//! Env file storage (U2: R1, R3, R4, R6).
//!
//! An env file record holds the `.env` **exactly as the user supplied it**.
//! Nothing here parses, normalises, reformats or reorders the text: comments,
//! blank lines, quoting style and key order are part of what the user saved,
//! and a file that comes back subtly different is worse than useless in a
//! fresh checkout. Parsing happens in the frontend, for display only (KTD4).

use rusqlite::{params, OptionalExtension};

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault, VaultError};

// Bound into every record's AAD, so these are part of the on-disk format
// (KTD6). Renaming one makes existing ciphertext undecryptable.
const COL_TITLE: &str = "env_file.title";
const COL_CONTENT: &str = "env_file.content";

/// The environments an env file can belong to (R2).
pub const ENV_PRODUCTION: &str = "production";
pub const ENV_STAGING: &str = "staging";
pub const ENV_LOCAL: &str = "local";

/// A decrypted env file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvFile {
    pub id: i64,
    /// The project this file belongs to.
    pub title: String,
    /// The raw file text, byte-for-byte as saved.
    pub content: String,
    pub environment: String,
    pub folder_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// An env file as submitted.
#[derive(Debug, Clone, Default)]
pub struct NewEnvFile {
    pub title: String,
    pub content: String,
    pub environment: String,
    pub folder_id: Option<i64>,
}

/// Rejects an environment the schema would refuse anyway.
///
/// The CHECK constraint is the real guarantee; this exists so a bad value
/// surfaces as a validation error the UI can show rather than an opaque
/// database failure.
fn validate_environment(environment: &str) -> Result<()> {
    if environment == ENV_PRODUCTION || environment == ENV_STAGING || environment == ENV_LOCAL {
        Ok(())
    } else {
        Err(VaultError::Corrupt(format!(
            "{environment:?} is not an environment"
        )))
    }
}

impl Vault {
    pub fn insert_env_file(&self, dek: &SymmetricKey, new: &NewEnvFile) -> Result<i64> {
        validate_environment(&new.environment)?;
        let id = new_row_id()?;
        let now = now_unix();

        self.connection().execute(
            "INSERT INTO env_files
                 (id, title_enc, content_enc, environment, folder_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                id,
                seal(dek, id, COL_TITLE, &new.title)?,
                seal(dek, id, COL_CONTENT, &new.content)?,
                new.environment,
                new.folder_id,
                now,
            ],
        )?;
        Ok(id)
    }

    pub fn get_env_file(&self, dek: &SymmetricKey, id: i64) -> Result<Option<EnvFile>> {
        let row = self
            .connection()
            .query_row(
                "SELECT title_enc, content_enc, environment, folder_id, created_at, updated_at
                 FROM env_files WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?;

        let Some((title, content, environment, folder_id, created_at, updated_at)) = row else {
            return Ok(None);
        };

        Ok(Some(EnvFile {
            id,
            title: unseal(dek, id, COL_TITLE, &title)?,
            content: unseal(dek, id, COL_CONTENT, &content)?,
            environment,
            folder_id,
            created_at,
            updated_at,
        }))
    }

    /// Every env file, most recently modified first — the same ordering the
    /// notes list uses, so an edited record rises to the top.
    pub fn list_env_files(&self, dek: &SymmetricKey) -> Result<Vec<EnvFile>> {
        let ids: Vec<i64> = {
            let conn = self.connection();
            let mut stmt =
                conn.prepare("SELECT id FROM env_files ORDER BY updated_at DESC, id DESC")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(env_file) = self.get_env_file(dek, id)? {
                out.push(env_file);
            }
        }
        Ok(out)
    }

    pub fn update_env_file(&self, dek: &SymmetricKey, id: i64, updated: &NewEnvFile) -> Result<()> {
        validate_environment(&updated.environment)?;

        let affected = self.connection().execute(
            "UPDATE env_files SET title_enc = ?2, content_enc = ?3, environment = ?4,
                                  folder_id = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                id,
                seal(dek, id, COL_TITLE, &updated.title)?,
                seal(dek, id, COL_CONTENT, &updated.content)?,
                updated.environment,
                updated.folder_id,
                now_unix(),
            ],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    pub fn delete_env_file(&self, id: i64) -> Result<()> {
        let affected = self
            .connection()
            .execute("DELETE FROM env_files WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        self.set_favorite("env_file", id, false)?;
        Ok(())
    }

    pub fn env_file_count(&self) -> Result<i64> {
        Ok(self
            .connection()
            .query_row("SELECT COUNT(*) FROM env_files", [], |row| row.get(0))?)
    }
}
