# Plan: SQLite as single source of truth for RTWiki settings

**Status:** implementation plan, approved in principle. Not yet implemented.
**Audience:** the implementing agent (starts fresh — this file is the authoritative brief).

---

## 0. Instructions to the implementing agent (read first)

1. **Follow this plan exactly.** Do not improvise, expand scope, or "improve" the design.
2. **Stop and ask** if the code does not match what this plan says. Do not guess, do not work around a mismatch, do not silently choose an alternative. Report the exact file and line where reality diverges and wait for an answer.
3. **Documentation-only boundaries do not apply here** — this is an implementation task. But stay strictly inside the file scope in §4. Do not touch unrelated files, the user's uncommitted `bun.lock`/`package.json`, or untracked docs.
4. **When you finish, report which tests passed**, explicitly naming:
   - the three new **shell (Rust) tests** (off-screen geometry, restore-swap read safety, close-speed under DB busy), run with `cargo test` from `src-tauri/`,
   - the shell's half of the interop test (also a Rust test, same command),
   - the full end-to-end test (fresh start → change port → restart → new port used), run with `bun test`,
   - the backup-restore-settings test and the full existing suite result.
   Do not claim a test passed unless you actually ran it. A test that checks shell code must be a real Rust test in `src-tauri/`, not a stand-in in the app's test folder.
5. Use a dedicated branch. Do not commit unless separately authorized. Report branch and files changed.

---

## 1. Objective and exact phase boundaries

Move all persistent settings from JSON files into the existing SQLite database. The **server owns the DB**; the **shell reads fresh at point of use** with a short timeout and a remembered-value fallback; the **shell writes only window geometry**, best-effort.

**In scope:** settings storage, bootstrap order, shell settings access, geometry persistence, new migration with defaults only, tests, docs.
**Out of scope (do not do):**
- No import of old JSON settings, no deletion of JSON files, no upgrade path. Old JSON files become unused and are left untouched. This is deliberate: there is nothing to move, and deleting files is the one step that could destroy data.
- No `refresh_settings_cache` command (replaced by fresh-read-with-fallback).
- No replacement of the `restart-requested` / `shutdown-requested` flag files — they are IPC signals, not settings.
- No change to the damaged-DB abort policy.
- No new server, no second DB, no provider/AI/M6 work, no unrelated refactoring.

---

## 2. Verified implementation baseline (confirmed by reading the code)

| Fact | Evidence |
|---|---|
| Server owns SQLite via `bun:sqlite` | `src/server/bootstrap.ts:291` `initDatabase(dataDir)` |
| Port read at line 184, DB opens at 291 | `src/server/bootstrap.ts:184,291` |
| Shell reads port + close behavior from JSON before spawning server | `src-tauri/src/sidecar.rs:75,91` |
| Damaged DB aborts startup (no default fallback) | `bootstrap.ts:296-299` throws; `src-tauri/src/main.rs:376` fatal dialog |
| First launch uses default port | `tests/server-settings.test.ts:81` |
| Respawn re-reads port via `configured_port()` | `src-tauri/src/main.rs:290` |
| Restore closes DB, renames DB+WAL+SHM aside, copies backup in | `src/server/backup/restore-service.ts:130-167` |
| Restore validation checks `_migrations` both directions | `src/server/backup/validation.ts:111-120` |
| `geom::apply()` blindly applies saved position; no monitor check | `src-tauri/src/geom.rs:83-96` |
| SQLite version in bun:sqlite = 3.54.1 | `bun -e "select sqlite_version()"` → `3.54.1` (Bun 1.4.5). This is **Bun's** SQLite only; `rusqlite` links its own version — see §7. |

---

## 3. Design

### 3.1 Storage

Migration `012_create_settings` creates one table, **defaults only — no JSON import, no file deletion**:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Keys: `server.port`, `desktop.closeBehavior`, `desktop.rememberCloseChoice`, `backup.slots`, `window.geometry`. Each value is a JSON scalar/object. One table, one source of truth.

### 3.2 Server owns the DB

Rewrite `src/server/settings/index.ts` to read/write through `getDb()` instead of JSON files. Keep the existing validation and defaults. **Per-key validation:** each key is validated independently; an invalid value resets only that key to its default, leaving all others intact.

### 3.3 Bootstrap order

Move `initDatabase()` + `runMigrations()` **before** the port read at `bootstrap.ts:184`, so `readServerPort()` reads from the DB. This is the only structural change to startup sequencing.

### 3.4 Shell reads fresh at point of use (no IPC dependency)

Add pinned `rusqlite` to `src-tauri/Cargo.toml`.

