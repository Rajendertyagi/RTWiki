# Backup and Restore — Implementation Plan

**Status:** ready to build. Nothing implemented.
**Branch at time of writing:** `docs/security-claims` @ `bc790b8`
**Related:** [BACKUP_RESEARCH.md](BACKUP_RESEARCH.md) · [SECURITY.md](SECURITY.md) §8 · [ADR-005](adr/ADR-005-portable-data-layout.md)

---

## 1. Objective

Give RTWiki a backup and restore capability, built on one SQL statement, with restore
validation strict enough that a bad file cannot destroy a working wiki.

Today: **no backup or restore feature exists.** `data/backups/` is created at startup and
stays empty. A disk failure or an accidental deletion is currently unrecoverable.

## 2. Non-goals

Explicitly **not** in scope, so they are not re-litigated:

- **A hand-rolled chunked file copy with a progress bar.** Rejected. Disabling
  `wal_autocheckpoint` around a copy risks leaving it disabled if the process is killed,
  after which the WAL grows without bound. `VACUUM INTO` is immune.
- **Encryption.** Decided against. No passphrase, no OS keyring, no "encrypted or local"
  fallback rule.
- **A restart or relaunch mechanism.** None exists (see §7.2). Restore asks the user to
  reopen the app.
- **A global write lock around backups.** Not needed (see §5.4).
- **Including `data/attachments/` in a backup.** Refused, not included (see §6.3).
- **A manifest file.** The database records its own schema in `_migrations`.

## 3. The mechanism

`VACUUM INTO` — a single SQL statement against the live database.

Chosen over the alternatives, all of which were measured on this machine:

| Approach | Result | Verdict |
|---|---|---|
| Copy the file while running | **Whole table gone**, `integrity_check` still `ok` | Unusable |
| `node:sqlite` `backup()` | Correct, with progress | Correct but needs a second driver; `bun:sqlite` has no `backup()`. Not adopted — [ADR-002](adr/ADR-002-bun-hono-sqlite.md) chose `bun:sqlite` |
| Chunked copy + checkpoint | Correct, 1 ms checkpoint | Rejected, see non-goals |
| **`VACUUM INTO`** | **Correct, no lock on source, compacts, purges deleted content** | **Adopted** |

### 3.1 Why not a plain file copy

RTWiki runs SQLite in WAL mode, where recent writes live in a `-wal` sidecar. Measured:

```
copy integrity_check : ok
copy sees the table  : ERROR - no such table
live sees the table  : 1
```

The copy passes every health check and is missing committed data. This is the single
strongest reason the mechanism is not a file copy, and it is why
`docs/SECURITY.md` §8.1 exists.

### 3.2 What `VACUUM INTO` gives us beyond correctness

Measured, on two functionally identical databases after deleting a row:

```
plain copy   : still holds the deleted text   40,960 bytes
VACUUM INTO  : does not                        8,192 bytes
both         : open cleanly, 1 row, integrity_check = ok
```

A deleted paragraph is **genuinely absent** from a backup. For a private-notes wiki
that is a deliberate property and must be documented, not left to chance (§10).

### 3.3 Rowids are not preserved — a footnote, not a demonstrated risk

SQLite documents that *"the `VACUUM` command may change the ROWIDs of entries in any tables
that do not have an explicit `INTEGER PRIMARY KEY`."* `VACUUM INTO` works the same way.

RTWiki's `pages` table is `id TEXT PRIMARY KEY` (`migrations.ts:19`), so it is a rowid
table and **rowids may be renumbered by a backup**. The only two `INTEGER PRIMARY KEY`
declarations in the schema are both `_migrations` (`:12`, `:430`).

**Five queries tie-break on it:**

| Site | Tie-break | Surface |
|---|---|---|
| `page-repository.ts:365` | `ORDER BY p.updated_at DESC, p.rowid DESC` | search results |
| `page-repository.ts:382` | `ORDER BY updated_at DESC, rowid DESC` | page list |
| `page-repository.ts:430` | `ORDER BY position, rowid` | **root ordering** |
| `page-repository.ts:435` | `ORDER BY position, rowid` | **sibling ordering** |
| `migrations.ts:67` | `p2.rowid > pages.rowid` | fts sync, inside a one-time migration |

**Not counted, deliberately:** `migrations.ts` sets `content_rowid='page_id'` on the
`search_index_fts` virtual table, which tells FTS5 to key on the `page_id` column *instead
of* the table rowid. It is recorded here only because it is the one rowid dependency in the
schema. **It insulates nothing, because that table is never queried** — the live search path
is `si.title LIKE ? OR si.content LIKE ?` joined on an explicit `page_id` column, which is
independent of the rowid of both tables. `migrations.ts` and `page-repository.ts` comments are
comments.

