//! Migration runner, keyed on `PRAGMA user_version`.
//!
//! `user_version` is a SQLite header field rather than a table, so it is read
//! and written inside the same transaction as the DDL it describes. A crash
//! mid-migration therefore leaves the version and the schema consistent with
//! each other: either both moved or neither did.
//!
//! The **schema** version tracked here is independent of
//! `crypto::VAULT_FORMAT_VERSION` (KTD22). Adding a table or column advances
//! this number and leaves the crypto format alone, so every existing record
//! still authenticates under the AAD it was written with.

use rusqlite::Connection;

use super::schema::MIGRATIONS;
use super::{Result, VaultError};

/// Reads the schema version recorded in the database header.
pub fn current_version(conn: &Connection) -> Result<u32> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    u32::try_from(version).map_err(|_| {
        VaultError::Corrupt(format!("schema version {version} is not a valid version"))
    })
}

/// Applies every migration newer than the recorded version.
///
/// Refuses to open a vault written by a newer build: running an old binary
/// against a newer schema would silently ignore columns it does not know
/// about, and writes made that way could not be reconciled later.
pub fn migrate(conn: &mut Connection) -> Result<u32> {
    let from = current_version(conn)?;
    let to = MIGRATIONS.len() as u32;

    if from > to {
        return Err(VaultError::SchemaTooNew {
            found: from,
            supported: to,
        });
    }
    if from == to {
        return Ok(to);
    }

    for (index, ddl) in MIGRATIONS.iter().enumerate().skip(from as usize) {
        let version = index as u32 + 1;
        let tx = conn.transaction()?;
        tx.execute_batch(ddl)?;
        // PRAGMA does not accept a bound parameter, and `version` is derived
        // from a compile-time array index, so this cannot carry user input.
        tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
        tx.commit()?;
    }

    Ok(to)
}
