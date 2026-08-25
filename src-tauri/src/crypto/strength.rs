//! Master-password strength floor (R44, KTD21).
//!
//! R44 makes the master password the only barrier protecting a stolen vault
//! file, so it gets a concrete floor rather than advisory guidance: zxcvbn
//! score >= 3 **and** at least 12 characters.
//!
//! zxcvbn rather than composition rules ("one capital, one digit, one
//! symbol") because composition rules measure the wrong thing -- `Password1!`
//! satisfies every one of them and is guessed instantly. zxcvbn estimates
//! actual guessability against dictionaries, keyboard patterns, dates, and
//! l33t substitutions.

use serde::Serialize;

/// Minimum characters, independent of score (KTD21).
pub const MIN_LENGTH: usize = 12;

/// Minimum zxcvbn score, 0-4 (KTD21).
pub const MIN_SCORE: u8 = 3;

/// The result of scoring a candidate password.
///
/// Carries no part of the password itself, so it is safe to return across the
/// IPC boundary and safe to log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthReport {
    /// zxcvbn score, 0 (weakest) to 4 (strongest).
    pub score: u8,
    /// Whether this password may be used as a master password.
    pub acceptable: bool,
    /// Why it was rejected, if it was. Present for display, never for logging.
    pub reason: Option<String>,
    /// Character count, so the UI can show progress toward the length floor.
    pub length: usize,
}

/// Scores a candidate master password against the KTD21 floor.
///
/// `user_inputs` supplies context zxcvbn should treat as guessable — a display
/// name, for instance. Passing them makes "ren2026" score as badly as it
/// deserves for a user called Ren.
pub fn evaluate(password: &str, user_inputs: &[&str]) -> StrengthReport {
    let length = password.chars().count();
    let score = u8::from(zxcvbn::zxcvbn(password, user_inputs).score());

    let reason = if length < MIN_LENGTH {
        Some(format!(
            "Use at least {MIN_LENGTH} characters. This one has {length}."
        ))
    } else if score < MIN_SCORE {
        Some(
            "This password is too easy to guess. Try a longer passphrase of unrelated words."
                .to_string(),
        )
    } else {
        None
    };

    StrengthReport {
        score,
        acceptable: reason.is_none(),
        reason,
        length,
    }
}

/// Scores a password with no additional context.
pub fn evaluate_simple(password: &str) -> StrengthReport {
    evaluate(password, &[])
}
