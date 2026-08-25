//! Unlock, lock, and auto-lock commands (U4: R6, R9, AE1).

use std::time::{Duration, Instant};

use serde::Serialize;

use crate::vault;

use super::{lock_poisoned, AppState, CommandResult};

/// Everything the shell needs to decide which window to show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// Whether first-run setup has happened.
    pub initialized: bool,
    /// Whether the DEK is currently loaded.
    pub locked: bool,
    /// Whether the user has acknowledged their recovery code (R46).
    pub recovery_acknowledged: bool,
    /// Current idle window, in minutes.
    pub auto_lock_minutes: u64,
}

/// Reports vault and session state. Safe to call while locked.
#[tauri::command]
pub fn vault_status(state: tauri::State<'_, AppState>) -> CommandResult<VaultStatus> {
    let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    let session = state.session.lock().map_err(|_| lock_poisoned("session"))?;

    let initialized = vault::is_initialized(&vault)?;
    Ok(VaultStatus {
        initialized,
        locked: session.is_locked(),
        recovery_acknowledged: initialized && vault::recovery_acknowledged(&vault)?,
        auto_lock_minutes: session.auto_lock().as_secs() / 60,
    })
}

/// Unlocks with the master password (R6).
///
/// `async` because Argon2id at the calibrated parameters takes roughly 750 ms
/// (KTD11), and a synchronous command would block the IPC thread and freeze
/// the window for the duration.
#[tauri::command]
pub async fn unlock_vault(
    state: tauri::State<'_, AppState>,
    password: String,
) -> CommandResult<()> {
    let dek = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        vault::unlock_with_password(&vault, &password)?
    };

    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.unlock(dek, Instant::now());
    Ok(())
}

/// Unlocks with the recovery code (R12).
#[tauri::command]
pub async fn unlock_with_recovery(
    state: tauri::State<'_, AppState>,
    code: String,
) -> CommandResult<()> {
    let dek = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        vault::unlock_with_recovery(&vault, &code)?
    };

    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.unlock(dek, Instant::now());
    Ok(())
}

/// Locks the vault, dropping the DEK (R9, KTD15).
#[tauri::command]
pub fn lock_vault(state: tauri::State<'_, AppState>) -> CommandResult<()> {
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.lock();
    Ok(())
}

/// Records user activity, restarting the idle window.
///
/// The frontend calls this on real interaction only. It is deliberately not
/// called by polling or background refresh, which would keep the vault open
/// indefinitely on an unattended machine.
#[tauri::command]
pub fn touch_activity(state: tauri::State<'_, AppState>) -> CommandResult<()> {
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.touch(Instant::now());
    Ok(())
}

/// Sets the idle window in minutes (R38).
#[tauri::command]
pub fn set_auto_lock_minutes(state: tauri::State<'_, AppState>, minutes: u64) -> CommandResult<()> {
    // Clamped rather than rejected: the settings field is a number input, and
    // an out-of-range value should land on the nearest sane one instead of
    // erroring at someone who typed too many digits.
    let clamped = minutes.clamp(1, 24 * 60);
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.set_auto_lock(Duration::from_secs(clamped * 60));
    Ok(())
}

/// Applies the idle timeout and reports whether the vault is now locked.
///
/// The background ticker calls this; so does the shell on window focus, which
/// is what catches a machine that was suspended rather than merely idle.
#[tauri::command]
pub fn poll_auto_lock(state: tauri::State<'_, AppState>) -> CommandResult<bool> {
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.enforce_idle_timeout(Instant::now());
    Ok(session.is_locked())
}