- `ShellState` holds last-known values for port and close behavior, seeded at startup from the DB or defaults.
- `sidecar::configured_port()` and `sidecar::close_behavior()` open a **short-timeout read-only** connection (e.g. `busy_timeout = 250ms`), read the current value, update the in-memory value on success, and **fall back to the remembered value on any failure** — busy, locked, missing table, missing DB, or a file mid-swap.
- No `refresh_settings_cache` command. A port change is picked up on the next respawn (`main.rs:290` already re-reads); close behavior is read fresh on every close.
- **Restore-swap safety:** before opening, check the DB file exists; if absent or the read fails, return the remembered value — never panic, never crash. See §6.2 test.

### 3.5 Shell writes only window geometry, best-effort

`window.geometry` lives in the settings table. The shell uses a write connection with `busy_timeout`. Every geometry write (throttled move/resize and the close-time save) is best-effort: on any error, log at debug and skip. It must never block or delay close. See §6.3 test.

### 3.6 First launch

No DB file → shell uses `DEFAULT_PORT`, spawns server; server creates DB and migration `012` seeds defaults. App opens normally.

### 3.7 Damaged DB

Keep the current abort policy. Update the fatal message to point at `data/backups/` explicitly. No silent fallback to defaults on corruption.

### 3.8 Off-screen window after restore

`geom::apply()` must validate the saved rect against the current monitors (Tauri `available_monitors()`). If the saved position does not intersect any monitor meaningfully, ignore the saved position and let the OS place the window (or center it). See §6.1 test.

### 3.9 Backup restore — deliberate choice

**Decision: restoring a backup restores the settings stored in it, including port and window position.** Rationale: a backup is a full workspace snapshot (`VACUUM INTO` of the whole DB); settings are part of that snapshot. Preserving current settings would require reading them before restore and re-applying after — extra code and a new failure mode. Document this in `docs/BACKUP_PLAN.md` and assert it with a test (§6.5). Note: restore validation rejects backups missing required migrations, so only backups taken after `012` can be restored — there is no "old settings" surprise from pre-012 backups.

**What the user sees if the backup's port differs:** the restore response/UI must state that a restart is required for the restored port to take effect (the server keeps listening on the current port until restart; the shell reads the restored port on next launch). This is the same "close and reopen" notice the restore flow already gives, now explicitly covering the port.

### 3.10 Concurrent read safety

SQLite WAL (official docs) allows readers in separate processes while a writer is active; each reader sees a consistent snapshot. The shell's read-only connection with `busy_timeout` is safe. Verify with the interop test (§6.4).

---

## 4. Exact file scope

| File | Change |
|---|---|
| `src/server/database/migrations.ts` | Add `012_create_settings` (defaults only) |
| `src/server/settings/index.ts` | Rewrite to DB-backed reads/writes; per-key validation |
| `src/server/bootstrap.ts` | Move DB init + migrations before port read |
| `src/server/routes/settings.ts` | Inject `getDb` instead of `dataDir` |
| `src-tauri/Cargo.toml` | Add pinned `rusqlite` |
| `src-tauri/Cargo.lock` | Updated by Cargo when `rusqlite` is added (commit the resolved lockfile) |
| `src-tauri/src/sidecar.rs` | Fresh DB reads with timeout + remembered fallback; geometry write |
| `src-tauri/src/main.rs` | In-memory last-known values; best-effort geometry; updated fatal message |
| `src-tauri/src/geom.rs` | Geometry to settings table; off-screen position validation |
| `src/shared/constants/index.ts` | Add setting keys |
| `tests/server-settings.test.ts` | Adapt to DB-backed settings |
| `tests/settings-e2e.test.ts` | New: fresh → change port → restart → new port used |
| `tests/sqlite-interop.test.ts` | New: server+shell same-file, concurrent read/write |
| `tests/backup-restore-settings.test.ts` | New: restore brings back settings |
| `src-tauri/src/geom.rs` (Rust `#[cfg(test)]` module) | New: off-screen saved position is rejected — **shell test, run with `cargo test`** |
| `src-tauri/src/sidecar.rs` (Rust `#[cfg(test)]` module) | New: shell read during restore swap falls back, no panic — **shell test, run with `cargo test`** |
| `src-tauri/src/main.rs` (Rust `#[cfg(test)]` module) | New: close path bounded under DB busy — **shell test, run with `cargo test`** |
| `docs/BACKUP_PLAN.md`, `docs/adr/ADR-005`, `docs/adr/ADR-011`, `AGENTS.md` | Update storage + restore claims |
| `docs/HANDOVER.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/rtwiki-uiux.md` | Update stale JSON-settings / drag-backdrop claims (audit M3, L1, L2) |

Do not modify any file not listed above without asking first.

---

## 5. Implementation order

