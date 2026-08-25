//! Windows clipboard integration (KTD16).
//!
//! The three exclusion formats are undocumented-looking but are the
//! Microsoft-documented mechanism: a clipboard *format* whose presence tells
//! the shell not to persist or sync the payload. They must be set inside the
//! same open/close pair as the text, and after `EmptyClipboard`, or they
//! describe nothing.
//!
//! Ownership rule that governs every `GlobalAlloc` below: once
//! `SetClipboardData` succeeds, the system owns that handle and freeing it
//! would be a double free. Only a *failed* `SetClipboardData` leaves the
//! handle ours to release.

use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

use super::{ClipboardError, CopyReceipt, ExclusionStatus, Result};

/// Unicode text.
const CF_UNICODETEXT: u32 = 13;

/// Formats that suppress clipboard history and cloud sync.
///
/// The first two carry a `DWORD` of 0 meaning "no". The third is a marker:
/// its presence alone asks clipboard monitors to leave the content alone.
const EXCLUSION_FORMATS: [&str; 3] = [
    "CanIncludeInClipboardHistory",
    "CanUploadToCloudClipboard",
    "ExcludeClipboardContentFromMonitorProcessing",
];

/// Current clipboard sequence number.
///
/// Changes on every clipboard write by any process, which is what makes the
/// guarded clear in the parent module possible.
pub fn sequence_number() -> u32 {
    // Safe: no arguments, no pointers, and the call is valid at any time.
    unsafe { GetClipboardSequenceNumber() }
}

fn to_utf16_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Allocates a moveable global block and fills it from `bytes`.
///
/// Returns `None` if either the allocation or the lock fails.
unsafe fn global_from_bytes(bytes: &[u8]) -> Option<HGLOBAL> {
    let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
    if handle.is_null() {
        return None;
    }

    let target = GlobalLock(handle) as *mut u8;
    if target.is_null() {
        GlobalFree(handle);
        return None;
    }

    std::ptr::copy_nonoverlapping(bytes.as_ptr(), target, bytes.len());
    GlobalUnlock(handle);
    Some(handle)
}

/// A clipboard opened for the duration of a scope.
struct ClipboardSession;

impl ClipboardSession {
    fn open() -> Result<Self> {
        // Another process can hold the clipboard briefly; a few retries turn a
        // transient collision into a success rather than a user-visible error.
        for attempt in 0..5 {
            // Safe: a null window handle associates the clipboard with the
            // current task, which is what a non-windowed helper wants.
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Ok(Self);
            }
            std::thread::sleep(std::time::Duration::from_millis(10 * (attempt + 1)));
        }
        Err(ClipboardError::Unavailable)
    }
}

impl Drop for ClipboardSession {
    fn drop(&mut self) {
        // Safe: only reached while this session holds the clipboard open.
        unsafe { CloseClipboard() };
    }
}

/// Registers the exclusion formats. Returns whether all three took effect.
unsafe fn apply_exclusions() -> ExclusionStatus {
    let mut all_applied = true;

    for name in EXCLUSION_FORMATS {
        let wide = to_utf16_null(name);
        let format = RegisterClipboardFormatW(wide.as_ptr());
        if format == 0 {
            all_applied = false;
            continue;
        }

        // A DWORD of zero: "no, do not include this".
        let payload = 0u32.to_ne_bytes();
        let Some(handle) = global_from_bytes(&payload) else {
            all_applied = false;
            continue;
        };

        if SetClipboardData(format, handle as HANDLE).is_null() {
            // The call failed, so the handle is still ours to release.
            GlobalFree(handle);
            all_applied = false;
        }
    }

    if all_applied {
        ExclusionStatus::Excluded
    } else {
        ExclusionStatus::NotExcluded
    }
}

