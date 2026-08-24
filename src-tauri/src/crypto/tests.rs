//! U2 verification gates.
//!
//! The Verification Contract marks the nonce-uniqueness property test and the
//! AAD-tamper test as mandatory, not optional -- they guard the two ways this
//! layer fails catastrophically rather than loudly.

use std::collections::HashSet;
use std::time::Duration;

use super::aead::nonce_of;
use super::*;

/// Cheap-but-legal Argon2id parameters for tests that are not about the KDF.
/// Exactly the KTD11 floor, so nothing here can pass under settings the
/// production path would reject.
fn floor_params() -> KdfParams {
    KdfParams {
        m_cost_kib: 19_456,
        t_cost: 2,
        p_cost: 1,
    }
}

fn test_key() -> SymmetricKey {
    SymmetricKey::generate().expect("OS RNG must be available")
}

// ---------------------------------------------------------------------------
// Record encryption -- R7
// ---------------------------------------------------------------------------

#[test]
fn encrypt_decrypt_round_trips_a_record() {
    let dek = test_key();
    let aad = RecordAad::new(42, "credential.password");
    let secret = b"correct horse battery staple";

    let blob = encrypt_record(&dek, &aad, secret).unwrap();
    let recovered = decrypt_record(&dek, &aad, &blob).unwrap();

    assert_eq!(recovered, secret);
}

#[test]
fn ciphertext_never_contains_the_plaintext() {
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");
    let secret = b"hunter2-hunter2-hunter2";

    let blob = encrypt_record(&dek, &aad, secret).unwrap();

    assert!(
        !blob.windows(secret.len()).any(|w| w == secret),
        "plaintext leaked into the stored blob"
    );
}

#[test]
fn same_plaintext_encrypts_to_different_ciphertext() {
    let dek = test_key();
    let aad = RecordAad::new(7, "note.body");
    let plaintext = b"identical input";

    let a = encrypt_record(&dek, &aad, plaintext).unwrap();
    let b = encrypt_record(&dek, &aad, plaintext).unwrap();

    assert_ne!(a, b, "deterministic ciphertext leaks equality of records");
}

#[test]
fn empty_plaintext_round_trips() {
    let dek = test_key();
    let aad = RecordAad::new(3, "credential.notes");

    let blob = encrypt_record(&dek, &aad, b"").unwrap();
    assert_eq!(decrypt_record(&dek, &aad, &blob).unwrap(), Vec::<u8>::new());
}

// ---------------------------------------------------------------------------
// Nonce uniqueness -- mandatory property gate (KTD12)
// ---------------------------------------------------------------------------

/// `aes-gcm` does not prevent nonce reuse, and reuse under GCM leaks both the
/// plaintext XOR and the authentication subkey. This asserts the invariant
/// directly over a realistic volume of encryptions under one key.
#[test]
fn ten_thousand_encryptions_never_repeat_a_nonce() {
    const ROUNDS: usize = 10_000;

    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");
    let mut seen = HashSet::with_capacity(ROUNDS);

    for _ in 0..ROUNDS {
        let blob = encrypt_record(&dek, &aad, b"same plaintext every time").unwrap();
        assert!(
            seen.insert(nonce_of(&blob).to_vec()),
            "nonce reuse detected under a single key"
        );
    }

    assert_eq!(seen.len(), ROUNDS);
}

// ---------------------------------------------------------------------------
// AAD binding -- mandatory tamper gate (KTD12)
// ---------------------------------------------------------------------------

#[test]
fn blob_moved_to_another_row_fails_to_decrypt() {
    let dek = test_key();
    let written = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &written, b"row one secret").unwrap();

    let moved = RecordAad::new(2, "credential.password");
    assert!(
        matches!(
            decrypt_record(&dek, &moved, &blob),
            Err(CryptoError::Decrypt)
        ),
        "a ciphertext relocated to another row must not authenticate"
    );
}

#[test]
fn blob_moved_to_another_column_fails_to_decrypt() {
    let dek = test_key();
    let written = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &written, b"a password").unwrap();

    let moved = RecordAad::new(1, "credential.notes");
    assert!(
        matches!(
            decrypt_record(&dek, &moved, &blob),
            Err(CryptoError::Decrypt)
        ),
        "a password blob must not decrypt as a notes value"
    );
}

