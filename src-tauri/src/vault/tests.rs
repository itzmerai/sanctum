//! U3 verification gates.
//!
//! The load-bearing one is `on_disk_file_contains_no_plaintext_secret`: every
//! other guarantee in this layer is an argument, and that test is the only
//! thing that actually looks at the bytes on disk.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::params;
use tempfile::TempDir;

use crate::crypto::{
    generate_salt, wrap_dek, KdfParams, SymmetricKey, WrapPurpose, VAULT_FORMAT_VERSION,
};

use super::*;

fn dek() -> SymmetricKey {
    SymmetricKey::generate().expect("OS RNG must be available")
}

fn sample() -> NewCredential {
    NewCredential {
        name: "Vercel Deployment Team".into(),
        username: "deployer@vercel.com".into(),
        password: "Vc_live_88xP9vL3mK0".into(),
        website: "https://vercel.com".into(),
        notes: "Production Next.js deployment platform.".into(),
        tags: vec!["vercel".into(), "nextjs".into(), "frontend".into()],
        folder_id: None,
    }
}

fn sample_header() -> VaultHeader {
    let kek = dek();
    let data_key = dek();
    VaultHeader {
        crypto_format_version: VAULT_FORMAT_VERSION,
        kdf_params: KdfParams::default(),
        master_salt: generate_salt().unwrap().to_vec(),
        recovery_salt: generate_salt().unwrap().to_vec(),
        wrapped_master: wrap_dek(&kek, &data_key, WrapPurpose::MasterPassword).unwrap(),
        wrapped_recovery: wrap_dek(&kek, &data_key, WrapPurpose::RecoveryCode).unwrap(),
        recovery_acknowledged: false,
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
    }
}

/// Every file SQLite may have written for this database.
fn database_files(path: &Path) -> Vec<PathBuf> {
    let mut names = vec![path.to_path_buf()];
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut os = path.as_os_str().to_os_string();
        os.push(suffix);
        names.push(PathBuf::from(os));
    }
    names.into_iter().filter(|p| p.exists()).collect()
}

// ---------------------------------------------------------------------------
// Round trip -- R8
// ---------------------------------------------------------------------------

#[test]
fn insert_then_read_returns_the_original_credential() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    let id = vault.insert_credential(&key, &sample()).unwrap();
    let read = vault.get_credential(&key, id).unwrap().expect("must exist");

    let original = sample();
    assert_eq!(read.name, original.name);
    assert_eq!(read.username, original.username);
    assert_eq!(read.password, original.password);
    assert_eq!(read.website, original.website);
    assert_eq!(read.notes, original.notes);
    assert_eq!(read.tags, original.tags);
    assert_eq!(read.id, id);
}

#[test]
fn unicode_and_empty_values_survive_the_round_trip() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    let awkward = NewCredential {
        name: "Ünïcödé — 日本語 — 🔐".into(),
        username: String::new(),
        password: "  leading and trailing  ".into(),
        website: String::new(),
        notes: "line one\nline two\ttabbed".into(),
        tags: vec![],
        folder_id: None,
    };

    let id = vault.insert_credential(&key, &awkward).unwrap();
    let read = vault.get_credential(&key, id).unwrap().unwrap();

    assert_eq!(read.name, awkward.name);
    assert_eq!(read.username, "");
    assert_eq!(read.password, awkward.password);
    assert_eq!(read.notes, awkward.notes);
    assert!(read.tags.is_empty());
}

#[test]
fn a_missing_credential_reads_as_none_not_an_error() {
    let vault = Vault::open_in_memory().unwrap();
    assert!(vault.get_credential(&dek(), 424_242).unwrap().is_none());
}

#[test]
fn update_replaces_contents_and_keeps_the_id() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();
    let id = vault.insert_credential(&key, &sample()).unwrap();

    let mut edited = sample();
    edited.password = "rotated-password-value".into();
    edited.tags = vec!["rotated".into()];
    vault.update_credential(&key, id, &edited).unwrap();

    let read = vault.get_credential(&key, id).unwrap().unwrap();
    assert_eq!(read.id, id, "an update must not move the row");
    assert_eq!(read.password, "rotated-password-value");
    assert_eq!(read.tags, vec!["rotated".to_string()]);
}

