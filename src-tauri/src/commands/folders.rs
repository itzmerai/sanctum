//! Folder and generator commands (U10/U11/U18).

use serde::Serialize;

use crate::crypto::generator::{self, GeneratorOptions};
use crate::vault::Folder;

use super::{with_dek, AppState, CommandError, CommandResult};

/// A folder as the UI sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDto {
    #[serde(with = "crate::commands::ids::as_string")]
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub color: String,
    pub item_count: i64,
    pub favorite: bool,
    pub created_at: i64,
}

impl FolderDto {
    fn from_record(record: Folder, favorite: bool) -> Self {
        Self {
            id: record.id,
            kind: record.kind,
            name: record.name,
            color: record.color,
            item_count: record.item_count,
            favorite,
            created_at: record.created_at,
        }
    }
}

#[tauri::command]
pub fn list_folders(
    state: tauri::State<'_, AppState>,
    kind: String,
) -> CommandResult<Vec<FolderDto>> {
    with_dek(&state, |vault, dek| {
        let favorites = vault.favorite_ids("folder")?;
        Ok(vault
            .list_folders(dek, &kind)?
            .into_iter()
            .map(|record| {
                let favorite = favorites.contains(&record.id);
                FolderDto::from_record(record, favorite)
            })
            .collect())
    })
}

#[tauri::command]
pub fn create_folder(
    state: tauri::State<'_, AppState>,
    kind: String,
    name: String,
    color: String,
) -> CommandResult<String> {
    if name.trim().is_empty() {
        return Err(CommandError::new(
            "validation",
            "A folder name is required.",
        ));
    }
    Ok(with_dek(&state, |vault, dek| {
        vault.insert_folder(dek, &kind, name.trim(), &color)
    })?
    .to_string())
}

#[tauri::command]
pub fn update_folder(
    state: tauri::State<'_, AppState>,
    id: String,
    name: String,
    color: String,
) -> CommandResult<()> {
    let id = crate::commands::ids::parse_id(&id)?;
    if name.trim().is_empty() {
        return Err(CommandError::new(
            "validation",
            "A folder name is required.",
        ));
    }
    with_dek(&state, |vault, dek| {
        vault.update_folder(dek, id, name.trim(), &color)
    })
}

#[tauri::command]
pub fn delete_folder(state: tauri::State<'_, AppState>, id: String) -> CommandResult<()> {
    let id = crate::commands::ids::parse_id(&id)?;
    with_dek(&state, |vault, _dek| vault.delete_folder(id))
}

/// Generates a password (R25).
///
/// Generation happens in Rust rather than the WebView: `crypto.getRandomValues`
/// would be adequate, but keeping every CSPRNG draw on one side of the boundary
/// means there is exactly one place to audit for randomness quality.
#[tauri::command]
pub fn generate_password(options: GeneratorOptions) -> CommandResult<String> {
    generator::generate(options).map_err(|error| CommandError::new("validation", error.to_string()))
}
