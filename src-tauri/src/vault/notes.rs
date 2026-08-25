//! Note storage (U14: R26, R27).

use rusqlite::{params, OptionalExtension};

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault, VaultError};

const COL_TITLE: &str = "note.title";
const COL_BODY: &str = "note.body";
const COL_LABELS: &str = "note.labels";

/// A decrypted note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    pub id: i64,
    pub title: String,
    /// Markdown source. TipTap round-trips through this (KTD17).
    pub body: String,
    pub labels: Vec<String>,
    pub folder_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A note as submitted.
#[derive(Debug, Clone, Default)]
pub struct NewNote {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub folder_id: Option<i64>,
}

impl Vault {
    pub fn insert_note(&self, dek: &SymmetricKey, new: &NewNote) -> Result<i64> {
        let id = new_row_id()?;
        let now = now_unix();
        let labels =
            serde_json::to_string(&new.labels).map_err(|e| VaultError::Corrupt(e.to_string()))?;

        self.connection().execute(
            "INSERT INTO notes (id, title_enc, body_enc, labels_enc, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                id,
                seal(dek, id, COL_TITLE, &new.title)?,
                seal(dek, id, COL_BODY, &new.body)?,
                seal(dek, id, COL_LABELS, &labels)?,
                new.folder_id,
                now,
            ],
        )?;
        Ok(id)
    }

    pub fn get_note(&self, dek: &SymmetricKey, id: i64) -> Result<Option<Note>> {
        let row = self
            .connection()
            .query_row(
                "SELECT title_enc, body_enc, labels_enc, folder_id, created_at, updated_at
                 FROM notes WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?;

        let Some((title, body, labels, folder_id, created_at, updated_at)) = row else {
            return Ok(None);
        };

        Ok(Some(Note {
            id,
            title: unseal(dek, id, COL_TITLE, &title)?,
            body: unseal(dek, id, COL_BODY, &body)?,
            labels: serde_json::from_str(&unseal(dek, id, COL_LABELS, &labels)?)
                .map_err(|e| VaultError::Corrupt(format!("note labels: {e}")))?,
            folder_id,
            created_at,
            updated_at,
        }))
    }

    /// Every note, most recently modified first — the order the reference list
    /// uses, since a note being edited should rise to the top.
    pub fn list_notes(&self, dek: &SymmetricKey) -> Result<Vec<Note>> {
        let ids: Vec<i64> = {
            let conn = self.connection();
            let mut stmt =
                conn.prepare("SELECT id FROM notes ORDER BY updated_at DESC, id DESC")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(note) = self.get_note(dek, id)? {
                out.push(note);
            }
        }
        Ok(out)
    }

    pub fn update_note(&self, dek: &SymmetricKey, id: i64, updated: &NewNote) -> Result<()> {
        let labels = serde_json::to_string(&updated.labels)
            .map_err(|e| VaultError::Corrupt(e.to_string()))?;

        let affected = self.connection().execute(
            "UPDATE notes SET title_enc = ?2, body_enc = ?3, labels_enc = ?4,
                              folder_id = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                id,
                seal(dek, id, COL_TITLE, &updated.title)?,
                seal(dek, id, COL_BODY, &updated.body)?,
                seal(dek, id, COL_LABELS, &labels)?,
                updated.folder_id,
                now_unix(),
            ],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let affected = self
            .connection()
            .execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        self.set_favorite("note", id, false)?;
        Ok(())
    }

    /// Copies a note (R27's Duplicate action).
    ///
    /// The copy is a new row with a new id, so its ciphertext is re-sealed
    /// under that id's AAD rather than sharing blobs with the original.
    pub fn duplicate_note(&self, dek: &SymmetricKey, id: i64) -> Result<i64> {
        let source = self.get_note(dek, id)?.ok_or(VaultError::NotFound { id })?;

        self.insert_note(
            dek,
            &NewNote {
                title: format!("{} (copy)", source.title),
                body: source.body,
                labels: source.labels,
                folder_id: source.folder_id,
            },
        )
    }

    pub fn note_count(&self) -> Result<i64> {
        Ok(self
            .connection()
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?)
    }
}