1. Migration `012` (defaults only) + DB-backed settings service + unit tests.
2. Bootstrap reorder; verify first launch and damaged-DB abort.
3. Rust shell: `rusqlite`, fresh-read-with-fallback, best-effort geometry write, off-screen validation.
4. Backup-restore settings behavior + test.
5. Interop/concurrent test, restore-swap test, close-speed test, E2E port-change-restart test.
6. Docs + `bun scripts/verify-docs.ts`.

---

## 6. Required focused tests

**Test placement rule:** any test that checks the desktop shell's own code (geometry, DB read, close path) must be a Rust test inside `src-tauri/` and run with `cargo test` from `src-tauri/`. It cannot run from the app's `tests/` folder (which is `bun test`). Do not write a weak stand-in in `tests/` and do not claim a shell test passed unless `cargo test` actually ran it.

### 6.1 Off-screen geometry — shell test (`src-tauri/src/geom.rs`, `cargo test`)
Saved position outside all current monitors → `geom::apply()` ignores it; window is placed on-screen.

### 6.2 Restore-swap read safety — shell test (`src-tauri/src/sidecar.rs`, `cargo test`)
Open the DB with the shell's read path while a restore swap (rename aside + copy in) happens. Assert: returns an error that triggers the remembered-value fallback; **no panic, no crash**. If `rusqlite` cannot be made safe here, the shell must check file existence before opening and skip the read during the swap window.

### 6.3 Close speed under DB busy — shell test (`src-tauri/src/main.rs`, `cargo test`)
Hold a write lock on the DB (or set `busy_timeout` high) and assert the close path returns within a bounded time using the remembered value. Proves the short timeout + fallback keeps close fast.

### 6.4 Interop / concurrent — two halves, two commands
- **Shell half (Rust, `src-tauri/`, `cargo test`):** open the DB with `rusqlite` read-only; read settings; write geometry from Rust; read it back. Server writes settings in a loop while the shell reads — no errors, no torn values, no corruption. This proves both SQLite builds interoperate on one WAL file.
- **Server half (`tests/sqlite-interop.test.ts`, `bun test`):** create the DB with `initDatabase` + `runMigrations`; write settings from the server while the shell-side reader runs; assert no errors or corruption.

### 6.5 Backup-restore settings (`tests/backup-restore-settings.test.ts`)
Restore a post-012 backup; assert port and window geometry from the backup are in effect. Documents the deliberate choice.

### 6.6 End-to-end (`tests/settings-e2e.test.ts`)
Fresh temp data dir → bootstrap → change port via `PUT /api/settings/server` → simulate restart (close DB, re-bootstrap with shell-style port read) → assert new port is used. This is the integrated flow currently missing.

---

## 7. Known risks (do not hide these)

- **Bootstrap reorder** (DB init before port read) — covered by first-launch and E2E tests.
- **Concurrent read/write between two SQLite builds** — Bun uses 3.54.1; `rusqlite` links its own version via `libsqlite3-sys`. The file format is stable and WAL is cross-version, but this must be proven by §6.4, not assumed.
- **Restore swap window** — the DB file is briefly absent/mid-rename; §6.2 must prove the shell falls back safely.
- **Off-screen geometry** — §6.1 must prove the window is recoverable after a restore from a different monitor setup.

---

## 8. Acceptance criteria

- Fresh launch, no DB → default port, server creates DB, app opens.
- Damaged DB → clear fatal message pointing to backups; no silent fallback.
- Port change → next respawn reads new port from DB (fresh read, no IPC dependency).
- Close behavior change → next close reads fresh from DB; if DB busy, uses remembered value.
- Invalid single setting → only that key resets.
- Geometry write failure → skipped quietly; close never blocks (§6.3).
- Saved off-screen position → window placed on-screen (§6.1).
- Shell read during restore swap → remembered value, no crash (§6.2).
- Server and shell both read/write same DB file; concurrent read during server write is safe (§6.4).
- Restore brings back settings including port/geometry — asserted (§6.5); if the restored port differs, the UI states a restart is required.
- E2E: fresh → change port → restart → new port used (§6.6).
- All existing tests pass; no regression in close behavior or backup scheduling.

---

## 9. Failure cases and security

- DB busy on read → short timeout → remembered value fallback.
- DB busy on geometry write → skip, never block close.
- DB missing → default port; server creates DB.
- DB corrupt → abort with backup-pointing message.
- Untrusted values → per-key validation, parameterized queries.
- Flag files → remain files.

---

## 10. Non-goals

- No JSON import/deletion, no upgrade path, no data destruction.
- No `refresh_settings_cache` command.
- No flag-file replacement, no damaged-DB policy change.
- No new server/DB, no M6/provider/AI work, no unrelated refactoring.