#[test]
fn a_different_crypto_format_version_fails_to_decrypt() {
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &aad, b"versioned").unwrap();

    let other = RecordAad {
        row_id: 1,
        column: "credential.password",
        format_version: VAULT_FORMAT_VERSION + 1,
    };
    assert!(matches!(
        decrypt_record(&dek, &other, &blob),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn aad_encoding_is_unambiguous() {
    // ("ab", row 1) and ("a", row 1) must not encode to a shared prefix that
    // could be made to collide -- length prefixing is what prevents that.
    let dek = test_key();
    let long = RecordAad::new(1, "ab");
    let short = RecordAad::new(1, "a");

    let blob = encrypt_record(&dek, &long, b"x").unwrap();
    assert!(matches!(
        decrypt_record(&dek, &short, &blob),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn flipping_any_bit_of_the_blob_fails_to_decrypt() {
    let dek = test_key();
    let aad = RecordAad::new(9, "income.remarks");
    let blob = encrypt_record(&dek, &aad, b"tamper target").unwrap();

    // Sample the nonce, the ciphertext body, and the tag.
    for index in [0usize, NONCE_LEN, blob.len() - 1] {
        let mut tampered = blob.clone();
        tampered[index] ^= 0b0000_0001;
        assert!(
            matches!(
                decrypt_record(&dek, &aad, &tampered),
                Err(CryptoError::Decrypt)
            ),
            "modification at byte {index} was not detected"
        );
    }
}

#[test]
fn wrong_key_fails_to_decrypt_a_record() {
    let dek = test_key();
    let other = test_key();
    let aad = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &aad, b"secret").unwrap();

    assert!(matches!(
        decrypt_record(&other, &aad, &blob),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn truncated_blob_is_rejected_without_panicking() {
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");

    for len in 0..(NONCE_LEN + 16) {
        let truncated = vec![0u8; len];
        assert!(
            decrypt_record(&dek, &aad, &truncated).is_err(),
            "a {len}-byte blob must be rejected, not parsed"
        );
    }
}

// ---------------------------------------------------------------------------
// KEK/DEK wrapping -- KTD9, KTD14
// ---------------------------------------------------------------------------

#[test]
fn dek_round_trips_through_a_wrap() {
    let kek = test_key();
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &aad, b"payload").unwrap();

    let wrapped = wrap_dek(&kek, &dek, WrapPurpose::MasterPassword).unwrap();
    let recovered = unwrap_dek(&kek, &wrapped).unwrap();

    // The proof that it is the same key is that it opens real ciphertext.
    assert_eq!(decrypt_record(&recovered, &aad, &blob).unwrap(), b"payload");
}

#[test]
fn wrong_kek_fails_to_unwrap_the_dek() {
    let kek = test_key();
    let wrong = test_key();
    let dek = test_key();

    let wrapped = wrap_dek(&kek, &dek, WrapPurpose::MasterPassword).unwrap();

    assert!(
        matches!(unwrap_dek(&wrong, &wrapped), Err(CryptoError::Decrypt)),
        "an incorrect KEK must fail cleanly, never panic"
    );
}

#[test]
fn a_recovery_blob_cannot_be_used_in_the_master_slot() {
    let kek = test_key();
    let dek = test_key();

    let mut recovery = wrap_dek(&kek, &dek, WrapPurpose::RecoveryCode).unwrap();
    // Simulate an attacker rewriting the header to swap the two slots.
    recovery.purpose = WrapPurpose::MasterPassword;

    assert!(
        matches!(unwrap_dek(&kek, &recovery), Err(CryptoError::Decrypt)),
        "purpose must be bound into the wrap AAD"
    );
}

#[test]
fn both_wraps_recover_the_same_dek() {
    let master_kek = test_key();
    let recovery_kek = test_key();
    let dek = test_key();
    let aad = RecordAad::new(5, "note.body");
    let blob = encrypt_record(&dek, &aad, b"one data key").unwrap();

    let from_master = unwrap_dek(
        &master_kek,
        &wrap_dek(&master_kek, &dek, WrapPurpose::MasterPassword).unwrap(),
    )
    .unwrap();
    let from_recovery = unwrap_dek(
        &recovery_kek,
        &wrap_dek(&recovery_kek, &dek, WrapPurpose::RecoveryCode).unwrap(),
    )
    .unwrap();

    assert_eq!(
        decrypt_record(&from_master, &aad, &blob).unwrap(),
        b"one data key"
    );
    assert_eq!(
        decrypt_record(&from_recovery, &aad, &blob).unwrap(),
        b"one data key"
    );
}

#[test]
fn malformed_wrapped_key_is_rejected_without_panicking() {
    let kek = test_key();
    let dek = test_key();
    let good = wrap_dek(&kek, &dek, WrapPurpose::MasterPassword).unwrap();

    let mut short_nonce = good.clone();
    short_nonce.nonce.truncate(4);
    assert!(unwrap_dek(&kek, &short_nonce).is_err());

    let mut short_ct = good.clone();
    short_ct.ciphertext.truncate(8);
    assert!(unwrap_dek(&kek, &short_ct).is_err());

    let mut long_ct = good;
    long_ct.ciphertext.extend_from_slice(&[0u8; 8]);
    assert!(unwrap_dek(&kek, &long_ct).is_err());
}

// ---------------------------------------------------------------------------
// Argon2id -- R41, KTD11
// ---------------------------------------------------------------------------

#[test]
fn derivation_is_deterministic_for_one_password_and_salt() {
    let salt = generate_salt().unwrap();
    let params = floor_params();
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");

    let first = derive_kek(&SecretBytes::from_str_secret("master pw"), &salt, params).unwrap();
    let second = derive_kek(&SecretBytes::from_str_secret("master pw"), &salt, params).unwrap();

    let wrapped = wrap_dek(&first, &dek, WrapPurpose::MasterPassword).unwrap();
    let via_second = unwrap_dek(&second, &wrapped).unwrap();
    let blob = encrypt_record(&dek, &aad, b"ok").unwrap();
    assert_eq!(decrypt_record(&via_second, &aad, &blob).unwrap(), b"ok");
}

#[test]
fn a_different_password_derives_a_different_kek() {
    let salt = generate_salt().unwrap();
    let params = floor_params();
    let dek = test_key();

    let right = derive_kek(&SecretBytes::from_str_secret("correct"), &salt, params).unwrap();
    let wrong = derive_kek(&SecretBytes::from_str_secret("incorrect"), &salt, params).unwrap();

    let wrapped = wrap_dek(&right, &dek, WrapPurpose::MasterPassword).unwrap();
    assert!(matches!(
        unwrap_dek(&wrong, &wrapped),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn a_different_salt_derives_a_different_kek() {
    let params = floor_params();
    let dek = test_key();
    let secret = SecretBytes::from_str_secret("same password");

    let a = derive_kek(&secret, &generate_salt().unwrap(), params).unwrap();
    let b = derive_kek(&secret, &generate_salt().unwrap(), params).unwrap();

    let wrapped = wrap_dek(&a, &dek, WrapPurpose::MasterPassword).unwrap();
    assert!(matches!(
        unwrap_dek(&b, &wrapped),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn a_short_salt_is_rejected() {
    assert!(derive_kek(
        &SecretBytes::from_str_secret("pw"),
        &[0u8; 4],
        floor_params()
    )
    .is_err());
}

#[test]
fn calibration_never_returns_parameters_below_the_floor() {
    // A target of ~0 makes the first probe satisfy the loop immediately, so
    // this exercises the floor logic without a long calibration run.
    let params = calibrate_to(Duration::from_millis(1)).unwrap();

    assert!(
        params.meets_floor(),
        "calibrated parameters {params:?} fall below the KTD11 floor"
    );
    assert!(params.m_cost_kib >= 19_456);
    assert!(params.t_cost >= 2);
    assert!((1..=4).contains(&params.p_cost));
}

#[test]
fn defaults_meet_the_floor() {
    assert!(KdfParams::default().meets_floor());
}

#[test]
fn clamping_raises_weak_parameters() {
    let weak = KdfParams {
        m_cost_kib: 8,
        t_cost: 1,
        p_cost: 0,
    };
    assert!(!weak.meets_floor());
    assert!(weak.clamped_to_floor().meets_floor());
}

#[test]
fn stored_parameters_survive_a_serialisation_round_trip() {
    // Old vaults must keep opening after defaults change (KTD11), which means
    // the header must carry these values faithfully.
    let params = KdfParams::default();
    let json = serde_json::to_string(&params).unwrap();
    assert_eq!(serde_json::from_str::<KdfParams>(&json).unwrap(), params);
}

// ---------------------------------------------------------------------------
// Secret hygiene -- KTD15
// ---------------------------------------------------------------------------

/// Compile-time detection of a `Debug` implementation.
///
/// The inherent impl applies only when `T: Debug`; otherwise the trait's
/// default is used. So `IMPLEMENTS_DEBUG` is `true` exactly when `T: Debug`,
/// which lets a `const` assertion fail the build if a secret type ever gains a
/// `Debug` derive and becomes loggable.
struct DebugProbe<T>(core::marker::PhantomData<T>);

impl<T: core::fmt::Debug> DebugProbe<T> {
    const IMPLEMENTS_DEBUG: bool = true;
}

trait DebugProbeFallback {
    const IMPLEMENTS_DEBUG: bool = false;
}

impl<T> DebugProbeFallback for DebugProbe<T> {}

// The probe itself must work, or the assertions below are vacuous.
const _: () = assert!(DebugProbe::<u32>::IMPLEMENTS_DEBUG);

const _: () = assert!(
    !DebugProbe::<SymmetricKey>::IMPLEMENTS_DEBUG,
    "SymmetricKey must never be Debug-printable"
);
const _: () = assert!(
    !DebugProbe::<SecretBytes>::IMPLEMENTS_DEBUG,
    "SecretBytes must never be Debug-printable"
);

#[test]
fn secret_bytes_reports_its_length() {
    let secret = SecretBytes::from_str_secret("abcdef");
    assert_eq!(secret.len(), 6);
    assert!(!secret.is_empty());
    assert!(SecretBytes::new(Vec::new()).is_empty());
}

#[test]
fn adopting_key_material_clears_the_callers_copy() {
    let mut material = [7u8; KEY_LEN];
    let _key = SymmetricKey::from_bytes(&mut material);
    assert_eq!(material, [0u8; KEY_LEN], "source buffer was not zeroed");
}

#[test]
fn generated_keys_are_not_all_zero() {
    let dek = test_key();
    let aad = RecordAad::new(1, "credential.password");
    // Indirect check: a zero key would still encrypt, so assert entropy by
    // confirming two generated keys are not interchangeable.
    let blob = encrypt_record(&dek, &aad, b"x").unwrap();
    assert!(decrypt_record(&test_key(), &aad, &blob).is_err());
}
