//! Vault creation and unlock (U4).
//!
//! Pure functions over a [`Vault`] and the crypto core, with no Tauri types in
//! sight — the command layer in `commands/` is a thin wrapper over these, so
//! the security-critical paths are testable without launching a window.

use crate::crypto::{
    derive_kek, derive_recovery_kek, generate_recovery_code, generate_salt,
    normalize_recovery_code, strength, unwrap_dek, wrap_dek, KdfParams, SecretBytes, SymmetricKey,
    WrapPurpose, VAULT_FORMAT_VERSION,
};

use super::{Result, Vault, VaultError, VaultHeader};

/// What a successful first-run setup produces.
///
/// `recovery_display` is the only time the code exists in readable form — it
/// is never stored, so if the user does not write it down here, it is gone
/// (R46). That is the intended property, not an oversight.
pub struct SetupOutcome {
    /// The unlocked data key, ready to install in the session.
    pub dek: SymmetricKey,
    /// The recovery code, formatted for display exactly once.
    pub recovery_display: String,
}

/// Whether this vault has been set up.
pub fn is_initialized(vault: &Vault) -> Result<bool> {
    Ok(VaultHeader::load(vault.connection())?.is_some())
}

/// Creates a vault: generates the DEK, wraps it under both secrets, writes the
/// header, and returns the unlocked key plus the one-time recovery code.
pub fn create_vault(
    vault: &Vault,
    master_password: &str,
    kdf_params: KdfParams,
) -> Result<SetupOutcome> {
    if is_initialized(vault)? {
        return Err(VaultError::AlreadyInitialized);
    }

    // KTD21: the strength floor is enforced here, in the same function that
    // creates the vault, so no caller can route around it.
    let report = strength::evaluate_simple(master_password);
    if !report.acceptable {
        return Err(VaultError::WeakPassword {
            reason: report
                .reason
                .unwrap_or_else(|| "This password is too weak.".into()),
        });
    }

    let params = kdf_params.clamped_to_floor();
    let master_salt = generate_salt()?;
    let recovery_salt = generate_salt()?;

    let dek = SymmetricKey::generate()?;

    let master_kek = derive_kek(
        &SecretBytes::from_str_secret(master_password),
        &master_salt,
        params,
    )?;
    let recovery = generate_recovery_code()?;
    let recovery_kek = derive_recovery_kek(&recovery.secret, &recovery_salt)?;

    let now = now_unix();
    let header = VaultHeader {
        crypto_format_version: VAULT_FORMAT_VERSION,
        kdf_params: params,
        master_salt: master_salt.to_vec(),
        recovery_salt: recovery_salt.to_vec(),
        wrapped_master: wrap_dek(&master_kek, &dek, WrapPurpose::MasterPassword)?,
        wrapped_recovery: wrap_dek(&recovery_kek, &dek, WrapPurpose::RecoveryCode)?,
        recovery_acknowledged: false,
        created_at: now,
        updated_at: now,
    };
    header.store(vault.connection())?;

    Ok(SetupOutcome {
        dek,
        recovery_display: recovery.display,
    })
}

/// Unlocks with the master password.
///
/// A wrong password returns `Err` and leaves the caller with no key — there is
/// no partial-success path, because `unwrap_dek` either authenticates or does
/// not.
pub fn unlock_with_password(vault: &Vault, master_password: &str) -> Result<SymmetricKey> {
    let header = load_header(vault)?;
    header.ensure_supported_crypto_format()?;

    let kek = derive_kek(
        &SecretBytes::from_str_secret(master_password),
        &header.master_salt,
        header.kdf_params,
    )?;

    unwrap_dek(&kek, &header.wrapped_master).map_err(|_| VaultError::WrongSecret)
}

/// Unlocks with the recovery code (R12, KTD14).
pub fn unlock_with_recovery(vault: &Vault, code: &str) -> Result<SymmetricKey> {
    let header = load_header(vault)?;
    header.ensure_supported_crypto_format()?;

    let normalized = normalize_recovery_code(code).ok_or(VaultError::WrongSecret)?;
    let kek = derive_recovery_kek(&normalized, &header.recovery_salt)?;

    unwrap_dek(&kek, &header.wrapped_recovery).map_err(|_| VaultError::WrongSecret)
}

/// Checks a recovery code without unlocking (U5's non-destructive verify).
///
/// Returns whether the code is valid. The unwrapped key is dropped
/// immediately, so a "is my code still good?" check never puts the DEK into
/// the session.
pub fn verify_recovery_code(vault: &Vault, code: &str) -> Result<bool> {
    match unlock_with_recovery(vault, code) {
        Ok(_dek) => Ok(true),
        Err(VaultError::WrongSecret) => Ok(false),
        Err(other) => Err(other),
    }
}

/// Records that the user typed the acknowledgment for their recovery code (R46).
pub fn acknowledge_recovery_code(vault: &Vault) -> Result<()> {
    let mut header = load_header(vault)?;
    header.recovery_acknowledged = true;
    header.updated_at = now_unix();
    header.store(vault.connection())
}

/// Whether the recovery code has been acknowledged.
pub fn recovery_acknowledged(vault: &Vault) -> Result<bool> {
    Ok(load_header(vault)?.recovery_acknowledged)
}

pub(super) fn load_header(vault: &Vault) -> Result<VaultHeader> {
    VaultHeader::load(vault.connection())?.ok_or(VaultError::NotInitialized)
}

pub(super) fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
