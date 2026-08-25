//! Clipboard security (U7: R10, R43, KTD16).
//!
//! Two problems, and they are separate.
//!
//! **Windows keeps copies.** Clipboard History (Win+V) and Cloud Clipboard
//! persist and sync whatever is copied. A password put on the clipboard the
//! ordinary way is therefore written to disk and possibly to a Microsoft
//! account, entirely outside Sanctum's control. The fix is to register three
//! extra clipboard formats alongside the text, which tell Windows to exclude
//! it. See `windows_impl`.
//!
//! **Clearing is racy.** The 30-second auto-clear must not wipe whatever the
//! user copied *after* us. `GetClipboardSequenceNumber` increments on every
//! change, so recording it at copy time and comparing before clearing makes
//! the clear conditional on the clipboard still holding our value. That guard
//! logic lives here, platform-independent and unit-tested; the API calls live
//! behind it.

#[cfg(windows)]
mod windows_impl;

use std::time::Duration;

/// How long a copied secret stays on the clipboard (R10).
pub const CLEAR_AFTER: Duration = Duration::from_secs(30);

/// Whether the platform could apply history/cloud exclusion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExclusionStatus {
    /// All three exclusion formats were registered.
    Excluded,
    /// The APIs were unavailable or refused. The value was still copied, and
    /// the user must be told (R43) rather than left believing it was excluded.
    NotExcluded,
}

/// What a copy produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReceipt {
    /// Clipboard sequence number immediately after the copy.
    pub sequence: u32,
    pub exclusion: ExclusionStatus,
}

/// Errors from the clipboard layer.
#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("the clipboard could not be opened; another application may be holding it")]
    Unavailable,

    #[error("the clipboard operation failed: {0}")]
    Failed(String),

    #[error("clipboard integration is not available on this platform")]
    Unsupported,
}

pub type Result<T> = std::result::Result<T, ClipboardError>;

/// Decides whether a scheduled clear should still run.
///
/// Pure, so the race that matters is testable without a clipboard: if anything
/// changed the clipboard after our copy, the sequence number moved and the
/// value on it is no longer ours to erase.
pub fn should_clear(receipt: CopyReceipt, sequence_now: u32) -> bool {
    receipt.sequence == sequence_now
}

/// Copies a secret with history and cloud sync excluded (KTD16).
#[cfg(windows)]
pub fn copy_secret(text: &str) -> Result<CopyReceipt> {
    windows_impl::copy_secret(text)
}

/// Clears the clipboard if it still holds what we put there (R43).
#[cfg(windows)]
pub fn clear_if_unchanged(receipt: CopyReceipt) -> Result<bool> {
    let now = windows_impl::sequence_number();
    if !should_clear(receipt, now) {
        return Ok(false);
    }
    windows_impl::clear()?;
    Ok(true)
}

#[cfg(not(windows))]
pub fn copy_secret(_text: &str) -> Result<CopyReceipt> {
    Err(ClipboardError::Unsupported)
}

#[cfg(not(windows))]
pub fn clear_if_unchanged(_receipt: CopyReceipt) -> Result<bool> {
    Err(ClipboardError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(sequence: u32) -> CopyReceipt {
        CopyReceipt {
            sequence,
            exclusion: ExclusionStatus::Excluded,
        }
    }

    #[test]
    fn the_clear_runs_when_the_clipboard_is_untouched() {
        assert!(should_clear(receipt(42), 42));
    }

    /// R43: the guard exists so a scheduled clear cannot destroy something the
    /// user copied from another application in the meantime.
    #[test]
    fn the_clear_is_skipped_after_someone_else_copies() {
        assert!(!should_clear(receipt(42), 43));
        assert!(!should_clear(receipt(42), 99));
    }

    /// The sequence number is a `u32` that wraps. A wrapped value is a
    /// *different* value, so the guard still refuses -- which is the safe
    /// direction: at worst a secret lingers until the next copy, rather than
    /// Sanctum erasing someone's unrelated clipboard.
    #[test]
    fn a_wrapped_sequence_number_does_not_authorise_a_clear() {
        assert!(!should_clear(receipt(u32::MAX), 0));
        assert!(should_clear(receipt(u32::MAX), u32::MAX));
    }

    #[test]
    fn the_clear_window_is_thirty_seconds() {
        assert_eq!(CLEAR_AFTER, Duration::from_secs(30));
    }

    #[test]
    fn the_receipt_reports_whether_exclusion_applied() {
        // R43: the frontend branches on this to decide whether to show the
        // "Windows may still keep a copy" disclosure.
        let json = serde_json::to_string(&receipt(1)).unwrap();
        assert!(json.contains("excluded"));

        let unprotected = CopyReceipt {
            sequence: 1,
            exclusion: ExclusionStatus::NotExcluded,
        };
        assert!(serde_json::to_string(&unprotected)
            .unwrap()
            .contains("notExcluded"));
    }

    #[test]
    fn a_receipt_never_carries_the_copied_value() {
        // The receipt crosses to the WebView; it must describe the copy, not
        // repeat it.
        let json = serde_json::to_string(&receipt(7)).unwrap();
        assert!(!json.contains("password"));
        assert_eq!(json.matches(':').count(), 2);
    }
}
