//! Crash-safe secret rotation (U5: R11, R12, R40, R42, R46).
//!
//! Rotation re-wraps the **same** DEK under a new KEK (KTD9). No record body
//! is read, rewritten, or even opened. That is what makes the operation safe:
//! the only thing that changes is a few hundred bytes of header, and it
//! changes in one statement.
//!
//! KTD13 specifies write-temp-then-atomic-rename. The header lives in SQLite
//! rather than its own file (U3), so the atomic unit here is a transaction
//! commit instead of a rename. The guarantee is the same one KTD13 was after —
//! a crash leaves either the old header or the new one, never a blend — and it
//! is stronger in one respect: there is no second file that can fall out of
//! step with the database. KTD13's rename stays literal in U6, where restore
//! genuinely replaces the whole file.
//!
//! The [`RotationPhase`] hook exists so a test can abort at each side of the
//! commit deterministically, rather than racing a real process kill.

use crate::crypto::{
    derive_kek, derive_recovery_kek, generate_recovery_code, generate_salt, strength, unwrap_dek,
    wrap_dek, SecretBytes, SymmetricKey, WrapPurpose, VAULT_FORMAT_VERSION,
};

use super::lifecycle::{load_header, now_unix};
use super::{Result, Vault, VaultError, VaultHeader};

/// Points at which an instrumented rotation can be interrupted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RotationPhase {
    /// New keys derived, nothing written yet.
    BeforeCommit,
    /// Header written and committed.
    AfterCommit,
}

/// The outcome of a successful rotation.
pub struct RotationOutcome {
    /// The new recovery code, shown once (R42, R46).
    pub recovery_display: String,
    /// The DEK, unchanged, so the caller's session stays valid.
    pub dek: SymmetricKey,
}

/// Changes the master password, rotating the recovery code with it (R40, R42).
pub fn change_master_password(
    vault: &Vault,
    current_password: &str,
    new_password: &str,
) -> Result<RotationOutcome> {
    change_master_password_instrumented(vault, current_password, new_password, &mut |_| Ok(()))
}

/// As [`change_master_password`], with a hook that can abort at either side of
/// the commit. Production callers use the uninstrumented wrapper.
pub fn change_master_password_instrumented(
    vault: &Vault,
    current_password: &str,
    new_password: &str,
    hook: &mut dyn FnMut(RotationPhase) -> Result<()>,
) -> Result<RotationOutcome> {
    let header = load_header(vault)?;
    header.ensure_supported_crypto_format()?;

    // Prove the caller knows the current password before anything else. The
    // DEK recovered here is the one that gets re-wrapped -- it is never
    // regenerated, which is why every existing record keeps decrypting (R11).
    let current_kek = derive_kek(
        &SecretBytes::from_str_secret(current_password),
        &header.master_salt,
        header.kdf_params,
    )?;
    let dek =
        unwrap_dek(&current_kek, &header.wrapped_master).map_err(|_| VaultError::WrongSecret)?;

    let report = strength::evaluate_simple(new_password);
    if !report.acceptable {
        return Err(VaultError::WeakPassword {
            reason: report
                .reason
                .unwrap_or_else(|| "This password is too weak.".into()),
        });
    }

    // Fresh salts. Reusing the old master salt would let a precomputed attack
    // against the old password carry over to the new one.
    let master_salt = generate_salt()?;
    let recovery_salt = generate_salt()?;

    let new_kek = derive_kek(
        &SecretBytes::from_str_secret(new_password),
        &master_salt,
        header.kdf_params,
    )?;
    let recovery = generate_recovery_code()?;
    let recovery_kek = derive_recovery_kek(&recovery.secret, &recovery_salt)?;

    let next = VaultHeader {
        crypto_format_version: VAULT_FORMAT_VERSION,
        kdf_params: header.kdf_params,
        master_salt: master_salt.to_vec(),
        recovery_salt: recovery_salt.to_vec(),
        wrapped_master: wrap_dek(&new_kek, &dek, WrapPurpose::MasterPassword)?,
        wrapped_recovery: wrap_dek(&recovery_kek, &dek, WrapPurpose::RecoveryCode)?,
        // A new code has not been acknowledged yet (R46).
        recovery_acknowledged: false,
        created_at: header.created_at,
        updated_at: now_unix(),
    };

    hook(RotationPhase::BeforeCommit)?;
    next.store(vault.connection())?;
    hook(RotationPhase::AfterCommit)?;

    Ok(RotationOutcome {
        recovery_display: recovery.display,
        dek,
    })
}

