//! Recovery-code and strength gates (U4: R3, R12, R44, KTD14, KTD21).

use std::collections::HashSet;

use super::strength;
use super::*;

// ---------------------------------------------------------------------------
// Recovery code format -- R3
// ---------------------------------------------------------------------------

#[test]
fn a_generated_code_has_the_documented_shape() {
    let code = generate_recovery_code().unwrap();

    // SANCTUM-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
    let parts: Vec<&str> = code.display.split('-').collect();
    assert_eq!(parts[0], CODE_PREFIX);
    assert_eq!(parts.len(), 7, "prefix plus six groups: {}", code.display);
    for group in &parts[1..] {
        assert_eq!(group.len(), 5, "group {group} is not five symbols");
    }
    assert_eq!(code.secret.len(), CODE_LEN);
}

/// KTD14 sets a floor of 128 bits. Six groups of five Crockford symbols is
/// 30 x 5 = 150 bits; the five groups the reference design shows would be 125.
#[test]
fn a_code_carries_at_least_128_bits() {
    let bits = CODE_LEN * 5;
    assert!(bits >= 128, "recovery codes carry only {bits} bits");
}

#[test]
fn codes_never_contain_a_confusable_character() {
    // Crockford omits I, L, O and U so the code cannot be misread off paper
    // and cannot accidentally spell a word.
    for _ in 0..200 {
        let code = generate_recovery_code().unwrap();
        let body = code.display.trim_start_matches(CODE_PREFIX);
        for ch in body.chars().filter(|c| *c != '-') {
            assert!(
                !matches!(ch, 'I' | 'L' | 'O' | 'U'),
                "confusable character {ch} appeared in {}",
                code.display
            );
            assert!(ch.is_ascii_uppercase() || ch.is_ascii_digit());
        }
    }
}

#[test]
fn generated_codes_do_not_repeat() {
    let mut seen = HashSet::new();
    for _ in 0..500 {
        assert!(
            seen.insert(generate_recovery_code().unwrap().display),
            "the generator produced a duplicate code"
        );
    }
}

#[test]
fn every_alphabet_symbol_is_reachable() {
    // Guards the 5-bit mask: a bug there would silently shrink the alphabet
    // and cost entropy without breaking anything visibly.
    let mut seen = HashSet::new();
    for _ in 0..500 {
        for ch in generate_recovery_code().unwrap().display.chars() {
            if ch != '-' {
                seen.insert(ch);
            }
        }
    }
    // Prefix letters are in there too, so check the alphabet is covered.
    for ch in "0123456789ABCDEFGHJKMNPQRSTVWXYZ".chars() {
        assert!(seen.contains(&ch), "symbol {ch} was never generated");
    }
}

// ---------------------------------------------------------------------------
// Normalisation -- typing a code off paper
// ---------------------------------------------------------------------------

#[test]
fn a_freshly_generated_code_normalises_back_to_itself() {
    let code = generate_recovery_code().unwrap();
    let normalized = normalize_recovery_code(&code.display).expect("must normalise");
    assert_eq!(normalized.len(), CODE_LEN);
    assert_eq!(
        format_for_display(normalized_bytes(&normalized)),
        code.display
    );
}

/// The bytes behind a normalised code, for assertions only.
fn normalized_bytes(secret: &SecretBytes) -> &[u8] {
    // `expose` is pub(crate) and this module is inside the crate.
    secret.expose()
}

#[test]
fn normalisation_is_forgiving_about_how_it_was_typed() {
    let code = generate_recovery_code().unwrap();
    let canonical = normalize_recovery_code(&code.display).unwrap();
    let expected = normalized_bytes(&canonical).to_vec();

    let body = code
        .display
        .trim_start_matches(CODE_PREFIX)
        .trim_start_matches('-');

    let variants = [
        code.display.to_lowercase(),
        code.display.replace('-', " "),
        code.display.replace('-', ""),
        format!("  {}  ", code.display),
        body.to_string(),
        body.replace('-', ""),
    ];

    for variant in variants {
        let parsed = normalize_recovery_code(&variant)
            .unwrap_or_else(|| panic!("failed to normalise {variant:?}"));
        assert_eq!(normalized_bytes(&parsed), expected, "variant {variant:?}");
    }
}

#[test]
fn crockford_confusables_are_accepted_on_input() {
    // Someone reading handwriting cannot distinguish O from 0 or I/L from 1.
    // Crockford's rule is to accept the confusable and map it, which is what
    // makes the alphabet safe to write down in the first place.
    let with_zeros = "SANCTUM-00000-11111-ABCDE-FGHJK-MNPQR-STVWX";
    let with_letters = "SANCTUM-OOOOO-ILILI-ABCDE-FGHJK-MNPQR-STVWX";

    let a = normalize_recovery_code(with_zeros).unwrap();
    let b = normalize_recovery_code(with_letters).unwrap();
    assert_eq!(normalized_bytes(&a), normalized_bytes(&b));
}

#[test]
fn a_code_of_the_wrong_length_is_rejected() {
    assert!(normalize_recovery_code("SANCTUM-ABCDE").is_none());
    assert!(normalize_recovery_code("").is_none());
    assert!(normalize_recovery_code("SANCTUM-ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789-EXTRA").is_none());
}

