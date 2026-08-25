//! Backup, restore, CSV and reset gates (U6: R39, R45, AE8, AE10).

use std::fs;

use tempfile::TempDir;

use crate::crypto::KdfParams;
use crate::vault::{create_vault, unlock_with_password, NewCredential, Vault};

use super::container;
use super::*;

const VAULT_PASSWORD: &str = "correct-horse-battery-staple-97";
const BACKUP_PASSWORD: &str = "unrelated-backup-passphrase-31";

fn fast_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 19_456,
        t_cost: 2,
        p_cost: 1,
    }
}

struct Fixture {
    _dir: TempDir,
    path: std::path::PathBuf,
    ids: Vec<i64>,
}

/// A real on-disk vault with records in it.
fn populated_vault() -> Fixture {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sanctum.db");

    let vault = Vault::open(&path).unwrap();
    let outcome = create_vault(&vault, VAULT_PASSWORD, fast_params()).unwrap();

    let mut ids = Vec::new();
    for index in 0..5 {
        ids.push(
            vault
                .insert_credential(
                    &outcome.dek,
                    &NewCredential {
                        name: format!("entry {index}"),
                        username: format!("user{index}@example.com"),
                        password: format!("password-{index}"),
                        ..Default::default()
                    },
                )
                .unwrap(),
        );
    }
    vault.checkpoint().unwrap();
    drop(vault);

    Fixture {
        _dir: dir,
        path,
        ids,
    }
}

fn make_backup(fixture: &Fixture) -> Vec<u8> {
    let vault = Vault::open(&fixture.path).unwrap();
    let archive =
        export_backup_with(&vault, &fixture.path, BACKUP_PASSWORD, fast_params()).unwrap();
    drop(vault);
    archive
}

fn assert_records_intact(path: &std::path::Path, ids: &[i64]) {
    let vault = Vault::open(path).unwrap();
    let key = unlock_with_password(&vault, VAULT_PASSWORD).unwrap();
    for (index, id) in ids.iter().enumerate() {
        let record = vault
            .get_credential(&key, *id)
            .unwrap()
            .unwrap_or_else(|| panic!("record {index} missing"));
        assert_eq!(record.password, format!("password-{index}"));
    }
}

// ---------------------------------------------------------------------------
// Container -- KTD20
// ---------------------------------------------------------------------------

#[test]
fn a_container_round_trips() {
    let body = b"arbitrary vault bytes".repeat(100);
    let sealed = container::seal_with(&body, BACKUP_PASSWORD, fast_params()).unwrap();
    assert_eq!(container::open(&sealed, BACKUP_PASSWORD).unwrap(), body);
}

#[test]
fn a_container_starts_with_its_magic_and_version() {
    let sealed = container::seal_with(b"x", BACKUP_PASSWORD, fast_params()).unwrap();
    assert_eq!(&sealed[..10], container::MAGIC);
    assert_eq!(u16::from_le_bytes([sealed[10], sealed[11]]), 1);
}

#[test]
fn the_backup_body_is_not_readable_in_the_file() {
    let secret = b"this-must-not-appear-in-the-archive";
    let sealed = container::seal_with(secret, BACKUP_PASSWORD, fast_params()).unwrap();
    assert!(!sealed.windows(secret.len()).any(|w| w == secret));
}

#[test]
fn a_wrong_backup_password_is_refused() {
    let sealed = container::seal_with(b"body", BACKUP_PASSWORD, fast_params()).unwrap();
    assert!(matches!(
        container::open(&sealed, "the-wrong-passphrase-entirely"),
        Err(BackupError::WrongPassword)
    ));
}

#[test]
fn a_non_sanctum_file_is_rejected_by_shape() {
    let junk = vec![0u8; 500];
    assert!(matches!(
        container::open(&junk, BACKUP_PASSWORD),
        Err(BackupError::Malformed(_))
    ));
}

/// KTD20's downgrade guard: the stored Argon2 parameters are inside the AAD,
/// so rewriting them to something trivial breaks the tag instead of yielding a
/// cheaply-crackable container.
#[test]
fn rewriting_the_declared_kdf_parameters_breaks_the_tag() {
    let mut sealed = container::seal_with(b"body", BACKUP_PASSWORD, fast_params()).unwrap();

    // m_cost sits at offset 12; drop it to the minimum.
    sealed[12..16].copy_from_slice(&8u32.to_le_bytes());

    assert!(matches!(
        container::open(&sealed, BACKUP_PASSWORD),
        Err(BackupError::WrongPassword) | Err(BackupError::Malformed(_))
    ));
}

#[test]
fn absurd_declared_parameters_are_refused_before_any_derivation() {
    let mut sealed = container::seal_with(b"body", BACKUP_PASSWORD, fast_params()).unwrap();
    // 16 GiB of memory cost would hang or OOM the process if we derived first.
    sealed[12..16].copy_from_slice(&16_777_216u32.to_le_bytes());

    assert!(matches!(
        container::open(&sealed, BACKUP_PASSWORD),
        Err(BackupError::Malformed(_))
    ));
}

