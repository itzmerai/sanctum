//! Unlock session state (U4, KTD15).
//!
//! Holds the DEK for exactly as long as the vault is unlocked, and not one
//! moment longer. Auto-lock **drops** the key — it does not hide the UI, and
//! it does not keep a copy "just in case". Re-unlocking therefore re-runs the
//! full Argon2id derivation, which is the whole point: after the idle window
//! the key genuinely is not in this process's memory, so a memory capture
//! taken while the screen is locked yields nothing to decrypt with.
//!
//! Time is passed in rather than read from the clock inside the guard, so the
//! idle-timeout behaviour is testable without sleeping.

use std::time::{Duration, Instant};

use crate::crypto::SymmetricKey;

/// Default idle window before the vault locks itself (R9).
pub const DEFAULT_AUTO_LOCK: Duration = Duration::from_secs(5 * 60);

/// Why a command that needs the DEK could not run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SessionError {
    #[error("the vault is locked")]
    Locked,
}

/// The unlocked-session half of application state.
///
/// Deliberately not `Debug`: it owns a `SymmetricKey`, and while that type is
/// itself unprintable, deriving `Debug` here would be the first step toward
/// someone adding a field that is not.
pub struct Session {
    dek: Option<SymmetricKey>,
    last_activity: Instant,
    auto_lock: Duration,
}

impl Session {
    /// A new, locked session.
    pub fn new() -> Self {
        Self {
            dek: None,
            last_activity: Instant::now(),
            auto_lock: DEFAULT_AUTO_LOCK,
        }
    }

    /// Installs the DEK, marking the vault unlocked.
    pub fn unlock(&mut self, dek: SymmetricKey, now: Instant) {
        self.dek = Some(dek);
        self.last_activity = now;
    }

    /// Drops the DEK.
    ///
    /// `Option::take` moves the key out and lets it fall out of scope, which
    /// runs `SymmetricKey`'s `ZeroizeOnDrop` and scrubs the bytes.
    pub fn lock(&mut self) {
        self.dek.take();
    }

    /// Whether the vault is currently locked.
    pub fn is_locked(&self) -> bool {
        self.dek.is_none()
    }

    /// The configured idle window.
    pub fn auto_lock(&self) -> Duration {
        self.auto_lock
    }

    /// Sets the idle window (R38 / Settings).
    ///
    /// A zero duration means "lock immediately when idle is checked", which is
    /// a legitimate paranoid setting rather than a disabled timer.
    pub fn set_auto_lock(&mut self, window: Duration) {
        self.auto_lock = window;
    }

    /// Records user activity, restarting the idle window.
    pub fn touch(&mut self, now: Instant) {
        if self.dek.is_some() {
            self.last_activity = now;
        }
    }

    /// Locks the vault if the idle window has elapsed. Returns true if this
    /// call was the one that locked it.
    pub fn enforce_idle_timeout(&mut self, now: Instant) -> bool {
        if self.dek.is_none() {
            return false;
        }
        if now.duration_since(self.last_activity) >= self.auto_lock {
            self.lock();
            return true;
        }
        false
    }

    /// Borrows the DEK for one operation, enforcing the idle window first.
    ///
    /// Every command that touches ciphertext goes through here, so the timeout
    /// cannot be bypassed by a code path that forgot to check — there is no
    /// other way to reach the key.
    pub fn dek(&mut self, now: Instant) -> Result<&SymmetricKey, SessionError> {
        self.enforce_idle_timeout(now);
        self.touch(now);
        self.dek.as_ref().ok_or(SessionError::Locked)
    }

    /// Borrows the DEK without touching the activity clock.
    ///
    /// For background work that must not count as user activity — otherwise a
    /// periodic refresh would hold the vault open forever.
    pub fn dek_without_touch(&mut self, now: Instant) -> Result<&SymmetricKey, SessionError> {
        self.enforce_idle_timeout(now);
        self.dek.as_ref().ok_or(SessionError::Locked)
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::SymmetricKey;

    fn key() -> SymmetricKey {
        SymmetricKey::generate().unwrap()
    }

    #[test]
    fn a_new_session_is_locked() {
        let mut session = Session::new();
        assert!(session.is_locked());
        assert!(matches!(
            session.dek(Instant::now()),
            Err(SessionError::Locked)
        ));
    }

    #[test]
    fn unlocking_makes_the_key_available() {
        let mut session = Session::new();
        session.unlock(key(), Instant::now());

        assert!(!session.is_locked());
        assert!(session.dek(Instant::now()).is_ok());
    }

    #[test]
    fn locking_drops_the_key() {
        let mut session = Session::new();
        session.unlock(key(), Instant::now());
        session.lock();

        assert!(session.is_locked());
        assert!(matches!(
            session.dek(Instant::now()),
            Err(SessionError::Locked)
        ));
    }

    /// R9: after the idle window, a command requiring the DEK must fail until
    /// the user unlocks again. The key is gone, not merely hidden.
    #[test]
    fn the_key_is_unreachable_after_the_idle_window() {
        let start = Instant::now();
        let mut session = Session::new();
        session.set_auto_lock(Duration::from_secs(300));
        session.unlock(key(), start);

        // Just inside the window.
        assert!(session.dek(start + Duration::from_secs(299)).is_ok());

        // Past it, measured from the last activity.
        let expired = start + Duration::from_secs(299) + Duration::from_secs(301);
        assert!(matches!(session.dek(expired), Err(SessionError::Locked)));
        assert!(session.is_locked());
    }

    #[test]
    fn activity_restarts_the_idle_window() {
        let start = Instant::now();
        let mut session = Session::new();
        session.set_auto_lock(Duration::from_secs(60));
        session.unlock(key(), start);

        for step in 1..=10 {
            let now = start + Duration::from_secs(50 * step);
            assert!(
                session.dek(now).is_ok(),
                "continuous use must not trigger auto-lock at step {step}"
            );
        }
    }

    #[test]
    fn background_reads_do_not_hold_the_vault_open() {
        let start = Instant::now();
        let mut session = Session::new();
        session.set_auto_lock(Duration::from_secs(60));
        session.unlock(key(), start);

        // Repeated background access never refreshes the clock, so the window
        // still expires on schedule.
        for step in 1..=3 {
            let _ = session.dek_without_touch(start + Duration::from_secs(10 * step));
        }
        assert!(matches!(
            session.dek(start + Duration::from_secs(61)),
            Err(SessionError::Locked)
        ));
    }

    #[test]
    fn enforce_reports_only_the_transition() {
        let start = Instant::now();
        let mut session = Session::new();
        session.set_auto_lock(Duration::from_secs(10));
        session.unlock(key(), start);

        let late = start + Duration::from_secs(11);
        assert!(session.enforce_idle_timeout(late), "first call locks");
        assert!(
            !session.enforce_idle_timeout(late),
            "an already-locked session reports no transition"
        );
    }

    #[test]
    fn a_zero_window_locks_on_the_next_check() {
        let start = Instant::now();
        let mut session = Session::new();
        session.set_auto_lock(Duration::ZERO);
        session.unlock(key(), start);

        assert!(matches!(session.dek(start), Err(SessionError::Locked)));
    }

    #[test]
    fn touching_a_locked_session_does_nothing() {
        let mut session = Session::new();
        session.touch(Instant::now());
        assert!(session.is_locked());
    }
}
