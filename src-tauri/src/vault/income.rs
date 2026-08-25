//! Income storage (U17: R32).
//!
//! The **amount is encrypted**, which means totals cannot be a `SUM()` in SQL
//! and are computed in Rust over decrypted rows instead. That is the right
//! trade: what someone earns is exactly the kind of thing this app exists to
//! protect, and a personal ledger is hundreds of rows, not millions.
//!
//! Amounts are stored as integer **minor units** (cents), not floats. `0.1 +
//! 0.2 != 0.3` in binary floating point, and a money total that drifts by a
//! cent is a bug that surfaces months later in a figure someone trusts.

use rusqlite::{params, OptionalExtension};

use crate::crypto::SymmetricKey;

use super::store::{new_row_id, now_unix, seal, unseal};
use super::{Result, Vault, VaultError};

const COL_SOURCE: &str = "income.source";
const COL_AMOUNT: &str = "income.amount";
const COL_REMARKS: &str = "income.remarks";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Income {
    pub id: i64,
    pub source: String,
    /// Minor units, e.g. 26_000_000 for PHP 260,000.00.
    pub amount_minor: i64,
    pub remarks: String,
    pub currency: String,
    pub category: String,
    /// Unix milliseconds for the day it was received.
    pub received_on: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewIncome {
    pub source: String,
    pub amount_minor: i64,
    pub remarks: String,
    pub currency: String,
    pub category: String,
    pub received_on: i64,
}

impl Default for NewIncome {
    fn default() -> Self {
        Self {
            source: String::new(),
            amount_minor: 0,
            remarks: String::new(),
            currency: "PHP".into(),
            category: "Salary".into(),
            received_on: now_unix(),
        }
    }
}

impl Vault {
    pub fn insert_income(&self, dek: &SymmetricKey, new: &NewIncome) -> Result<i64> {
        let id = new_row_id()?;
        let now = now_unix();

        self.connection().execute(
            "INSERT INTO income (id, source_enc, amount_enc, remarks_enc, currency, category,
                                 received_on, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![
                id,
                seal(dek, id, COL_SOURCE, &new.source)?,
                seal(dek, id, COL_AMOUNT, &new.amount_minor.to_string())?,
                seal(dek, id, COL_REMARKS, &new.remarks)?,
                new.currency,
                new.category,
                new.received_on,
                now,
            ],
        )?;
        Ok(id)
    }

    pub fn get_income(&self, dek: &SymmetricKey, id: i64) -> Result<Option<Income>> {
        let row = self
            .connection()
            .query_row(
                "SELECT source_enc, amount_enc, remarks_enc, currency, category, received_on,
                        created_at, updated_at
                 FROM income WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, Vec<u8>>(0)?,
                        row.get::<_, Vec<u8>>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                },
            )
            .optional()?;

        let Some((
            source,
            amount,
            remarks,
            currency,
            category,
            received_on,
            created_at,
            updated_at,
        )) = row
        else {
            return Ok(None);
        };

        let amount_text = unseal(dek, id, COL_AMOUNT, &amount)?;
        Ok(Some(Income {
            id,
            source: unseal(dek, id, COL_SOURCE, &source)?,
            amount_minor: amount_text
                .parse()
                .map_err(|_| VaultError::Corrupt(format!("income amount {amount_text:?}")))?,
            remarks: unseal(dek, id, COL_REMARKS, &remarks)?,
            currency,
            category,
            received_on,
            created_at,
            updated_at,
        }))
    }

    pub fn list_income(&self, dek: &SymmetricKey) -> Result<Vec<Income>> {
        let ids: Vec<i64> = {
            let conn = self.connection();
            let mut stmt =
                conn.prepare("SELECT id FROM income ORDER BY received_on DESC, id DESC")?;
            let rows = stmt.query_map([], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(entry) = self.get_income(dek, id)? {
                out.push(entry);
            }
        }
        Ok(out)
    }

    pub fn update_income(&self, dek: &SymmetricKey, id: i64, updated: &NewIncome) -> Result<()> {
        let affected = self.connection().execute(
            "UPDATE income SET source_enc = ?2, amount_enc = ?3, remarks_enc = ?4,
                               currency = ?5, category = ?6, received_on = ?7, updated_at = ?8
             WHERE id = ?1",
            params![
                id,
                seal(dek, id, COL_SOURCE, &updated.source)?,
                seal(dek, id, COL_AMOUNT, &updated.amount_minor.to_string())?,
                seal(dek, id, COL_REMARKS, &updated.remarks)?,
                updated.currency,
                updated.category,
                updated.received_on,
                now_unix(),
            ],
        )?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    pub fn delete_income(&self, id: i64) -> Result<()> {
        let affected = self
            .connection()
            .execute("DELETE FROM income WHERE id = ?1", params![id])?;
        if affected == 0 {
            return Err(VaultError::NotFound { id });
        }
        Ok(())
    }

    /// Sums income received within `[from, to)`, in minor units.
    ///
    /// Integer arithmetic throughout, and `checked_add` so a total that would
    /// overflow reports rather than silently wrapping to a negative figure.
    pub fn income_total(&self, dek: &SymmetricKey, from: i64, to: i64) -> Result<i64> {
        let ids: Vec<i64> = {
            let conn = self.connection();
            let mut stmt =
                conn.prepare("SELECT id FROM income WHERE received_on >= ?1 AND received_on < ?2")?;
            let rows = stmt.query_map(params![from, to], |row| row.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };

        let mut total: i64 = 0;
        for id in ids {
            if let Some(entry) = self.get_income(dek, id)? {
                total = total
                    .checked_add(entry.amount_minor)
                    .ok_or_else(|| VaultError::Corrupt("income total overflowed".into()))?;
            }
        }
        Ok(total)
    }
}
