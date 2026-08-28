//! Backup, CSV export, and reset commands (U6/U21: R39, R45, AE8, AE10).

use std::path::PathBuf;

use serde::Serialize;

use crate::backup::{self, BackupError};

use super::{lock_poisoned, with_dek, AppState, CommandError, CommandResult};

impl From<BackupError> for CommandError {
    fn from(error: BackupError) -> Self {
        let kind = match &error {
            BackupError::WrongPassword => "wrongSecret",
            BackupError::Malformed(_) | BackupError::NotAVault => "badBackup",
            BackupError::UnsupportedVersion { .. } => "unsupportedBackup",
            BackupError::Io(_) => "io",
            BackupError::Crypto(_) | BackupError::Vault(_) => "internal",
        };
        Self::new(kind, error.to_string())
    }
}

/// What a backup preflight found, for the overwrite confirmation (R45).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub schema_version: u32,
    pub initialized: bool,
    pub size_bytes: usize,
}

/// Writes an encrypted backup to `destination` (R45).
#[tauri::command]
pub async fn export_backup(
    state: tauri::State<'_, AppState>,
    destination: PathBuf,
    backup_password: String,
) -> CommandResult<()> {
    let archive = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        backup::export_backup(&vault, &state.vault_path, &backup_password)?
    };
    std::fs::write(&destination, archive).map_err(|e| CommandError::new("io", e.to_string()))?;
    Ok(())
}

/// Verifies a backup file without touching the live vault.
///
/// The UI calls this first, so its overwrite warning is shown only for a file
/// that has already proven itself decryptable and structurally sound (AE10).
#[tauri::command]
pub async fn inspect_backup(
    source: PathBuf,
    backup_password: String,
) -> CommandResult<BackupSummary> {
    let archive = std::fs::read(&source).map_err(|e| CommandError::new("io", e.to_string()))?;
    let report = backup::inspect_backup(&archive, &backup_password)?;
    Ok(BackupSummary {
        schema_version: report.schema_version,
        initialized: report.initialized,
        size_bytes: report.body_len,
    })
}

/// Restores a backup over the live vault.
///
/// Locks first and reopens afterwards: the vault file is about to be replaced
/// underneath SQLite, and any handle still holding the old file would write
/// stale WAL frames over the restored one.
#[tauri::command]
pub async fn restore_backup(
    state: tauri::State<'_, AppState>,
    source: PathBuf,
    backup_password: String,
) -> CommandResult<()> {
    let archive = std::fs::read(&source).map_err(|e| CommandError::new("io", e.to_string()))?;

    // Verify before disturbing anything.
    backup::inspect_backup(&archive, &backup_password)?;

    {
        let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
        session.lock();
    }

    let mut vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    *vault = crate::vault::Vault::open_in_memory()?;
    backup::restore_backup(&archive, &backup_password, &state.vault_path)?;
    *vault = crate::vault::Vault::open(&state.vault_path)?;
    Ok(())
}

/// Exports every credential as plaintext CSV (R39).
#[tauri::command]
pub fn export_csv(
    state: tauri::State<'_, AppState>,
    destination: PathBuf,
) -> CommandResult<String> {
    let csv = with_dek(&state, |vault, dek| {
        backup::export_credentials_csv(vault, dek).map_err(|e| match e {
            BackupError::Vault(inner) => inner,
            other => crate::vault::VaultError::Corrupt(other.to_string()),
        })
    })?;

    backup::write_restricted(&destination, &csv)?;
    Ok(backup::CSV_WARNING.to_string())
}

/// The warning shown beside the CSV controls.
#[tauri::command]
pub fn csv_warning() -> &'static str {
    backup::CSV_WARNING
}

/// Deletes the local vault and returns to first-run setup (AE8, R39).
#[tauri::command]
pub async fn reset_vault(state: tauri::State<'_, AppState>) -> CommandResult<()> {
    {
        let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
        session.lock();
    }

    let mut vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    // Drop the handle on the file before deleting it.
    *vault = crate::vault::Vault::open_in_memory()?;
    backup::reset_vault(&state.vault_path)?;
    *vault = crate::vault::Vault::open(&state.vault_path)?;
    Ok(())
}

/// A `.env` is text a human wrote; anything this large is not one, and reading
/// it would only succeed in wedging the editor.
const MAX_ENV_IMPORT_BYTES: u64 = 1024 * 1024;

/// Reads a `.env` the user picked, so the file's text can be dropped into the
/// editor (R5).
///
/// Rust does the reading for the same reason backup restore does: the frontend
/// receives a path from the native dialog and never gains filesystem access of
/// its own. The WebView cannot name a path the user did not choose.
#[tauri::command]
pub fn read_env_text(source: PathBuf) -> CommandResult<String> {
    let size = std::fs::metadata(&source)
        .map_err(|e| CommandError::new("io", e.to_string()))?
        .len();
    if size > MAX_ENV_IMPORT_BYTES {
        return Err(CommandError::new(
            "tooLarge",
            "That file is larger than 1 MB, so it is not an env file.",
        ));
    }

    let bytes = std::fs::read(&source).map_err(|e| CommandError::new("io", e.to_string()))?;

    // Refuse binary rather than storing replacement characters: a lossy
    // conversion would be saved and later pasted back as corrupted text.
    String::from_utf8(bytes).map_err(|_| {
        CommandError::new(
            "notText",
            "That file is not valid UTF-8 text, so it cannot be an env file.",
        )
    })
}
