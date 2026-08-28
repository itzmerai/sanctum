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
    // --- M2: monotonic ordering for the activity log ------------------------
    //
    // Row ids are random by design (see the header note), so they cannot break
    // a tie between two entries written in the same second. Without a
    // monotonic key the "keep the newest 500" trim discards arbitrary rows.
    r#"
    ALTER TABLE activity ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
    UPDATE activity SET seq = rowid;
    CREATE INDEX idx_activity_seq ON activity(seq DESC);
    "#,
    // --- M3: timestamps in milliseconds -------------------------------------
    //
    // Seconds are too coarse to order a list the user watches: two edits in
    // the same second fell through to the random-id tiebreak and came back in
    // arbitrary order. Milliseconds also match JavaScript natively, so no
    // boundary has to multiply or divide.
    r#"
    UPDATE vault_header SET created_at = created_at * 1000, updated_at = updated_at * 1000;
    UPDATE folders     SET created_at = created_at * 1000, updated_at = updated_at * 1000;
    UPDATE credentials SET created_at = created_at * 1000, updated_at = updated_at * 1000;
    UPDATE notes       SET created_at = created_at * 1000, updated_at = updated_at * 1000;
    UPDATE tasks       SET created_at = created_at * 1000, updated_at = updated_at * 1000,
                           due_date = due_date * 1000;
    UPDATE income      SET created_at = created_at * 1000, updated_at = updated_at * 1000,
                           received_on = received_on * 1000;
    UPDATE favorites   SET created_at = created_at * 1000;
    UPDATE activity    SET created_at = created_at * 1000;
    "#,
    // --- M4: env files ------------------------------------------------------
    //
    // Two existing tables carry a CHECK constraint that has to admit a new
    // value, and SQLite cannot alter a CHECK in place -- each table must be
    // rebuilt.
    //
    // `favorites` is rebuilt the obvious way: nothing references it, so the
    // drop fires no foreign key action.
    //
    // `folders` cannot be. `credentials` and `notes` reference it with
    // ON DELETE SET NULL, and with foreign keys enabled a DROP performs an
    // implicit DELETE FROM first -- which fires that action and silently nulls
    // out every folder assignment in the vault. `PRAGMA foreign_keys` is a
    // no-op inside a transaction (which is where migrations run), and
    // `legacy_alter_table` does not survive one either, so neither pragma is a
    // way out.
    //
    // So the assignments are carried across the rebuild by hand: saved before
    // the drop, restored after the new table is in place. Explicit beats
    // clever here -- the behaviour does not depend on a pragma holding inside
    // a transaction. `a_migration_to_env_files_keeps_folder_assignments` is
    // the regression test.
    r#"
    CREATE TABLE favorites_m4 (
        entity_type TEXT    NOT NULL CHECK (entity_type IN ('credential', 'note', 'folder', 'env_file')),
        entity_id   INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_id)
    );
    INSERT INTO favorites_m4 (entity_type, entity_id, created_at)
        SELECT entity_type, entity_id, created_at FROM favorites;
    DROP TABLE favorites;
    ALTER TABLE favorites_m4 RENAME TO favorites;

    CREATE TABLE folders_m4 AS
        SELECT id, kind, name_enc, color, created_at, updated_at FROM folders;
    CREATE TABLE credential_folders_m4 AS
        SELECT id, folder_id FROM credentials WHERE folder_id IS NOT NULL;
    CREATE TABLE note_folders_m4 AS
        SELECT id, folder_id FROM notes WHERE folder_id IS NOT NULL;

    DROP TABLE folders;

    CREATE TABLE folders (
        id         INTEGER PRIMARY KEY,
        kind       TEXT    NOT NULL CHECK (kind IN ('passwords', 'notes', 'env')),
        name_enc   BLOB    NOT NULL,
        color      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    INSERT INTO folders (id, kind, name_enc, color, created_at, updated_at)
        SELECT id, kind, name_enc, color, created_at, updated_at FROM folders_m4;

    UPDATE credentials
        SET folder_id = (SELECT s.folder_id FROM credential_folders_m4 s WHERE s.id = credentials.id)
        WHERE id IN (SELECT id FROM credential_folders_m4);
    UPDATE notes
        SET folder_id = (SELECT s.folder_id FROM note_folders_m4 s WHERE s.id = notes.id)
        WHERE id IN (SELECT id FROM note_folders_m4);

    DROP TABLE folders_m4;
    DROP TABLE credential_folders_m4;
    DROP TABLE note_folders_m4;

    CREATE TABLE env_files (
        id          INTEGER PRIMARY KEY,
        title_enc   BLOB    NOT NULL,
        content_enc BLOB    NOT NULL,
        environment TEXT    NOT NULL CHECK (environment IN ('production', 'staging', 'local')),
        folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX idx_env_files_folder ON env_files(folder_id);
    CREATE INDEX idx_env_files_environment ON env_files(environment);
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
