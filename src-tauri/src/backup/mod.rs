//! Backup, restore, CSV export, and reset (U6: R39, R45, AE8, AE10).

pub mod container;
mod csv_export;
mod restore;

pub use csv_export::write_restricted;
pub use csv_export::{export_credentials_csv, CSV_WARNING};
pub use restore::{
    export_backup, export_backup_with, inspect_backup, reset_vault, restore_backup,
    RestorePreflight,
};

/// Errors from the backup subsystem.
#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Crypto(#[from] crate::crypto::CryptoError),

    #[error(transparent)]
    Vault(#[from] crate::vault::VaultError),

    /// The container did not authenticate. Reported identically for a wrong
    /// password and for tampered bytes -- distinguishing them would confirm to
    /// an attacker that they had guessed the password of a file they had also
    /// modified.
    #[error("that password does not open this backup, or the file has been altered")]
    WrongPassword,

    #[error("{0}")]
    Malformed(String),

    #[error("this backup uses format {found}, but this build supports {supported}")]
    UnsupportedVersion { found: u16, supported: u16 },

    #[error("the restored file is not a usable Sanctum vault")]
    NotAVault,
}

pub type Result<T> = std::result::Result<T, BackupError>;

#[cfg(test)]
mod tests;
