//! Rotation commands (U21 exposing U5: R11, R12, R38, R40, R42).
//!
//! Each returns the new recovery code, because every rotation issues one — a
//! password change invalidates the old code (R42), so handing back a fresh one
//! is not optional and the caller must display it exactly once.

use std::time::Instant;

use crate::vault;

use super::{lock_poisoned, AppState, CommandResult};

/// Changes the master password and rotates the recovery code (R40, R42).
///
/// `async` because it derives two Argon2id keys. The session is re-armed with
/// the same DEK afterwards: rotation never changes the data key, so an
/// unlocked vault stays unlocked rather than throwing the user back to the
/// lock screen for an operation they just authenticated.
#[tauri::command]
pub async fn change_master_password(
    state: tauri::State<'_, AppState>,
    current_password: String,
    new_password: String,
) -> CommandResult<String> {
    let outcome = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        vault::change_master_password(&vault, &current_password, &new_password)?
    };

    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.unlock(outcome.dek, Instant::now());
    Ok(outcome.recovery_display)
}

/// Issues a new recovery code, keeping the master password (R12, R38).
#[tauri::command]
pub async fn rotate_recovery_code(
    state: tauri::State<'_, AppState>,
    master_password: String,
) -> CommandResult<String> {
    let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    Ok(vault::rotate_recovery_code(&vault, &master_password)?)
}

/// Sets a new master password using the recovery code (AE11).
///
/// Reached from the unlock window when the password is lost. Leaves the vault
/// unlocked, since the user has just proven possession of a valid secret.
#[tauri::command]
pub async fn reset_password_with_recovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    recovery_code: String,
    new_password: String,
) -> CommandResult<String> {
    let outcome = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        vault::reset_master_password_with_recovery(&vault, &recovery_code, &new_password)?
    };

    {
        let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
        session.unlock(outcome.dek, Instant::now());
    }
    super::windows::reveal_app(&app);
    Ok(outcome.recovery_display)
}
