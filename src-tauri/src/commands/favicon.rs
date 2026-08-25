//! Website icons (U12: R24, AE4, AE12, KTD3, KTD18).
//!
//! The only outbound network request Sanctum can make, and it is **off by
//! default**. Three properties make that claim checkable rather than a promise:
//!
//! 1. **The gate is here, not in the UI.** `AppState` holds the flag and it
//!    starts `false`. A disabled fetch returns before any socket is opened, so
//!    a fresh install makes no request even if a component asks (AE12).
//! 2. **Only a hostname can leave.** [`sanitize_domain`] rejects anything that
//!    is not a bare host and, critically, strips URL userinfo — a website
//!    field containing `https://user:pass@example.com` must never send those
//!    credentials anywhere (AE4).
//! 3. **The response is bounded and typed.** A timeout, a size cap, and a
//!    content-type check, so a hostile or broken endpoint cannot hand back
//!    something that is not a small image.
//!
//! Failure is always a silent `None`: a missing icon falls back to the generic
//! tile, which is not worth an error dialog.

use std::time::Duration;

use super::{AppState, CommandResult};

/// DuckDuckGo's icon service. Takes a domain and returns a small PNG/ICO.
const ICON_ENDPOINT: &str = "https://icons.duckduckgo.com/ip3";

/// Give up rather than hold a row's render on a slow endpoint.
const TIMEOUT: Duration = Duration::from_secs(4);

/// Icons are a few kilobytes; anything larger is not an icon.
const MAX_BYTES: usize = 128 * 1024;

/// Extracts a bare hostname from whatever the user typed in the website field.
///
/// Returns `None` for anything that is not a plausible hostname, which is the
/// safe direction: no icon is a much smaller problem than leaking a path, a
/// query string, or credentials to a third party.
pub fn sanitize_domain(input: &str) -> Option<String> {
    let mut host = input.trim();
    if host.is_empty() || host.len() > 253 {
        return None;
    }

    // Strip a scheme.
    if let Some(rest) = host.split_once("://") {
        host = rest.1;
    }

    // Strip userinfo. `https://user:pass@example.com` is a real thing people
    // paste, and everything before the `@` is a credential.
    if let Some((_, rest)) = host.split_once('@') {
        host = rest;
    }

    // Strip path, query and fragment.
    host = host.split(['/', '?', '#']).next().unwrap_or_default();

    // Strip a port.
    if let Some((name, _)) = host.rsplit_once(':') {
        // An IPv6 literal contains colons; those are rejected below anyway.
        host = name;
    }

    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.len() > 253 {
        return None;
    }

    // A hostname, and nothing else: letters, digits, hyphens and dots, with at
    // least one dot and no empty labels.
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return None;
    }
    if !host.contains('.') {
        return None;
    }
    if host.split('.').any(|label| {
        label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-')
    }) {
        return None;
    }

    let tld = host.rsplit('.').next().unwrap_or_default();

    // Reject IP literals. A public icon service cannot answer for one, and a
    // private address (192.168.x.x, 10.x.x.x) would disclose the shape of the
    // user's internal network to a third party for nothing in return. Every
    // real top-level domain contains a letter; no IPv4 address does.
    if !tld.chars().any(|c| c.is_ascii_alphabetic()) {
        return None;
    }

    // Special-use and internal names never resolve publicly, and sending them
    // would disclose internal hostnames. RFC 6761/8375 plus the conventional
    // corporate ones.
    const PRIVATE_TLDS: [&str; 9] = [
        "local",
        "internal",
        "lan",
        "home",
        "corp",
        "intranet",
        "test",
        "invalid",
        "localhost",
    ];
    if PRIVATE_TLDS.contains(&tld) {
        return None;
    }

    Some(host)
}

/// Turns image bytes into a `data:` URI the WebView can render.
///
/// Returned as a data URI rather than a URL so the page never makes the
/// request itself — the CSP has no external `img-src`, and the bytes arrive
/// over IPC having already been fetched and checked by Rust.
fn to_data_uri(content_type: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", content_type, base64_encode(bytes))
}

