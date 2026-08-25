//! Window transitions (U4, KTD18).
//!
//! Showing the app window is a consequence of the vault being unlocked, and
//! the vault being unlocked is a fact only Rust knows. Driving the transition
//! from here rather than from the WebView means:
//!
//! * the unlock window's capability set stays minimal — it needs no
//!   `allow-show` / `allow-hide` / `allow-get-all-windows` at all;
//! * a compromised or buggy WebView cannot reveal the app window without a
//!   successful unwrap having actually happened, because the only code path
//!   that calls [`reveal_app`] is the one that just installed a DEK.
//!
//! A failure to move a window is logged rather than propagated: the unlock
//! itself succeeded, and turning a cosmetic failure into an unlock error would
//! be a worse outcome than a window in the wrong state.

use tauri::{AppHandle, Emitter, Manager};

pub const UNLOCK_WINDOW: &str = "unlock";
pub const MAIN_WINDOW: &str = "main";

/// Shows the application window and hides the unlock window.
pub fn reveal_app(app: &AppHandle) {
    // Announce before showing: the window is already mounted and listening, so
    // it can refresh its state as it appears rather than after a visible beat
    // of stale content.
    let _ = app.emit(crate::EVENT_VAULT_UNLOCKED, ());
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(unlock) = app.get_webview_window(UNLOCK_WINDOW) {
        let _ = unlock.hide();
    }
}

/// Shows the unlock window and hides the application window.
///
/// Order matters: the unlock window is shown *first*, so there is never a
/// moment with no visible window — on Windows that reads as the app having
/// crashed.
pub fn reveal_lock(app: &AppHandle) {
    if let Some(unlock) = app.get_webview_window(UNLOCK_WINDOW) {
        let _ = unlock.show();
        let _ = unlock.set_focus();
    }
    if let Some(main) = app.get_webview_window(MAIN_WINDOW) {
        let _ = main.hide();
    }
}
