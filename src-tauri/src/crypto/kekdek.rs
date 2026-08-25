//! KEK/DEK key wrapping (KTD9, KTD14).
//!
//! One random data-encryption key protects every record. That DEK is stored
//! only in wrapped form, encrypted under a key-encryption key -- once by the
//! KEK derived from the master password, and once by the KEK derived from the
//! recovery code (KTD14). Two independent wraps of the *same* key is what lets
//! either secret open the vault, and what makes rotating one of them a small
//! header write rather than a re-encryption of the whole store.
//!
//! Each wrap binds its purpose into the AAD, so a `Recovery` blob moved into
//! the `MasterPassword` slot fails to authenticate instead of silently
//! granting access under the wrong secret.

use super::{
    aead::NONCE_LEN, fill_random, secrets::KEY_LEN, CryptoError, Result, SymmetricKey,
    VAULT_FORMAT_VERSION,
};

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};

/// GCM tag length in bytes.
const TAG_LEN: usize = 16;

/// Which secret a wrapped DEK blob belongs to.
///
/// Bound into the wrap AAD, so the two blobs in a vault header are not
/// interchangeable even though both wrap the same DEK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WrapPurpose {
    /// Wrapped under the Argon2id-derived master-password KEK.
    MasterPassword,
    /// Wrapped under the recovery-code KEK (KTD14).
    RecoveryCode,
    /// Wrapped under a backup file password (KTD20). A distinct context, so a
    /// blob lifted from a vault header cannot be pasted into a backup.
    Backup,
}

impl WrapPurpose {
    fn as_context(self) -> &'static [u8] {
        match self {
            Self::MasterPassword => b"sanctum.dek.master",
            Self::RecoveryCode => b"sanctum.dek.recovery",
            Self::Backup => b"sanctum.dek.backup",
        }
    }
}

/// A DEK encrypted under a KEK, as stored in the vault header.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WrappedKey {
    /// Which secret unwraps this blob.
    pub purpose: WrapPurpose,
    /// Crypto format version this blob was written under (KTD22).
    pub format_version: u16,
    /// Random 96-bit nonce.
    pub nonce: Vec<u8>,
    /// Wrapped key material with its GCM tag appended.
    pub ciphertext: Vec<u8>,
}

fn wrap_aad(purpose: WrapPurpose, format_version: u16) -> Vec<u8> {
    let ctx = purpose.as_context();
    let mut out = Vec::with_capacity(2 + 2 + ctx.len());
    out.extend_from_slice(&format_version.to_le_bytes());
    out.extend_from_slice(&(ctx.len() as u16).to_le_bytes());
    out.extend_from_slice(ctx);
    out
}

fn cipher(kek: &SymmetricKey) -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(kek.expose()))
}

/// Encrypts the DEK under a KEK.
pub fn wrap_dek(
    kek: &SymmetricKey,
    dek: &SymmetricKey,
    purpose: WrapPurpose,
) -> Result<WrappedKey> {
    let mut nonce_bytes = [0u8; NONCE_LEN];
    fill_random(&mut nonce_bytes)?;

    let ciphertext = cipher(kek)
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: dek.expose(),
                aad: &wrap_aad(purpose, VAULT_FORMAT_VERSION),
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;

    Ok(WrappedKey {
        purpose,
        format_version: VAULT_FORMAT_VERSION,
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

/// Recovers the DEK from a wrapped blob.
///
/// A wrong KEK, a blob moved between purposes, or any modification to the
/// stored bytes all fail identically -- and never panic, which matters because
/// this runs on every unlock attempt with attacker-chosen input.
pub fn unwrap_dek(kek: &SymmetricKey, wrapped: &WrappedKey) -> Result<SymmetricKey> {
    if wrapped.nonce.len() != NONCE_LEN {
        return Err(CryptoError::MalformedCiphertext {
            expected: NONCE_LEN,
            actual: wrapped.nonce.len(),
        });
    }
    if wrapped.ciphertext.len() != KEY_LEN + TAG_LEN {
        return Err(CryptoError::MalformedCiphertext {
            expected: KEY_LEN + TAG_LEN,
            actual: wrapped.ciphertext.len(),
        });
    }

    let mut plaintext = cipher(kek)
        .decrypt(
            Nonce::from_slice(&wrapped.nonce),
            Payload {
                msg: &wrapped.ciphertext,
                aad: &wrap_aad(wrapped.purpose, wrapped.format_version),
            },
        )
        .map_err(|_| CryptoError::Decrypt)?;

    // Length is already guaranteed by the ciphertext-size check above, but
    // convert without indexing so a future change cannot turn this into a panic.
    let mut key_bytes: [u8; KEY_LEN] =
        plaintext
            .as_slice()
            .try_into()
            .map_err(|_| CryptoError::MalformedCiphertext {
                expected: KEY_LEN,
                actual: plaintext.len(),
            })?;

    let key = SymmetricKey::from_bytes(&mut key_bytes);

    // The decrypted DEK passed through a plain Vec; scrub it before it drops.
    use zeroize::Zeroize;
    plaintext.zeroize();

    Ok(key)
}