#### 3.3.1 Not enforced by the schema…

```sql
CREATE INDEX idx_pages_parent_position ON pages(parent_id, position) WHERE deleted_at IS NULL
```

A plain `CREATE INDEX`, not `UNIQUE`. The only `UNIQUE` constraints in the schema are
`migrations.name` (`migrations.ts:13`, `:431`) and `attachments.stored_name` (`:163`, since
dropped by migration `008_drop_stored_name`). **Nothing enforces `(parent_id, position)`.**

So a tie is *possible in principle*. That is a statement about the schema, not about
behaviour.

#### 3.3.2 …but not reachable through any path found

**Every writer of `position` sits inside a real `BEGIN IMMEDIATE` transaction.** Mapped by
enclosing function, not by proximity — an earlier draft of this table paired writers with
transactions by line distance and got four of five wrong.

| Writer | Enclosing function | Transaction opens at |
|---|---|---|
| `page-repository.ts:187` — shift siblings on insert | `duplicatePage` (175–223) | `:184` |
| `page-repository.ts:237`, `:246` — soft delete, reindex | `softDeletePage` (224–263) | `:229` |
| `page-repository.ts:310` — restore a soft-deleted page | `restorePage` (279–332) | `:288` |
| `page-repository.ts:443` — `UPDATE pages SET position = ?` | `reindexSiblings` (441–455) | **caller** — see below |
| `page-service.ts:102` — `nextChildPosition` on create | `createPage` (87–…) | `:94` |

**`reindexSiblings` is the one caller-dependent writer, and it is still protected.** It is a
**private** function; its only two call sites, `:520` and `:522`, are both inside
`movePage` (456–553), which opens its own transaction at `:462`. So the `:443` update does
run under a real write lock — opened one frame up the stack, not at the statement.

**Two lines in this file mention `BEGIN IMMEDIATE` and are not lock acquisitions:**

- `page-repository.ts:412` — a section comment reading *"All structural mutations run on the
  ambient connection inside a `BEGIN IMMEDIATE`…`COMMIT`/`ROLLBACK` transaction opened by the
  caller."* It sits in the header of the "Hierarchy primitives" block (410–413), not in code.
- `page-service.ts:121` — a doc comment on `movePage`, describing the lock `movePage` itself
  takes at `page-repository.ts:462`.

Neither appears in the table above, and neither should: listing a comment as a transaction
site conflates a documented invariant with an acquired lock.

**The residual fragility is real, and it is not `reindexSiblings`.** The invariant at
`:410-413` is **documented but not enforced** — nothing stops a future *exported* hierarchy
function from relying on that comment and being called outside a transaction. `movePage`
satisfies the rule internally; a new sibling function might not. This is pre-existing,
independent of backup, and is why §3.3.5 carries it forward.

The create path is protected three times over, and says so in prose:

```ts
// src/server/services/page-service.ts:87-102
export function createPage(db: Database, input: CreatePageInput): Page {   // synchronous
  // Parent validation and position allocation share one write transaction so
  // concurrent creates serialize into distinct sibling positions.
  db.run('BEGIN IMMEDIATE')
  ...
  const position = repo.nextChildPosition(db, input.parentId ?? null)
  const page = repo.createPage(db, id, ..., { parentId, position })   // adjacent, no await
```

1. `BEGIN IMMEDIATE` takes SQLite's write lock, so a second writer **blocks** rather than
   reading a stale `MAX(position)`. This holds across connections, not merely across
   JavaScript.
2. `createPage` is **synchronous** — adjacent lines with no `await` between them, so
   JavaScript cannot suspend in the gap. The same argument §5.4 uses to rule out a global
   write lock applies here with the same force.
3. The comment states the intent, so a future editor sees the constraint instead of
   re-deriving it.

**A claim an earlier draft of this plan made is withdrawn.** It stated that the create path
was unprotected, citing `page-repository.ts:61-66`. That was wrong twice over: `:61-66` is
the *insert*, which receives `position` as a parameter and computes nothing, and it executes
inside the transaction opened at `page-service.ts:94`. The allocation is
`nextChildPosition` (`page-repository.ts:77-80`), a separately exported function called from
within that transaction.

#### 3.3.3 What was measured, and what the measurement is worth

```sql
SELECT parent_id, position, COUNT(*) c FROM pages
 WHERE deleted_at IS NULL GROUP BY parent_id, position HAVING c > 1
```

