# Packaging and signing (U22)

## Building

```powershell
npm run tauri build
```

Produces an NSIS installer at
`src-tauri/target/release/bundle/nsis/Sanctum_<version>_x64-setup.exe`.

The release profile uses `lto = true`, `codegen-units = 1`, `opt-level = "s"`,
`panic = "abort"` and `strip = true`, so the first build is slow and the binary
is small. Argon2id is also **dramatically** faster here than in a debug build —
a debug unlock can take tens of seconds where the release build hits its
~750 ms calibration target (KTD11).

## WebView2

`webviewInstallMode` is `downloadBootstrapper`, which keeps the installer small
and fetches the WebView2 runtime only if the machine lacks it.

The alternative is `offlineInstaller`, which embeds the whole runtime:

```json
"webviewInstallMode": { "type": "offlineInstaller" }
```

That adds roughly 130 MB. Windows 11 and current Windows 10 ship WebView2
already, so for nearly every user that would be dead weight — but it is the
right choice for an air-gapped or locked-down target, and it is a one-line
change.

This is the one place Sanctum's installer can touch the network. The
application itself still makes no request unless website icons are turned on
(R24, off by default).

## Signing

The repository is **not** configured to sign locally. There is no certificate
committed and none referenced, so `npm run tauri build` produces an unsigned
installer that Windows SmartScreen will warn about on first run.

### With a purchased certificate (CI)

Add these repository secrets and the `bundle` job signs automatically:

| Secret | Contents |
|---|---|
| `WINDOWS_CERTIFICATE` | the `.pfx`, base64-encoded |
| `WINDOWS_CERTIFICATE_PASSWORD` | its password |

The workflow decodes the certificate to a temp file, imports it, reads the
thumbprint, and patches `tauri.conf.json` before building. When the secrets are
absent the job skips signing and still uploads an unsigned installer, so forks
and ordinary branch pushes keep working.

### With a self-signed certificate (personal use)

A self-signed certificate does not remove the SmartScreen warning for anyone
else, but it does let you verify the binary you built is the binary you are
running, and it exercises the signing path.

```powershell
# Create it (no admin needed - CurrentUser store)
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Sanctum" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -KeyUsage DigitalSignature `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears(3)

$cert.Thumbprint   # paste into tauri.conf.json -> bundle.windows.certificateThumbprint
```

Then add to `src-tauri/tauri.conf.json` under `bundle.windows`:

```json
"certificateThumbprint": "<thumbprint>"
```

To have Windows *trust* it on this machine (this one **does** need admin):

```powershell
Export-Certificate -Cert $cert -FilePath sanctum.cer
Import-Certificate -FilePath sanctum.cer -CertStoreLocation Cert:\LocalMachine\Root
```

Do not commit the thumbprint if the repository is public — it is not secret,
but it invites confusion about which key is authoritative.

## Verifying a build

```powershell
# Signature (if signed)
Get-AuthenticodeSignature .\Sanctum_0.1.0_x64-setup.exe | Format-List Status, SignerCertificate

# What the installer contains
& "C:\Program Files (x86)\Windows Kits\10\bin\<ver>\x64\signtool.exe" verify /pa /v .\Sanctum_0.1.0_x64-setup.exe
```

## Manual smoke checklist

These need a person and a real Windows session. None of them are covered by
the automated suite, and the Definition of Done is not met until they pass.

- [ ] Installer runs on a clean Windows target; app title and taskbar icon read
      **Sanctum**
- [ ] First run shows setup; the recovery code appears once and cannot be
      dismissed without typing the acknowledgment (R46)
- [ ] Unlock takes roughly a second, not tens of seconds (release Argon2id)
- [ ] Add a credential, copy its password, then press **Win+V** — the value must
      **not** appear in clipboard history (R10, KTD16)
- [ ] Wait 30 seconds after a copy and paste — the clipboard must be empty
- [ ] Copy from another application within the 30 seconds — Sanctum must **not**
      wipe it (R43)
- [ ] Leave the app idle past the auto-lock window; it returns to the lock
      screen and the vault genuinely re-derives on unlock (R9)
- [ ] Change the master password, then unlock with the new one and confirm every
      record still opens (R11)
- [ ] Export a backup, Reset Vault, restore it, and confirm the records return
      (R45, AE8)
- [ ] Corrupt a byte of a `.sanctumbak` in a hex editor and try to restore — it
      must be refused and the live vault untouched (AE10)
- [ ] Export CSV, then check its file permissions grant only your account
- [ ] Turn website icons on, add a credential with a website, and confirm with a
      network monitor that only the domain is requested (AE4); turn it off and
      confirm no request at all (AE12)
