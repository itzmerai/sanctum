//! Notes, tasks, income and activity gates (U14/U15/U17/U19: R26–R35).

use crate::crypto::KdfParams;

use super::*;

fn fast_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 19_456,
        t_cost: 2,
        p_cost: 1,
    }
}

fn vault_with_key() -> (Vault, crate::crypto::SymmetricKey) {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, "correct-horse-battery-staple-97", fast_params()).unwrap();
    (vault, outcome.dek)
}

// ---------------------------------------------------------------------------
// Notes -- R26, R27
// ---------------------------------------------------------------------------

#[test]
fn a_note_round_trips() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "API Rate Limiting".into(),
                body: "# Token Bucket\n\nImplemented in Redis.".into(),
                labels: vec!["Architecture".into()],
                folder_id: None,
            },
        )
        .unwrap();

    let note = vault.get_note(&dek, id).unwrap().unwrap();
    assert_eq!(note.title, "API Rate Limiting");
    assert!(note.body.contains("Token Bucket"));
    assert_eq!(note.labels, vec!["Architecture".to_string()]);
}

/// The list is ordered by `updated_at`, so an edited note rises to the top.
///
/// Timestamps are set explicitly rather than by editing in real time: two
/// operations in a test land in the same millisecond, which a person cannot do
/// but which would make this assert the clock rather than the query.
#[test]
fn notes_list_most_recently_edited_first() {
    let (vault, dek) = vault_with_key();
    let older = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "older".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let newer = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "newer".into(),
                ..Default::default()
            },
        )
        .unwrap();

    vault
        .connection()
        .execute(
            "UPDATE notes SET updated_at = ?2 WHERE id = ?1",
            rusqlite::params![older, 1_000i64],
        )
        .unwrap();
    vault
        .connection()
        .execute(
            "UPDATE notes SET updated_at = ?2 WHERE id = ?1",
            rusqlite::params![newer, 2_000i64],
        )
        .unwrap();

    let listed = vault.list_notes(&dek).unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(
        listed[0].id, newer,
        "the most recently edited note comes first"
    );
    assert_eq!(listed[1].id, older);
}

/// Timestamps are milliseconds (M3), so a record written now is far past any
/// plausible second-resolution value.
#[test]
fn timestamps_are_milliseconds() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "now".into(),
                ..Default::default()
            },
        )
        .unwrap();

    let created = vault.get_note(&dek, id).unwrap().unwrap().created_at;
    // Seconds since 1970 passed 2e9 in 2033; milliseconds passed it in 1970.
    assert!(
        created > 1_700_000_000_000,
        "{created} looks like seconds, not milliseconds"
    );
}

#[test]
fn duplicating_a_note_creates_an_independent_copy() {
    let (vault, dek) = vault_with_key();
    let original = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "Template".into(),
                body: "shared body".into(),
                labels: vec!["docs".into()],
                folder_id: None,
            },
        )
        .unwrap();

    let copy = vault.duplicate_note(&dek, original).unwrap();
    assert_ne!(copy, original);

    let copied = vault.get_note(&dek, copy).unwrap().unwrap();
    assert_eq!(copied.title, "Template (copy)");
    assert_eq!(copied.body, "shared body");

    // Editing the copy must not touch the original.
    vault
        .update_note(
            &dek,
            copy,
            &NewNote {
                title: "Changed".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        vault.get_note(&dek, original).unwrap().unwrap().title,
        "Template"
    );
}

#[test]
fn deleting_a_note_clears_its_favourite() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_note(
            &dek,
            &NewNote {
                title: "starred".into(),
                ..Default::default()
            },
        )
        .unwrap();
    vault.set_favorite("note", id, true).unwrap();

    vault.delete_note(id).unwrap();
    assert!(!vault.is_favorite("note", id).unwrap());
}

// ---------------------------------------------------------------------------
// Tasks -- R28, R29, AE7
// ---------------------------------------------------------------------------

