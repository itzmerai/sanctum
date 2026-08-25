//! Encrypted vault store (U3).
//!
//! A plain `rusqlite` database in WAL mode where every secret-bearing column
//! is an AES-256-GCM blob produced by [`crate::crypto`] (KTD10). SQLCipher was
//! considered and rejected: application-layer encryption keeps one cipher
//! stack in the codebase, gives per-field control over what is protected, and
//! leaves the nonce and AAD invariants (KTD12) directly unit-testable rather
//! than buried inside a driver.
//!
//! What that choice costs is written down in [`schema`]: table and index
//! *metadata* is visible to anyone holding the file. SQLCipher remains the
//! documented fallback if hiding that ever becomes a requirement.

mod folders;
mod header;
mod lifecycle;
mod migrations;
mod rotate;
mod schema;
mod store;

pub use folders::{Folder, KIND_NOTES, KIND_PASSWORDS};
pub use header::VaultHeader;
pub use lifecycle::{
    acknowledge_recovery_code, create_vault, is_initialized, recovery_acknowledged,
    unlock_with_password, unlock_with_recovery, verify_recovery_code, SetupOutcome,
};
pub use rotate::{
    change_master_password, reset_master_password_with_recovery, rotate_recovery_code,
    RotationOutcome, RotationPhase,
};
pub use schema::latest_version as latest_schema_version;
pub use store::{Credential, CredentialMeta, NewCredential, Vault};

/// Errors surfaced by the vault store.
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// Wraps a crypto failure without adding detail. A record that will not
    /// decrypt is reported the same way whether the key is wrong or the file
    /// was edited -- see `crypto::CryptoError::Decrypt`.
    #[error(transparent)]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error("no record with id {id}")]
    NotFound { id: i64 },

    #[error("this vault has already been set up")]
    AlreadyInitialized,

    #[error("this vault has not been set up yet")]
    NotInitialized,

    /// One opaque failure for a wrong master password and a wrong recovery
    /// code alike. Distinguishing them would tell an attacker which secret
    /// they are closer to guessing.
    #[error("that secret does not open this vault")]
    WrongSecret,

    #[error("{reason}")]
    WeakPassword { reason: String },

    #[error("vault data is corrupt: {0}")]
    Corrupt(String),

    #[error("this vault uses schema version {found}, but this build supports {supported}")]
    SchemaTooNew { found: u32, supported: u32 },

    #[error("this vault uses crypto format {found}, but this build supports {supported}")]
    CryptoFormatUnsupported { found: u16, supported: u16 },
}

pub type Result<T> = std::result::Result<T, VaultError>;

#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod rotate_tests;
#[cfg(test)]
mod tests;
