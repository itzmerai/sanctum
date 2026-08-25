//! The IPC surface (U4).
//!
//! Deliberately narrow. The DEK lives in [`AppState`] on this side of the
//! boundary and never appears in a return type — the WebView receives
//! decrypted *values* for the records it asks about, never the key that
//! produced them (KTD15).
//!
//! Every command that touches ciphertext goes through [`with_dek`], which is
//! the only path to the key and enforces the idle timeout on the way. A new
//! command cannot forget to check the lock, because there is nowhere else to
//! get a key from.

pub mod clipboard_cmds;
pub mod credentials;
pub mod data;
pub mod session_cmds;
pub mod setup;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;

use crate::crypto::SymmetricKey;
use crate::session::{Session, SessionError};
use crate::vault::{Vault, VaultError};

/// Application state, owned by Tauri and shared across commands.
pub struct AppState {
    pub vault: Mutex<Vault>,
    pub session: Mutex<Session>,
    pub vault_path: PathBuf,
}

impl AppState {
    pub fn new(vault: Vault, vault_path: PathBuf) -> Self {
        Self {
            vault: Mutex::new(vault),
            session: Mutex::new(Session::new()),
            vault_path,
        }
    }
}

/// A failure the frontend can branch on.
///
/// `kind` is a stable machine-readable tag; `message` is for display. The two
/// are separate so the UI never parses prose to decide what happened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub kind: &'static str,
    pub message: String,
}

impl CommandError {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// The one error every guarded command can return.
    pub fn locked() -> Self {
        Self::new("locked", "The vault is locked.")
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl From<SessionError> for CommandError {
    fn from(_: SessionError) -> Self {
        Self::locked()
    }
}

impl From<VaultError> for CommandError {
    fn from(error: VaultError) -> Self {
        // Map to stable tags. Crypto failures collapse into `wrongSecret`
        // rather than exposing whether the key, the AAD, or the bytes were at
        // fault -- the distinction is an oracle (see `CryptoError::Decrypt`).
        let kind = match &error {
            VaultError::NotFound { .. } => "notFound",
            VaultError::AlreadyInitialized => "alreadyInitialized",
            VaultError::NotInitialized => "notInitialized",
            VaultError::WrongSecret | VaultError::Crypto(_) => "wrongSecret",
            VaultError::WeakPassword { .. } => "weakPassword",
            VaultError::SchemaTooNew { .. } | VaultError::CryptoFormatUnsupported { .. } => {
                "unsupportedVault"
            }
            VaultError::Corrupt(_) | VaultError::Sqlite(_) => "internal",
        };
        Self::new(kind, error.to_string())
    }
}

/// A poisoned mutex means another thread panicked while holding vault or
/// session state. Recovering the guard and carrying on could operate on
/// half-updated state, so this reports rather than papers over it.
pub fn lock_poisoned(what: &str) -> CommandError {
    CommandError::internal(format!(
        "{what} state was left inconsistent by an earlier error"
    ))
}

pub type CommandResult<T> = std::result::Result<T, CommandError>;

/// Runs `f` with the unlocked DEK, or fails with `locked`.
///
/// The single chokepoint for key access from the command layer. It enforces
/// the idle window before handing the key over and records the call as user
/// activity.
pub fn with_dek<T>(
    state: &AppState,
    f: impl FnOnce(&Vault, &SymmetricKey) -> Result<T, VaultError>,
) -> CommandResult<T> {
    let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    let mut session = state.session.lock().map_err(|_| lock_poisoned("session"))?;
    let dek = session.dek(Instant::now())?;
    f(&vault, dek).map_err(CommandError::from)
}

/// Runs `f` against the vault without needing the DEK.
///
/// For metadata reads that are legitimate while locked (counts, timestamps).
pub fn with_vault<T>(
    state: &AppState,
    f: impl FnOnce(&Vault) -> Result<T, VaultError>,
) -> CommandResult<T> {
    let vault = state.vault.lock().map_err(|_| lock_poisoned("vault"))?;
    f(&vault).map_err(CommandError::from)
}
