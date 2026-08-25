//! Rotation gates (U5: R11, R12, R40, R42, AE9, AE11).
//!
//! The mandatory one is `a_crash_mid_rotation_leaves_exactly_one_working_key`.
//! Everything else here is ordinary coverage; that test is the reason the
//! whole KTD9 key-indirection design was chosen.

use crate::crypto::KdfParams;

use super::rotate::*;
use super::*;

fn fast_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 19_456,
        t_cost: 2,
        p_cost: 1,
    }
}

const OLD_PASSWORD: &str = "correct-horse-battery-staple-97";
const NEW_PASSWORD: &str = "tangerine-scaffold-glimmer-42";

struct Fixture {
    vault: Vault,
    recovery: String,
    ids: Vec<i64>,
}

/// A vault with ten real records, so every rotation assertion is made against
/// data that must survive it.
fn populated() -> Fixture {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, OLD_PASSWORD, fast_params()).unwrap();

    let mut ids = Vec::new();
    for index in 0..10 {
        ids.push(
            vault
                .insert_credential(
                    &outcome.dek,
                    &NewCredential {
                        name: format!("record {index}"),
                        password: format!("password-{index}"),
                        ..Default::default()
                    },
                )
                .unwrap(),
        );
    }

    Fixture {
        vault,
        recovery: outcome.recovery_display,
        ids,
    }
}

/// Asserts every record still decrypts under `key`.
fn assert_all_readable(fixture: &Fixture, key: &crate::crypto::SymmetricKey) {
    for (index, id) in fixture.ids.iter().enumerate() {
        let record = fixture
            .vault
            .get_credential(key, *id)
            .unwrap()
            .unwrap_or_else(|| panic!("record {index} vanished"));
        assert_eq!(record.password, format!("password-{index}"));
    }
}

// ---------------------------------------------------------------------------
// Password change -- R11, R40
// ---------------------------------------------------------------------------

#[test]
fn changing_the_password_keeps_every_record_readable() {
    let fixture = populated();
    let outcome = change_master_password(&fixture.vault, OLD_PASSWORD, NEW_PASSWORD).unwrap();

    // R11: the DEK never changed, so the records were never touched.
    assert_all_readable(&fixture, &outcome.dek);

    let reopened = unlock_with_password(&fixture.vault, NEW_PASSWORD).unwrap();
    assert_all_readable(&fixture, &reopened);
}

#[test]
fn the_old_password_stops_working() {
    let fixture = populated();
    change_master_password(&fixture.vault, OLD_PASSWORD, NEW_PASSWORD).unwrap();

    assert!(matches!(
        unlock_with_password(&fixture.vault, OLD_PASSWORD),
        Err(VaultError::WrongSecret)
    ));
}

#[test]
fn a_wrong_current_password_changes_nothing() {
    let fixture = populated();

    assert!(matches!(
        change_master_password(&fixture.vault, "not-the-password-at-all", NEW_PASSWORD),
        Err(VaultError::WrongSecret)
    ));

    // The vault is exactly as it was.
    let key = unlock_with_password(&fixture.vault, OLD_PASSWORD).unwrap();
    assert_all_readable(&fixture, &key);
    assert!(unlock_with_recovery(&fixture.vault, &fixture.recovery).is_ok());
}

#[test]
fn a_weak_new_password_is_rejected_and_changes_nothing() {
    let fixture = populated();

    assert!(matches!(
        change_master_password(&fixture.vault, OLD_PASSWORD, "password1234"),
        Err(VaultError::WeakPassword { .. })
    ));

    let key = unlock_with_password(&fixture.vault, OLD_PASSWORD).unwrap();
    assert_all_readable(&fixture, &key);
}

#[test]
fn the_master_salt_is_replaced_on_every_change() {
    let fixture = populated();
    let before = VaultHeader::load(fixture.vault.connection())
        .unwrap()
        .unwrap();

    change_master_password(&fixture.vault, OLD_PASSWORD, NEW_PASSWORD).unwrap();

    let after = VaultHeader::load(fixture.vault.connection())
        .unwrap()
        .unwrap();
    assert_ne!(
        before.master_salt, after.master_salt,
        "reusing the salt would carry precomputation across the change"
    );
}

// ---------------------------------------------------------------------------
// Recovery rotation -- R42
// ---------------------------------------------------------------------------

