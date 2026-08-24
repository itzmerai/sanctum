# Sanctum — Visual Grounding (from 32 reference screenshots)

Extracted from the 32 reference screenshots (kept outside this repo at `C:devsanctum.claude	auri`).
deferred to implementation: matched close (KTD7) against the screenshots during the shell unit (U8)").

Fidelity bar is KTD7 **close match**: layout/components/flows replicate exactly; colour and spacing values
below are read off the screenshots and are approximations where the images don't reveal them.


---

## 1. Screenshot index

| # | File (`Screenshot 2026-08-22 …`) | Screen / state | Feeds |
|---|---|---|---|
| 1 | `221310` | Lock screen, unlocking ("Working…") | U4 |
| 2 | `221324` | Dashboard, sidebar expanded | U20, U8 |
| 3 | `221354` | Dashboard, sidebar collapsed to icon rail | U8 (R14) |
| 4 | `221412` | Dashboard, sidebar fully hidden | U8 (R14) |
| 5 | `221437` | Vault — list view | U9 |
| 6 | `221448` | Vault — grid view, card hover actions | U9 |
| 7 | `221519` | Credential detail modal | U9 (R21) |
| 8 | `221531` | New credential modal, empty | U10 |
| 9 | `221615` | New credential, filled + strength "Excellent" | U10 (R22) |
| 10 | `221628` | Notes — empty right pane | U14 |
| 11 | `221641` | Notes — note selected, editor + toolbar | U14 |
| 12 | `221658` | Notes — new note, title being typed | U14 |
| 13 | `221718` | Notes — note with body content | U14 |
| 14 | `221749` | Notes — overflow menu open | U14 (R27) |
| 15 | `221759` | Notes — "Move to folder" modal | U14, U18 |
| 16 | `221813` | Tasks — grouped list | U15 |
| 17 | `221827` | Task detail modal | U15 (R29) |
| 18 | `221859` | Calendar — Month view + right rail | U16 |
| 19 | `221914` | Calendar — Year view | U16 (R31) |
| 20 | `221946` | Calendar — Year view (scrolled) | U16 |
| 21 | `221956` | Income — entry detail modal | U17 |
| 22 | `222009` | Income — "Log income" form | U17 (R32) |
| 23 | `222028` | Folders — grid, Passwords tab | U18 |
| 24 | `222104` | Folders — overflow menu open | U18 (R33) |
| 25 | `222120` | Favorites — Folders filter | U18 (R34) |
| 26 | `222138` | Generate Password | U11 (R25) |
| 27 | `222158` | Activity Log | U19 (R35) |
| 28 | `222210` | Settings — Account | U21 (R36) |
| 29 | `222224` | Settings — Appearance **(dark theme)** | U21 (R37) |
| 30 | `222242` | Settings — Security | U21 (R38) |
| 31 | `222306` | "Your recovery code" modal | U4/U5 (R5, R12) |
| 32 | `222321` | Settings — Data | U21 (R39) |

Screens **not** captured (reconstruct to the established system, per plan Dependencies/Assumptions):
first-run setup flow, Calendar **Week** view, Income list/table, Folders **list** view, Folders **Notes**
tab, Favorites credential/note filters, Settings **About**, command-palette (⌘K) open state.

---

## 2. Typography

The reference uses a **two-family split** — this is the single most identity-defining detail:

- **Monospace** for all structural / identity text: wordmark, page headings, card titles, entity names,
  field **labels** (uppercase, tracked), table column heads, buttons, nav items, numerals, badges, code.
- **Sans-serif** for prose only: page subtitles, help text, descriptions, note body copy, empty states.

```css
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
--font-sans: "Inter", ui-sans-serif, "Segoe UI", system-ui, sans-serif;
```

Scale (Medium = default; Small ×0.9, Large ×1.1 per R37):

| Token | px | Family | Used for |
|---|---|---|---|
| `--fs-page-title` | 22 | mono 500 | "Vault", "Calendar", "Settings" |
| `--fs-greeting` | 24 | mono 500 | "Good evening, REN." |
| `--fs-section` | 15 | mono 500 | "Income Activity", "World Clocks" |
| `--fs-body` | 13.5 | sans 400 | subtitles, descriptions |
| `--fs-item` | 13.5 | mono 500 | credential/note/task names |
| `--fs-label` | 10.5 | mono 500, `letter-spacing:.09em`, uppercase | `USERNAME / EMAIL`, `MODULES` |
| `--fs-meta` | 11.5 | sans 400 | timestamps, "2 items", relative time |
| `--fs-stat` | 26 | mono 500 | stat-card counts, `3/3` |

---

## 3. Colour — light theme (default)

