# Sanctum

An offline password and personal vault for Windows. Credentials, notes, tasks,
income and a calendar live in a single encrypted SQLite file on your machine.
There is no account, no sync, no server, and nothing to sign up for.

**Status: 0.1.0.** Working and tested, but early. The cryptography has not been
independently audited and installers are not yet code-signed — see
[Honest limitations](#honest-limitations) before trusting it with anything you
cannot afford to lose.

## What it holds

| | |
|---|---|
| **Vault** | Credentials with username, password, URL, notes and folders |
| **Notes** | Free-form notes with labels, favourites and a quick peek |
| **Tasks** | Due dates, overdue highlighting, completion |
| **Income** | Entries in minor units with monthly totals |
| **Calendar** | Tasks and income laid out by month |
| **Generator** | Passwords and passphrases, strength-scored |
| **Dashboard** | Counts, vault protection status, recent activity |

Folders and favourites cut across everything, and `Ctrl+K` opens a command
palette that searches all of it — without ever surfacing a password.

## How your data is protected

Your passphrase never unlocks records directly. It derives a key-encrypting key,
which unwraps a data-encrypting key, which decrypts individual fields. That
indirection is what makes changing your passphrase cheap: only the wrapped DEK
is rewritten, not every record.

| Concern | Choice |
|---|---|
| Passphrase → key | Argon2id, calibrated on first run to ~750 ms on your hardware |
| Record encryption | AES-256-GCM, fresh 96-bit nonce per write |
| Tamper binding | Each ciphertext's AAD binds its row id, column and format version |
| Storage | SQLite with application-layer column encryption |
| Lost passphrase | A 150-bit recovery code, shown once, wrapping a second copy of the DEK |
| Keys in memory | Zeroized on drop; no `Debug`, `Clone` or `Serialize` on key types |
| Clipboard | Copies are excluded from Windows clipboard history and cloud sync, and cleared automatically |
| Idle | The DEK is dropped and the window locks after inactivity |

The AAD binding is the part worth understanding. A ciphertext carries its own
address, so moving an encrypted password from one row or column to another makes
it fail to decrypt rather than silently authenticate as the wrong secret.

## What it does and does not defend against

**It defends against** someone taking the database file, the drive, or a backup:
without the passphrase the contents are unreadable, and a modified file is
rejected rather than partially trusted.

**It does not defend against** a compromised Windows account while the vault is
unlocked. Malware running as you can read decrypted fields out of the process,
log your keystrokes, or capture the screen. No desktop vault solves this —
Sanctum reduces the window by locking on idle and keeping keys out of swap-prone
structures, but it cannot eliminate it.

Website icons are **off by default**: fetching a favicon tells a third party
which sites you hold credentials for. Turning it on is a deliberate choice.

## Honest limitations

- **Unaudited.** The primitives are standard and the constructions are
  conventional, but no third party has reviewed them.
- **Unsigned.** Installers carry no Authenticode signature, so Windows
  SmartScreen will warn. Build from source if that matters to you.
- **No sync, by design.** Your vault exists on one machine. Take backups.
- **Windows only.** The clipboard protections use Windows-specific formats.

## Running it

Requires [Rust](https://rustup.rs), the Visual Studio Build Tools with the MSVC
C++ workload, Node 20+, and WebView2 (present on Windows 11).

```bash
npm install
npm run tauri dev      # development
npm run tauri build    # installer -> src-tauri/target/release/bundle
```

## Tests

```bash
cargo test --all-features --manifest-path src-tauri/Cargo.toml   # 185 tests
npm run test                                                     # 51 tests
npm run typecheck && npm run lint
```

The crypto tests cover round trips, wrong-key rejection, AAD mismatch, recovery
code derivation and passphrase rotation. The clipboard test exercises the real
Windows clipboard rather than a mock — an earlier version read the sequence
number before closing the clipboard, so auto-clear could never fire, and only a
live test caught it.

## Layout

```
src/            React front end, one directory per feature
src-tauri/
  src/crypto/   KDF, KEK/DEK, AEAD, recovery codes, generator
  src/vault/    Schema, migrations, encrypted store, entities
  src/backup/   Encrypted .sanctumbak containers, CSV export
  src/commands/ The IPC surface
docs/           Packaging and visual reference
```

## License

Copyright (c) 2026 Sanctum. **All rights reserved.**

This source is published for inspection — which matters for a security tool —
but it is not open source. No permission is granted to use, copy, modify or
distribute it. Get in touch if you need different terms.
