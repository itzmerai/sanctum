//! Clipboard commands (U7: R10, R43).
//!
//! The password never travels to the frontend to be copied. The frontend asks
//! Sanctum to copy credential *N*, and the plaintext goes from the vault to
//! the clipboard entirely inside Rust — it is never a JavaScript string, never
//! in a DOM node, and never in a devtools heap snapshot.

use std::time::Duration;

use crate::clipboard::{self, ClipboardError, CopyReceipt, CLEAR_AFTER};

use super::{with_dek, AppState, CommandError, CommandResult};

impl From<ClipboardError> for CommandError {
    fn from(error: ClipboardError) -> Self {
        let kind = match &error {
            ClipboardError::Unavailable => "clipboardBusy",
            ClipboardError::Unsupported => "clipboardUnsupported",
            ClipboardError::Failed(_) => "clipboardFailed",
        };
        Self::new(kind, error.to_string())
    }
}

/// Copies a credential's password, then schedules the guarded clear.
#[tauri::command]
pub fn copy_password(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: i64,
) -> CommandResult<CopyReceipt> {
    let password = with_dek(&state, |vault, dek| {
        vault
            .get_credential(dek, id)?
            .map(|record| record.password)
            .ok_or(crate::vault::VaultError::NotFound { id })
    })?;

    let receipt = clipboard::copy_secret(&password)?;
    schedule_clear(app, receipt, CLEAR_AFTER);
    Ok(receipt)
}

/// Copies an arbitrary value the frontend already holds — a generated password
/// that has not been saved yet (U11), or a username.
///
/// Unlike [`copy_password`] this does handle a string from the WebView, which
/// is unavoidable for a value the WebView produced.
#[tauri::command]
pub fn copy_text(
    app: tauri::AppHandle,
    text: String,
    auto_clear: bool,
) -> CommandResult<CopyReceipt> {
    let receipt = clipboard::copy_secret(&text)?;
    if auto_clear {
        schedule_clear(app, receipt, CLEAR_AFTER);
    }
    Ok(receipt)
}

/// Clears the clipboard now, if it still holds our value.
#[tauri::command]
pub fn clear_clipboard(receipt: CopyReceipt) -> CommandResult<bool> {
    Ok(clipboard::clear_if_unchanged(receipt)?)
}

/// How long a copied secret survives, so the UI can show a countdown.
#[tauri::command]
pub fn clipboard_clear_seconds() -> u64 {
    CLEAR_AFTER.as_secs()
}

/// Spawns the delayed clear.
///
/// A detached thread rather than a timer the frontend owns: if the WebView is
/// reloaded, navigated, or crashes during those 30 seconds, a frontend timer
/// would vanish and leave the password sitting on the clipboard indefinitely.
fn schedule_clear(app: tauri::AppHandle, receipt: CopyReceipt, after: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(after);
        if let Ok(cleared) = clipboard::clear_if_unchanged(receipt) {
            use tauri::Emitter;
            let _ = app.emit(crate::EVENT_CLIPBOARD_CLEARED, cleared);
        }
    });
}