Against **two** databases in the working tree:

| Database | Pages | Duplicate `(parent_id, position)` | Groups sharing an identical `updated_at` |
|---|---|---|---|
| `data/rtwiki.sqlite` | 6 | **0** | **0** |
| `build/server/data/rtwiki.sqlite` | 19 | **0** | **0** |

**Twenty-five pages in total.** This is not evidence at scale and is not presented as such.
Both databases are test residue, and the reliable check is the same query against a real
wiki, which does not exist yet.

**A second claim is also withdrawn.** An earlier draft cited `migrations.ts:67` as
corroboration — "you do not preserve a tie-break that never fires". That line sits inside a
**one-time data migration** preserving order for a data fix. It is weak evidence about live
query behaviour, and may have been defensive.

#### 3.3.4 Net effect

**Not demonstrated. Accepted by tolerance, not by measurement.**

- **Content is never lost.** No page, text or attachment is at risk on any path.
- **No reachable path produces a tie today** — three independent guards, plus a
  zero-result query on a small database.
- **If a tie ever existed**, the affected pages could return in a different relative order
  after a restore, because rowid is exactly the tie-break. Cosmetic, not loss.
- **The residual risk is future code, not current code.** The index is not `UNIQUE`, so
  nothing stops a new unprotected writer from creating ties.

**Not fixing it here, deliberately.** A `UNIQUE` index on
`(parent_id, position) WHERE deleted_at IS NULL` would make the tie-break unreachable by
construction — but it **would fail on any existing database already holding duplicates**, so
it needs its own migration plus a cleanup pass over real user data. Smuggling that into a
backup change is the scope creep this project keeps paying for.

#### 3.3.5 Consequences that still apply

1. **The round-trip test (§11) must not assume order is stable.** Compare the set of page
   ids and their content, and the set of `(parent_id, position)` pairs. Assert ordering is
   monotonic in `position` **only where positions are distinct** — never positionally
   overall, and never in rowid. A positional comparison fails on a correct backup; an
   order-blind one can mask a real regression.
2. **A comment at each of the five tie-break sites** recording that the tie-break resolves
   against a rowid that `VACUUM INTO` may renumber. Cheap now; the next person to touch
   these queries will not go looking for it.
3. **The caller-opened transaction invariant at `page-repository.ts:410-413` is documented
   but not enforced.** `movePage` satisfies it internally, and `reindexSiblings` is private
   with both call sites inside that transaction — so nothing is broken today. But nothing
   stops a future *exported* hierarchy function from trusting the comment and being called
   outside a transaction, which would reintroduce a `position` tie (§3.3.1) and with it a
   possible reordering across a restore. Pre-existing and independent of backup.
   **Not fixed here on purpose:** a `db.inTransaction` guard on the hierarchy primitives is
   a behaviour change on a hot path, and it wants testing against a real wiki rather than a
   25-page test residue. The cheap half is worth doing on its own — a runtime check, or at
   minimum a note on each exported primitive saying which transaction it expects.

## 4. Files

### 4.1 New

| Path | Responsibility |
|---|---|
| `src/server/backup/backup-service.ts` | Create and list. Owns the slot logic and the `.partial` sweep. **No pruning** — the model has none (§6.2) |
| `src/server/backup/restore-service.ts` | The seven validation steps, the pre-restore swap, clean shutdown |
| `src/server/backup/validation.ts` | The validation steps as pure functions over a path, each returning a classified reason |
| `src/server/backup/schedule.ts` | Due-check and the scheduling model (§8) |
| `src/server/routes/backup.ts` | Hono routes |
| `src/web/features/settings/backup-panel.tsx` | The Backup settings panel. Conditionally rendered, following `debug-log-viewer.tsx`. See §9 |
| `src/web/features/settings/restore-confirm-modal.tsx` | Restore confirmation. **Separate from `DeleteConfirmModal`** because restore replaces the live database — see §9.3 |
| `tests/backup-service.test.ts` | Service-level, isolated temp `dataDir` |
| `tests/backup-restore-roundtrip.test.ts` | Back up → wipe → restore |
| `tests/backup-validation.test.ts` | One test per rejection reason |

### 4.2 Modified

