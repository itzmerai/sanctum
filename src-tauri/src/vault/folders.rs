//! Folder storage (U18, introduced early because U6's CSV export needs names).
//!
//! Folders are scoped by `kind` — the reference design keeps Passwords and
//! Notes folders in separate tabs, and a credential must not be filed into a
//! notes folder.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault, VaultError};

/// Which side of the Folders screen a folder belongs to.
pub const KIND_PASSWORDS: &str = "passwords";
pub const KIND_NOTES: &str = "notes";

const COL_FOLDER_NAME: &str = "folder.name";

/// A decrypted folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Folder {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub color: String,
    pub item_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Vault {
    /// Creates a folder, returning its id.
    pub fn insert_folder(
        &self,
        dek: &SymmetricKey,
        kind: &str,
        name: &str,
        color: &str,
    ) -> Result<i64> {
        validate_kind(kind)?;
        let id = new_row_id()?;
        let now = now_unix();

        self.connection().execute(
            "INSERT INTO folders (id, kind, name_enc, color, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, kind, seal(dek, id, COL_FOLDER_NAME, name)?, color, now],
        )?;
        Ok(id)
    }

    /// Lists folders of one kind, with a live item count.
    ///
    /// The count is computed in SQL rather than by decrypting every child,
    /// which is why `folder_id` is one of the columns left in plaintext.
    pub fn list_folders(&self, dek: &SymmetricKey, kind: &str) -> Result<Vec<Folder>> {
        validate_kind(kind)?;
        let child_table = if kind == KIND_NOTES {
            "notes"
        } else {
            "credentials"
        };

        let sql = format!(
            "SELECT f.id, f.kind, f.name_enc, f.color, f.created_at, f.updated_at,
                    (SELECT COUNT(*) FROM {child_table} c WHERE c.folder_id = f.id)
             FROM folders f WHERE f.kind = ?1 ORDER BY f.created_at ASC"
        );

        let conn = self.connection();
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![kind], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;

        let mut out = Vec::new();
        for row in rows {
            let (id, kind, name_enc, color, created_at, updated_at, item_count) = row?;
            out.push(Folder {
                id,
                kind,
                name: unseal(dek, id, COL_FOLDER_NAME, &name_enc)?,
                color,
                item_count,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    }

    /// Every folder id mapped to its decrypted name, for CSV export and lookups.
    pub fn folder_names(&self, dek: &SymmetricKey) -> Result<HashMap<i64, String>> {
        let conn = self.connection();
        let mut stmt = conn.prepare("SELECT id, name_enc FROM folders")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })?;

        let mut out = HashMap::new();
        for row in rows {
            let (id, name_enc) = row?;
            out.insert(id, unseal(dek, id, COL_FOLDER_NAME, &name_enc)?);
        }
        Ok(out)
    }

    /// Renames a folder and/or changes its colour (R33).
    pub fn update_folder(
        &self,
        dek: &SymmetricKey,
        id: i64,
        name: &str,
        color: &str,
    ) -> Result<()> {
        let affected = self.connection().execute(
            "UPDATE folders SET name_enc = ?2, color = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, seal(dek, id, COL_FOLDER_NAME, name)?, color, now_unix()],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    /// Deletes a folder.
    ///
    /// Children are not deleted with it: the schema's `ON DELETE SET NULL`
    /// moves them to "no folder". Deleting a folder should never be a way to
    /// lose credentials by accident.
    pub fn delete_folder(&self, id: i64) -> Result<()> {
        let affected = self
            .connection()
            .execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        self.set_favorite("folder", id, false)?;
        Ok(())
    }

    /// Reads one folder.
    pub fn get_folder(&self, dek: &SymmetricKey, id: i64) -> Result<Option<Folder>> {
        let row = self
            .connection()
            .query_row(
                "SELECT kind, name_enc, color, created_at, updated_at FROM folders WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;

        let Some((kind, name_enc, color, created_at, updated_at)) = row else {
            return Ok(None);
        };

        Ok(Some(Folder {
            id,
            kind,
            name: unseal(dek, id, COL_FOLDER_NAME, &name_enc)?,
            color,
            item_count: 0,
            created_at,
            updated_at,
        }))
    }
}

fn validate_kind(kind: &str) -> Result<()> {
    if kind == KIND_PASSWORDS || kind == KIND_NOTES {
        Ok(())
    } else {
        Err(VaultError::Corrupt(format!(
            "{kind:?} is not a folder kind"
        )))
    }
}
