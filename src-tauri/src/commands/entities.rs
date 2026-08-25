//! Notes, tasks, income and activity commands (U13–U19).
//!
//! Every mutation writes an activity entry in the same call that performs it
//! (R35). Doing it here rather than in the store keeps the log a record of
//! *user actions* — a restore or a migration touches rows without any of them
//! being something the user did.

use serde::{Deserialize, Serialize};

use crate::vault::{
    ActivityEntry, Income, NewIncome, NewNote, NewTask, Note, Task, ACTION_CREATED, ACTION_DELETED,
    ACTION_UPDATED,
};

use super::{with_dek, AppState, CommandError, CommandResult};

// --- notes -------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: i64,
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub folder_id: Option<i64>,
    pub favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl NoteDto {
    fn from_record(record: Note, favorite: bool) -> Self {
        Self {
            id: record.id,
            title: record.title,
            body: record.body,
            labels: record.labels,
            folder_id: record.folder_id,
            favorite,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub title: String,
    pub body: String,
    pub labels: Vec<String>,
    pub folder_id: Option<i64>,
}

/// An untitled note is legitimate — the reference creates one before you have
/// typed anything — so this only normalises, it does not reject.
fn note_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "Untitled note".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn list_notes(state: tauri::State<'_, AppState>) -> CommandResult<Vec<NoteDto>> {
    with_dek(&state, |vault, dek| {
        let favorites = vault.favorite_ids("note")?;
        Ok(vault
            .list_notes(dek)?
            .into_iter()
            .map(|record| {
                let favorite = favorites.contains(&record.id);
                NoteDto::from_record(record, favorite)
            })
            .collect())
    })
}

#[tauri::command]
pub fn create_note(state: tauri::State<'_, AppState>, input: NoteInput) -> CommandResult<i64> {
    with_dek(&state, |vault, dek| {
        let title = note_title(&input.title);
        let id = vault.insert_note(
            dek,
            &NewNote {
                title: title.clone(),
                body: input.body,
                labels: input.labels,
                folder_id: input.folder_id,
            },
        )?;
        vault.log_activity(dek, "note", ACTION_CREATED, &title)?;
        Ok(id)
    })
}

#[tauri::command]
pub fn update_note(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: NoteInput,
) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        let title = note_title(&input.title);
        vault.update_note(
            dek,
            id,
            &NewNote {
                title: title.clone(),
                body: input.body,
                labels: input.labels,
                folder_id: input.folder_id,
            },
        )?;
        vault.log_activity(dek, "note", ACTION_UPDATED, &title)?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_note(state: tauri::State<'_, AppState>, id: i64) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        // Read the name before deleting: afterwards there is nothing to log.
        let name = vault
            .get_note(dek, id)?
            .map(|note| note.title)
            .unwrap_or_default();
        vault.delete_note(id)?;
        vault.log_activity(dek, "note", ACTION_DELETED, &name)?;
        Ok(())
    })
}

#[tauri::command]
pub fn duplicate_note(state: tauri::State<'_, AppState>, id: i64) -> CommandResult<i64> {
    with_dek(&state, |vault, dek| {
        let new_id = vault.duplicate_note(dek, id)?;
        let name = vault
            .get_note(dek, new_id)?
            .map(|note| note.title)
            .unwrap_or_default();
        vault.log_activity(dek, "note", ACTION_CREATED, &name)?;
        Ok(new_id)
    })
}

