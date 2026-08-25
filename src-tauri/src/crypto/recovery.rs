//! Recovery codes (R3, R12, KTD14).
//!
//! A recovery code is a high-entropy random value that derives a second KEK,
//! which wraps its own copy of the DEK. Either secret opens the vault; neither
//! can derive the other.
//!
//! **Why a fast KDF here and Argon2id there.** The master password is
//! human-chosen and therefore guessable, so it needs a deliberately expensive
//! derivation. A recovery code is 150 bits of CSPRNG output -- there is no
//! dictionary to run against it, and slowing derivation buys nothing while
//! costing the user a wait during an already-stressful recovery. HKDF-SHA256
//! is the right tool for stretching a value that is *already* uniform.
//!
//! **Alphabet.** Crockford base32: no `I`, `L`, `O`, or `U`, so the code
//! cannot be misread and cannot spell anything. Decoding is lenient in the
//! Crockford way -- `O` reads as `0`, `I` and `L` read as `1`, case is
//! ignored, and hyphens and spaces are skipped -- because a user copying this
//! off paper under pressure should not be defeated by handwriting.

use hkdf::Hkdf;
use sha2::Sha256;

use super::{fill_random, secrets::KEY_LEN, CryptoError, Result, SecretBytes, SymmetricKey};

/// Crockford base32. Exactly 32 symbols, so one symbol carries 5 bits with no
/// modulo bias when taken from the low bits of a uniform byte.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// Symbols per group, as displayed.
const GROUP_LEN: usize = 5;

/// Number of groups.
///
/// Six rather than the five the reference design shows: five groups is 125
/// bits, and KTD14 sets a floor of 128. One more group buys 150 bits and keeps
/// the same shape.
const GROUP_COUNT: usize = 6;

/// Total symbols in a code, excluding the prefix and hyphens.
pub const CODE_LEN: usize = GROUP_LEN * GROUP_COUNT;

/// Brand prefix (R3).
pub const CODE_PREFIX: &str = "SANCTUM";

/// Domain separation for the recovery KEK derivation.
const HKDF_INFO: &[u8] = b"sanctum.recovery.kek.v1";

/// A freshly generated recovery code.
///
/// `display` is shown to the user exactly once (R46). `secret` is the
/// normalised form the KDF consumes, and is zeroed when dropped.
pub struct RecoveryCode {
    /// `SANCTUM-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`
    pub display: String,
    /// Normalised symbols, without prefix or hyphens.
    pub secret: SecretBytes,
}

/// Generates a new recovery code from the OS CSPRNG.
pub fn generate_recovery_code() -> Result<RecoveryCode> {
    let mut raw = [0u8; CODE_LEN];
    fill_random(&mut raw)?;

    // The alphabet has exactly 32 entries, so masking a uniform byte to five
    // bits is itself uniform -- no rejection sampling needed, and no modulo
    // bias to get wrong.
    let symbols: Vec<u8> = raw
        .iter()
        .map(|b| ALPHABET[(b & 0b1_1111) as usize])
        .collect();

    let mut display = String::with_capacity(CODE_PREFIX.len() + CODE_LEN + GROUP_COUNT);
    display.push_str(CODE_PREFIX);
    for group in symbols.chunks(GROUP_LEN) {
        display.push('-');
        display.push_str(std::str::from_utf8(group).map_err(|_| {
            CryptoError::InvalidParams("recovery alphabet produced invalid UTF-8".into())
        })?);
    }

    Ok(RecoveryCode {
        display,
        secret: SecretBytes::new(symbols),
    })
}

/// Normalises user-entered text into the canonical symbol sequence.
///
/// Accepts the code with or without its prefix, in any case, with any mix of
/// hyphens and spaces, and applies Crockford's confusable substitutions.
/// Returns `None` when the result is not exactly [`CODE_LEN`] valid symbols.
pub fn normalize_recovery_code(input: &str) -> Option<SecretBytes> {
    let trimmed = input.trim();

    // Drop the brand prefix if present, in any case.
    let body = {
        let upper = trimmed.to_ascii_uppercase();
        if let Some(rest) = upper.strip_prefix(CODE_PREFIX) {
            rest.trim_start_matches(['-', ' ']).to_string()
        } else {
            upper
        }
    };

    let mut symbols = Vec::with_capacity(CODE_LEN);
    for ch in body.chars() {
        match ch {
            '-' | ' ' | '\t' | '\n' | '\r' => continue,
            'O' => symbols.push(b'0'),
            'I' | 'L' => symbols.push(b'1'),
            // `U` is excluded from the alphabet specifically so it cannot be
            // confused with `V`; treating it as input would defeat that.
            c if c.is_ascii_alphanumeric() => {
                let up = c.to_ascii_uppercase() as u8;
                if ALPHABET.contains(&up) {
                    symbols.push(up);
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    }

    if symbols.len() == CODE_LEN {
        Some(SecretBytes::new(symbols))
    } else {
        None
    }
}

/// Derives the recovery KEK from a normalised code and the vault's recovery salt.
pub fn derive_recovery_kek(code: &SecretBytes, salt: &[u8]) -> Result<SymmetricKey> {
    if salt.len() < 8 {
        return Err(CryptoError::InvalidParams(format!(
            "recovery salt must be at least 8 bytes, got {}",
            salt.len()
        )));
    }

    let hk = Hkdf::<Sha256>::new(Some(salt), code.expose());
    let mut out = [0u8; KEY_LEN];
    hk.expand(HKDF_INFO, &mut out)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;

    Ok(SymmetricKey::from_bytes(&mut out))
}

/// Formats normalised symbols back into display form. Used when re-showing a
/// code the user just typed, never to recover one that was not stored.
pub fn format_for_display(symbols: &[u8]) -> String {
    let mut out = String::with_capacity(CODE_PREFIX.len() + symbols.len() + GROUP_COUNT);
    out.push_str(CODE_PREFIX);
    for group in symbols.chunks(GROUP_LEN) {
        out.push('-');
        out.push_str(&String::from_utf8_lossy(group));
    }
    out
}
