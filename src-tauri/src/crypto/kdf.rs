//! Argon2id key derivation (KTD11, R41).
//!
//! Parameters are calibrated on the host at first run and then **stored in the
//! vault header**, so a vault created today still opens after the defaults are
//! raised. Deriving a KEK always uses the parameters recorded with that vault,
//! never the current defaults.

use std::time::{Duration, Instant};

use argon2::{Algorithm, Argon2, Params, Version};

use super::{secrets::KEY_LEN, CryptoError, Result, SecretBytes, SymmetricKey};

/// Salt length for the master and recovery KDFs.
pub const SALT_LEN: usize = 16;

/// Calibration target for interactive unlock (KTD11).
pub const TARGET_UNLOCK: Duration = Duration::from_millis(750);

/// Absolute floor from KTD11 -- OWASP's minimum Argon2id configuration.
///
/// Calibration may raise these; it may never go below them, even on a slow
/// machine. R41 makes this a resistance floor for an offline attack on a
/// stolen vault file, not a latency budget.
const FLOOR_M_COST_KIB: u32 = 19_456;
const FLOOR_T_COST: u32 = 2;
const FLOOR_P_COST: u32 = 1;

/// Preferred starting point: 256 MiB, 3 passes (KTD11).
const PREFERRED_M_COST_KIB: u32 = 262_144;
const PREFERRED_T_COST: u32 = 3;

/// Upper bound on calibration escalation, so a slow host cannot produce a
/// vault that takes minutes to open.
const MAX_T_COST: u32 = 10;

/// Argon2id cost parameters, persisted in the vault header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct KdfParams {
    /// Memory cost in KiB.
    pub m_cost_kib: u32,
    /// Time cost (passes).
    pub t_cost: u32,
    /// Parallelism (lanes).
    pub p_cost: u32,
}

impl KdfParams {
    /// Raises any field that sits below the KTD11 floor.
    pub fn clamped_to_floor(self) -> Self {
        Self {
            m_cost_kib: self.m_cost_kib.max(FLOOR_M_COST_KIB),
            t_cost: self.t_cost.max(FLOOR_T_COST),
            p_cost: self.p_cost.max(FLOOR_P_COST),
        }
    }

    /// True when every field meets the KTD11 floor.
    pub fn meets_floor(self) -> bool {
        self.m_cost_kib >= FLOOR_M_COST_KIB
            && self.t_cost >= FLOOR_T_COST
            && self.p_cost >= FLOOR_P_COST
    }

    fn to_argon2(self) -> Result<Argon2<'static>> {
        let params = Params::new(self.m_cost_kib, self.t_cost, self.p_cost, Some(KEY_LEN))
            .map_err(|e| CryptoError::InvalidParams(e.to_string()))?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost_kib: PREFERRED_M_COST_KIB,
            t_cost: PREFERRED_T_COST,
            p_cost: default_parallelism(),
        }
    }
}

fn default_parallelism() -> u32 {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(1);
    cores.clamp(1, 4)
}

/// Derives a key-encryption key from a secret and salt.
///
/// Used for the master password and for any other Argon2id-derived key. The
/// output is a `SymmetricKey`, so the derived bytes are zeroed on drop and
/// never printable.
pub fn derive_kek(secret: &SecretBytes, salt: &[u8], params: KdfParams) -> Result<SymmetricKey> {
    if salt.len() < 8 {
        return Err(CryptoError::InvalidParams(format!(
            "salt must be at least 8 bytes, got {}",
            salt.len()
        )));
    }

    let argon = params.to_argon2()?;
    let mut out = [0u8; KEY_LEN];
    argon
        .hash_password_into(secret.expose(), salt, &mut out)
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;

    Ok(SymmetricKey::from_bytes(&mut out))
}

/// Calibrates Argon2id to the default interactive target (KTD11).
pub fn calibrate() -> Result<KdfParams> {
    calibrate_to(TARGET_UNLOCK)
}

/// Calibrates Argon2id to an explicit target.
///
/// Memory is held at the preferred 256 MiB and passes are escalated, because
/// memory hardness is what actually costs a GPU or ASIC attacker; adding
/// passes is the cheaper knob for both sides. If even the first probe is
/// slower than the target, the preferred parameters are returned unchanged --
/// they are already above the floor, and reducing them to hit a latency
/// number would trade R41's security property for comfort.
pub fn calibrate_to(target: Duration) -> Result<KdfParams> {
    let mut params = KdfParams {
        m_cost_kib: PREFERRED_M_COST_KIB,
        t_cost: PREFERRED_T_COST,
        p_cost: default_parallelism(),
    };

    let probe_secret = SecretBytes::from_str_secret("sanctum-calibration-probe");
    let probe_salt = [0u8; SALT_LEN];

    loop {
        let start = Instant::now();
        derive_kek(&probe_secret, &probe_salt, params)?;
        let elapsed = start.elapsed();

        if elapsed >= target || params.t_cost >= MAX_T_COST {
            break;
        }
        params.t_cost += 1;
    }

    Ok(params.clamped_to_floor())
}

/// Generates a fresh random salt.
pub fn generate_salt() -> Result<[u8; SALT_LEN]> {
    let mut salt = [0u8; SALT_LEN];
    super::fill_random(&mut salt)?;
    Ok(salt)
}