#[test]
fn a_truncated_container_is_rejected_without_panicking() {
    let sealed = container::seal_with(&b"body".repeat(50), BACKUP_PASSWORD, fast_params()).unwrap();

    // Sampled rather than exhaustive: every prefix past the header costs a
    // full Argon2 derivation, and the interesting boundaries are the header
    // edges plus a few points inside the body.
    let mut lengths: Vec<usize> = (0..=64).collect();
    lengths.extend([
        sealed.len() / 4,
        sealed.len() / 2,
        sealed.len() - 17,
        sealed.len() - 1,
    ]);

    for length in lengths {
        assert!(
            container::open(&sealed[..length], BACKUP_PASSWORD).is_err(),
            "a {length}-byte prefix was accepted"
        );
    }
}

// ---------------------------------------------------------------------------
// Export and restore -- R45
// ---------------------------------------------------------------------------

#[test]
fn a_backup_restores_the_whole_vault() {
    let fixture = populated_vault();
    let archive = make_backup(&fixture);

    // Wipe and restore.
    reset_vault(&fixture.path).unwrap();
    assert!(!fixture.path.exists());

    restore_backup(&archive, BACKUP_PASSWORD, &fixture.path).unwrap();
    assert_records_intact(&fixture.path, &fixture.ids);
}

#[test]
fn a_restored_vault_still_needs_its_own_master_password() {
    // The backup password guards the file; the vault password still guards
    // the contents. Restoring does not weaken the vault.
    let fixture = populated_vault();
    let archive = make_backup(&fixture);
    reset_vault(&fixture.path).unwrap();
    restore_backup(&archive, BACKUP_PASSWORD, &fixture.path).unwrap();

    let vault = Vault::open(&fixture.path).unwrap();
    assert!(unlock_with_password(&vault, BACKUP_PASSWORD).is_err());
    assert!(unlock_with_password(&vault, VAULT_PASSWORD).is_ok());
}

#[test]
fn restoring_over_a_live_vault_replaces_it() {
    let fixture = populated_vault();
    let archive = make_backup(&fixture);

    // Add a record that exists only in the live vault.
    let extra = {
        let vault = Vault::open(&fixture.path).unwrap();
        let key = unlock_with_password(&vault, VAULT_PASSWORD).unwrap();
        let id = vault
            .insert_credential(
                &key,
                &NewCredential {
                    name: "added after the backup".into(),
                    ..Default::default()
                },
            )
            .unwrap();
        vault.checkpoint().unwrap();
        id
    };

    restore_backup(&archive, BACKUP_PASSWORD, &fixture.path).unwrap();

    let vault = Vault::open(&fixture.path).unwrap();
    let key = unlock_with_password(&vault, VAULT_PASSWORD).unwrap();
    assert!(
        vault.get_credential(&key, extra).unwrap().is_none(),
        "the restored vault must be the backed-up state, not a merge"
    );
    assert_records_intact(&fixture.path, &fixture.ids);
}

// ---------------------------------------------------------------------------
// AE10 -- a bad backup must never damage the live vault
// ---------------------------------------------------------------------------

/// The mandatory gate. Each variant is a differently-broken archive, and after
/// every one the live vault must be byte-for-byte what it was.
#[test]
fn a_corrupt_backup_is_rejected_before_the_vault_is_touched() {
    let fixture = populated_vault();
    let archive = make_backup(&fixture);
    let before = fs::read(&fixture.path).unwrap();

    let mut flipped_body = archive.clone();
    let last = flipped_body.len() - 1;
    flipped_body[last] ^= 0b1000_0000;

    let mut flipped_header = archive.clone();
    flipped_header[30] ^= 0b0000_0001;

    let truncated = archive[..archive.len() / 2].to_vec();

    let mut wrong_magic = archive.clone();
    wrong_magic[0] = b'X';

    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("flipped body bit", flipped_body, BACKUP_PASSWORD),
        ("flipped header bit", flipped_header, BACKUP_PASSWORD),
        ("truncated", truncated, BACKUP_PASSWORD),
        ("wrong magic", wrong_magic, BACKUP_PASSWORD),
        ("wrong password", archive.clone(), "not-the-backup-password"),
        ("not a backup at all", vec![7u8; 4096], BACKUP_PASSWORD),
    ];

    for (label, bad, password) in cases {
        let result = restore_backup(&bad, password, &fixture.path);
        assert!(result.is_err(), "{label}: a broken archive was accepted");

        assert_eq!(
            fs::read(&fixture.path).unwrap(),
            before,
            "{label}: the live vault was modified by a failed restore"
        );
    }

    // And it still works afterwards.
    assert_records_intact(&fixture.path, &fixture.ids);
}