| Path | Change |
|---|---|
| `src/server/config/index.ts` | **No change.** `BACKUPS_DIR` is already exported. It exports only `AppConfig`, `CreateConfigOverrides`, `createConfig`, `RuntimePaths`, `resolveRuntimePaths`, `joinPaths`, `dirname` — nothing settings-related |
| `src/server/settings/index.ts` | The backup settings accessors, **beside the existing port ones** at `:77` (`readServerPort`) and `:85` (`writeServerPort`). The pattern lives here, not in `config/index.ts` |
| `src/server/database/index.ts` | Set `PRAGMA synchronous = FULL` (§6.1) |
| `src/server/app.ts` | Register the routes |
| `src/web/features/settings/settings-workspace.tsx` | `'backup'` added to the `Section` union (`:68`), a nav item, and the section branch. See §9.1 |
| `src/web/config/index.ts` | `UI_TEXT` entries — `settingsBackup`, slot names, confirm-modal copy, failure reasons, the reopen message. No magic strings (`AGENTS.md` §8) |

## 5. Backup creation

### 5.1 Write to a temp file, then move

`VACUUM INTO` **fails if the target exists and is non-empty** — measured,
`SQLiteError: output file already exists`, and SQLite documents that the target *"must
not previously exist, or else it must be an empty file, or the `VACUUM INTO` command will
fail with an error."* Temp-then-move is therefore **forced by the API**, not merely safer.

```
data/backups/rtwiki-backup-daily.partial     <- written
   on success:  move over data/backups/rtwiki-backup-daily
   on failure:  delete the .partial, leave the old slot untouched
```

Writing a slot in place would destroy the previous good backup exactly when backups are
already failing.

### 5.2 Sweep `.partial` at startup

"Delete on failure" does not cover a hard kill. SQLite states an interrupted
`VACUUM INTO` "might be incomplete and corrupt", so a leftover `.partial` is a
corrupt file sitting where a backup belongs. Delete every `*.partial` in
`data/backups/` at startup.

### 5.3 Windows rename behaviour — measure it

`fs.rename` over an existing file can fail with `EPERM`/`EEXIST` on Windows. **Measure
which happens** before coding around it. If it fails, delete-then-rename, or use
slot-numbered filenames.

### 5.4 No write lock is needed

All **12** `BEGIN IMMEDIATE`…`COMMIT` blocks in `src/server/` were walked — 6 in
`page-repository.ts`, 2 in `migrations.ts`, 1 in `page-service.ts`, 1 in
`schedule-service.ts` — and **none contains an `await`**. JavaScript is single-threaded
and there is no suspension point, so a timer
callback cannot interleave into a write transaction. **Do not add a global write lock** —
it would serialise autosave against a multi-second operation.

Two rules regardless:

- **Never invoke the backup from inside a transaction.**
- SQLite documents that *a VACUUM fails if there is an open transaction on the
  connection*, and that unfinalized statements typically hold a read transaction open.
  Whether this applies to `VACUUM INTO` is **not stated**. Measure it (§12). If it
  bites, use a bounded retry — an intermittent failure that presents as a flaky backup
  is the worst possible shape.

## 6. Configuration and pragmas

### 6.1 `PRAGMA synchronous = FULL`, explicitly

Never set anywhere in `src/` today. On `VACUUM INTO` it is load-bearing:

> "if the `PRAGMA synchronous` setting of the original database is NORMAL or FULL, then
> SQLite invokes `fsync()`… to sync the output database to disk after it has been
> written." — [sqlite.org/lang_vacuum.html](https://www.sqlite.org/lang_vacuum.html)

Left unset, that guarantee rests on a compile flag inside Bun's bundled SQLite, which
this project does not control. **`FULL`, not `NORMAL`** — autosave commits every 2 s so
the fsync cost is a few per second and negligible, whereas `NORMAL` in WAL mode trades
power-loss durability for throughput. The wrong trade for someone's notes. Comment says
why.

### 6.2 Three configurable slots

| Slot | Default interval | Enable flag |
|---|---|---|
| daily | 24 h | `backupDailyEnabled` |
| weekly | 7 days | `backupWeeklyEnabled` |
| monthly | 30 days | `backupMonthlyEnabled` |

Nothing hardcoded. The intervals are exposed in Settings rather than baked into the code,
which is the one deliberate departure from Trilium — it ships the same three periods with
the same flags and the same 24 h / 7 d / 30 d defaults.

**Fixed slots, overwritten. No history, no pruning.** This follows Trilium exactly, and
the owner chose it over a rolling model after the trade-off was put to them.

- Filenames are `backup-daily`, `backup-weekly`, `backup-monthly` — the period name, not a
  timestamp. Each period's backup overwrites its own.
- **There is no retention code, and none should be written.** Verified: no pruning,
  retention limit or age cutoff exists anywhere in Trilium's backup path. The only
  deletion is of the *counterpart* file extension when a format changes, which is
  container bookkeeping, not retention.