#[test]
fn updating_or_deleting_a_missing_row_reports_not_found() {
    let vault = Vault::open_in_memory().unwrap();
    assert!(matches!(
        vault.update_credential(&dek(), 999, &sample()),
        Err(VaultError::NotFound { id: 999 })
    ));
    assert!(matches!(
        vault.delete_credential(999),
        Err(VaultError::NotFound { id: 999 })
    ));
}

#[test]
fn listing_returns_every_credential() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    for index in 0..5 {
        let mut credential = sample();
        credential.name = format!("entry {index}");
        vault.insert_credential(&key, &credential).unwrap();
    }

    let listed = vault.list_credentials(&key).unwrap();
    assert_eq!(listed.len(), 5);
    assert_eq!(vault.credential_count().unwrap(), 5);
}

#[test]
fn a_wrong_key_cannot_read_a_stored_credential() {
    let vault = Vault::open_in_memory().unwrap();
    let id = vault.insert_credential(&dek(), &sample()).unwrap();

    assert!(matches!(
        vault.get_credential(&dek(), id),
        Err(VaultError::Crypto(_))
    ));
}

// ---------------------------------------------------------------------------
// The on-disk invariant -- R8, mandatory
// ---------------------------------------------------------------------------

/// Reads the real database file (and its WAL) and asserts no secret appears in
/// it. This is the claim the whole encryption layer exists to make, so it is
/// checked against bytes rather than inferred from the code.
#[test]
fn on_disk_file_contains_no_plaintext_secret() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");

    let secrets = {
        let vault = Vault::open(&path).unwrap();
        let key = dek();
        vault.insert_credential(&key, &sample()).unwrap();
        sample_header().store(vault.connection()).unwrap();
        // Force the WAL into the main file so nothing is missed by scanning.
        vault.checkpoint().unwrap();

        let original = sample();
        vec![
            original.password,
            original.username,
            original.name,
            original.website,
            original.notes,
            "nextjs".to_string(),
        ]
    };

    let files = database_files(&path);
    assert!(!files.is_empty(), "no database file was written");

    for file in &files {
        let bytes = fs::read(file).unwrap();
        for secret in &secrets {
            let needle = secret.as_bytes();
            if needle.is_empty() {
                continue;
            }
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "{} leaked into {}",
                secret,
                file.display()
            );
        }
    }
}

#[test]
fn column_metadata_is_visible_on_disk_as_documented() {
    // The counterpart to the test above: this records the disclosure KTD10
    // knowingly accepts, so a future move to SQLCipher has a failing test to
    // delete rather than an undocumented assumption to rediscover.
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");
    {
        let vault = Vault::open(&path).unwrap();
        vault.insert_credential(&dek(), &sample()).unwrap();
        vault.checkpoint().unwrap();
    }

    let bytes = fs::read(&path).unwrap();
    assert!(
        bytes.windows(11).any(|w| w == b"credentials"),
        "table names are expected to be visible under application-layer encryption"
    );
}

// ---------------------------------------------------------------------------
// Locked reads -- metadata without the DEK
// ---------------------------------------------------------------------------

#[test]
fn metadata_is_readable_without_a_key() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();
    let id = vault.insert_credential(&key, &sample()).unwrap();

    // No key is in scope for either call below.
    assert_eq!(vault.credential_count().unwrap(), 1);
    let meta = vault.list_credential_meta().unwrap();
    assert_eq!(meta.len(), 1);
    assert_eq!(meta[0].id, id);
    assert!(meta[0].created_at > 0);
}

// ---------------------------------------------------------------------------
// Migrations -- KTD22
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_database_migrates_to_the_current_schema() {
    let vault = Vault::open_in_memory().unwrap();
    assert_eq!(vault.schema_version().unwrap(), latest_schema_version());

    let tables: Vec<String> = {
        let conn = vault.connection();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let rows = stmt.query_map([], |row| row.get(0)).unwrap();
        rows.collect::<std::result::Result<_, _>>().unwrap()
    };

    for expected in [
        "activity",
        "credentials",
        "favorites",
        "folders",
        "income",
        "notes",
        "tasks",
        "vault_header",
    ] {
        assert!(
            tables.iter().any(|t| t == expected),
            "table {expected} is missing; found {tables:?}"
        );
    }
}

