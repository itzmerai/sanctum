//! Vault schema and migrations (U3).
//!
//! **What is encrypted, and what is not.** Every column holding a secret or a
//! personally revealing free-text value is stored as an AEAD blob (`*_enc`).
//! Structural and temporal columns stay plaintext so SQLite can index them:
//! status, priority, due date, currency, category, folder colour, timestamps.
//!
//! That split is a deliberate, bounded disclosure (KTD10 gives per-field
//! choice). Someone holding the vault file without the key learns *how many*
//! credentials exist, *when* records were made, that a task is due on a date,
//! and that income arrived on a date in a currency. They learn no name, no
//! username, no password, no note, no amount. Moving those columns behind
//! encryption too would mean loading and decrypting the entire store to sort a
//! task list, so the trade is priced deliberately rather than by accident.
//!
//! **Row ids are random, not autoincrement.** SQLite reuses rowids after a
//! delete. Since the record AAD binds ciphertext to its row id (KTD12), a
//! reused id would let an attacker with file access replay a deleted record's
//! blob into the new row occupying that id and have it authenticate. A random
//! 63-bit id makes that reuse impossible.

/// Ordered schema migrations. Index + 1 is the resulting `PRAGMA user_version`.
///
/// Append only -- never edit a shipped entry, or existing vaults will diverge
/// from new ones. Adding a column here does **not** change
/// `crypto::VAULT_FORMAT_VERSION` (KTD22), so existing ciphertext keeps
/// authenticating across a schema migration.
pub const MIGRATIONS: &[&str] = &[
    // --- M1: initial schema -------------------------------------------------
    r#"
    CREATE TABLE vault_header (
        id                    INTEGER PRIMARY KEY CHECK (id = 1),
        crypto_format_version INTEGER NOT NULL,
        kdf_params            TEXT    NOT NULL,
        master_salt           BLOB    NOT NULL,
        recovery_salt         BLOB    NOT NULL,
        wrapped_master        TEXT    NOT NULL,
        wrapped_recovery      TEXT    NOT NULL,
        recovery_acknowledged INTEGER NOT NULL DEFAULT 0,
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL
    );

    CREATE TABLE folders (
        id         INTEGER PRIMARY KEY,
        kind       TEXT    NOT NULL CHECK (kind IN ('passwords', 'notes')),
        name_enc   BLOB    NOT NULL,
        color      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE credentials (
        id           INTEGER PRIMARY KEY,
        name_enc     BLOB    NOT NULL,
        username_enc BLOB    NOT NULL,
        password_enc BLOB    NOT NULL,
        website_enc  BLOB    NOT NULL,
        notes_enc    BLOB    NOT NULL,
        tags_enc     BLOB    NOT NULL,
        folder_id    INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
    );
    CREATE INDEX idx_credentials_folder ON credentials(folder_id);

    CREATE TABLE notes (
        id         INTEGER PRIMARY KEY,
        title_enc  BLOB    NOT NULL,
        body_enc   BLOB    NOT NULL,
        labels_enc BLOB    NOT NULL,
        folder_id  INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_notes_folder ON notes(folder_id);

    CREATE TABLE tasks (
        id              INTEGER PRIMARY KEY,
        title_enc       BLOB    NOT NULL,
        description_enc BLOB    NOT NULL,
        tags_enc        BLOB    NOT NULL,
        status          TEXT    NOT NULL CHECK (status IN ('todo', 'in_progress', 'completed')),
        priority        TEXT    NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
        due_date        INTEGER,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
    );
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_due ON tasks(due_date);

    CREATE TABLE income (
        id          INTEGER PRIMARY KEY,
        source_enc  BLOB    NOT NULL,
        amount_enc  BLOB    NOT NULL,
        remarks_enc BLOB    NOT NULL,
        currency    TEXT    NOT NULL,
        category    TEXT    NOT NULL,
        received_on INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_income_received ON income(received_on);

    CREATE TABLE favorites (
        entity_type TEXT    NOT NULL CHECK (entity_type IN ('credential', 'note', 'folder')),
        entity_id   INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
    );

    CREATE TABLE activity (
        id          INTEGER PRIMARY KEY,
        entity_type TEXT    NOT NULL,
        action      TEXT    NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
        subject_enc BLOB    NOT NULL,
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_activity_created ON activity(created_at DESC);
    "#,
];

/// Schema version a fresh vault is created at.
pub fn latest_version() -> u32 {
    MIGRATIONS.len() as u32
}

// --- AAD column labels -------------------------------------------------------
//
// These strings are bound into every record's AAD (KTD12), so they are part of
// the on-disk format: renaming one makes existing ciphertext undecryptable.
// Treat them as frozen unless the crypto format version is also bumped.

pub const COL_CREDENTIAL_NAME: &str = "credential.name";
pub const COL_CREDENTIAL_USERNAME: &str = "credential.username";
pub const COL_CREDENTIAL_PASSWORD: &str = "credential.password";
pub const COL_CREDENTIAL_WEBSITE: &str = "credential.website";
pub const COL_CREDENTIAL_NOTES: &str = "credential.notes";
pub const COL_CREDENTIAL_TAGS: &str = "credential.tags";