#[test]
fn a_task_round_trips() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_task(
            &dek,
            &NewTask {
                title: "Optimize LCP".into(),
                description: "Compress webp assets.".into(),
                tags: vec!["nextjs".into(), "performance".into()],
                status: STATUS_TODO.into(),
                priority: PRIORITY_MEDIUM.into(),
                due_date: Some(1_800_000_000),
            },
        )
        .unwrap();

    let task = vault.get_task(&dek, id).unwrap().unwrap();
    assert_eq!(task.title, "Optimize LCP");
    assert_eq!(task.status, STATUS_TODO);
    assert_eq!(task.priority, PRIORITY_MEDIUM);
    assert_eq!(task.due_date, Some(1_800_000_000));
}

#[test]
fn an_invalid_status_or_priority_is_refused() {
    let (vault, dek) = vault_with_key();
    assert!(vault
        .insert_task(
            &dek,
            &NewTask {
                title: "x".into(),
                status: "almost".into(),
                ..Default::default()
            }
        )
        .is_err());
    assert!(vault
        .insert_task(
            &dek,
            &NewTask {
                title: "x".into(),
                priority: "urgent".into(),
                ..Default::default()
            }
        )
        .is_err());
}

#[test]
fn tasks_sort_by_due_date_with_undated_last() {
    let (vault, dek) = vault_with_key();
    vault
        .insert_task(
            &dek,
            &NewTask {
                title: "undated".into(),
                ..Default::default()
            },
        )
        .unwrap();
    vault
        .insert_task(
            &dek,
            &NewTask {
                title: "later".into(),
                due_date: Some(2_000),
                ..Default::default()
            },
        )
        .unwrap();
    vault
        .insert_task(
            &dek,
            &NewTask {
                title: "sooner".into(),
                due_date: Some(1_000),
                ..Default::default()
            },
        )
        .unwrap();

    let titles: Vec<String> = vault
        .list_tasks(&dek)
        .unwrap()
        .into_iter()
        .map(|t| t.title)
        .collect();
    assert_eq!(titles, vec!["sooner", "later", "undated"]);
}

/// AE7: the dashboard's overdue callout must be answerable without the key
/// for the counts, and must exclude completed work.
#[test]
fn overdue_counts_exclude_completed_tasks() {
    let (vault, dek) = vault_with_key();
    let now = 10_000i64;

    vault
        .insert_task(
            &dek,
            &NewTask {
                title: "overdue".into(),
                due_date: Some(now - 1),
                ..Default::default()
            },
        )
        .unwrap();
    vault
        .insert_task(
            &dek,
            &NewTask {
                title: "future".into(),
                due_date: Some(now + 1),
                ..Default::default()
            },
        )
        .unwrap();
    let done = vault
        .insert_task(
            &dek,
            &NewTask {
                title: "done late".into(),
                due_date: Some(now - 1),
                ..Default::default()
            },
        )
        .unwrap();
    vault.set_task_status(done, STATUS_COMPLETED).unwrap();

    let (open, overdue) = vault.task_counts(now).unwrap();
    assert_eq!(open, 2, "completed tasks are not open");
    assert_eq!(overdue, 1, "a completed task is not overdue");
}

#[test]
fn setting_status_leaves_the_text_alone() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_task(
            &dek,
            &NewTask {
                title: "keep me".into(),
                description: "and me".into(),
                ..Default::default()
            },
        )
        .unwrap();

    vault.set_task_status(id, STATUS_COMPLETED).unwrap();

    let task = vault.get_task(&dek, id).unwrap().unwrap();
    assert_eq!(task.status, STATUS_COMPLETED);
    assert_eq!(task.title, "keep me");
    assert_eq!(task.description, "and me");
}

// ---------------------------------------------------------------------------
// Income -- R32
// ---------------------------------------------------------------------------

#[test]
fn an_income_entry_round_trips() {
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_income(
            &dek,
            &NewIncome {
                source: "Client G - Enterprise Cloud Audit".into(),
                amount_minor: 26_000_000,
                remarks: "Penetration Testing".into(),
                currency: "PHP".into(),
                category: "Salary".into(),
                received_on: 1_700_000_000,
            },
        )
        .unwrap();

    let entry = vault.get_income(&dek, id).unwrap().unwrap();
    assert_eq!(entry.amount_minor, 26_000_000);
    assert_eq!(entry.source, "Client G - Enterprise Cloud Audit");
}

