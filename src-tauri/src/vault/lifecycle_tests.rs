//! Vault setup and unlock gates (U4: R5, R6, R44, R46, AE1, AE2).

use crate::crypto::{normalize_recovery_code, KdfParams, RecordAad};

use super::*;

/// Floor parameters keep these tests fast without dropping below what the
/// production path would accept.
fn fast_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 19_456,
        t_cost: 2,
        p_cost: 1,
    }
}

const GOOD_PASSWORD: &str = "correct-horse-battery-staple-97";

fn set_up() -> (Vault, SetupOutcome) {
    let vault = Vault::open_in_memory().unwrap();
    let outcome = create_vault(&vault, GOOD_PASSWORD, fast_params()).unwrap();
    (vault, outcome)
}

// ---------------------------------------------------------------------------
// First-run setup -- R5
// ---------------------------------------------------------------------------

#[test]
fn a_fresh_vault_reports_itself_uninitialised() {
    let vault = Vault::open_in_memory().unwrap();
    assert!(!is_initialized(&vault).unwrap());
}

#[test]
fn setup_initialises_the_vault_and_issues_a_recovery_code() {
    let (vault, outcome) = set_up();

    assert!(is_initialized(&vault).unwrap());
    assert!(outcome.recovery_display.starts_with("SANCTUM-"));
    assert!(!recovery_acknowledged(&vault).unwrap());
}

