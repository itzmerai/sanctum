//! Sanctum core.
//!
//! Everything secret lives on this side of the IPC boundary (KTD15): the
//! data-encryption key is held in Rust-owned state and is never returned to the
//! WebView. Modules are added by their owning units:
//!
//! - `crypto`    (U2) Argon2id KDF, KEK/DEK wrapping, AES-256-GCM records
//! - `vault`     (U3) rusqlite store with per-record encryption
//! - `session`   (U4) DEK lifetime and auto-lock
//! - `commands`  (U4) the narrow `#[tauri::command]` surface
//! - `backup`    (U6) `.sanctumbak` container, restore, CSV export, reset
//! - `clipboard` (U7) Windows clipboard exclusion + guarded clear
//! - `activity`  (U19) local activity log

pub mod backup;
pub mod clipboard;
pub mod commands;
pub mod crypto;
pub mod session;
pub mod vault;

use std::path::PathBuf;
use std::time::Duration;

use tauri::{Emitter, Manager};

use commands::AppState;
use vault::Vault;

/// How often the background ticker checks the idle window.
///
/// Fifteen seconds rather than every second: the timeout is measured in
/// minutes, and the guard in `Session::dek` enforces it exactly on any real
/// access anyway. This ticker exists to lock an *idle* window whose user has
/// walked away, where a few seconds of imprecision is irrelevant.
const AUTO_LOCK_TICK: Duration = Duration::from_secs(15);

/// Event emitted when the vault locks itself, so the shell can clear state.
pub const EVENT_VAULT_LOCKED: &str = "sanctum://vault-locked";

/// Emitted after a scheduled clipboard clear runs.
pub const EVENT_CLIPBOARD_CLEARED: &str = "sanctum://clipboard-cleared";

/// Resolves the vault file location inside the app's data directory.
fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the application data directory: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir.join("sanctum.db"))
}

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let path = vault_path(&handle)?;
            let vault = Vault::open(&path)?;
            app.manage(AppState::new(vault, path));

            // Auto-lock ticker. Locking is a state transition the frontend
            // must hear about, because it has decrypted values on screen that
            // have to be cleared (KTD15).
            let ticker = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(AUTO_LOCK_TICK);

                let Some(state) = ticker.try_state::<AppState>() else {
                    continue;
                };
                let Ok(mut session) = state.session.lock() else {
                    // A poisoned session lock means another thread panicked
                    // holding it. Locking is the safe direction, but this
                    // thread cannot reach the state to do it; the guard in
                    // `with_dek` will refuse access anyway.
                    continue;
                };

                if session.enforce_idle_timeout(std::time::Instant::now()) {
                    drop(session);
                    let _ = ticker.emit(EVENT_VAULT_LOCKED, ());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // setup + recovery (U4)
            commands::setup::password_strength,
            commands::setup::setup_vault,
            commands::setup::acknowledge_recovery_code,
            commands::setup::verify_recovery_code,
            commands::setup::kdf_parameters,
            // session (U4)
            commands::session_cmds::vault_status,
            commands::session_cmds::unlock_vault,
            commands::session_cmds::unlock_with_recovery,
            commands::session_cmds::lock_vault,
            commands::session_cmds::touch_activity,
            commands::session_cmds::set_auto_lock_minutes,
            commands::session_cmds::poll_auto_lock,
            // credentials (U9/U10)
            commands::credentials::list_credentials,
            commands::credentials::get_credential,
            commands::credentials::reveal_password,
            commands::credentials::create_credential,
            commands::credentials::update_credential,
            commands::credentials::delete_credential,
            commands::credentials::set_favorite,
            commands::credentials::credential_count,
            // clipboard (U7)
            commands::clipboard_cmds::copy_password,
            commands::clipboard_cmds::copy_text,
            commands::clipboard_cmds::clear_clipboard,
            commands::clipboard_cmds::clipboard_clear_seconds,
            // data (U6/U21)
            commands::data::export_backup,
            commands::data::inspect_backup,
            commands::data::restore_backup,
            commands::data::export_csv,
            commands::data::csv_warning,
            commands::data::reset_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sanctum");
}