/// R42: changing the password must invalidate the old recovery code. Leaving
/// it live would mean a password change did not actually revoke prior access.
#[test]
fn changing_the_password_invalidates_the_old_recovery_code() {
    let fixture = populated();
    let outcome = change_master_password(&fixture.vault, OLD_PASSWORD, NEW_PASSWORD).unwrap();

    assert!(matches!(
        unlock_with_recovery(&fixture.vault, &fixture.recovery),
        Err(VaultError::WrongSecret)
    ));
    assert!(unlock_with_recovery(&fixture.vault, &outcome.recovery_display).is_ok());
}

#[test]
fn rotating_the_code_leaves_the_password_alone() {
    let fixture = populated();
    let fresh = rotate_recovery_code(&fixture.vault, OLD_PASSWORD).unwrap();

    // Old code dead, new code live, password untouched.
    assert!(matches!(
        unlock_with_recovery(&fixture.vault, &fixture.recovery),
        Err(VaultError::WrongSecret)
    ));
    let via_new = unlock_with_recovery(&fixture.vault, &fresh).unwrap();
    assert_all_readable(&fixture, &via_new);

    let via_password = unlock_with_password(&fixture.vault, OLD_PASSWORD).unwrap();
    assert_all_readable(&fixture, &via_password);
}

#[test]
fn rotating_the_code_requires_the_master_password() {
    let fixture = populated();
    assert!(matches!(
        rotate_recovery_code(&fixture.vault, "wrong"),
        Err(VaultError::WrongSecret)
    ));
    assert!(unlock_with_recovery(&fixture.vault, &fixture.recovery).is_ok());
}

#[test]
fn a_new_code_starts_unacknowledged() {
    let fixture = populated();
    acknowledge_recovery_code(&fixture.vault).unwrap();
    assert!(recovery_acknowledged(&fixture.vault).unwrap());

    rotate_recovery_code(&fixture.vault, OLD_PASSWORD).unwrap();
    assert!(
        !recovery_acknowledged(&fixture.vault).unwrap(),
        "a code the user has not seen cannot already be acknowledged"
    );
}

// ---------------------------------------------------------------------------
// Crash safety -- AE9, mandatory
// ---------------------------------------------------------------------------