- Bounded at three files forever, with nothing to configure and nothing to get wrong, and
  each period can never overwrite another.

**The known cost, recorded rather than argued:** a mistake that persists across a backup
window — a week of notes deleted by accident, for instance — will be captured in the next
backup of that period and will overwrite the last good copy. There is no earlier version
to roll back to. The owner is aware of this and chose the simpler model.

Defence against it is outside the backup feature: a `pre-restore` copy (§7.3) before any
restore, and the fact that a **restore is always user-initiated**, so a bad daily is
noticed by being restored rather than by the backup itself failing.

### 6.3 Refuse on a mid-migration database

If any `attachments` row has `data IS NULL`, bytes also sit in `data/attachments/` and a
one-file backup would miss them. Such a database is mid-migration and resolves on next
boot. **Refuse loudly** rather than making the backup two-part and doubling the restore
path. Never silently omit.

```sql
SELECT COUNT(*) FROM attachments WHERE data IS NULL
```

### 6.4 Container: a bare `.sqlite` file — decided

**No archive. No zip. No new dependency.**

This follows Trilium's own rule rather than inventing one. It produces a container only
when compression or encryption is asked for:

```ts
// Trilium apps/server/src/backup_provider.ts:376
const isContainer = format.compress || format.passphrase !== null;
const fileName = `${baseName}${isContainer ? CONTAINER_EXTENSION : DATABASE_EXTENSION}`;
```

RTWiki has decided against encryption, so with no encryption the container branch is
never taken and the result is a **plain database file**. `VACUUM INTO` already produces a
minimal, fully-vacuumed file, so the "minimal in size" advantage SQLite attributes to
`VACUUM INTO` over the backup API is already banked — there is nothing left for a
compressor to do.

**Consequences, all favourable:**

- **No new dependency.** `fflate` is *not* added. **Bun has no zip writer** - its archive
  support is tar/tar.gz only. An earlier draft of this plan claimed `Bun.Archive` "rejects
  a zip signature with `Unrecognized archive format`". That was probed, and a second probe
  **did not reproduce the throw**, returning an empty archive silently instead. Do not rely
  on `Bun.Archive` to reject a zip file: a silent empty result is worse than an error, and
  probed behaviour is not a guarantee. The fact that matters is simpler and solid - there is
  no zip writer to use - so a zip would cost a dependency and a performance problem
  deflating a large file, for no benefit.
- One file, copyable by a non-technical user with File Explorer. No extraction step, no
  "where did it extract to".
- The snapshot has no `-wal` sidecar of its own, so a restore cannot pick up a mismatched
  pair. That class of mistake is designed out rather than validated for.

**Known divergence from the docs.** [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) §3
specifies an `.rtwiki.zip` note-package for **content import**. That is a different
feature, and its format is not decided by this plan. If a zip is ever needed there, the
dependency question is reopened then. This plan simply does not use one.

## 7. Restore

### 7.1 The seven validation steps

From [SECURITY.md](SECURITY.md) §8, in order. Any failure aborts with a named reason.

1. **Header check** — 16 bytes, so a photograph gets a sensible error
2. **Opens as a database** — through its **own read-only connection**, never the live one,
   so a restore cannot corrupt the database it replaces
3. **`PRAGMA integrity_check`** returns a single `ok`
4. **A throw counts as failure.** Measured on SQLite 3.53.2: a 60 % truncation raises
   `database disk image is malformed` and a non-database file raises `file is not a
   database`, rather than returning rows
5. **`PRAGMA foreign_key_check` returns zero rows.** Not covered by step 3 — SQLite
   documents that `integrity_check` "does not find FOREIGN KEY errors"
6. **Schema against `_migrations`**, not `user_version` — nothing in `src/` reads
   `user_version`, so the runtime's own authority is the one to check. Reject a backup
   newer than the running build, or missing a migration the build expects
7. **User confirmation**, naming the file, its date and size, and what will happen to the
   current data

### 7.2 No restart mechanism exists

The original plan said restore would reuse the desktop restart handshake. **It cannot.**

- `requestRestart()` writes a flag file; `consumeRestartRequest()`
  (`src/server/settings/index.ts:133`) has **zero production call sites**. Its six
  references are all in `tests/server-settings.test.ts`.
- `launcher.ts:22` opens the **browser** (`rundll32 url.dll,FileProtocolHandler`), not
  the server.
- Nothing respawns the server. The desktop shell that would is never built.

