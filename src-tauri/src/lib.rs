//! Sanctum core.
//!
//! Everything secret lives on this side of the IPC boundary (KTD15): the
//! data-encryption key is held in Rust-owned state and is never returned to the
//! WebView. Modules are added by their owning units:
//!
//! - `crypto`    (U2) Argon2id KDF, KEK/DEK wrapping, AES-256-GCM records
//! - `vault`     (U3) rusqlite store with per-record encryption
//! - `commands`  (U4) the narrow `#[tauri::command]` surface
//! - `backup`    (U6) `.sanctumbak` container, restore, CSV export, reset
//! - `clipboard` (U7) Windows clipboard exclusion + guarded clear
//! - `activity`  (U19) local activity log

pub mod crypto;

/// Builds and runs the Tauri application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running Sanctum");
}
