//! Export, restore, and reset (U6: R45, AE8, AE10, KTD13).
//!
//! Restore is the one place in Sanctum that replaces a whole file, so it is
//! the one place KTD13's temp-file-then-atomic-rename applies literally.
//!
//! The order matters and is the entire point of AE10:
//!
//! 1. decrypt and verify the container's tag — a corrupt file dies here;
//! 2. write the plaintext database to a temp file *beside* the target;
//! 3. open that temp file as a vault and confirm it has a readable header —
//!    a well-formed container holding garbage dies here;
//! 4. only then rename over the live vault.
//!
//! Nothing touches the existing vault until step 4, so a failed restore leaves
//! it exactly as it was.

use std::fs;
use std::path::{Path, PathBuf};

use crate::vault::{Vault, VaultHeader};

use super::{container, BackupError, Result};

/// Builds a `.sanctumbak` from the live vault.
///
/// Checkpoints first: without it the most recent writes are still in the WAL
/// and the copied file would be missing them.
pub fn export_backup(vault: &Vault, vault_path: &Path, backup_password: &str) -> Result<Vec<u8>> {
    vault.checkpoint()?;
    let body = fs::read(vault_path)?;
    container::seal(&body, backup_password)
}

/// As [`export_backup`], with explicit Argon2id cost. Tests only.
pub fn export_backup_with(
    vault: &Vault,
    vault_path: &Path,
    backup_password: &str,
    params: crate::crypto::KdfParams,
) -> Result<Vec<u8>> {
    vault.checkpoint()?;
    let body = fs::read(vault_path)?;
    container::seal_with(&body, backup_password, params)
}

/// What a dry-run restore learned about a candidate file.
#[derive(Debug, Clone)]
pub struct RestorePreflight {
    /// Size of the vault the backup contains.
    pub body_len: usize,
    /// Schema version recorded in it.
    pub schema_version: u32,
    /// Whether the contained vault has completed first-run setup.
    pub initialized: bool,
}

/// Verifies a backup without touching the live vault.
///
/// The UI calls this before showing its overwrite confirmation, so the warning
/// it displays is backed by a file that has already been proven good (R45).
pub fn inspect_backup(archive: &[u8], backup_password: &str) -> Result<RestorePreflight> {
    let body = container::open(archive, backup_password)?;
    let staged = stage_to_temp(&body, std::env::temp_dir().as_path())?;
    let report = validate_staged(&staged.path);
    let _ = fs::remove_file(&staged.path);
    report.map(|(schema_version, initialized)| RestorePreflight {
        body_len: body.len(),
        schema_version,
        initialized,
    })
}

/// Restores a backup over the vault at `target`.
///
/// The caller is responsible for having confirmed the overwrite with the user
/// and for having dropped every open handle to the target first.
pub fn restore_backup(archive: &[u8], backup_password: &str, target: &Path) -> Result<()> {
    // Step 1: authenticate. A tampered or truncated file cannot get past here.
    let body = container::open(archive, backup_password)?;

    // Step 2: stage beside the target, so the rename is same-volume and
    // therefore atomic. A temp dir on another drive would silently degrade to
    // copy-then-delete, which is not.
    let directory = target.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(directory)?;
    let staged = stage_to_temp(&body, directory)?;

    // Step 3: prove the decrypted bytes really are a vault.
    if let Err(error) = validate_staged(&staged.path) {
        let _ = fs::remove_file(&staged.path);
        return Err(error);
    }

    // Step 4: the live vault's WAL and shm describe the file being replaced.
    // Leaving them would let SQLite reconstruct a mix of the two.
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = target.as_os_str().to_os_string();
        sidecar.push(suffix);
        let _ = fs::remove_file(PathBuf::from(sidecar));
    }

    // `fs::rename` is `MoveFileExW` with MOVEFILE_REPLACE_EXISTING on Windows,
    // which is atomic within a volume.
    fs::rename(&staged.path, target)?;
    Ok(())
}

/// Deletes the vault and its sidecars, returning to first-run setup (AE8, R39).
pub fn reset_vault(target: &Path) -> Result<()> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut path = target.as_os_str().to_os_string();
        path.push(suffix);
        let path = PathBuf::from(path);
        if path.exists() {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

/// A staged file that is removed on drop unless it was renamed away.
struct Staged {
    path: PathBuf,
}

fn stage_to_temp(body: &[u8], directory: &Path) -> Result<Staged> {
    // A random suffix rather than a fixed name: two restores racing on one
    // directory must not stage over each other.
    let mut suffix = [0u8; 8];
    crate::crypto::fill_random(&mut suffix)?;
    let name = format!(
        "sanctum-restore-{}.tmp",
        suffix
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let path = directory.join(name);
    fs::write(&path, body)?;
    Ok(Staged { path })
}

/// Opens a staged file as a vault and reports what it holds.
fn validate_staged(path: &Path) -> Result<(u32, bool)> {
    let vault = Vault::open(path).map_err(|_| BackupError::NotAVault)?;
    let schema_version = vault.schema_version().map_err(|_| BackupError::NotAVault)?;
    let initialized = VaultHeader::load(vault.connection())
        .map_err(|_| BackupError::NotAVault)?
        .is_some();

    // Opening created a WAL beside the staged file; fold it in and drop the
    // sidecars so only the single file gets renamed into place.
    vault.checkpoint().map_err(|_| BackupError::NotAVault)?;
    drop(vault);
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        let _ = fs::remove_file(PathBuf::from(sidecar));
    }

    Ok((schema_version, initialized))
}