```css
--bg-titlebar:  #0d0d0f;  /* custom dark chrome, spans full width */
--bg-app:       #f6f6f5;  /* page canvas, slightly warm */
--bg-sidebar:   #fbfbfa;
--bg-surface:   #ffffff;  /* cards, modals, inputs-on-white */
--bg-input:     #f2f2f0;  /* filled/placeholder inputs inside modals */
--bg-hover:     #f0f0ee;
--bg-active:    #eaeae8;  /* selected sidebar item, selected list row */

--border:       #e7e7e4;
--border-strong:#d8d8d4;

--text:         #19191a;
--text-muted:   #8b8b86;
--text-faint:   #a8a8a3;
--text-oncolor: #ffffff;
```

**Dark theme** (screenshot 29):

```css
--bg-titlebar:  #0d0d0f;  /* unchanged */
--bg-app:       #1b1c1e;
--bg-sidebar:   #17181a;
--bg-surface:   #232426;
--bg-input:     #2b2c2f;
--bg-hover:     #2a2b2e;
--bg-active:    #313236;
--border:       #303134;
--text:         #e9e9e6;
--text-muted:   #9a9a95;
```

### Accent palette (R37 — six named accents, 2×3 grid)

`Slate` is the default shown throughout the screenshots.

| Name | Swatch dot | Solid button | Dark-theme variant |
|---|---|---|---|
| Sage | `#7f9c72` | `#6d8a61` | `#93ae86` |
| Clay | `#c8734f` | `#b46240` | `#d98a67` |
| **Slate** *(default)* | `#4a7591` | `#37647f` | `#6fa3c4` |
| Moss | `#5f8a5a` | `#4e7749` | `#79a373` |
| Stone | `#8a8a80` | `#75756c` | `#a3a399` |
| Dusk | `#8b7bb5` | `#7869a3` | `#a595cc` |

### Semantic

```css
--warn-bg:  #fdf6e7;  --warn-dot: #e0a63c;  --warn-text: #8a6a1f;  /* "1 task overdue" callout */
--danger:   #d64550;  --danger-bg: #fdecee;                        /* Reset Vault, Delete */
--success-dot: #4a9c6d;                                            /* "Live", "Active", "Ready" */
```

Priority pills — `bg` / `text`:

| Priority | Background | Text |
|---|---|---|
| High | `#fde8ec` | `#b3384f` |
| Medium | `#fdf3dd` | `#8a6a1f` |
| Low | `#e8f3ea` | `#3d7a52` |

Folder colours (R33 colour-coded, from screenshots 23–25):
`#e8734a` orange · `#4a7fc1` blue · `#4aa86a` green · `#8b6ec9` purple
(+ extend with `#e0a63c` amber, `#d64550` red, `#8a8a80` stone for the Change-colour picker.)

---

## 4. Shape, spacing, elevation

```css
--r-card: 10px;  --r-modal: 14px;  --r-input: 8px;  --r-btn: 8px;
--r-pill: 999px; --r-icon: 8px;    /* entity favicon tile */

--sp: 4px;  /* 4/8/12/16/20/24/32 scale */

--shadow-card:  0 1px 2px rgb(0 0 0 / .04);
--shadow-modal: 0 16px 48px rgb(0 0 0 / .18);
--modal-scrim:  rgb(0 0 0 / .45);   /* + backdrop-filter: blur(2px) */
```

Geometry read off the screenshots:

- Titlebar height **~40px**; hamburger left, wordmark, centred search pill, window controls right.
- Sidebar **~232px** expanded / **~56px** icon rail / **0** hidden (three states, R14).
- Sidebar nav row: 36px high, 8px radius, full-width active fill `--bg-active`.
- Card padding **16–20px**; grid gutter **16px**; page gutter **24px**.
- Modal widths: entity detail/form **~400px**; "Move to folder" **~340px**; recovery code **~410px**.
- Inputs **~38px** high; buttons **~38px**; icon buttons **32×32**.
- Entity favicon tile **36×36**, `--r-icon`, white bg + hairline border.

---

## 5. Component notes (behaviour visible in the images)

**Titlebar** — custom (decorations off). Centre pill: magnifier + "Search" + `⌘K` kbd chip.
Wordmark is the logo glyph + "Sanctum" in mono, white on `--bg-titlebar`.

**Sidebar** — avatar (28px circle) + display name, theme toggle (moon → sun in dark) on the right.
Group labels `MODULES` / `TOOLS` in `--fs-label` `--text-faint`. Tasks row carries a count badge
(pill, `--bg-active`). Bottom group (Activity Log / Settings / Lock) is separated by a hairline and
pinned to the bottom.

**Buttons** — primary = solid accent, white mono text. Secondary = white bg + `--border`.
Destructive = solid `--danger`. The circular **`+`** (28–32px, solid accent) is the per-module create
action, top-right of the toolbar row.

**Segmented control** — Week|Month|Year and grid|list: `--bg-input` track, selected segment is
`--bg-surface` with `--shadow-card`.

**Toggles** — 36×20 pill, accent when on, `#d8d8d4` when off.

