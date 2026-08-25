//! The vault store: an encrypted `rusqlite` database (U3).
//!
//! The DEK is never held here. Every method that touches a secret takes
//! `&SymmetricKey` explicitly, which keeps the key's lifetime owned by the
//! caller (U4 holds it in Tauri state, KTD15) and makes the metadata-only
//! methods visibly key-free -- they compile without one, so "readable while
//! locked" is a property of the type signature rather than a convention.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::crypto::{decrypt_record, encrypt_record, RecordAad, SymmetricKey};

use super::migrations;
use super::schema;
use super::{Result, VaultError};

/// An open vault database.
pub struct Vault {
    conn: Connection,
}

/// A credential as supplied by the caller, before it is stored.
#[derive(Debug, Clone, Default)]
pub struct NewCredential {
    pub name: String,
    pub username: String,
    pub password: String,
    pub website: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub folder_id: Option<i64>,
}

/// A decrypted credential.
///
/// Deliberately not `Serialize`: this type carries a plaintext password, and
/// only the narrow command layer (U4/U9) decides what crosses to the WebView.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub password: String,
    pub website: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub folder_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// The plaintext columns of a credential, readable without the DEK.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialMeta {
    pub id: i64,
    pub folder_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Vault {
    /// Opens (creating if absent) a vault at `path` and brings it up to date.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_connection(conn)
    }

    /// Opens a private in-memory vault. Tests and one-shot verification only.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::from_connection(conn)
    }

    fn from_connection(mut conn: Connection) -> Result<Self> {
        // WAL keeps readers from blocking on the writer and is the mode
        // KTD13's checkpoint-then-rename assumes for restore. An in-memory
        // database silently ignores it, which is fine.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        conn.pragma_update(None, "foreign_keys", true)?;

        migrations::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    /// Borrows the underlying connection (header access, U5 rotation, U6 backup).
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Mutable access, for callers that need a transaction.
    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// The schema version this vault is currently at.
    pub fn schema_version(&self) -> Result<u32> {
        migrations::current_version(&self.conn)
    }

    /// Flushes the write-ahead log into the main database file.
    ///
    /// Needed before anything inspects, copies, or replaces the file itself --
    /// otherwise recent writes are still sitting in `-wal`.
    pub fn checkpoint(&self) -> Result<()> {
        self.conn
            .pragma_update(None, "wal_checkpoint", "TRUNCATE")?;
        Ok(())
    }

    // --- credentials ---------------------------------------------------------

    /// Encrypts and inserts a credential, returning its id.
    pub fn insert_credential(&self, dek: &SymmetricKey, new: &NewCredential) -> Result<i64> {
        let id = new_row_id()?;
        let now = now_unix();
        let tags =
            serde_json::to_string(&new.tags).map_err(|e| VaultError::Corrupt(e.to_string()))?;

        self.conn.execute(
            "INSERT INTO credentials (
                 id, name_enc, username_enc, password_enc, website_enc, notes_enc,
                 tags_enc, folder_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                seal(dek, id, schema::COL_CREDENTIAL_NAME, &new.name)?,
                seal(dek, id, schema::COL_CREDENTIAL_USERNAME, &new.username)?,
                seal(dek, id, schema::COL_CREDENTIAL_PASSWORD, &new.password)?,
                seal(dek, id, schema::COL_CREDENTIAL_WEBSITE, &new.website)?,
                seal(dek, id, schema::COL_CREDENTIAL_NOTES, &new.notes)?,
                seal(dek, id, schema::COL_CREDENTIAL_TAGS, &tags)?,
                new.folder_id,
                now,
                now,
            ],
        )?;

        Ok(id)
    }

    /// Reads and decrypts one credential.
    pub fn get_credential(&self, dek: &SymmetricKey, id: i64) -> Result<Option<Credential>> {
        let row = self
            .conn
            .query_row(
                "SELECT name_enc, username_enc, password_enc, website_enc, notes_enc,
                        tags_enc, folder_id, created_at, updated_at
                 FROM credentials WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, Vec<u8>>(4)?,
                        row.get::<_, Vec<u8>>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()?;

        let Some((name, username, password, website, notes, tags, folder_id, created, updated)) =
            row
        else {
            return Ok(None);
        };

        Ok(Some(Credential {
            id,
            name: unseal(dek, id, schema::COL_CREDENTIAL_NAME, &name)?,
            username: unseal(dek, id, schema::COL_CREDENTIAL_USERNAME, &username)?,
            password: unseal(dek, id, schema::COL_CREDENTIAL_PASSWORD, &password)?,
            website: unseal(dek, id, schema::COL_CREDENTIAL_WEBSITE, &website)?,
            notes: unseal(dek, id, schema::COL_CREDENTIAL_NOTES, &notes)?,
            tags: parse_tags(&unseal(dek, id, schema::COL_CREDENTIAL_TAGS, &tags)?)?,
            folder_id,
            created_at: created,
            updated_at: updated,
        }))
    }

    /// Reads and decrypts every credential, newest first.
    pub fn list_credentials(&self, dek: &SymmetricKey) -> Result<Vec<Credential>> {
        let ids: Vec<i64> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM credentials ORDER BY created_at DESC, id DESC")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            // A row that vanished between the two statements is not an error;
            // a row that fails to decrypt is.
            if let Some(credential) = self.get_credential(dek, id)? {
                out.push(credential);
            }
        }
        Ok(out)
    }

    /// Replaces a credential's contents in place, keeping its id.
    pub fn update_credential(
        &self,
        dek: &SymmetricKey,
        id: i64,
        updated: &NewCredential,
    ) -> Result<()> {
        let tags =
            serde_json::to_string(&updated.tags).map_err(|e| VaultError::Corrupt(e.to_string()))?;

        let affected = self.conn.execute(
            "UPDATE credentials SET
                 name_enc = ?2, username_enc = ?3, password_enc = ?4, website_enc = ?5,
                 notes_enc = ?6, tags_enc = ?7, folder_id = ?8, updated_at = ?9
             WHERE id = ?1",
            params![
                id,
                seal(dek, id, schema::COL_CREDENTIAL_NAME, &updated.name)?,
                seal(dek, id, schema::COL_CREDENTIAL_USERNAME, &updated.username)?,
                seal(dek, id, schema::COL_CREDENTIAL_PASSWORD, &updated.password)?,
                seal(dek, id, schema::COL_CREDENTIAL_WEBSITE, &updated.website)?,
                seal(dek, id, schema::COL_CREDENTIAL_NOTES, &updated.notes)?,
                seal(dek, id, schema::COL_CREDENTIAL_TAGS, &tags)?,
                updated.folder_id,
                now_unix(),
            ],
        )?;

        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    /// Deletes a credential.
    pub fn delete_credential(&self, id: i64) -> Result<()> {
        let affected = self
            .conn
            .execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    // --- favorites (R34) -----------------------------------------------------

    /// Marks or unmarks an entity as a favourite.
    ///
    /// Kept in its own table rather than as a column on each entity so the
    /// Favorites view is one query across every type instead of a UNION that
    /// grows each time a module is added.
    pub fn set_favorite(&self, entity_type: &str, id: i64, favorite: bool) -> Result<()> {
        if favorite {
            self.conn.execute(
                "INSERT INTO favorites (entity_type, entity_id, created_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(entity_type, entity_id) DO NOTHING",
                params![entity_type, id, now_unix()],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM favorites WHERE entity_type = ?1 AND entity_id = ?2",
                params![entity_type, id],
            )?;
        }
        Ok(())
    }

    /// Whether one entity is favourited.
    pub fn is_favorite(&self, entity_type: &str, id: i64) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM favorites WHERE entity_type = ?1 AND entity_id = ?2",
            params![entity_type, id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Every favourited id of one entity type.
    ///
    /// Returned as a set so a list render is one query plus O(1) lookups
    /// rather than one query per row.
    pub fn favorite_ids(&self, entity_type: &str) -> Result<std::collections::HashSet<i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT entity_id FROM favorites WHERE entity_type = ?1")?;
        let rows = stmt.query_map(params![entity_type], |row| row.get(0))?;
        rows.collect::<std::result::Result<_, _>>()
            .map_err(Into::into)
    }

    /// Removes any favourite rows pointing at entities that no longer exist.
    ///
    /// The favourites table cannot carry a foreign key (its target table
    /// varies by row), so deletions are reconciled here.
    pub fn prune_favorites(&self) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM favorites
             WHERE (entity_type = 'credential' AND entity_id NOT IN (SELECT id FROM credentials))
                OR (entity_type = 'note'       AND entity_id NOT IN (SELECT id FROM notes))
                OR (entity_type = 'folder'     AND entity_id NOT IN (SELECT id FROM folders))",
            params![],
        )?)
    }

    // --- metadata, readable while locked -------------------------------------

    /// Counts credentials. Takes no key, so it works with the vault locked.
    pub fn credential_count(&self) -> Result<i64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM credentials", [], |row| row.get(0))?)
    }

    /// Lists the plaintext columns of every credential, without the DEK.
    pub fn list_credential_meta(&self) -> Result<Vec<CredentialMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, folder_id, created_at, updated_at
             FROM credentials ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(CredentialMeta {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

// --- column sealing ----------------------------------------------------------

/// Encrypts one column value, bound to its row and column (KTD12).
pub(super) fn seal(
    dek: &SymmetricKey,
    row_id: i64,
    column: &str,
    plaintext: &str,
) -> Result<Vec<u8>> {
    Ok(encrypt_record(
        dek,
        &RecordAad::new(row_id, column),
        plaintext.as_bytes(),
    )?)
}

/// Decrypts one column value.
pub(super) fn unseal(dek: &SymmetricKey, row_id: i64, column: &str, blob: &[u8]) -> Result<String> {
    let bytes = decrypt_record(dek, &RecordAad::new(row_id, column), blob)?;
    String::from_utf8(bytes)
        .map_err(|_| VaultError::Corrupt(format!("{column} did not decrypt to valid UTF-8")))
}

fn parse_tags(json: &str) -> Result<Vec<String>> {
    serde_json::from_str(json).map_err(|e| VaultError::Corrupt(format!("tags: {e}")))
}

/// Generates a random positive row id.
///
/// Not `AUTOINCREMENT`: SQLite reuses rowids after a delete, and the record
/// AAD binds ciphertext to its row id (KTD12). A reused id would let a deleted
/// record's blob be replayed into whatever row later occupies that id and
/// still authenticate. 63 bits of randomness removes the possibility.
pub(super) fn new_row_id() -> Result<i64> {
    let mut bytes = [0u8; 8];
    crate::crypto::fill_random(&mut bytes)?;
    // Clear the sign bit: SQLite rowids are signed, and a negative id is legal
    // but needlessly surprising in a database someone may inspect by hand.
    Ok(i64::from_le_bytes(bytes) & i64::MAX)
}

/// Unix time in **milliseconds**.
///
/// Milliseconds rather than seconds for two reasons: two edits inside one
/// second must still order correctly (row ids are random and cannot break the
/// tie), and JavaScript measures time this way, so no IPC boundary has to
/// convert.
pub(super) fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