/// Issues a new recovery code without changing the master password (R12, R38).
///
/// Requires the master password: regenerating the code is a
/// credential-changing operation, and a walk-up attacker at an unlocked
/// machine should not be able to mint themselves a permanent way back in.
pub fn rotate_recovery_code(vault: &Vault, master_password: &str) -> Result<String> {
    rotate_recovery_code_instrumented(vault, master_password, &mut |_| Ok(()))
}

/// As [`rotate_recovery_code`], with the same interruption hook.
pub fn rotate_recovery_code_instrumented(
    vault: &Vault,
    master_password: &str,
    hook: &mut dyn FnMut(RotationPhase) -> Result<()>,
) -> Result<String> {
    let header = load_header(vault)?;
    header.ensure_supported_crypto_format()?;

    let kek = derive_kek(
        &SecretBytes::from_str_secret(master_password),
        &header.master_salt,
        header.kdf_params,
    )?;
    let dek = unwrap_dek(&kek, &header.wrapped_master).map_err(|_| VaultError::WrongSecret)?;

    let recovery_salt = generate_salt()?;
    let recovery = generate_recovery_code()?;
    let recovery_kek = derive_recovery_kek(&recovery.secret, &recovery_salt)?;

    let next = VaultHeader {
        recovery_salt: recovery_salt.to_vec(),
        wrapped_recovery: wrap_dek(&recovery_kek, &dek, WrapPurpose::RecoveryCode)?,
        recovery_acknowledged: false,
        updated_at: now_unix(),
        // The master half is carried across untouched: rotating one secret
        // must not disturb the other's blob.
        ..header
    };

    hook(RotationPhase::BeforeCommit)?;
    next.store(vault.connection())?;
    hook(RotationPhase::AfterCommit)?;

    Ok(recovery.display)
}

/// Sets a new master password using the recovery code (AE11).
///
/// The path a user takes when they have lost the password but kept the code.
/// The recovery code is rotated at the same time: it has just been typed into
/// a machine and possibly read aloud off paper, so treating it as still-secret
/// afterwards would be optimistic.
pub fn reset_master_password_with_recovery(
    vault: &Vault,
    recovery_code: &str,
    new_password: &str,
) -> Result<RotationOutcome> {
    let header = load_header(vault)?;
    header.ensure_supported_crypto_format()?;

    let normalized =
        crate::crypto::normalize_recovery_code(recovery_code).ok_or(VaultError::WrongSecret)?;
    let recovery_kek = derive_recovery_kek(&normalized, &header.recovery_salt)?;
    let dek =
        unwrap_dek(&recovery_kek, &header.wrapped_recovery).map_err(|_| VaultError::WrongSecret)?;

    let report = strength::evaluate_simple(new_password);
    if !report.acceptable {
        return Err(VaultError::WeakPassword {
            reason: report
                .reason
                .unwrap_or_else(|| "This password is too weak.".into()),
        });
    }

    let master_salt = generate_salt()?;
    let new_recovery_salt = generate_salt()?;
    let new_kek = derive_kek(
        &SecretBytes::from_str_secret(new_password),
        &master_salt,
        header.kdf_params,
    )?;
    let fresh_code = generate_recovery_code()?;
    let fresh_recovery_kek = derive_recovery_kek(&fresh_code.secret, &new_recovery_salt)?;

    let next = VaultHeader {
        crypto_format_version: VAULT_FORMAT_VERSION,
        kdf_params: header.kdf_params,
        master_salt: master_salt.to_vec(),
        recovery_salt: new_recovery_salt.to_vec(),
        wrapped_master: wrap_dek(&new_kek, &dek, WrapPurpose::MasterPassword)?,
        wrapped_recovery: wrap_dek(&fresh_recovery_kek, &dek, WrapPurpose::RecoveryCode)?,
        recovery_acknowledged: false,
        created_at: header.created_at,
        updated_at: now_unix(),
    };
    next.store(vault.connection())?;

    Ok(RotationOutcome {
        recovery_display: fresh_code.display,
        dek,
    })
}