/// AE9: a process killed mid-rotation must leave a vault that opens under
/// exactly one key, with every record intact. Both sides of the commit are
/// exercised, because the failure modes differ: before it, nothing should have
/// changed; after it, everything should have.
#[test]
fn a_crash_mid_rotation_leaves_exactly_one_working_key() {
    // --- killed before the commit ---
    {
        let fixture = populated();
        let result = change_master_password_instrumented(
            &fixture.vault,
            OLD_PASSWORD,
            NEW_PASSWORD,
            &mut |phase| {
                if phase == RotationPhase::BeforeCommit {
                    Err(VaultError::Corrupt("simulated kill".into()))
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());

        // Old secrets still work; new one never took effect.
        let key = unlock_with_password(&fixture.vault, OLD_PASSWORD)
            .expect("a crash before the commit must leave the old password working");
        assert_all_readable(&fixture, &key);
        assert!(unlock_with_recovery(&fixture.vault, &fixture.recovery).is_ok());
        assert!(matches!(
            unlock_with_password(&fixture.vault, NEW_PASSWORD),
            Err(VaultError::WrongSecret)
        ));
    }

    // --- killed immediately after the commit ---
    {
        let fixture = populated();
        let mut issued = None;
        let result = change_master_password_instrumented(
            &fixture.vault,
            OLD_PASSWORD,
            NEW_PASSWORD,
            &mut |phase| {
                if phase == RotationPhase::AfterCommit {
                    // Capture what the header now holds, then "die" before the
                    // caller could ever display the new code.
                    issued = VaultHeader::load(fixture.vault.connection()).unwrap();
                    Err(VaultError::Corrupt("simulated kill".into()))
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        assert!(issued.is_some(), "the header must have been written");

        // New password works; old password and old code are dead.
        let key = unlock_with_password(&fixture.vault, NEW_PASSWORD)
            .expect("a crash after the commit must leave the new password working");
        assert_all_readable(&fixture, &key);
        assert!(matches!(
            unlock_with_password(&fixture.vault, OLD_PASSWORD),
            Err(VaultError::WrongSecret)
        ));
        assert!(matches!(
            unlock_with_recovery(&fixture.vault, &fixture.recovery),
            Err(VaultError::WrongSecret)
        ));
    }
}

/// The same guarantee for the recovery-only rotation path.
#[test]
fn a_crash_mid_code_rotation_leaves_exactly_one_working_code() {
    let fixture = populated();
    let result = rotate_recovery_code_instrumented(&fixture.vault, OLD_PASSWORD, &mut |phase| {
        if phase == RotationPhase::BeforeCommit {
            Err(VaultError::Corrupt("simulated kill".into()))
        } else {
            Ok(())
        }
    });
    assert!(result.is_err());

    let key = unlock_with_recovery(&fixture.vault, &fixture.recovery)
        .expect("the original code must survive an aborted rotation");
    assert_all_readable(&fixture, &key);
}

/// Whatever happens, there must never be a moment where neither secret opens
/// the vault. This drives rotation to failure at both phases and asserts the
/// vault is always openable by something.
#[test]
fn no_interruption_can_produce_an_unopenable_vault() {
    for phase in [RotationPhase::BeforeCommit, RotationPhase::AfterCommit] {
        let fixture = populated();
        let mut captured = None;

        let _ = change_master_password_instrumented(
            &fixture.vault,
            OLD_PASSWORD,
            NEW_PASSWORD,
            &mut |reached| {
                if reached == phase {
                    captured = Some(reached);
                    Err(VaultError::Corrupt("simulated kill".into()))
                } else {
                    Ok(())
                }
            },
        );

        let old_works = unlock_with_password(&fixture.vault, OLD_PASSWORD).is_ok();
        let new_works = unlock_with_password(&fixture.vault, NEW_PASSWORD).is_ok();

        assert!(
            old_works ^ new_works,
            "after a kill at {phase:?}, exactly one password must work \
             (old={old_works}, new={new_works})"
        );
    }
}

// ---------------------------------------------------------------------------
// Recovery-driven reset -- AE11
// ---------------------------------------------------------------------------

#[test]
fn the_recovery_code_can_set_a_new_master_password() {
    let fixture = populated();
    let outcome =
        reset_master_password_with_recovery(&fixture.vault, &fixture.recovery, NEW_PASSWORD)
            .unwrap();

    assert_all_readable(&fixture, &outcome.dek);
    let via_new = unlock_with_password(&fixture.vault, NEW_PASSWORD).unwrap();
    assert_all_readable(&fixture, &via_new);

    assert!(matches!(
        unlock_with_password(&fixture.vault, OLD_PASSWORD),
        Err(VaultError::WrongSecret)
    ));
}

#[test]
fn a_recovery_reset_also_retires_the_code_it_used() {
    // The code was just typed into a machine and read off paper; continuing to
    // honour it afterwards would extend its exposure indefinitely.
    let fixture = populated();
    let outcome =
        reset_master_password_with_recovery(&fixture.vault, &fixture.recovery, NEW_PASSWORD)
            .unwrap();

    assert!(matches!(
        unlock_with_recovery(&fixture.vault, &fixture.recovery),
        Err(VaultError::WrongSecret)
    ));
    assert!(unlock_with_recovery(&fixture.vault, &outcome.recovery_display).is_ok());
}

#[test]
fn a_wrong_recovery_code_cannot_reset_the_password() {
    let fixture = populated();
    let other = crate::crypto::generate_recovery_code().unwrap();

    assert!(matches!(
        reset_master_password_with_recovery(&fixture.vault, &other.display, NEW_PASSWORD),
        Err(VaultError::WrongSecret)
    ));
    assert!(unlock_with_password(&fixture.vault, OLD_PASSWORD).is_ok());
}

// ---------------------------------------------------------------------------
// Record bodies are never touched
// ---------------------------------------------------------------------------

/// KTD9's whole justification: rotation is a header write. If a record blob
/// changed, the O(1) claim -- and the crash-safety argument built on it -- is
/// false.
#[test]
fn rotation_does_not_rewrite_a_single_record_blob() {
    let fixture = populated();

    let blobs_before: Vec<Vec<u8>> = fixture
        .ids
        .iter()
        .map(|id| {
            fixture
                .vault
                .connection()
                .query_row(
                    "SELECT password_enc FROM credentials WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get(0),
                )
                .unwrap()
        })
        .collect();

    change_master_password(&fixture.vault, OLD_PASSWORD, NEW_PASSWORD).unwrap();

    let blobs_after: Vec<Vec<u8>> = fixture
        .ids
        .iter()
        .map(|id| {
            fixture
                .vault
                .connection()
                .query_row(
                    "SELECT password_enc FROM credentials WHERE id = ?1",
                    rusqlite::params![id],
                    |row| row.get(0),
                )
                .unwrap()
        })
        .collect();

    assert_eq!(
        blobs_before, blobs_after,
        "a password change must not rewrite record ciphertext"
    );
}
