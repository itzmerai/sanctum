//! Plaintext CSV export (U6: R39).
//!
//! This writes every password in the clear. That is the point of the feature —
//! it exists so a user can leave for another manager — but it means the file
//! is the single most dangerous artefact Sanctum can produce, so it gets two
//! mitigations the rest of the app does not need:
//!
//! 1. an explicit warning naming cloud-sync folders, because a CSV dropped in
//!    OneDrive or Dropbox is a vault upload with extra steps;
//! 2. an NTFS ACL restricting the file to the current user at write time, so
//!    it is not readable by other accounts on a shared machine.
//!
//! KTD8 drops CSV *import* and the template for v1; only export is here.

use std::path::Path;

use crate::crypto::SymmetricKey;
use crate::vault::Vault;

use super::Result;

/// Shown next to the export control, and repeated in the confirmation.
pub const CSV_WARNING: &str = "This file contains every password in plain text. \
Anyone who opens it can read them. Do not save it to OneDrive, Dropbox, \
Google Drive, or any other folder that syncs to the cloud, and delete it as \
soon as you have finished with it.";

/// Escapes one field per RFC 4180.
///
/// Quoting is unconditional rather than conditional. A password can contain a
/// comma, a quote, or a newline, and deciding per-field when to quote is
/// exactly the kind of thing that works until the one entry where it does not.
fn escape(field: &str) -> String {
    format!("\"{}\"", field.replace('"', "\"\""))
}

/// Renders every credential as CSV.
pub fn export_credentials_csv(vault: &Vault, dek: &SymmetricKey) -> Result<String> {
    let mut out = String::from("name,username,password,website,notes,tags,folder\n");

    let folders = vault.folder_names(dek)?;

    for credential in vault.list_credentials(dek)? {
        let folder = credential
            .folder_id
            .and_then(|id| folders.get(&id).cloned())
            .unwrap_or_default();

        let row = [
            escape(&credential.name),
            escape(&credential.username),
            escape(&credential.password),
            escape(&credential.website),
            escape(&credential.notes),
            escape(&credential.tags.join(" ")),
            escape(&folder),
        ];
        out.push_str(&row.join(","));
        out.push('\n');
    }

    Ok(out)
}

/// Writes the CSV with an ACL granting access only to the current user.
///
/// On Windows a new file inherits the directory's ACL, which on a shared
/// machine can include other accounts. `icacls /inheritance:r` strips the
/// inherited entries and the explicit grant re-adds only the current user.
#[cfg(windows)]
pub fn write_restricted(path: &Path, contents: &str) -> Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    std::fs::write(path, contents)?;

    // CREATE_NO_WINDOW: this runs from a GUI app, and a console flashing up
    // during an export looks like something has gone wrong.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let user = std::env::var("USERNAME").unwrap_or_default();

    let status = Command::new("icacls")
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("{user}:F"))
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    // A failed ACL change is not a failed export -- the file is written and
    // the user was already warned about it. It is worth surfacing, but not
    // worth throwing away the export they asked for.
    if !matches!(status, Ok(code) if code.success()) {
        return Err(super::BackupError::Malformed(
            "The CSV was written, but its permissions could not be restricted to your account. \
             Treat it as readable by anyone using this machine."
                .into(),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn write_restricted(path: &Path, contents: &str) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, contents)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}