So restore: **validate → move the live database aside → swap → shut down cleanly → tell
the user plainly "Restored. Close and reopen RTWiki."** No relaunch, no dependency on the
desktop shell.

### 7.3 Reversibility

Move, never delete. The live database becomes
`data/rtwiki.pre-restore-<timestamp>.sqlite`, and the user is told where it is. A bad
restore is always recoverable by hand.

This is a deliberate difference from Trilium, which has no undo because its restore only
runs from the first-run screen where there is nothing to lose. RTWiki's restore replaces a
live wiki.

## 8. Scheduling

**There is no `setInterval` anywhere in `src/server/`** — measured, zero matches. The
only timer is a 2 s `AbortController` timeout at `bootstrap.ts:125`. Daily, weekly and
monthly intervals therefore mean **new scheduling infrastructure**.

Recommended, smallest version that is honest — and it is Trilium's behaviour exactly:

- **Check on a short interval, plus a kickoff shortly after startup.** Trilium uses a
  four-hour interval and a five-minute startup kickoff
  (`backup_provider.ts:76,79`). Because the slot is fixed, catching up overwrites rather
  than accumulating, so a long startup delay costs nothing and there is no need for a
  short interval to catch a missed run. RTWiki should use the same shape.
- **A missed run is caught up, not skipped, and only once.** Trilium's `periodBackup`
  compares elapsed time against the stored last-run date and fires if it has overrun
  (`packages/trilium-core/src/services/backup.ts:156`). If the app was closed for three
  days, the next check takes **one** daily backup, not three. Storing three identical
  files would help nobody.
- Each period records its own last-run date, so enabling the monthly does not disturb the
  daily.
- An in-flight backup must never overlap the next check.
- `scheduleBackups()` is a **no-op** on platforms with nowhere to write
  (`backup.ts:99-100`). RTWiki is desktop-only with a real filesystem, so it always
  schedules.

## 9. UI

A **Backup** section in Settings, built from the components the app already uses. Mantine
is **9.6.2**. Every element below was chosen by reading an existing use site, not by
reach — introducing a new pattern for a settings panel is not worth it.

### 9.1 How a section is added

Settings is not a page of free composition; it is a switch over a named union:

```ts
// src/web/features/settings/settings-workspace.tsx:68
type Section = 'appearance' | 'layout' | 'editor' | 'debugLogs' | 'scheduler' | 'desktop'
```

So a Backup section requires all four of:

1. `'backup'` added to that union
2. a nav item, styled with the existing `.navItem` / `.navItemActive` classes
3. a `UI_TEXT.settingsBackup` string in `src/web/config/index.ts`
4. a branch rendering `<Stack gap="sm" className={classes.section}>` with a
   `<Title order={5}>` — the exact shape of the six existing sections. `<Title order={6}>`
   is for a sub-heading within a section, as `schedulerQuietHours` and `desktopPort` do

**The panel is rendered conditionally**, following how `DebugLogViewer` is mounted
(`settings-workspace.tsx:704`, `) : null}`) — not always mounted. A substantial sub-panel
is a separate file; `debug-log-viewer.tsx` is 7.8 kB and is the precedent for `backup-panel.tsx`.

### 9.2 Element mapping

| Need | Component | Existing use site |
|---|---|---|
| Enable/disable a period | **`Switch`** | `scheduler-inapp`, `word-wrap`, `desktop-autostart`. **Not** `SegmentedControl` — that is for 2–3 mutually exclusive choices, like appearance |
| The interval value | **`NumberInput`** or `TextInput` | `TextInput` is the established numeric field (`desktop-port`) |
| "Back up now" and its busy state | **`Button`** + **`Loader`** | `Loader` is used 3× already. **`Progress` is imported nowhere in `src/web`** — a progress bar would be a new pattern, which is a second reason the spinner is right (§9.4) |
| The backup list | **`Table`** | **`trash-view.tsx:136-142`** — `<Table highlightOnHover verticalSpacing="sm">` with a `Table.Thead` and a dedicated `Actions` `Table.Th`, `ActionIcon` per row. A list of items with per-row actions is exactly that shape. **Corrected:** an earlier draft of this plan rejected `Table` on the strength of a single use site in `shortcut-help.tsx`; there are 18 `<Table>` uses across two files and the trash list is the better precedent |
| Success / failure | **`notifications.show()`** | `src/web/features/rich-editor/blocks/image-upload.ts:34`, `src/web/features/rich-editor/blocks/document-upload.ts:25`, `src/web/services/schedule-notifier.ts:217`. The portal is mounted once in `src/web/features/calendar/schedule-notifications.tsx:37` and the stylesheet is imported in `main.tsx:9` — nothing extra to wire |
| A persistent message | **`Alert`** | `dashboard.tsx:53`, `html-editor-error-boundary.tsx:53` |
| Confirmation | **`Modal`** | `delete-confirm-modal.tsx` |