/// Copies `text`, excluded from history and cloud sync where possible.
///
/// A failure to exclude does **not** fail the copy: the user asked for their
/// password on the clipboard and refusing would be worse than proceeding. It
/// is reported in the receipt so the UI can disclose it (R43).
pub fn copy_secret(text: &str) -> Result<CopyReceipt> {
    // The write happens in an inner scope so the clipboard is CLOSED before
    // the sequence number is read. GetClipboardSequenceNumber does not
    // observe a change until the writing session closes -- reading it while
    // still open records a stale value that can never match later, which
    // would make the guarded clear skip every single time and leave
    // passwords sitting on the clipboard forever.
    let exclusion = {
        let _session = ClipboardSession::open()?;

        // SAFETY: every call below runs while  holds the clipboard
        // open, and each allocated handle is either transferred to the system
        // by a successful  or freed on the failure path.
        unsafe {
            if EmptyClipboard() == 0 {
                return Err(ClipboardError::Failed(
                    "could not empty the clipboard".into(),
                ));
            }

            let wide = to_utf16_null(text);
            let bytes = std::slice::from_raw_parts(
                wide.as_ptr() as *const u8,
                std::mem::size_of_val(&wide[..]),
            );

            let handle = global_from_bytes(bytes).ok_or_else(|| {
                ClipboardError::Failed("could not allocate clipboard memory".into())
            })?;

            if SetClipboardData(CF_UNICODETEXT, handle as HANDLE).is_null() {
                GlobalFree(handle);
                return Err(ClipboardError::Failed(
                    "the system refused the clipboard data".into(),
                ));
            }

            // Order matters: the exclusion formats describe content that is
            // already on the clipboard, so they go on after the text.
            apply_exclusions()
        }
    };

    Ok(CopyReceipt {
        sequence: sequence_number(),
        exclusion,
    })
}

/// Empties the clipboard.
pub fn clear() -> Result<()> {
    let _session = ClipboardSession::open()?;
    // Safe: the clipboard is open for the lifetime of `_session`.
    if unsafe { EmptyClipboard() } == 0 {
        return Err(ClipboardError::Failed(
            "could not empty the clipboard".into(),
        ));
    }
    Ok(())
}

/// Reads back the clipboard's Unicode text. Test support only.
#[cfg(test)]
pub fn read_text() -> Result<String> {
    use windows_sys::Win32::System::DataExchange::GetClipboardData;

    let _session = ClipboardSession::open()?;
    unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            return Ok(String::new());
        }
        let locked = GlobalLock(handle as HGLOBAL) as *const u16;
        if locked.is_null() {
            return Ok(String::new());
        }

        let mut length = 0usize;
        while *locked.add(length) != 0 {
            length += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(locked, length));
        GlobalUnlock(handle as HGLOBAL);
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The clipboard is a process-wide singleton, so these run as one test to
    /// avoid interfering with each other under cargo's parallel runner.
    #[test]
    fn copy_clear_and_the_sequence_guard_work_against_the_real_clipboard() {
        let secret = "sanctum-clipboard-test-value-9137";

        let Ok(receipt) = copy_secret(secret) else {
            // A locked or unavailable clipboard (headless CI, another app
            // holding it) is an environment limitation, not a failure of this
            // code. The pure guard logic is covered in the parent module.
            eprintln!("clipboard unavailable; skipping the live-clipboard check");
            return;
        };

        assert_eq!(read_text().unwrap(), secret);
        assert!(receipt.sequence > 0);

        // R43: our own copy is still the most recent, so the clear applies.
        assert!(super::super::should_clear(receipt, sequence_number()));
        assert!(super::super::clear_if_unchanged(receipt).unwrap());
        assert_eq!(read_text().unwrap(), "");

        // Now simulate another application copying after us: the sequence
        // number moves, and the stale receipt must no longer authorise a clear.
        let stale = receipt;
        let _ = copy_secret("something the user copied afterwards");
        assert!(!super::super::should_clear(stale, sequence_number()));
        assert!(!super::super::clear_if_unchanged(stale).unwrap());
        assert_eq!(read_text().unwrap(), "something the user copied afterwards");

        let _ = clear();
    }
}
