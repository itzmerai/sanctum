//! Credential commands (U9/U10's IPC surface, introduced with U4's guard).
//!
//! **A password crosses the boundary only when the user asks for it.** The
//! list and detail views receive [`CredentialDto`], which has no password
//! field at all — not a masked one, not an empty string. Revealing or copying
//! is a separate, explicit command.
//!
//! That is not decoration. The WebView is the least trustworthy part of this
//! process; keeping every password out of the payload that renders a list of
//! forty entries means a rendering bug, a devtools session, or a stray
//! `console.log` cannot spill forty passwords at once.

use serde::{Deserialize, Serialize};

use crate::vault::{Credential, NewCredential};

use super::{with_dek, AppState, CommandError, CommandResult};

/// A credential as the UI sees it. No password field by construction.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialDto {
    #[serde(with = "crate::commands::ids::as_string")]
    pub id: i64,
    pub name: String,
    pub username: String,
    pub website: String,
    pub notes: String,
    pub tags: Vec<String>,
    #[serde(with = "crate::commands::ids::as_string_opt")]
    pub folder_id: Option<i64>,
    pub favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl CredentialDto {
    fn from_record(record: Credential, favorite: bool) -> Self {
        // Destructured rather than field-accessed so that adding a field to
        // `Credential` forces a decision here about whether it may cross.
        let Credential {
            id,
            name,
            username,
            password: _,
            website,
            notes,
            tags,
            folder_id,
            created_at,
            updated_at,
        } = record;

        Self {
            id,
            name,
            username,
            website,
            notes,
            tags,
            folder_id,
            favorite,
            created_at,
            updated_at,
        }
    }
}

/// What the create/edit form submits.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    pub name: String,
    pub username: String,
    pub password: String,
    pub website: String,
    pub notes: String,
    pub tags: Vec<String>,
    #[serde(with = "crate::commands::ids::as_string_opt")]
    pub folder_id: Option<i64>,
}

/// Maximum tags per credential (R22, AE6).
pub const MAX_TAGS: usize = 5;

impl CredentialInput {
    fn validate(&self) -> CommandResult<()> {
        if self.name.trim().is_empty() {
            return Err(CommandError::new("validation", "A name is required."));
        }
        if self.tags.len() > MAX_TAGS {
            return Err(CommandError::new(
                "validation",
                format!("A credential can have at most {MAX_TAGS} tags."),
            ));
        }
        Ok(())
    }

    fn into_record(self) -> NewCredential {
        NewCredential {
            name: self.name,
            username: self.username,
            password: self.password,
            website: self.website,
            notes: self.notes,
            tags: self.tags,
            folder_id: self.folder_id,
        }
    }
}

#[tauri::command]
pub fn list_credentials(state: tauri::State<'_, AppState>) -> CommandResult<Vec<CredentialDto>> {
    with_dek(&state, |vault, dek| {
        let favorites = vault.favorite_ids("credential")?;
        Ok(vault
            .list_credentials(dek)?
            .into_iter()
            .map(|record| {
                let favorite = favorites.contains(&record.id);
                CredentialDto::from_record(record, favorite)
            })
            .collect())
    })
}

#[tauri::command]
pub fn get_credential(
    state: tauri::State<'_, AppState>,
    id: String,
) -> CommandResult<Option<CredentialDto>> {
    let id = crate::commands::ids::parse_id(&id)?;
    with_dek(&state, |vault, dek| {
        let favorite = vault.is_favorite("credential", id)?;
        Ok(vault
            .get_credential(dek, id)?
            .map(|record| CredentialDto::from_record(record, favorite)))
    })
}

/// Returns one password in plaintext.
///
/// The only command that does. Kept separate so it is trivially auditable and
/// so U19's activity log can record reveals distinctly from reads.
#[tauri::command]
pub fn reveal_password(state: tauri::State<'_, AppState>, id: String) -> CommandResult<String> {
    let id = crate::commands::ids::parse_id(&id)?;
    with_dek(&state, |vault, dek| {
        vault
            .get_credential(dek, id)?
            .map(|record| record.password)
            .ok_or(crate::vault::VaultError::NotFound { id })
    })
}

#[tauri::command]
pub fn create_credential(
    state: tauri::State<'_, AppState>,
    input: CredentialInput,
) -> CommandResult<String> {
    input.validate()?;
    let record = input.into_record();
    // Returned as a string for the same reason it is sent as one.
    Ok(with_dek(&state, |vault, dek| vault.insert_credential(dek, &record))?.to_string())
}

#[tauri::command]
pub fn update_credential(
    state: tauri::State<'_, AppState>,
    id: String,
    input: CredentialInput,
) -> CommandResult<()> {
    let id = crate::commands::ids::parse_id(&id)?;
    input.validate()?;
    let record = input.into_record();
    with_dek(&state, |vault, dek| {
        vault.update_credential(dek, id, &record)
    })
}

#[tauri::command]
pub fn delete_credential(state: tauri::State<'_, AppState>, id: String) -> CommandResult<()> {
    let id = crate::commands::ids::parse_id(&id)?;
    // Deleting does not need the key, but it does need the vault unlocked --
    // otherwise a locked window could still destroy data.
    with_dek(&state, |vault, _dek| vault.delete_credential(id))
}

#[tauri::command]
pub fn set_favorite(
    state: tauri::State<'_, AppState>,
    entity_type: String,
    id: String,
    favorite: bool,
) -> CommandResult<()> {
    let id = crate::commands::ids::parse_id(&id)?;
    with_dek(&state, |vault, _dek| {
        vault.set_favorite(&entity_type, id, favorite)
    })
}

/// Counts credentials without needing the key, for the locked-state shell.
#[tauri::command]
pub fn credential_count(state: tauri::State<'_, AppState>) -> CommandResult<i64> {
    super::with_vault(&state, |vault| vault.credential_count())
}