/// Minimal base64. A dependency for forty lines of table lookup would be a
/// poor trade in a project whose premise is carrying nothing it does not need.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);

    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Enables or disables website icons (R37's Appearance toggle).
#[tauri::command]
pub fn set_website_icons(state: tauri::State<'_, AppState>, enabled: bool) -> CommandResult<()> {
    state
        .website_icons
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

/// Whether website icons are enabled. Starts `false` on every launch.
#[tauri::command]
pub fn website_icons_enabled(state: tauri::State<'_, AppState>) -> CommandResult<bool> {
    Ok(state
        .website_icons
        .load(std::sync::atomic::Ordering::Relaxed))
}

/// Fetches a site icon, or `None`.
///
/// Returns `None` without touching the network when the setting is off, when
/// the input is not a bare hostname, or when anything at all goes wrong.
#[tauri::command]
pub async fn fetch_favicon(
    state: tauri::State<'_, AppState>,
    website: String,
) -> CommandResult<Option<String>> {
    // AE12: the gate comes first, before the domain is even parsed.
    if !state
        .website_icons
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return Ok(None);
    }

    let Some(domain) = sanitize_domain(&website) else {
        return Ok(None);
    };

    Ok(fetch_icon_bytes(&domain).await)
}

/// The network half, separated so the gate above is trivially auditable.
async fn fetch_icon_bytes(domain: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        // No cookie store, no redirect chasing beyond a couple of hops, and a
        // neutral agent string: nothing here should build a profile.
        .redirect(reqwest::redirect::Policy::limited(2))
        .user_agent("Sanctum")
        .build()
        .ok()?;

    let response = client
        .get(format!("{ICON_ENDPOINT}/{domain}.ico"))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !content_type.starts_with("image/") {
        return None;
    }

    // Declared length first, so an oversized body is refused before it is read.
    if response
        .content_length()
        .is_some_and(|n| n as usize > MAX_BYTES)
    {
        return None;
    }

    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return None;
    }

    Some(to_data_uri(&content_type, &bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- domain sanitising -- AE4 -------------------------------------------

    #[test]
    fn a_plain_domain_survives() {
        assert_eq!(
            sanitize_domain("example.com").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            sanitize_domain("sub.example.co.uk").as_deref(),
            Some("sub.example.co.uk")
        );
    }

    #[test]
    fn a_scheme_and_path_are_stripped() {
        for input in [
            "https://example.com",
            "http://example.com/",
            "https://example.com/login?next=/account",
            "https://example.com#section",
            "example.com/some/path",
            // A path containing a space is still just a path to strip.
            "example.com/a b",
        ] {
            assert_eq!(
                sanitize_domain(input).as_deref(),
                Some("example.com"),
                "{input}"
            );
        }
    }

    /// AE4, the one that matters: a website field can contain credentials, and
    /// they must never reach a third-party icon service.
    #[test]
    fn credentials_in_a_url_are_never_sent() {
        for input in [
            "https://user:hunter2@example.com",
            "https://admin@example.com/panel",
            "user:pass@example.com",
        ] {
            let result = sanitize_domain(input);
            assert_eq!(result.as_deref(), Some("example.com"), "{input}");
            let host = result.unwrap();
            assert!(!host.contains('@'), "{input}");
            assert!(!host.contains("hunter2"), "{input}");
            assert!(!host.contains("user"), "{input}");
            assert!(!host.contains("admin"), "{input}");
        }
    }

    #[test]
    fn a_port_is_stripped() {
        assert_eq!(
            sanitize_domain("https://example.com:8443/x").as_deref(),
            Some("example.com")
        );
    }

    #[test]
    fn case_and_trailing_dots_are_normalised() {
        assert_eq!(
            sanitize_domain("  HTTPS://Example.COM.  ").as_deref(),
            Some("example.com")
        );
    }

    #[test]
    fn anything_that_is_not_a_hostname_is_refused() {
        for input in [
            "",
            "   ",
            "localhost",
            "not a domain",
            "example",
            "exa mple.com",
            "example..com",
            "-example.com",
            "example-.com",
            "192.168.1.1:8080/admin path",
            "192.168.1.1",
            "10.0.0.1",
            "https://172.16.4.9:9000/",
            "nas.local",
            "git.internal",
            "printer.lan",
            "http://[::1]/",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ] {
            assert!(
                sanitize_domain(input).is_none(),
                "{input:?} should not be treated as a domain"
            );
        }
    }

    #[test]
    fn an_absurdly_long_host_is_refused() {
        let long = format!("{}.com", "a".repeat(300));
        assert!(sanitize_domain(&long).is_none());

        let long_label = format!("{}.com", "a".repeat(64));
        assert!(sanitize_domain(&long_label).is_none());
    }

    // --- base64 --------------------------------------------------------------

    #[test]
    fn base64_matches_the_standard_encoding() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // Bytes above 0x7f must encode too -- an icon is binary.
        assert_eq!(base64_encode(&[0xff, 0xfe, 0xfd]), "//79");
        assert_eq!(base64_encode(&[0x00, 0x00, 0x00]), "AAAA");
    }

    #[test]
    fn a_data_uri_carries_its_content_type() {
        let uri = to_data_uri("image/png", b"foo");
        assert_eq!(uri, "data:image/png;base64,Zm9v");
        assert!(uri.starts_with("data:image/"));
    }
}