#[test]
fn the_key_from_setup_can_immediately_encrypt() {
    let (vault, outcome) = set_up();

    let id = vault
        .insert_credential(
            &outcome.dek,
            &NewCredential {
                name: "first".into(),
                password: "s3cret".into(),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(
        vault
            .get_credential(&outcome.dek, id)
            .unwrap()
            .unwrap()
            .password,
        "s3cret"
    );
}

#[test]
fn a_vault_cannot_be_set_up_twice() {
    let (vault, _) = set_up();
    assert!(matches!(
        create_vault(&vault, GOOD_PASSWORD, fast_params()),
        Err(VaultError::AlreadyInitialized)
    ));
}

/// R44 / KTD21: the floor is enforced inside `create_vault`, so there is no
/// caller that can skip it.
#[test]
fn setup_rejects_a_password_below_the_strength_floor() {
    for weak in ["short", "password1234", "aaaaaaaaaaaaaa", ""] {
        let vault = Vault::open_in_memory().unwrap();
        assert!(
            matches!(
                create_vault(&vault, weak, fast_params()),
                Err(VaultError::WeakPassword { .. })
            ),
            "{weak:?} was accepted as a master password"
        );
        assert!(
            !is_initialized(&vault).unwrap(),
            "a rejected password must leave no header behind"
        );
    }
}

#[test]
fn setup_raises_parameters_that_sit_below_the_floor() {
    let vault = Vault::open_in_memory().unwrap();
    let weak = KdfParams {
        m_cost_kib: 8,
        t_cost: 1,
        p_cost: 1,
    };
    create_vault(&vault, GOOD_PASSWORD, weak).unwrap();

    let header = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert!(
        header.kdf_params.meets_floor(),
        "stored parameters {:?} are below the KTD11 floor",
        header.kdf_params
    );
}

#[test]
fn the_stored_parameters_are_the_ones_unlock_uses() {
    // KTD11: a vault must keep opening after the defaults change, which only
    // works if unlock reads the header rather than the current constants.
    let vault = Vault::open_in_memory().unwrap();
    let unusual = KdfParams {
        m_cost_kib: 32_768,
        t_cost: 4,
        p_cost: 2,
    };
    create_vault(&vault, GOOD_PASSWORD, unusual).unwrap();

    let header = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert_eq!(header.kdf_params, unusual);
    assert!(unlock_with_password(&vault, GOOD_PASSWORD).is_ok());
}

// ---------------------------------------------------------------------------
// Unlock -- R6, AE1
// ---------------------------------------------------------------------------

#[test]
fn the_master_password_unlocks_the_vault() {
    let (vault, outcome) = set_up();
    let id = vault
        .insert_credential(
            &outcome.dek,
            &NewCredential {
                password: "round-trip".into(),
                ..Default::default()
            },
        )
        .unwrap();

    let reopened = unlock_with_password(&vault, GOOD_PASSWORD).unwrap();
    assert_eq!(
        vault
            .get_credential(&reopened, id)
            .unwrap()
            .unwrap()
            .password,
        "round-trip"
    );
}

/// AE1: a wrong master password leaves the vault locked and never yields a key.
#[test]
fn a_wrong_master_password_yields_no_key() {
    let (vault, _) = set_up();

    for wrong in [
        "correct-horse-battery-staple-98",
        "Correct-Horse-Battery-Staple-97",
        "",
        "totally different passphrase here",
    ] {
        assert!(
            matches!(
                unlock_with_password(&vault, wrong),
                Err(VaultError::WrongSecret)
            ),
            "{wrong:?} unlocked the vault"
        );
    }
}

#[test]
fn unlocking_an_uninitialised_vault_reports_not_initialised() {
    let vault = Vault::open_in_memory().unwrap();
    assert!(matches!(
        unlock_with_password(&vault, GOOD_PASSWORD),
        Err(VaultError::NotInitialized)
    ));
}

// ---------------------------------------------------------------------------
// Recovery -- R12, AE11 (first half), KTD14
// ---------------------------------------------------------------------------

#[test]
fn the_recovery_code_opens_the_same_vault_as_the_password() {
    let (vault, outcome) = set_up();
    let aad = RecordAad::new(1, "credential.password");
    let blob = crate::crypto::encrypt_record(&outcome.dek, &aad, b"same key").unwrap();

    let via_recovery = unlock_with_recovery(&vault, &outcome.recovery_display).unwrap();

    assert_eq!(
        crate::crypto::decrypt_record(&via_recovery, &aad, &blob).unwrap(),
        b"same key",
        "both secrets must unwrap the same DEK"
    );
}

#[test]
fn a_recovery_code_typed_untidily_still_works() {
    let (vault, outcome) = set_up();

    for variant in [
        outcome.recovery_display.to_lowercase(),
        outcome.recovery_display.replace('-', " "),
        format!("  {}  ", outcome.recovery_display),
    ] {
        assert!(
            unlock_with_recovery(&vault, &variant).is_ok(),
            "variant {variant:?} was rejected"
        );
    }
}

#[test]
fn a_wrong_recovery_code_yields_no_key() {
    let (vault, _) = set_up();
    let other = crate::crypto::generate_recovery_code().unwrap();

    assert!(matches!(
        unlock_with_recovery(&vault, &other.display),
        Err(VaultError::WrongSecret)
    ));
}

#[test]
fn a_malformed_recovery_code_is_rejected_as_a_wrong_secret() {
    let (vault, _) = set_up();

    // Not a distinct error: telling the user "that is the right shape but the
    // wrong value" is information an attacker can use.
    for junk in ["", "nonsense", "SANCTUM-ABCDE", "SANCTUM-!!!!!-!!!!!"] {
        assert!(matches!(
            unlock_with_recovery(&vault, junk),
            Err(VaultError::WrongSecret)
        ));
    }
}

#[test]
fn verifying_a_code_reports_validity_without_unlocking() {
    let (vault, outcome) = set_up();
    let other = crate::crypto::generate_recovery_code().unwrap();

    assert!(verify_recovery_code(&vault, &outcome.recovery_display).unwrap());
    assert!(!verify_recovery_code(&vault, &other.display).unwrap());
}

// ---------------------------------------------------------------------------
// One-time display -- R46, AE2
// ---------------------------------------------------------------------------

/// AE2: the code is shown once. Nothing in the vault can reproduce it, which
/// is the property that makes "write this down" meaningful.
#[test]
fn the_recovery_code_is_not_recoverable_from_the_vault() {
    let (vault, outcome) = set_up();
    let normalized = normalize_recovery_code(&outcome.recovery_display).unwrap();
    assert_eq!(normalized.len(), 30);

    // Scan every byte of the header for any trace of the code.
    let header = VaultHeader::load(vault.connection()).unwrap().unwrap();
    let mut header_bytes = Vec::new();
    header_bytes.extend_from_slice(&header.master_salt);
    header_bytes.extend_from_slice(&header.recovery_salt);
    header_bytes.extend_from_slice(&header.wrapped_master.ciphertext);
    header_bytes.extend_from_slice(&header.wrapped_recovery.ciphertext);
    header_bytes.extend_from_slice(&header.wrapped_master.nonce);
    header_bytes.extend_from_slice(&header.wrapped_recovery.nonce);

    let needle = outcome
        .recovery_display
        .trim_start_matches("SANCTUM-")
        .replace('-', "");
    assert!(
        !header_bytes
            .windows(needle.len())
            .any(|w| w == needle.as_bytes()),
        "the recovery code is stored in the vault header"
    );
}

#[test]
fn acknowledgement_is_recorded_and_persists() {
    let (vault, _) = set_up();
    assert!(!recovery_acknowledged(&vault).unwrap());

    acknowledge_recovery_code(&vault).unwrap();
    assert!(recovery_acknowledged(&vault).unwrap());

    // Still true after a fresh read of the header.
    let header = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert!(header.recovery_acknowledged);
}

#[test]
fn acknowledging_does_not_disturb_the_wrapped_keys() {
    let (vault, outcome) = set_up();
    let before = VaultHeader::load(vault.connection()).unwrap().unwrap();

    acknowledge_recovery_code(&vault).unwrap();

    let after = VaultHeader::load(vault.connection()).unwrap().unwrap();
    assert_eq!(before.wrapped_master, after.wrapped_master);
    assert_eq!(before.wrapped_recovery, after.wrapped_recovery);
    assert!(unlock_with_password(&vault, GOOD_PASSWORD).is_ok());
    assert!(unlock_with_recovery(&vault, &outcome.recovery_display).is_ok());
}