#[test]
fn a_code_with_an_illegal_character_is_rejected() {
    assert!(normalize_recovery_code("SANCTUM-ABCD!-FGHJK-MNPQR-STVWX-YZ234-56789").is_none());
    assert!(normalize_recovery_code("SANCTUM-ABCDU-FGHJK-MNPQR-STVWX-YZ234-56789").is_none());
}

// ---------------------------------------------------------------------------
// Recovery KEK -- KTD14
// ---------------------------------------------------------------------------

#[test]
fn the_recovery_code_unwraps_its_own_dek_copy() {
    let dek = SymmetricKey::generate().unwrap();
    let salt = generate_salt().unwrap();
    let code = generate_recovery_code().unwrap();

    let kek = derive_recovery_kek(&code.secret, &salt).unwrap();
    let wrapped = wrap_dek(&kek, &dek, WrapPurpose::RecoveryCode).unwrap();

    // Re-derive from the typed form, exactly as a real recovery would.
    let typed = normalize_recovery_code(&code.display).unwrap();
    let rederived = derive_recovery_kek(&typed, &salt).unwrap();
    let recovered = unwrap_dek(&rederived, &wrapped).unwrap();

    let aad = RecordAad::new(1, "credential.password");
    let blob = encrypt_record(&dek, &aad, b"proof").unwrap();
    assert_eq!(decrypt_record(&recovered, &aad, &blob).unwrap(), b"proof");
}

#[test]
fn a_different_recovery_code_derives_a_different_kek() {
    let salt = generate_salt().unwrap();
    let dek = SymmetricKey::generate().unwrap();

    let right = derive_recovery_kek(&generate_recovery_code().unwrap().secret, &salt).unwrap();
    let wrong = derive_recovery_kek(&generate_recovery_code().unwrap().secret, &salt).unwrap();

    let wrapped = wrap_dek(&right, &dek, WrapPurpose::RecoveryCode).unwrap();
    assert!(matches!(
        unwrap_dek(&wrong, &wrapped),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn a_different_salt_derives_a_different_recovery_kek() {
    let code = generate_recovery_code().unwrap();
    let dek = SymmetricKey::generate().unwrap();

    let a = derive_recovery_kek(&code.secret, &generate_salt().unwrap()).unwrap();
    let b = derive_recovery_kek(&code.secret, &generate_salt().unwrap()).unwrap();

    let wrapped = wrap_dek(&a, &dek, WrapPurpose::RecoveryCode).unwrap();
    assert!(matches!(
        unwrap_dek(&b, &wrapped),
        Err(CryptoError::Decrypt)
    ));
}

#[test]
fn a_short_recovery_salt_is_rejected() {
    let code = generate_recovery_code().unwrap();
    assert!(derive_recovery_kek(&code.secret, &[0u8; 4]).is_err());
}

// ---------------------------------------------------------------------------
// Password strength -- R44, KTD21
// ---------------------------------------------------------------------------

#[test]
fn a_short_password_is_rejected_however_complex() {
    // Eleven characters of maximum entropy still fails the length floor: the
    // two rules are independent, not a combined score.
    let report = strength::evaluate_simple("xK9#mQ2$vL!");
    assert!(!report.acceptable);
    assert_eq!(report.length, 11);
    assert!(report.reason.unwrap().contains("12"));
}

#[test]
fn a_long_but_guessable_password_is_rejected() {
    for weak in [
        "password1234",
        "aaaaaaaaaaaaaa",
        "qwertyuiop[]\\",
        "123456789012",
    ] {
        let report = strength::evaluate_simple(weak);
        assert!(
            !report.acceptable,
            "{weak:?} scored {} and was accepted",
            report.score
        );
    }
}

#[test]
fn a_strong_passphrase_is_accepted() {
    let report = strength::evaluate_simple("correct-horse-battery-staple-97");
    assert!(
        report.acceptable,
        "score {} rejected: {:?}",
        report.score, report.reason
    );
    assert!(report.score >= strength::MIN_SCORE);
    assert!(report.reason.is_none());
}

#[test]
fn composition_rules_alone_do_not_pass() {
    // The canonical example of why zxcvbn replaces "one capital, one digit,
    // one symbol": this satisfies every composition rule and is trivial to
    // guess.
    let report = strength::evaluate_simple("Password1!");
    assert!(!report.acceptable);
}

#[test]
fn user_context_makes_related_passwords_score_worse() {
    let generic = strength::evaluate("Ren2026Sanctum", &[]);
    let contextual = strength::evaluate("Ren2026Sanctum", &["Ren", "Sanctum"]);
    assert!(
        contextual.score <= generic.score,
        "supplying the user's own name should not improve the score"
    );
}

#[test]
fn an_empty_password_is_rejected_without_panicking() {
    let report = strength::evaluate_simple("");
    assert!(!report.acceptable);
    assert_eq!(report.length, 0);
}

#[test]
fn the_report_never_carries_the_password() {
    let secret = "correct-horse-battery-staple-97";
    let json = serde_json::to_string(&strength::evaluate_simple(secret)).unwrap();
    assert!(
        !json.contains(secret),
        "the strength report leaked the password: {json}"
    );
}