### 9.3 Confirmation — and why restore needs its own modal

`delete-confirm-modal.tsx` is an exact, reusable precedent: `Modal` + `variant="subtle"`
cancel + `color="red"` confirm, every label from `UI_TEXT`.

**Restore is more destructive than delete** and must not reuse that modal unchanged. It
replaces the live database. Its modal has to state, in the user's terms:

- which backup, and its date and size
- that the **current** data is **moved aside, not deleted**, and where the pre-restore copy
  will be
- that RTWiki **will shut down** and must be reopened

Delete gets a modal shaped like `DeleteConfirmModal`; restore gets its own, more explicit
one. Two components, not one parameterised into confusion.

### 9.4 Spinner, and the constraint on it

`Loader`, not `Progress` — `Progress` is used nowhere in the app, so a real progress bar
would introduce an unfamiliar element to do something the mechanism cannot support anyway
(`VACUUM INTO` reports no progress).

**Build it so showing elapsed time is a small later change.** The first backup of a real
database will reveal whether a multi-second operation needs more than a spinner. That is
the measurement, taken when it matters and for free — not worth generating a synthetic
500 MB database in advance.

### 9.5 Labels

Every user-facing string goes in `UI_TEXT` in `src/web/config/index.ts`. No inline strings
(`AGENTS.md` §8). After a successful restore the panel says **"Restored. Close and reopen
RTWiki"**, because the app will have shut down (§7.2).

A "last backup" line is worth showing whether or not anything is running, so a silently
stopped backup schedule is visible without opening a dialog.

## 10. Security

- Restore routes sit behind the global cross-origin guard in `src/server/app.ts`, and
  where applicable the shutdown token. Copy the pattern from
  `src/server/routes/shutdown.ts`, which validates a token with `timingSafeEqual` and
  checks same-origin.
- **Restore path containment.** A path from a client is a request to *name* a file, not
  permission to reach it. Resolve and require it to be inside a known backup directory,
  using `path.relative` rather than a prefix comparison — a prefix test does not hold at
  a drive root.
- **No backup paths in logs.** The directory carries the user's name. Redact it the way
  `sanitize-path.ts` already does.