**Strength meter** — 4px full-width bar + right-aligned word label ("Excellent"). Fills accent.
Appears under the password field in the credential form and under the generated password in U11.

**Masked password** — literal `**********` in mono `--text-faint`, then eye / copy / star / ⋮ icon row.

**Overflow (⋮) menu** — white card, `--shadow-modal`, 8px radius, 13.5px mono rows with leading
16px icon; destructive row in `--danger`. Note menu: Move to folder / Add to favorites / Duplicate /
Delete note. Folder menu: Rename / Add to favorites / Change color / Delete.

**Empty states** — centred 24px outline icon in `--text-faint`, sans message, then a primary button
("+ Create note"). Tasks uses an inline "No tasks." row instead.

---

## 6. Verbatim brand strings (R1–R3 rebrand mapping)

Reference → Sanctum. Everything else is copied as-is.

| Where | Reference | Sanctum |
|---|---|---|
| Wordmark / window title | `KeepR` | `Sanctum` |
| Logo | R-in-keyhole | keyhole set in an arch/doorway (R2 — asset to produce) |
| Lock tagline | `Coded for privacy.` | unchanged (R3) |
| Lock sub-copy | `Your vault stays encrypted and private.` / `Everything stays local to your device.` | unchanged |
| Lock crypto badge | `AES-256 · Argon2id · Local-first · v2.0.0` | unchanged, version = ours |
| Lock footer L1 | `[ SYSTEM_STATUS: LOCKED ]  root@keepr:~/vault/ - NO CLOUD. NO BACKDOORS. NO COMPROMISE.` | `root@sanctum:~/vault/` |
| Lock footer L2 | `NO COMPROMISE. HAND-CODED FOR PRIVACY. ALL RIGHTS RESERVED.` | unchanged |
| Recovery code | `KEEPR-TQTSG-Q2DG3-R5A2H-9DX9H-H6F9C` | `SANCTUM-` + 5×5 Crockford base32 (R3, KTD14) |
| Auto-lock help | `Lock Keepr after this many minutes without activity.` | `Lock Sanctum after …` |
| Clipboard help | `Copied passwords clear after 30 seconds. Windows clipboard history and cloud sync can still keep their own copies outside Keepr.` | `…outside Sanctum.` — this **is** the R43 disclosure |
| Reset vault help | `Permanently delete local Keepr data on this device and return to setup.` | `…local Sanctum data…` |
| Dashboard | `Good evening, REN.` / `Here's everything across your Life OS.` | unchanged (name from R36) |
| Vault | `You have 7 credentials. Saved logins stay encrypted and organized in this local vault.` | unchanged |
| Notes | `Write markdown notes and keep them organized by folder or favorite.` | unchanged |
| Tasks | `My Task` / `You have N open tasks. Stay focused and complete them one at a time.` | unchanged |
| Calendar | `Tasks and income across your schedule.` | unchanged |
| Folders | `Keep credentials and notes grouped in color-coded folders.` | unchanged |
| Favorites | `Star folders, passwords, and notes you want close by.` | unchanged |
| Generator | `Create strong passwords and use them when saving a credential.` | unchanged |
| Activity Log | `Review local vault changes. This log never leaves this device.` | unchanged |
| Settings | `Manage account, appearance, security, backup, and reset options.` | unchanged |
| Website icons help | `Fetches site icons from DuckDuckGo. Domains may be sent, but never usernames or passwords. Turn off for full offline privacy.` | unchanged |
| Recovery modal | `Write this down and keep it somewhere safe (not in this vault). It will not be shown again. Anyone with this code and your vault files can reset your password.` | unchanged; extend per R46 (both-lost ⇒ unrecoverable) |
| Encrypted backup help | `A single protected file for backing up Keepr or moving your vault to another device.` | `…backing up Sanctum…` |

---

## 7. Deliberate divergences from the reference

Each is a plan decision, not a fidelity miss — record in the U8/U21 commit messages.

1. **Website icons default `Off`.** Screenshot 29 shows `On` selected; R24 + AE12 mandate off-by-default.
2. **CSV: export only.** Screenshot 32 shows `Export CSV` / `Template` / `Import CSV`; KTD8 drops
   Template and Import CSV for v1. Keep the "CSV files" section with `Export CSV` alone.
3. **Master-password help text.** Reference says "Changing it re-encrypts every entry with the new key."
   That is factually wrong for our design — KTD9 re-wraps the DEK; record bodies are untouched.
   Reword to match reality, and disclose the KTD9 residual risk (Scope Boundaries).
4. **Recovery-code acknowledgment.** Reference has `Copy` / `I saved it`. R46 + U4 require a *typed*
   acknowledgment, so `I saved it` stays disabled until the user types a confirmation phrase.
5. **Master-password strength floor.** Not visible in the reference; KTD21 requires zxcvbn ≥ 3 and
   ≥ 12 chars, surfaced by a meter at setup and at change (R44).