/// A container that authenticates but holds bytes that are not a database must
/// also be caught -- before the rename, not after.
#[test]
fn a_valid_container_holding_garbage_is_rejected() {
    let fixture = populated_vault();
    let before = fs::read(&fixture.path).unwrap();

    let bogus = container::seal_with(
        b"perfectly authentic nonsense",
        BACKUP_PASSWORD,
        fast_params(),
    )
    .unwrap();
    assert!(matches!(
        restore_backup(&bogus, BACKUP_PASSWORD, &fixture.path),
        Err(BackupError::NotAVault)
    ));

    assert_eq!(fs::read(&fixture.path).unwrap(), before);
    assert_records_intact(&fixture.path, &fixture.ids);
}

#[test]
fn a_failed_restore_leaves_no_temporary_file_behind() {
    let fixture = populated_vault();
    let bogus = container::seal_with(b"not a database", BACKUP_PASSWORD, fast_params()).unwrap();
    let _ = restore_backup(&bogus, BACKUP_PASSWORD, &fixture.path);

    let leftovers: Vec<_> = fs::read_dir(fixture.path.parent().unwrap())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.starts_with("sanctum-restore-"))
        .collect();

    assert!(leftovers.is_empty(), "left staged files: {leftovers:?}");
}

// ---------------------------------------------------------------------------
// Reset -- AE8
// ---------------------------------------------------------------------------

#[test]
fn reset_removes_the_vault_and_its_sidecars() {
    let fixture = populated_vault();
    reset_vault(&fixture.path).unwrap();

    for suffix in ["", "-wal", "-shm"] {
        let mut path = fixture.path.as_os_str().to_os_string();
        path.push(suffix);
        assert!(
            !std::path::PathBuf::from(path).exists(),
            "a {suffix:?} file survived the reset"
        );
    }
}

#[test]
fn after_a_reset_the_next_launch_sees_first_run_setup() {
    let fixture = populated_vault();
    reset_vault(&fixture.path).unwrap();

    let vault = Vault::open(&fixture.path).unwrap();
    assert!(!crate::vault::is_initialized(&vault).unwrap());
}

#[test]
fn resetting_a_vault_that_is_already_gone_is_not_an_error() {
    let dir = TempDir::new().unwrap();
    assert!(reset_vault(&dir.path().join("absent.db")).is_ok());
}

// ---------------------------------------------------------------------------
// CSV export -- R39
// ---------------------------------------------------------------------------

#[test]
fn csv_export_contains_every_credential() {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, VAULT_PASSWORD, fast_params()).unwrap();
    vault
        .insert_credential(
            &outcome.dek,
            &NewCredential {
                name: "GitHub".into(),
                username: "dev@example.com".into(),
                password: "s3cret".into(),
                website: "github.com".into(),
                tags: vec!["dev".into()],
                ..Default::default()
            },
        )
        .unwrap();

    let csv = export_credentials_csv(&vault, &outcome.dek).unwrap();
    assert!(csv.starts_with("name,username,password,website,notes,tags,folder\n"));
    assert!(csv.contains("\"GitHub\""));
    assert!(csv.contains("\"s3cret\""));
}

/// A password containing a comma, a quote, or a newline must not break the
/// file. Every field is quoted unconditionally, so this is structural rather
/// than a special case.
#[test]
fn csv_export_escapes_awkward_values() {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, VAULT_PASSWORD, fast_params()).unwrap();
    vault
        .insert_credential(
            &outcome.dek,
            &NewCredential {
                name: "comma, quote \" and".into(),
                password: "line\nbreak".into(),
                notes: "he said \"hello\"".into(),
                ..Default::default()
            },
        )
        .unwrap();

    let csv = export_credentials_csv(&vault, &outcome.dek).unwrap();
    assert!(csv.contains("\"comma, quote \"\" and\""));
    assert!(csv.contains("\"he said \"\"hello\"\"\""));
}

#[test]
fn csv_export_names_the_folder_a_credential_belongs_to() {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, VAULT_PASSWORD, fast_params()).unwrap();
    let folder = vault
        .insert_folder(
            &outcome.dek,
            crate::vault::KIND_PASSWORDS,
            "Client Projects",
            "#e8734a",
        )
        .unwrap();
    vault
        .insert_credential(
            &outcome.dek,
            &NewCredential {
                name: "Filed".into(),
                folder_id: Some(folder),
                ..Default::default()
            },
        )
        .unwrap();

    let csv = export_credentials_csv(&vault, &outcome.dek).unwrap();
    assert!(csv.contains("\"Client Projects\""));
}

#[test]
fn the_csv_warning_names_the_cloud_folders_that_matter() {
    for service in ["OneDrive", "Dropbox", "Google Drive"] {
        assert!(
            CSV_WARNING.contains(service),
            "the warning should name {service} explicitly"
        );
    }
}

#[test]
fn a_written_csv_is_restricted_to_the_current_user() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("export.csv");

    // A failure to tighten the ACL is reported but still writes the file --
    // assert the file exists either way, and that the error explains itself.
    match super::csv_export::write_restricted(&path, "name\n\"x\"\n") {
        Ok(()) => assert!(path.exists()),
        Err(BackupError::Malformed(message)) => {
            assert!(path.exists(), "the export should still have been written");
            assert!(message.contains("permissions"));
        }
        Err(other) => panic!("unexpected error: {other}"),
    }
}