#[test]
fn reopening_a_vault_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");
    let key = dek();

    let id = {
        let vault = Vault::open(&path).unwrap();
        vault.insert_credential(&key, &sample()).unwrap()
    };

    let vault = Vault::open(&path).unwrap();
    assert_eq!(vault.schema_version().unwrap(), latest_schema_version());
    assert_eq!(
        vault.get_credential(&key, id).unwrap().unwrap().password,
        sample().password
    );
}

/// KTD22's central claim: a schema migration must not disturb existing
/// ciphertext, because the crypto format version bound into each record's AAD
/// is independent of the schema version.
#[test]
fn a_migration_against_a_populated_vault_preserves_every_record() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");
    let key = dek();

    let mut ids = Vec::new();
    {
        let vault = Vault::open(&path).unwrap();
        for index in 0..10 {
            let mut credential = sample();
            credential.name = format!("record {index}");
            ids.push(vault.insert_credential(&key, &credential).unwrap());
        }
        vault.checkpoint().unwrap();
    }

    // Stand in for a future migration: add a column and advance the schema
    // version, exactly as `migrations::migrate` would.
    {
        let vault = Vault::open(&path).unwrap();
        let conn = vault.connection();
        conn.execute_batch(
            "ALTER TABLE credentials ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
             PRAGMA user_version = 99;",
        )
        .unwrap();
    }

    // A newer schema than this build supports must be refused, not guessed at.
    // `Vault` has no `Debug` impl (it owns a live connection), so match rather
    // than `unwrap_err`.
    match Vault::open(&path) {
        Ok(_) => panic!("a vault from a newer schema must be refused"),
        Err(err) => assert!(matches!(err, VaultError::SchemaTooNew { found: 99, .. })),
    }

    // Put the version back where a real migration would have left it, then
    // confirm the added column changed nothing about decryptability.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(&format!(
            "PRAGMA user_version = {}",
            latest_schema_version()
        ))
        .unwrap();
    }

    let vault = Vault::open(&path).unwrap();
    for (index, id) in ids.iter().enumerate() {
        let credential = vault
            .get_credential(&key, *id)
            .unwrap()
            .unwrap_or_else(|| panic!("record {index} disappeared across the migration"));
        assert_eq!(credential.name, format!("record {index}"));
        assert_eq!(credential.password, sample().password);
    }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

#[test]
fn a_new_vault_has_no_header_until_setup() {
    let vault = Vault::open_in_memory().unwrap();
    assert!(VaultHeader::load(vault.connection()).unwrap().is_none());
}

#[test]
fn the_header_round_trips() {
    let vault = Vault::open_in_memory().unwrap();
    let header = sample_header();
    header.store(vault.connection()).unwrap();

    let loaded = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert_eq!(loaded, header);
    loaded.ensure_supported_crypto_format().unwrap();
}

#[test]
fn storing_the_header_twice_replaces_rather_than_duplicates() {
    let vault = Vault::open_in_memory().unwrap();
    let mut header = sample_header();
    header.store(vault.connection()).unwrap();

    header.recovery_acknowledged = true;
    header.updated_at = 1_700_000_500;
    header.store(vault.connection()).unwrap();

    let count: i64 = vault
        .connection()
        .query_row("SELECT COUNT(*) FROM vault_header", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1, "the header must remain a single row");

    let loaded = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert!(loaded.recovery_acknowledged);
    assert_eq!(loaded.updated_at, 1_700_000_500);
}

#[test]
fn a_second_header_row_cannot_be_inserted() {
    let vault = Vault::open_in_memory().unwrap();
    sample_header().store(vault.connection()).unwrap();

    let result = vault.connection().execute(
        "INSERT INTO vault_header (
             id, crypto_format_version, kdf_params, master_salt, recovery_salt,
             wrapped_master, wrapped_recovery, recovery_acknowledged, created_at, updated_at
         ) VALUES (2, 1, '{}', x'00', x'00', '{}', '{}', 0, 0, 0)",
        params![],
    );
    assert!(result.is_err(), "the CHECK (id = 1) constraint must hold");
}