// --- tasks -------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: String,
    pub priority: String,
    pub due_date: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<Task> for TaskDto {
    fn from(record: Task) -> Self {
        Self {
            id: record.id,
            title: record.title,
            description: record.description,
            tags: record.tags,
            status: record.status,
            priority: record.priority,
            due_date: record.due_date,
            created_at: record.created_at,
            updated_at: record.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: String,
    pub priority: String,
    pub due_date: Option<i64>,
}

#[tauri::command]
pub fn list_tasks(state: tauri::State<'_, AppState>) -> CommandResult<Vec<TaskDto>> {
    with_dek(&state, |vault, dek| {
        Ok(vault
            .list_tasks(dek)?
            .into_iter()
            .map(TaskDto::from)
            .collect())
    })
}

#[tauri::command]
pub fn create_task(state: tauri::State<'_, AppState>, input: TaskInput) -> CommandResult<i64> {
    if input.title.trim().is_empty() {
        return Err(CommandError::new("validation", "A task needs a title."));
    }
    with_dek(&state, |vault, dek| {
        let title = input.title.trim().to_string();
        let id = vault.insert_task(
            dek,
            &NewTask {
                title: title.clone(),
                description: input.description,
                tags: input.tags,
                status: input.status,
                priority: input.priority,
                due_date: input.due_date,
            },
        )?;
        vault.log_activity(dek, "task", ACTION_CREATED, &title)?;
        Ok(id)
    })
}

#[tauri::command]
pub fn update_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: TaskInput,
) -> CommandResult<()> {
    if input.title.trim().is_empty() {
        return Err(CommandError::new("validation", "A task needs a title."));
    }
    with_dek(&state, |vault, dek| {
        let title = input.title.trim().to_string();
        vault.update_task(
            dek,
            id,
            &NewTask {
                title: title.clone(),
                description: input.description,
                tags: input.tags,
                status: input.status,
                priority: input.priority,
                due_date: input.due_date,
            },
        )?;
        vault.log_activity(dek, "task", ACTION_UPDATED, &title)?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_task_status(
    state: tauri::State<'_, AppState>,
    id: i64,
    status: String,
) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        vault.set_task_status(id, &status)?;
        let name = vault
            .get_task(dek, id)?
            .map(|task| task.title)
            .unwrap_or_default();
        vault.log_activity(dek, "task", ACTION_UPDATED, &name)?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_task(state: tauri::State<'_, AppState>, id: i64) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        let name = vault
            .get_task(dek, id)?
            .map(|task| task.title)
            .unwrap_or_default();
        vault.delete_task(id)?;
        vault.log_activity(dek, "task", ACTION_DELETED, &name)?;
        Ok(())
    })
}

// --- income ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeDto {
    pub id: i64,
    pub source: String,
    pub amount_minor: i64,
    pub remarks: String,
    pub currency: String,
    pub category: String,
    pub received_on: i64,
    pub created_at: i64,
}

impl From<Income> for IncomeDto {
    fn from(record: Income) -> Self {
        Self {
            id: record.id,
            source: record.source,
            amount_minor: record.amount_minor,
            remarks: record.remarks,
            currency: record.currency,
            category: record.category,
            received_on: record.received_on,
            created_at: record.created_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeInput {
    pub source: String,
    pub amount_minor: i64,
    pub remarks: String,
    pub currency: String,
    pub category: String,
    pub received_on: i64,
}

#[tauri::command]
pub fn list_income(state: tauri::State<'_, AppState>) -> CommandResult<Vec<IncomeDto>> {
    with_dek(&state, |vault, dek| {
        Ok(vault
            .list_income(dek)?
            .into_iter()
            .map(IncomeDto::from)
            .collect())
    })
}

#[tauri::command]
pub fn create_income(state: tauri::State<'_, AppState>, input: IncomeInput) -> CommandResult<i64> {
    if input.source.trim().is_empty() {
        return Err(CommandError::new(
            "validation",
            "An income source is required.",
        ));
    }
    with_dek(&state, |vault, dek| {
        let source = input.source.trim().to_string();
        let id = vault.insert_income(
            dek,
            &NewIncome {
                source: source.clone(),
                amount_minor: input.amount_minor,
                remarks: input.remarks,
                currency: input.currency,
                category: input.category,
                received_on: input.received_on,
            },
        )?;
        vault.log_activity(dek, "income", ACTION_CREATED, &source)?;
        Ok(id)
    })
}

#[tauri::command]
pub fn update_income(
    state: tauri::State<'_, AppState>,
    id: i64,
    input: IncomeInput,
) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        let source = input.source.trim().to_string();
        vault.update_income(
            dek,
            id,
            &NewIncome {
                source: source.clone(),
                amount_minor: input.amount_minor,
                remarks: input.remarks,
                currency: input.currency,
                category: input.category,
                received_on: input.received_on,
            },
        )?;
        vault.log_activity(dek, "income", ACTION_UPDATED, &source)?;
        Ok(())
    })
}

#[tauri::command]
pub fn delete_income(state: tauri::State<'_, AppState>, id: i64) -> CommandResult<()> {
    with_dek(&state, |vault, dek| {
        let name = vault
            .get_income(dek, id)?
            .map(|entry| entry.source)
            .unwrap_or_default();
        vault.delete_income(id)?;
        vault.log_activity(dek, "income", ACTION_DELETED, &name)?;
        Ok(())
    })
}

// --- activity ----------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDto {
    pub id: i64,
    pub entity_type: String,
    pub action: String,
    pub subject: String,
    pub created_at: i64,
}

impl From<ActivityEntry> for ActivityDto {
    fn from(entry: ActivityEntry) -> Self {
        Self {
            id: entry.id,
            entity_type: entry.entity_type,
            action: entry.action,
            subject: entry.subject,
            created_at: entry.created_at,
        }
    }
}

#[tauri::command]
pub fn list_activity(state: tauri::State<'_, AppState>) -> CommandResult<Vec<ActivityDto>> {
    with_dek(&state, |vault, dek| {
        Ok(vault
            .list_activity(dek, 200)?
            .into_iter()
            .map(ActivityDto::from)
            .collect())
    })
}

#[tauri::command]
pub fn clear_activity(state: tauri::State<'_, AppState>) -> CommandResult<usize> {
    with_dek(&state, |vault, _dek| vault.clear_activity())
}

// --- dashboard ---------------------------------------------------------------

/// Aggregate counts for the dashboard (R17).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummary {
    pub credentials: i64,
    pub notes: i64,
    pub open_tasks: i64,
    pub overdue_tasks: i64,
    pub income_this_month_minor: i64,
    pub income_all_time_minor: i64,
}

#[tauri::command]
pub fn vault_summary(
    state: tauri::State<'_, AppState>,
    month_start: i64,
    month_end: i64,
) -> CommandResult<VaultSummary> {
    with_dek(&state, |vault, dek| {
        // The month window is supplied by the caller rather than computed here:
        // "this month" is a local-calendar question, and the frontend is the
        // only side that knows the user's time zone.
        let (open_tasks, overdue_tasks) = vault.task_counts(month_end.max(month_start))?;
        Ok(VaultSummary {
            credentials: vault.credential_count()?,
            notes: vault.note_count()?,
            open_tasks,
            overdue_tasks,
            income_this_month_minor: vault.income_total(dek, month_start, month_end)?,
            income_all_time_minor: vault.income_total(dek, i64::MIN, i64::MAX)?,
        })
    })
}
