//! First-run setup and recovery-code commands (U4: R5, R44, R46).

use std::time::Instant;

use serde::Serialize;

use crate::crypto::strength::{self, StrengthReport};
use crate::crypto::{calibrate, KdfParams};
use crate::vault;

use super::{lock_poisoned, AppState, CommandError, CommandResult};

/// What the frontend receives after a successful setup.
///
/// This is the only moment the recovery code exists in readable form
/// anywhere -- it is not stored, and no later command can reproduce it (R46).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResponse {
    pub recovery_code: String,
}

/// Scores a candidate master password (R44, KTD21).
///
/// Called on every keystroke by the setup form, so it must stay cheap: zxcvbn
/// scoring is pure CPU with no KDF work.
#[tauri::command]
pub fn password_strength(password: String, user_inputs: Vec<String>) -> StrengthReport {
    let refs: Vec<&str> = user_inputs.iter().map(String::as_str).collect();
    strength::evaluate(&password, &refs)
}

/// Creates the vault and returns the one-time recovery code.
///
/// Calibration runs here rather than at build time so the parameters match the
/// machine the vault actually lives on (KTD11). It costs roughly one unlock's
/// worth of time, once, during setup.
#[tauri::command]
pub async fn setup_vault(
    state: tauri::State<'_, AppState>,
    password: String,
) -> CommandResult<SetupResponse> {
    let params = calibrate().unwrap_or_else(|_| KdfParams::default());

    let outcome = {
        let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
        vault::create_vault(&vault, &password, params)?
    };

    // Setup leaves the vault unlocked: the user just proved they know the
    // password, and making them retype it immediately would be theatre.
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    session.unlock(outcome.dek, Instant::now());

    Ok(SetupResponse {
        recovery_code: outcome.recovery_display,
    })
}

/// Records the typed acknowledgment for the recovery code (R46).
///
/// The frontend gates its "I saved it" control on the user typing a
/// confirmation phrase; this records that it happened. Setup is not considered
/// finished until it does, so a user who closes the window mid-setup is
/// prompted again rather than left with an unacknowledged code.
#[tauri::command]
pub fn acknowledge_recovery_code(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CommandResult<()> {
    super::with_vault(&state, vault::acknowledge_recovery_code)?;
    // Setup is finished and the vault is already unlocked, so this is the
    // moment the app window appears.
    super::windows::reveal_app(&app);
    Ok(())
}

/// Checks a recovery code without unlocking anything (U5's verify path).
#[tauri::command]
pub fn verify_recovery_code(
    state: tauri::State<'_, AppState>,
    code: String,
) -> CommandResult<bool> {
    super::with_vault(&state, |vault| vault::verify_recovery_code(vault, &code))
}

/// Reports the calibrated parameters, for the About panel.
#[tauri::command]
pub fn kdf_parameters(state: tauri::State<'_, AppState>) -> CommandResult<KdfParams> {
    super::with_vault(&state, |vault| {
        crate::vault::VaultHeader::load(vault.connection())?
            .map(|header| header.kdf_params)
            .ok_or(crate::vault::VaultError::NotInitialized)
    })
    .map_err(|_: CommandError| CommandError::new("notInitialized", "This vault has no header yet."))
}
