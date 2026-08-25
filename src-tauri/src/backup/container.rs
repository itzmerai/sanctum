//! The `.sanctumbak` AEAD container (U6, KTD20).
//!
//! ```text
//! magic "SANCTUMBAK"            10 bytes
//! format version                 2 bytes  LE
//! Argon2id m_cost / t_cost / p   12 bytes LE
//! salt                          16 bytes
//! wrapped backup DEK length      4 bytes  LE
//! wrapped backup DEK             n bytes
//! nonce                         12 bytes
//! AEAD(body) || tag             rest
//! ```
//!
//! Every header field up to and including the wrapped key is bound into the
//! body's AAD, mirroring KTD12. That is what stops a downgrade: an attacker
//! cannot rewrite the stored Argon2 parameters to something trivial and have
//! the body still authenticate, because the parameters are part of what the
//! tag covers.
//!
//! **The body is the database file.** Not a JSON dump of rows. A dump would
//! have to be extended every time a module adds a table, and a backup that
//! silently omits a table is the worst possible bug in a backup system. The
//! file already contains every table, and its records are already encrypted
//! under the vault's own DEK, so the container is protecting an
//! already-encrypted artefact — the backup password guards the file, and the
//! vault's master password still guards its contents after restore.

use crate::crypto::{
    derive_kek, generate_salt, unwrap_dek, wrap_dek, KdfParams, SecretBytes, SymmetricKey,
    WrapPurpose,
};

use super::{BackupError, Result};

pub const MAGIC: &[u8; 10] = b"SANCTUMBAK";
pub const FORMAT_VERSION: u16 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

/// Argon2id cost for a backup file.
///
/// Deliberately heavier than the interactive unlock target: a backup is opened
/// rarely and may sit in cloud storage or on a USB stick for years, so it can
/// afford several seconds of derivation in exchange for a much worse day for
/// anyone who steals it.
fn backup_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 262_144,
        t_cost: 6,
        p_cost: 4,
    }
    .clamped_to_floor()
}

/// The parsed header of a container.
pub struct ContainerHeader {
    pub format_version: u16,
    pub kdf_params: KdfParams,
    pub salt: Vec<u8>,
    pub wrapped_key: Vec<u8>,
    /// The exact bytes bound into the body AAD.
    pub aad: Vec<u8>,
    /// Offset at which the nonce begins.
    pub body_offset: usize,
}

/// Seals `body` into a container protected by `password`.
pub fn seal(body: &[u8], password: &str) -> Result<Vec<u8>> {
    seal_with(body, password, backup_params())
}

/// As [`seal`], with explicit Argon2id cost.
///
/// Production always uses [`backup_params`]; this exists so tests can run at
/// the KTD11 floor instead of paying 256 MiB of derivation per case.
pub fn seal_with(body: &[u8], password: &str, params: KdfParams) -> Result<Vec<u8>> {
    let params = params.clamped_to_floor();
    let salt = generate_salt()?;

    let kek = derive_kek(&SecretBytes::from_str_secret(password), &salt, params)?;
    let body_key = SymmetricKey::generate()?;
    let wrapped = wrap_dek(&kek, &body_key, WrapPurpose::Backup)?;
    let wrapped_bytes =
        serde_json::to_vec(&wrapped).map_err(|e| BackupError::Malformed(e.to_string()))?;

    let mut header = Vec::new();
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    header.extend_from_slice(&params.m_cost_kib.to_le_bytes());
    header.extend_from_slice(&params.t_cost.to_le_bytes());
    header.extend_from_slice(&params.p_cost.to_le_bytes());
    header.extend_from_slice(&salt);
    header.extend_from_slice(&(wrapped_bytes.len() as u32).to_le_bytes());
    header.extend_from_slice(&wrapped_bytes);

    // The body is encrypted with the record AEAD, using the header as AAD.
    // Row id 0 and a fixed column label give it a context distinct from any
    // vault record, so a record blob can never be replayed as a backup body.
    let sealed = crate::crypto::encrypt_record_with_aad(&body_key, &header, body)?;

    let mut out = header;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Parses and validates a container header.
pub fn parse_header(bytes: &[u8]) -> Result<ContainerHeader> {
    let fixed = MAGIC.len() + 2 + 12 + SALT_LEN + 4;
    if bytes.len() < fixed {
        return Err(BackupError::Malformed(
            "file is too short to be a Sanctum backup".into(),
        ));
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(BackupError::Malformed(
            "this is not a Sanctum backup file".into(),
        ));
    }

    // Explicit offsets rather than a cursor closure: every read below is
    // bounds-checked by the length guard above, and a fixed layout is easier
    // to compare against the format comment than mutation-in-a-closure.
    let mut at = MAGIC.len();

    let format_version = u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    at += 2;
    if format_version != FORMAT_VERSION {
        return Err(BackupError::UnsupportedVersion {
            found: format_version,
            supported: FORMAT_VERSION,
        });
    }

    let read_u32 = |offset: usize| -> u32 {
        u32::from_le_bytes([
            bytes[offset],
            bytes[offset + 1],
            bytes[offset + 2],
            bytes[offset + 3],
        ])
    };

    let kdf_params = KdfParams {
        m_cost_kib: read_u32(at),
        t_cost: read_u32(at + 4),
        p_cost: read_u32(at + 8),
    };
    at += 12;

    // A malicious file could claim absurd parameters to exhaust memory before
    // the tag is ever checked, so bound them before deriving anything.
    if kdf_params.m_cost_kib > 4 * 1_048_576 || kdf_params.t_cost > 64 || kdf_params.p_cost > 64 {
        return Err(BackupError::Malformed(
            "backup declares implausible key-derivation parameters".into(),
        ));
    }

    let salt = bytes[at..at + SALT_LEN].to_vec();
    at += SALT_LEN;

    let wrapped_len = read_u32(at) as usize;
    at += 4;

    if wrapped_len > 4096 || bytes.len() < at + wrapped_len + NONCE_LEN + TAG_LEN {
        return Err(BackupError::Malformed("backup header is truncated".into()));
    }
    let wrapped_key = bytes[at..at + wrapped_len].to_vec();
    at += wrapped_len;

    Ok(ContainerHeader {
        format_version,
        kdf_params,
        salt,
        wrapped_key,
        aad: bytes[..at].to_vec(),
        body_offset: at,
    })
}

/// Opens a container, returning the body.
///
/// The tag is verified before a single byte is returned, which is what lets
/// restore promise it never overwrites a live vault with corrupt data (AE10).
pub fn open(bytes: &[u8], password: &str) -> Result<Vec<u8>> {
    let header = parse_header(bytes)?;

    let kek = derive_kek(
        &SecretBytes::from_str_secret(password),
        &header.salt,
        header.kdf_params,
    )?;

    let wrapped = serde_json::from_slice(&header.wrapped_key)
        .map_err(|e| BackupError::Malformed(e.to_string()))?;
    let body_key = unwrap_dek(&kek, &wrapped).map_err(|_| BackupError::WrongPassword)?;

    crate::crypto::decrypt_record_with_aad(&body_key, &header.aad, &bytes[header.body_offset..])
        .map_err(|_| BackupError::WrongPassword)
}
