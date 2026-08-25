//! Per-record AES-256-GCM (KTD10, KTD12).
//!
//! Two invariants carry the security of this layer:
//!
//! * **A fresh random 96-bit nonce per encryption.** `aes-gcm` will happily
//!   reuse a nonce if handed one, and nonce reuse under GCM is catastrophic --
//!   it leaks the XOR of two plaintexts and, worse, the authentication
//!   subkey. Callers cannot supply a nonce through this API at all.
//! * **AAD binds the ciphertext to its location.** Without it, an attacker
//!   with write access to the file could move a password blob from one row to
//!   another, or from the notes column into the password column, and it would
//!   still authenticate. See `RecordAad`.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};

use super::{fill_random, CryptoError, Result, SymmetricKey, VAULT_FORMAT_VERSION};

/// AES-GCM nonce length in bytes (96 bits, the size GCM is defined for).
pub const NONCE_LEN: usize = 12;

/// GCM authentication tag length in bytes.
const TAG_LEN: usize = 16;

/// The context a ciphertext is cryptographically pinned to (KTD12).
///
/// Encoded length-prefixed so no two distinct contexts can serialise to the
/// same bytes: `(row 1, "ab")` and `(row 1, "a")` followed by a stray `b` must
/// not collide.
pub struct RecordAad<'ctx> {
    /// The row this value belongs to.
    pub row_id: i64,
    /// Which column, by purpose -- for example `credential.password`.
    pub column: &'ctx str,
    /// Crypto format version (KTD22), not the schema version.
    pub format_version: u16,
}

impl<'ctx> RecordAad<'ctx> {
    /// Builds an AAD for the current crypto format.
    pub fn new(row_id: i64, column: &'ctx str) -> Self {
        Self {
            row_id,
            column,
            format_version: VAULT_FORMAT_VERSION,
        }
    }

    fn encode(&self) -> Vec<u8> {
        let col = self.column.as_bytes();
        let mut out = Vec::with_capacity(2 + 8 + 2 + col.len());
        out.extend_from_slice(&self.format_version.to_le_bytes());
        out.extend_from_slice(&self.row_id.to_le_bytes());
        out.extend_from_slice(&(col.len() as u16).to_le_bytes());
        out.extend_from_slice(col);
        out
    }
}

fn cipher(key: &SymmetricKey) -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.expose()))
}

/// Encrypts one record field.
///
/// Returns `nonce || ciphertext || tag` as a single blob for storage.
pub fn encrypt_record(
    key: &SymmetricKey,
    aad: &RecordAad<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    fill_random(&mut nonce_bytes)?;

    let ciphertext = cipher(key)
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: &aad.encode(),
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;

    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

/// Decrypts a `nonce || ciphertext || tag` blob.
///
/// Fails if the key is wrong, the AAD does not match the context the value was
/// written under, or a single bit of the blob was altered -- all reported as
/// the same opaque error, so none of it is usable as an oracle.
pub fn decrypt_record(key: &SymmetricKey, aad: &RecordAad<'_>, blob: &[u8]) -> Result<Vec<u8>> {
    let minimum = NONCE_LEN + TAG_LEN;
    if blob.len() < minimum {
        return Err(CryptoError::MalformedCiphertext {
            expected: minimum,
            actual: blob.len(),
        });
    }

    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);

    cipher(key)
        .decrypt(
            Nonce::from_slice(nonce_bytes),
            Payload {
                msg: ciphertext,
                aad: &aad.encode(),
            },
        )
        .map_err(|_| CryptoError::Decrypt)
}

/// Encrypts with caller-supplied AAD bytes.
///
/// For contexts that are not a table row -- the backup container binds its own
/// header here (KTD20) rather than a (row, column) pair.
pub fn encrypt_record_with_aad(
    key: &SymmetricKey,
    aad: &[u8],
    plaintext: &[u8],
) -> Result<Vec<u8>> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    fill_random(&mut nonce_bytes)?;

    let ciphertext = cipher(key)
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;

    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

/// Decrypts a blob sealed by `encrypt_record_with_aad`.
pub fn decrypt_record_with_aad(key: &SymmetricKey, aad: &[u8], blob: &[u8]) -> Result<Vec<u8>> {
    let minimum = NONCE_LEN + TAG_LEN;
    if blob.len() < minimum {
        return Err(CryptoError::MalformedCiphertext {
            expected: minimum,
            actual: blob.len(),
        });
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    cipher(key)
        .decrypt(
            Nonce::from_slice(nonce_bytes),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| CryptoError::Decrypt)
}

/// Extracts the nonce from a stored blob. Test and audit helper only.
#[cfg(test)]
pub(crate) fn nonce_of(blob: &[u8]) -> &[u8] {
    &blob[..NONCE_LEN]
}