/// Amounts are integer minor units precisely so repeated addition stays exact.
#[test]
fn totals_are_exact_over_many_entries() {
    let (vault, dek) = vault_with_key();

    // 0.10 + 0.20 three hundred times is 90.00 exactly -- in floats it is not.
    for _ in 0..300 {
        vault
            .insert_income(
                &dek,
                &NewIncome {
                    amount_minor: 10,
                    received_on: 500,
                    ..Default::default()
                },
            )
            .unwrap();
        vault
            .insert_income(
                &dek,
                &NewIncome {
                    amount_minor: 20,
                    received_on: 500,
                    ..Default::default()
                },
            )
            .unwrap();
    }

    assert_eq!(vault.income_total(&dek, 0, 1_000).unwrap(), 9_000);
}

#[test]
fn totals_respect_the_date_window() {
    let (vault, dek) = vault_with_key();
    for (amount, day) in [(100i64, 100i64), (200, 200), (400, 300)] {
        vault
            .insert_income(
                &dek,
                &NewIncome {
                    amount_minor: amount,
                    received_on: day,
                    ..Default::default()
                },
            )
            .unwrap();
    }

    // Half-open: 200 is included, 300 is not.
    assert_eq!(vault.income_total(&dek, 200, 300).unwrap(), 200);
    assert_eq!(vault.income_total(&dek, 0, 1_000).unwrap(), 700);
    assert_eq!(vault.income_total(&dek, 1_000, 2_000).unwrap(), 0);
}

#[test]
fn a_negative_amount_is_stored_faithfully() {
    // The reference shows a signed amount, so a refund or correction must
    // survive the round trip rather than being clamped.
    let (vault, dek) = vault_with_key();
    let id = vault
        .insert_income(
            &dek,
            &NewIncome {
                amount_minor: -5_000,
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        vault.get_income(&dek, id).unwrap().unwrap().amount_minor,
        -5_000
    );
}

// ---------------------------------------------------------------------------
// Activity log -- R35
// ---------------------------------------------------------------------------

#[test]
fn activity_records_what_happened_newest_first() {
    let (vault, dek) = vault_with_key();
    vault
        .log_activity(&dek, "folder", ACTION_CREATED, "Social Media")
        .unwrap();
    vault
        .log_activity(&dek, "task", ACTION_UPDATED, "Optimize LCP")
        .unwrap();

    let entries = vault.list_activity(&dek, 50).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].subject, "Optimize LCP");
    assert_eq!(entries[0].action, ACTION_UPDATED);
    assert_eq!(entries[1].entity_type, "folder");
}

#[test]
fn the_activity_subject_is_encrypted_at_rest() {
    let (vault, dek) = vault_with_key();
    vault
        .log_activity(
            &dek,
            "credential",
            ACTION_CREATED,
            "Secret Project Codename",
        )
        .unwrap();

    let blob: Vec<u8> = vault
        .connection()
        .query_row("SELECT subject_enc FROM activity LIMIT 1", [], |row| {
            row.get(0)
        })
        .unwrap();

    let needle = b"Secret Project Codename";
    assert!(!blob.windows(needle.len()).any(|w| w == needle));
}

#[test]
fn clearing_empties_the_log() {
    let (vault, dek) = vault_with_key();
    for index in 0..5 {
        vault
            .log_activity(&dek, "note", ACTION_UPDATED, &format!("note {index}"))
            .unwrap();
    }
    assert_eq!(vault.activity_count().unwrap(), 5);

    vault.clear_activity().unwrap();
    assert_eq!(vault.activity_count().unwrap(), 0);
    assert!(vault.list_activity(&dek, 50).unwrap().is_empty());
}

/// The log is a convenience, not an audit trail. Left unbounded it would grow
/// inside every backup the user ever takes.
#[test]
fn the_log_is_capped() {
    let (vault, dek) = vault_with_key();
    for index in 0..520 {
        vault
            .log_activity(&dek, "task", ACTION_UPDATED, &format!("entry {index}"))
            .unwrap();
    }

    let count = vault.activity_count().unwrap();
    assert!(count <= 500, "the log grew to {count} entries");

    // The most recent entry survived the trim.
    let entries = vault.list_activity(&dek, 1).unwrap();
    assert_eq!(entries[0].subject, "entry 519");
}