- **`SECURITY.md` addition** — record that a backup is fully vacuumed and therefore contains
  **no deleted page content**. This is **documented SQLite behaviour**, not merely a local
  measurement: `VACUUM INTO` leaves *"no forensic traces"* — see
  [lang_vacuum.html](https://www.sqlite.org/lang_vacuum.html). Cite the source and the §3.2
  measurement together. A property, not an accident. Do not build a scrubber; there is
  nothing to scrub.
- No global request limit. The right place is a `bodyLimit` in `createApp()`, separate
  work.

## 11. Tests

Unit and service level, all against an **isolated temp `dataDir`** — `bootstrap()`
already accepts `dataDir?` (`bootstrap.ts:42`, applied at `:174`), so tests never need
the app closed and never touch real `data/`.

**The two that matter most:**

- **Round-trip.** Back up → wipe → restore → assert content identical. Without it every
  other test only proves a file appeared.
  **Compare as a set, not positionally** — `VACUUM INTO` may renumber `pages` rowids, and
  `(parent_id, position)` is not uniqueness-enforced by the schema (§3.3). Assert the set of
  page ids and their content, and the set of `(parent_id, position)` pairs. Assert ordering
  is monotonic in `position` **only where positions are distinct** — never positionally
  overall, and never in rowid. A positional comparison fails on a correct backup; an
  order-blind one can mask a real ordering regression.
- **A tied sibling pair survives a restore with its content intact**, and the round-trip
  test does not depend on which of the two comes first. The regression guard for §3.3.
- **A failed backup preserves the previous good one.** Inject a failure mid-write and
  assert the prior `backup-daily` is still valid and still opens. This is the regression
  test for §5.1.

**Also:**

- the backup captures data still in the `-wal` sidecar (the §3.1 failure mode)
- each of the seven validation steps rejects exactly what it should, including a
  truncated file, a non-database file, a database with an orphaned foreign key, and a
  backup from a newer schema
- `integrity_check` **throwing** is treated as failure, not as a pass
- `.partial` files are swept at startup
- **a slot is overwritten, and the other two slots are untouched by it** — the fixed-slot
  model means there is no pruning to test, and the thing worth asserting is that taking
  the daily backup cannot affect the weekly or monthly files
- **a missed run is caught up exactly once** — three days closed produces one daily
  backup, not three
- **`incremental_vacuum` is never invoked during a backup** (§13)
- Windows `rename`-over-existing behaves as §5.3 expects

A browser spec for the Settings panel: open it, take a backup, the list updates, a failure
shows a message, restore confirms, and the confirm modal states that the current data is
moved aside and the app will need reopening. **Type for real; never `.fill()`** — it sets a
value with no key events and is how a focus defect stayed hidden on this project for a
session.

## 12. Measurements still required

Three, all cheap, and none of them is a synthetic 500 MB build:

1. Windows `fs.rename` over an existing file — `EPERM`, `EEXIST`, or success (§5.3)
2. Whether `VACUUM INTO` fails with an open read transaction on the same connection
   (§5.4). If it succeeds, build nothing
3. Real wall time of a backup of a real database, once there is one — the input to
   §9's spinner decision

## 13. A latent hazard to guard

RTWiki sets `auto_vacuum = INCREMENTAL` (`database/index.ts:53`). In that mode an
`incremental_vacuum` call **truncates the main database file**. It appears **only in a
comment** (`:46`) and is never called today — safe.

A retention pass for orphaned attachments is planned, and that is exactly where someone
would add the call. `VACUUM INTO` is immune to it, so this is about not regressing later:
**add a comment in the backup code and a test asserting the pragma is never invoked
during a backup.**

## 14. Documentation

- [SECURITY.md](SECURITY.md) §8 — from "Not implemented" to built, with the §10 addition
- [SECURITY.md](SECURITY.md) §8.1 — keep the `VACUUM INTO` rationale; add the measured
  refusal of an existing target and the open-transaction question
- [ADR-005](adr/ADR-005-portable-data-layout.md) — the `data/backups/` contract, plus the
  pre-restore copy in `data/`

## 15. Risks

| Risk | Mitigation |
|---|---|
| A restore replaces a working wiki | Pre-restore copy kept, never deleted (§7.3) |
| Backup silently stops happening | Persistent panel message, not only a toast; a "last backup" line |
| `VACUUM INTO` fails intermittently on a read transaction | Measure (§12.2); bounded retry |
| Windows rename fails | Measure (§12.1) before coding around it |
| Backup writes fill the disk | Backup needs roughly the **compacted output** in free space — *not* 2× the database. SQLite documents *"as much as twice the size of the original database file is required"* for `VACUUM`, which copies to a temporary file and then over the original; `VACUUM INTO` "omits the step of copying the vacuumed database back over top of the original", so that figure does not apply. A 2× threshold would refuse backups that would actually fit. Surface a clear error, and check free space before starting |
| Tied siblings reorder after a restore | **Not demonstrated.** Content is never lost. `(parent_id, position)` is not `UNIQUE`, so a tie is possible in principle, but every `position` writer sits inside `BEGIN IMMEDIATE` and the duplicate-position query returns zero (§3.3.2, §3.3.3). Accepted by tolerance, not by measurement. The `UNIQUE` index that would settle it needs its own migration plus a cleanup pass over real data — separate work, deliberately not smuggled in here |

## 16. Decisions taken, and where they came from

All three open items are now settled, each resolved by reading Trilium's code rather than
by preference:

| Decision | Resolution | Evidence |
|---|---|---|
| Container format | **Bare `.sqlite`. No zip, no `fflate`.** | Trilium produces a container only when compressing or encrypting; with no encryption the branch is never taken. `backup_provider.ts:376-377` |
| Retention | **Three fixed slots, overwritten. No pruning code at all.** | `backup_provider.ts:90` builds `backup-${period}`. No retention, cutoff or age limit exists anywhere in its backup path. The only deletion is the counterpart *extension* (`:400-401`), which is format bookkeeping |
| Missed runs | **Caught up, once, on the next check.** A five-minute startup kickoff plus a periodic check, as Trilium does | `backup.ts:156` fires when the period has overrun; `backup_provider.ts:76,79` gives the interval and the kickoff |

The retention choice was put to the owner as a straight trade-off — Trilium's model has
the property that a mistake persisting past a backup window overwrites the last good copy
of that period — and Trilium's model was chosen. §6.2 records the cost so it is not
rediscovered as a surprise.

**Still open, and genuinely so:** nothing. Every other decision in this plan either
follows an existing project convention or is recorded with its reasoning.