#[test]
fn a_vault_from_a_newer_crypto_format_is_rejected() {
    let mut header = sample_header();
    header.crypto_format_version = VAULT_FORMAT_VERSION + 1;

    assert!(matches!(
        header.ensure_supported_crypto_format(),
        Err(VaultError::CryptoFormatUnsupported { .. })
    ));
}

// ---------------------------------------------------------------------------
// Row ids
// ---------------------------------------------------------------------------

/// Row ids must not be reused after a delete: the AAD binds ciphertext to its
/// row id, so a recycled id would let a deleted record's blob be replayed into
/// the row that inherits it.
#[test]
fn row_ids_are_not_reused_after_a_delete() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    let first = vault.insert_credential(&key, &sample()).unwrap();
    vault.delete_credential(first).unwrap();

    for _ in 0..20 {
        let next = vault.insert_credential(&key, &sample()).unwrap();
        assert_ne!(next, first, "a deleted row id was handed out again");
        vault.delete_credential(next).unwrap();
    }
}

#[test]
fn row_ids_are_positive_and_distinct() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    let mut seen = std::collections::HashSet::new();
    for _ in 0..200 {
        let id = vault.insert_credential(&key, &sample()).unwrap();
        assert!(id > 0, "row id {id} is not positive");
        assert!(seen.insert(id), "row id {id} was issued twice");
    }
}

/// A blob lifted from one row and pasted into another must not decrypt, even
/// though both rows belong to the same vault and the same key.
#[test]
fn a_password_blob_cannot_be_moved_between_rows_on_disk() {
    let vault = Vault::open_in_memory().unwrap();
    let key = dek();

    let victim = vault.insert_credential(&key, &sample()).unwrap();
    let mut other = sample();
    other.password = "attacker-known-password".into();
    let attacker = vault.insert_credential(&key, &other).unwrap();

    let stolen: Vec<u8> = vault
        .connection()
        .query_row(
            "SELECT password_enc FROM credentials WHERE id = ?1",
            params![attacker],
            |row| row.get(0),
        )
        .unwrap();

    vault
        .connection()
        .execute(
            "UPDATE credentials SET password_enc = ?2 WHERE id = ?1",
            params![victim, stolen],
        )
        .unwrap();

    assert!(
        matches!(
            vault.get_credential(&key, victim),
            Err(VaultError::Crypto(_))
        ),
        "a relocated ciphertext must fail to authenticate"
    );
}

// ---------------------------------------------------------------------------
// Journal mode
// ---------------------------------------------------------------------------

#[test]
fn a_file_backed_vault_runs_in_wal_mode() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");
    let vault = Vault::open(&path).unwrap();

    let mode: String = vault
        .connection()
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .unwrap();
    assert_eq!(mode.to_lowercase(), "wal");
}

#[test]
fn foreign_keys_are_enforced() {
    let vault = Vault::open_in_memory().unwrap();
    let mut credential = sample();
    credential.folder_id = Some(123_456);

    assert!(
        vault.insert_credential(&dek(), &credential).is_err(),
        "a credential must not reference a folder that does not exist"
    );
}

// --- M4: env files -----------------------------------------------------------

