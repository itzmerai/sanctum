//! The local activity log (U19: R35).
//!
//! Records that something happened, and to what it was called. It does **not**
//! record what changed — no old value, no new value, no field diff. A change
//! log that stored previous passwords would be a second, unversioned copy of
//! the vault's history sitting next to it.
//!
//! The subject name is still a secret (it is a credential or note title), so
//! it is encrypted like any other record. The entity type, the action and the
//! timestamp stay plaintext so the log can be listed and cleared without the
//! key.

use rusqlite::params;

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault};

const COL_SUBJECT: &str = "activity.subject";

pub const ACTION_CREATED: &str = "created";
pub const ACTION_UPDATED: &str = "updated";
pub const ACTION_DELETED: &str = "deleted";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivityEntry {
    pub id: i64,
    /// `credential`, `note`, `task`, `income`, `folder`.
    pub entity_type: String,
    pub action: String,
    /// The name of the thing acted on.
    pub subject: String,
    pub created_at: i64,
}

/// How many entries to keep.
///
/// The log is a convenience, not an audit trail, and an unbounded one would
/// grow forever inside a file the user backs up and restores.
const MAX_ENTRIES: i64 = 500;

impl Vault {
    /// Appends an entry.
    pub fn log_activity(
        &self,
        dek: &SymmetricKey,
        entity_type: &str,
        action: &str,
        subject: &str,
    ) -> Result<()> {
        let id = new_row_id()?;
        // A monotonic sequence, assigned here rather than derived from the id or
        // the clock: ids are random and a burst of entries shares one second,
        // so neither can order the log reliably.
        self.connection().execute(
            "INSERT INTO activity (id, entity_type, action, subject_enc, created_at, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM activity))",
            params![
                id,
                entity_type,
                action,
                seal(dek, id, COL_SUBJECT, subject)?,
                now_unix(),
            ],
        )?;

        // Trim in the same call that appends, so the cap holds without a
        // separate maintenance pass that could be forgotten.
        self.connection().execute(
            "DELETE FROM activity WHERE id NOT IN (
                 SELECT id FROM activity ORDER BY seq DESC LIMIT ?1
             )",
            params![MAX_ENTRIES],
        )?;
        Ok(())
    }

    /// Reads the log, newest first.
    pub fn list_activity(&self, dek: &SymmetricKey, limit: i64) -> Result<Vec<ActivityEntry>> {
        let rows: Vec<(i64, String, String, Vec<u8>, i64)> = {
            let conn = self.connection();
            let mut stmt = conn.prepare(
                "SELECT id, entity_type, action, subject_enc, created_at
                 FROM activity ORDER BY seq DESC LIMIT ?1",
            )?;
            let mapped = stmt.query_map(params![limit], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?;
            mapped.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(rows.len());
        for (id, entity_type, action, subject_enc, created_at) in rows {
            out.push(ActivityEntry {
                id,
                entity_type,
                action,
                subject: unseal(dek, id, COL_SUBJECT, &subject_enc)?,
                created_at,
            });
        }
        Ok(out)
    }

    /// Empties the log (R35's Clear action).
    pub fn clear_activity(&self) -> Result<usize> {
        Ok(self.connection().execute("DELETE FROM activity", [])?)
    }

    /// Counts entries. No key needed.
    pub fn activity_count(&self) -> Result<i64> {
        Ok(self
            .connection()
            .query_row("SELECT COUNT(*) FROM activity", [], |row| row.get(0))?)
    }
}
