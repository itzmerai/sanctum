//! Sanctum crypto core (U2).
//!
//! Key hierarchy (KTD9) -- one data key, two independent wraps:
//!
//! ```text
//!   master password --Argon2id--> master KEK --wraps--> DEK --> every record
//!   recovery code   --fast KDF--> recovery KEK --wraps--> DEK
//! ```
//!
//! Wrapping the DEK rather than deriving record keys from the password is what
//! makes a password change an O(1) header rewrite instead of a full-vault
//! re-encryption -- the property U5's crash-safety argument rests on.
//!
//! Nothing here touches the database or the IPC boundary; this module is pure
//! and directly unit-testable.

mod aead;
mod kdf;
mod kekdek;
mod recovery;
mod secrets;
pub mod strength;

pub use aead::{
    decrypt_record, decrypt_record_with_aad, encrypt_record, encrypt_record_with_aad, RecordAad,
    NONCE_LEN,
};
pub use kdf::{
    calibrate, calibrate_to, derive_kek, generate_salt, KdfParams, SALT_LEN, TARGET_UNLOCK,
};
pub use kekdek::{unwrap_dek, wrap_dek, WrapPurpose, WrappedKey};
pub use recovery::{
    derive_recovery_kek, format_for_display, generate_recovery_code, normalize_recovery_code,
    RecoveryCode, CODE_LEN, CODE_PREFIX,
};
pub use secrets::{SecretBytes, SymmetricKey, KEY_LEN};

/// Crypto format identifier bound into every record's AAD (KTD12).
///
/// Deliberately **not** the schema-migration version (KTD22): adding a column
/// or a table must not change this, or existing ciphertext would stop
/// authenticating. It changes only on a real crypto-format change, which then
/// requires re-encrypting every record under the new AAD.
pub const VAULT_FORMAT_VERSION: u16 = 1;

/// Errors surfaced by the crypto core.
///
/// Every authentication failure collapses into a single opaque variant. A
/// caller must not be able to distinguish "wrong key" from "tampered AAD" from
/// "corrupt ciphertext" -- that distinction is an oracle.
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("decryption failed: wrong key, wrong context, or corrupt data")]
    Decrypt,

    #[error("key derivation failed: {0}")]
    Kdf(String),

    #[error("the operating system random number generator failed: {0}")]
    Rng(String),

    #[error("malformed ciphertext: expected at least {expected} bytes, got {actual}")]
    MalformedCiphertext { expected: usize, actual: usize },

    #[error("invalid Argon2 parameters: {0}")]
    InvalidParams(String),
}

pub type Result<T> = std::result::Result<T, CryptoError>;

/// Fills `dest` from the operating system CSPRNG.
pub(crate) fn fill_random(dest: &mut [u8]) -> Result<()> {
    getrandom::fill(dest).map_err(|e| CryptoError::Rng(e.to_string()))
}

#[cfg(test)]
mod recovery_tests;
#[cfg(test)]
mod tests;