/// Builds a database at the pre-env-files schema so the migration can be
/// exercised against real rows rather than an empty file.
fn v3_database(path: &Path) {
    let conn = rusqlite::Connection::open(path).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    for ddl in super::schema::MIGRATIONS.iter().take(3) {
        conn.execute_batch(ddl).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 3;").unwrap();
}

#[test]
fn a_fresh_database_has_the_env_files_table() {
    let vault = Vault::open_in_memory().unwrap();
    let count: i64 = vault
        .connection()
        .query_row("SELECT COUNT(*) FROM env_files", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

/// The regression test for M4's central hazard.
///
/// Widening the `folders.kind` CHECK means rebuilding the table. Dropping it
/// naively, with foreign keys on, fires ON DELETE SET NULL against every
/// credential and note that referenced it -- so the migration would appear to
/// succeed while quietly emptying the Folders screen.
#[test]
fn a_migration_to_env_files_keeps_folder_assignments() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");
    v3_database(&path);

    // Raw rows: this test is about the foreign key action, not about crypto.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        conn.execute_batch(
            "INSERT INTO folders (id, kind, name_enc, color, created_at, updated_at)
                 VALUES (11, 'passwords', X'00', '#123456', 1, 1),
                        (12, 'notes',     X'00', '#654321', 1, 1);
             INSERT INTO credentials
                 (id, name_enc, username_enc, password_enc, website_enc, notes_enc, tags_enc,
                  folder_id, created_at, updated_at)
                 VALUES (21, X'00', X'00', X'00', X'00', X'00', X'00', 11, 1, 1);
             INSERT INTO notes (id, title_enc, body_enc, labels_enc, folder_id, created_at, updated_at)
                 VALUES (31, X'00', X'00', X'00', 12, 1, 1);
             INSERT INTO favorites (entity_type, entity_id, created_at)
                 VALUES ('credential', 21, 1);",
        )
        .unwrap();
    }

    // Opening runs the migration.
    let vault = Vault::open(&path).unwrap();
    let conn = vault.connection();

    let credential_folder: Option<i64> = conn
        .query_row("SELECT folder_id FROM credentials WHERE id = 21", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        credential_folder,
        Some(11),
        "the credential must still be filed in its folder"
    );

    let note_folder: Option<i64> = conn
        .query_row("SELECT folder_id FROM notes WHERE id = 31", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        note_folder,
        Some(12),
        "the note must still be filed in its folder"
    );

    let folders: i64 = conn
        .query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))
        .unwrap();
    assert_eq!(folders, 2, "both folders must survive the rebuild");

    let favorites: i64 = conn
        .query_row("SELECT COUNT(*) FROM favorites", [], |r| r.get(0))
        .unwrap();
    assert_eq!(favorites, 1, "favourites must survive the rebuild");

    // The rebuild must leave no scaffolding behind.
    let leftovers: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'table' AND (name LIKE '%_m4%' OR name LIKE '%_m4_old')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(leftovers, 0, "migration scaffolding tables must be gone");
}

#[test]
fn favorites_accept_an_env_file_after_migration() {
    let vault = Vault::open_in_memory().unwrap();
    vault.set_favorite("env_file", 4242, true).unwrap();
    assert!(vault.is_favorite("env_file", 4242).unwrap());
}

#[test]
fn folders_accept_the_env_kind_after_migration() {
    let vault = Vault::open_in_memory().unwrap();
    vault
        .connection()
        .execute_batch(
            "INSERT INTO folders (id, kind, name_enc, color, created_at, updated_at)
             VALUES (51, 'env', X'00', '#123456', 1, 1);",
        )
        .expect("the env folder kind must be accepted after M4");
}

#[test]
fn env_files_reject_an_unknown_environment() {
    let vault = Vault::open_in_memory().unwrap();
    let result = vault.connection().execute_batch(
        "INSERT INTO env_files
             (id, title_enc, content_enc, environment, folder_id, created_at, updated_at)
             VALUES (61, X'00', X'00', 'preview', NULL, 1, 1);",
    );
    assert!(
        result.is_err(),
        "only production, staging and local are valid environments"
    );
}

#[test]
fn deleting_a_folder_detaches_its_env_files() {
    let vault = Vault::open_in_memory().unwrap();
    vault
        .connection()
        .execute_batch(
            "INSERT INTO folders (id, kind, name_enc, color, created_at, updated_at)
                 VALUES (71, 'env', X'00', '#123456', 1, 1);
             INSERT INTO env_files
                 (id, title_enc, content_enc, environment, folder_id, created_at, updated_at)
                 VALUES (72, X'00', X'00', 'production', 71, 1, 1);
             DELETE FROM folders WHERE id = 71;",
        )
        .unwrap();

    let folder: Option<i64> = vault
        .connection()
        .query_row("SELECT folder_id FROM env_files WHERE id = 72", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        folder, None,
        "the record survives, detached from the folder"
    );
}
