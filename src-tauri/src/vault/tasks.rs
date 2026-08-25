//! Task storage (U15: R28, R29).
//!
//! `status`, `priority` and `due_date` stay plaintext so the grouped view,
//! the due-date sort and the Calendar's month query are SQL rather than a
//! decrypt-everything pass. See `schema.rs` for what that discloses.

use rusqlite::{params, OptionalExtension};

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault, VaultError};

const COL_TITLE: &str = "task.title";
const COL_DESCRIPTION: &str = "task.description";
const COL_TAGS: &str = "task.tags";

pub const STATUS_TODO: &str = "todo";
pub const STATUS_IN_PROGRESS: &str = "in_progress";
pub const STATUS_COMPLETED: &str = "completed";

pub const PRIORITY_LOW: &str = "low";
pub const PRIORITY_MEDIUM: &str = "medium";
pub const PRIORITY_HIGH: &str = "high";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: String,
    pub priority: String,
    /// Unix seconds, or `None` for no due date.
    pub due_date: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewTask {
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: String,
    pub priority: String,
    pub due_date: Option<i64>,
}

impl Default for NewTask {
    fn default() -> Self {
        Self {
            title: String::new(),
            description: String::new(),
            tags: Vec::new(),
            status: STATUS_TODO.into(),
            priority: PRIORITY_MEDIUM.into(),
            due_date: None,
        }
    }
}

fn validate(status: &str, priority: &str) -> Result<()> {
    if ![STATUS_TODO, STATUS_IN_PROGRESS, STATUS_COMPLETED].contains(&status) {
        return Err(VaultError::Corrupt(format!("{status:?} is not a status")));
    }
    if ![PRIORITY_LOW, PRIORITY_MEDIUM, PRIORITY_HIGH].contains(&priority) {
        return Err(VaultError::Corrupt(format!(
            "{priority:?} is not a priority"
        )));
    }
    Ok(())
}

impl Vault {
    pub fn insert_task(&self, dek: &SymmetricKey, new: &NewTask) -> Result<i64> {
        validate(&new.status, &new.priority)?;
        let id = new_row_id()?;
        let now = now_unix();
        let tags =
            serde_json::to_string(&new.tags).map_err(|e| VaultError::Corrupt(e.to_string()))?;

        self.connection().execute(
            "INSERT INTO tasks (id, title_enc, description_enc, tags_enc, status, priority,
                                due_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id,
                seal(dek, id, COL_TITLE, &new.title)?,
                seal(dek, id, COL_DESCRIPTION, &new.description)?,
                seal(dek, id, COL_TAGS, &tags)?,
                new.status,
                new.priority,
                new.due_date,
                now,
            ],
        )?;
        Ok(id)
    }

    pub fn get_task(&self, dek: &SymmetricKey, id: i64) -> Result<Option<Task>> {
        let row = self
            .connection()
            .query_row(
                "SELECT title_enc, description_enc, tags_enc, status, priority, due_date,
                        created_at, updated_at
                 FROM tasks WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()?;

        let Some((title, description, tags, status, priority, due_date, created_at, updated_at)) =
            row
        else {
            return Ok(None);
        };

        Ok(Some(Task {
            id,
            title: unseal(dek, id, COL_TITLE, &title)?,
            description: unseal(dek, id, COL_DESCRIPTION, &description)?,
            tags: serde_json::from_str(&unseal(dek, id, COL_TAGS, &tags)?)
                .map_err(|e| VaultError::Corrupt(format!("task tags: {e}")))?,
            status,
            priority,
            due_date,
            created_at,
            updated_at,
        }))
    }

    /// Every task. Ordered by due date with undated tasks last, which is what
    /// the reference's "Due date" sort shows.
    pub fn list_tasks(&self, dek: &SymmetricKey) -> Result<Vec<Task>> {
        let ids: Vec<i64> = {
            let conn = self.connection();
            let mut stmt = conn.prepare(
                "SELECT id FROM tasks
                 ORDER BY (due_date IS NULL), due_date ASC, created_at DESC",
            )?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(task) = self.get_task(dek, id)? {
                out.push(task);
            }
        }
        Ok(out)
    }

    pub fn update_task(&self, dek: &SymmetricKey, id: i64, updated: &NewTask) -> Result<()> {
        validate(&updated.status, &updated.priority)?;
        let tags =
            serde_json::to_string(&updated.tags).map_err(|e| VaultError::Corrupt(e.to_string()))?;

        let affected = self.connection().execute(
            "UPDATE tasks SET title_enc = ?2, description_enc = ?3, tags_enc = ?4,
                              status = ?5, priority = ?6, due_date = ?7, updated_at = ?8
             WHERE id = ?1",
            params![
                id,
                seal(dek, id, COL_TITLE, &updated.title)?,
                seal(dek, id, COL_DESCRIPTION, &updated.description)?,
                seal(dek, id, COL_TAGS, &tags)?,
                updated.status,
                updated.priority,
                updated.due_date,
                now_unix(),
            ],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    /// Flips a task's status without touching anything else.
    ///
    /// Its own statement rather than a read-modify-write, so ticking a
    /// checkbox cannot lose a concurrent edit to the task's text.
    pub fn set_task_status(&self, id: i64, status: &str) -> Result<()> {
        validate(status, PRIORITY_MEDIUM)?;
        let affected = self.connection().execute(
            "UPDATE tasks SET status = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, status, now_unix()],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    pub fn delete_task(&self, id: i64) -> Result<()> {
        let affected = self
            .connection()
            .execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    /// Counts open tasks, and how many of those are overdue (AE7, R17).
    ///
    /// Pure SQL over plaintext columns, so the Dashboard's overdue callout
    /// works without decrypting a single task.
    pub fn task_counts(&self, now: i64) -> Result<(i64, i64)> {
        let open: i64 = self.connection().query_row(
            "SELECT COUNT(*) FROM tasks WHERE status != ?1",
            params![STATUS_COMPLETED],
            |row| row.get(0),
        )?;
        let overdue: i64 = self.connection().query_row(
            "SELECT COUNT(*) FROM tasks
             WHERE status != ?1 AND due_date IS NOT NULL AND due_date < ?2",
            params![STATUS_COMPLETED, now],
            |row| row.get(0),
        )?;
        Ok((open, overdue))
    }
}
