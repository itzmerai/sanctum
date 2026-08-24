//! Secret-bearing types (KTD15).
//!
//! Two guarantees, both enforced by construction rather than by convention:
//!
//! 1. Memory is zeroed on drop (`ZeroizeOnDrop`).
//! 2. The types do not implement `Debug`, `Display`, `Clone`, or `Serialize`,
//!    so a secret cannot reach a log line, a panic message, or the IPC
//!    boundary by accident. `crypto::tests` asserts the absence of `Debug` at
//!    compile time.

use zeroize::{Zeroize, ZeroizeOnDrop};

use super::{fill_random, Result};

/// Length of every symmetric key in the system: AES-256.
pub const KEY_LEN: usize = 32;

/// A 256-bit symmetric key (a KEK or the DEK).
///
/// Intentionally missing: `Debug`, `Display`, `Clone`, `Copy`, `Serialize`,
/// `PartialEq`. Comparison of two keys is never a legitimate operation here --
/// the AEAD tag is what proves a key is correct.
#[derive(ZeroizeOnDrop)]
pub struct SymmetricKey([u8; KEY_LEN]);

impl SymmetricKey {
    /// Generates a fresh key from the OS CSPRNG.
    pub fn generate() -> Result<Self> {
        let mut bytes = [0u8; KEY_LEN];
        fill_random(&mut bytes)?;
        Ok(Self(bytes))
    }

    /// Adopts caller-supplied key material, zeroing the caller's copy.
    pub fn from_bytes(bytes: &mut [u8; KEY_LEN]) -> Self {
        let key = Self(*bytes);
        bytes.zeroize();
        key
    }

    /// Borrows the raw key.
    ///
    /// The only way to reach the bytes, and deliberately verbose at the call
    /// site so an audit can grep for it.
    pub(crate) fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

/// Variable-length secret bytes -- a master password or a recovery code.
#[derive(ZeroizeOnDrop)]
pub struct SecretBytes(Vec<u8>);

impl SecretBytes {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub fn from_str_secret(s: &str) -> Self {
        Self(s.as_bytes().to_vec())
    }

    pub(crate) fn expose(&self) -> &[u8] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
