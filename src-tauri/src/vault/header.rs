//! The vault header: everything needed to turn a secret into the DEK.
//!
//! Holds the KDF parameters the vault was created with (so raising the
//! defaults never locks an existing vault out), both salts, and the two
//! wrapped-DEK blobs (KTD9/KTD14). It contains no plaintext key material --
//! the DEK only ever exists wrapped here, or in memory behind
//! `SymmetricKey` after a successful unwrap.
//!
//! U5 adds rotation on top of this. Because KTD9 means rotation re-wraps the
//! same DEK, a rotation writes only these few hundred bytes and never touches
//! a record body.

use rusqlite::{params, Connection, OptionalExtension};

use crate::crypto::{KdfParams, WrappedKey, VAULT_FORMAT_VERSION};

use super::{Result, VaultError};

/// The single header row of a vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultHeader {
    /// Crypto format the records were written under (KTD22).
    pub crypto_format_version: u16,
    /// Argon2id cost parameters this vault was created with (KTD11).
    pub kdf_params: KdfParams,
    /// Salt for the master-password KDF.
    pub master_salt: Vec<u8>,
    /// Salt for the recovery-code KDF.
    pub recovery_salt: Vec<u8>,
    /// DEK wrapped under the master-password KEK.
    pub wrapped_master: WrappedKey,
    /// DEK wrapped under the recovery-code KEK.
    pub wrapped_recovery: WrappedKey,
    /// Whether the user has typed the acknowledgment for their recovery code (R46).
    pub recovery_acknowledged: bool,
    /// Unix seconds.
    pub created_at: i64,
    /// Unix seconds.
    pub updated_at: i64,
}

impl VaultHeader {
    /// Reads the header, or `None` for a vault that has not been set up yet.
    pub fn load(conn: &Connection) -> Result<Option<Self>> {
        let row = conn
            .query_row(
                "SELECT crypto_format_version, kdf_params, master_salt, recovery_salt,
                        wrapped_master, wrapped_recovery, recovery_acknowledged,
                        created_at, updated_at
                 FROM vault_header WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                    ))
                },
            )
            .optional()?;

        let Some((fmt, kdf, master_salt, recovery_salt, wm, wr, ack, created, updated)) = row
        else {
            return Ok(None);
        };

        let crypto_format_version = u16::try_from(fmt).map_err(|_| {
            VaultError::Corrupt(format!("crypto format version {fmt} is out of range"))
        })?;

        Ok(Some(Self {
            crypto_format_version,
            kdf_params: serde_json::from_str(&kdf)
                .map_err(|e| VaultError::Corrupt(format!("kdf_params: {e}")))?,
            master_salt,
            recovery_salt,
            wrapped_master: serde_json::from_str(&wm)
                .map_err(|e| VaultError::Corrupt(format!("wrapped_master: {e}")))?,
            wrapped_recovery: serde_json::from_str(&wr)
                .map_err(|e| VaultError::Corrupt(format!("wrapped_recovery: {e}")))?,
            recovery_acknowledged: ack != 0,
            created_at: created,
            updated_at: updated,
        }))
    }

    /// Inserts or replaces the header row.
    ///
    /// A single-statement upsert, so it is atomic under SQLite's own
    /// guarantees: a crash leaves either the previous header or the new one,
    /// never a blend of the two. That is what U5's rotation relies on.
    pub fn store(&self, conn: &Connection) -> Result<()> {
        conn.execute(
            "INSERT INTO vault_header (
                 id, crypto_format_version, kdf_params, master_salt, recovery_salt,
                 wrapped_master, wrapped_recovery, recovery_acknowledged,
                 created_at, updated_at
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 crypto_format_version = excluded.crypto_format_version,
                 kdf_params            = excluded.kdf_params,
                 master_salt           = excluded.master_salt,
                 recovery_salt         = excluded.recovery_salt,
                 wrapped_master        = excluded.wrapped_master,
                 wrapped_recovery      = excluded.wrapped_recovery,
                 recovery_acknowledged = excluded.recovery_acknowledged,
                 updated_at            = excluded.updated_at",
            params![
                i64::from(self.crypto_format_version),
                serde_json::to_string(&self.kdf_params)
                    .map_err(|e| VaultError::Corrupt(e.to_string()))?,
                self.master_salt,
                self.recovery_salt,
                serde_json::to_string(&self.wrapped_master)
                    .map_err(|e| VaultError::Corrupt(e.to_string()))?,
                serde_json::to_string(&self.wrapped_recovery)
                    .map_err(|e| VaultError::Corrupt(e.to_string()))?,
                i64::from(self.recovery_acknowledged),
                self.created_at,
                self.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Rejects a vault whose records were written under a crypto format this
    /// build does not implement.
    ///
    /// Opening it anyway would produce authentication failures that look
    /// exactly like a wrong password, which is a genuinely confusing way to
    /// lose a vault.
    pub fn ensure_supported_crypto_format(&self) -> Result<()> {
        if self.crypto_format_version != VAULT_FORMAT_VERSION {
            return Err(VaultError::CryptoFormatUnsupported {
                found: self.crypto_format_version,
                supported: VAULT_FORMAT_VERSION,
            });
        }
        Ok(())
    }
}
