# Backup Research: Trilium, and What It Means for RTWiki

This document records what Trilium's backup, restore, import and export features actually do, read
from its source rather than from its documentation, and states what RTWiki should and should not
take from them.

Trilium lives at `D:\Temp\Trilium`; citations below are to that tree. RTWiki citations are relative
to the repository root.

Every claim is marked:

- **MEASURED** — read directly from the source at the cited line.
- **INFERRED** — reasoned from the code, with the reasoning given.
- **UNVERIFIED** — not established. Collected in [What could not be established](#what-could-not-be-established).

---

## 1. The headline: Trilium does not have the bug RTWiki has to avoid

RTWiki runs SQLite in WAL mode. A plain file copy of a WAL database **passes `PRAGMA integrity_check`
while having silently lost committed data**, because recent writes live in the `-wal` sidecar rather
than in the main file. This was measured and is written up in [SECURITY.md](SECURITY.md) §8.1.

**Trilium does not copy the file.** It calls SQLite's Online Backup API:

```ts
// packages/trilium-core/src/services/sql/sql.ts:459
async copyDatabase(targetFilePath: string) {
    await this.dbConnection.backup(targetFilePath);
}
```

**MEASURED.** The whole backup path — every mode, every platform that has a real database — goes
through that one method. `apps/server/src/backup_provider.ts:88` (the plain-copy branch) and
`:377` (the container branch) both call it.

So the question that decides RTWiki's whole design — *consistent snapshot or file copy* — is
answered by Trilium, and the answer is **consistent snapshot**. The snapshot is additionally taken
inside an exclusive section so it cannot land mid-sync:

```ts
// apps/server/src/backup_provider.ts:93
return await syncMutexService.doExclusively(async () => {
```

**MEASURED.**

### 1.1 Why RTWiki cannot copy this approach

Trilium reaches the backup API through `better-sqlite3`, which exposes `db.backup()`. **RTWiki uses
`bun:sqlite`, which does not.** Measured against the installed Bun 1.4.2, the `bun:sqlite` prototype
exposes exactly:

```
constructor, handle, inTransaction, loadExtension, serialize, fileControl,
close, clearQueryCache, run, prepare, query, transaction, exec
```

No `backup`. `db.serialize()` exists but produces an in-memory image rather than writing to a path,
so it is not a drop-in replacement.

**`VACUUM INTO` is therefore not a fallback for RTWiki — it is the only consistent-snapshot mechanism
available.** Also measured working in the installed Bun: `VACUUM INTO` on a live database returned
the expected rows. This confirms the mechanism already chosen in [SECURITY.md](SECURITY.md) §8.1
rather than offering an alternative to it.

---

## 2. Libraries

| Package | Role | First-party? |
|---|---|---|
| `@triliumnext/backup-container` | The container format: header, compression, encryption, `getInfo` | **Yes** — their own workspace package |
| `better-sqlite3` | The database driver, and the backup API | No |
| `node:fs`, `node:path` | Filesystem | Built in |
| `@triliumnext/core` | `sync_mutex`, logging, websocket toasts | Their own |

**MEASURED** from the import list of `apps/server/src/backup_provider.ts` and
`packages/trilium-core/src/services/sql/sql.ts`.

**The container is first-party, not a package.** `writeBackupContainer` is called as
`apps/server/src/backup_provider.ts:377`, and `FIXED_HEADER_BYTES` and `getInfo` are imported from
`@triliumnext/backup-container` at `:3-7`. **INFERRED:** the first-party part is small, because the
file that uses it is small; the implementation lives in the package, whose size was not measured.

RTWiki has no equivalent and would not need one. Its constraint is different: Bun has no ZIP support
at all — `Bun.Archive` is tar-only and rejects a ZIP signature with "Unrecognized archive format"
(both **MEASURED** locally). The docs already promise a `.rtwiki.zip` in
[AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) §3, which the runtime cannot produce.

---

## 3. What a backup is

Every backup is one of two shapes, chosen by whether the user asked for compression or encryption:

| Shape | Extension | Produced by |
|---|---|---|
| Plain database | `.db` | `sql.copyDatabase` directly |
| Container | `.tnbackup` | snapshot → compress/encrypt → write |

**MEASURED** at `apps/server/src/backup_provider.ts:381-382`. One backup name yields exactly one
file: writing a container retires the plain copy with the same name and the other way round
(`:400`).

The container is written carefully, and the discipline is worth copying:

```ts
// apps/server/src/backup_provider.ts:377-405
const snapshot = path.resolve(dataDir.TMP_DIR, `${baseName}.snapshot.db`);
const partial = `${backupFile}.part`;
try {
    await sql.copyDatabase(snapshot);
    await writeBackupContainer(/* snapshot -> partial */);
    // Renamed last, so a half-written container is never mistaken for a finished one.
    fs.renameSync(partial, backupFile);
} finally {
    fs.rmSync(snapshot, { force: true });
    fs.rmSync(partial, { force: true });
}
```

**MEASURED.** Three properties follow, and each closes a real failure:

1. The snapshot lands in the data directory's temp folder, so the backup directory **never** holds a
   plain database even momentarily.
2. The container is renamed into place last, so a partial write is never listed as a backup.
3. A backup listing filters on the extension, which excludes `*.part` and `*.db-journal`
   (`:341-343`).

### 3.1 Compression and encryption

Both are options: `backupEnableCompression` and `backupEnableEncryption`
(`apps/server/src/backup_provider.ts:246-247`). The passphrase is deliberately **not** in the
database — it is kept by the platform, and the desktop app uses the OS keyring
(`:39-45`). `hasStoredPassphrase()` answers yes or no and never returns the value, so a screen can
offer "use the password I configured" without being able to learn it (`:200-203`).

**The most interesting decision in the whole feature** is what happens when encryption was asked for
and the passphrase cannot be read:

```ts
// apps/server/src/backup_provider.ts:236-243
getLog().error("Could not read the backup passphrase; backing up unencrypted to the " + "default location.");
ws.sendMessageToAllClients({ type: "toast", message: t("backup.passphrase_unavailable"), timeout: 15000 });
return { compress, passphrase: null, keepLocal: true };
```

**MEASURED.** The `keepLocal` flag forces the backup to the default directory rather than a custom
one, because — quoting the comment at `:56-60` — the chosen directory is typically a synced folder,
and putting an unencrypted database there is the very thing encryption was turned on to avoid.

So: it takes the backup anyway, keeps it somewhere safe, and tells the user. **INFERRED:** this is
better than either extreme. Refusing to back up because a key is unavailable leaves the user with no
backup at all; writing it unencrypted to a synced folder is the failure the setting exists to
prevent.

### 3.2 Where backups go, and fallback

Default is `dataDir.BACKUP_DIR` (`:325`). A custom directory is honoured only when the platform sets
`allowCustomDirectory` — the desktop app, where the user picks it; on a server it is configured by
environment variable instead (`:33-38`).

A backup that cannot reach the chosen location falls back to the default rather than being lost, and
the user is told with a 15-second toast (`:104-116`). **MEASURED.** Same philosophy as §3.1: the
backup is the thing that matters; where it landed is a lesser problem, so long as the user hears
about it.

---

## 4. Options and scheduling

**MEASURED** from `packages/trilium-core/src/services/backup.ts` and
`apps/server/src/backup_provider.ts:74-80`.

### 4.1 Three independent periods

| Period | Interval | Option |
|---|---|---|
| daily | 24 h | `dailyBackupEnabled` |
| weekly | 7 days | `weeklyBackupEnabled` |
| monthly | 30 days | `monthlyBackupEnabled` |

Each has its own enable flag and its own "last taken" option. `periodBackup` returns immediately if
the period is disabled, so a disabled period costs nothing
(`packages/trilium-core/src/services/backup.ts:138-160`).

### 4.2 How the schedule runs

```ts
// apps/server/src/backup_provider.ts:75-80
setInterval(() => this.regularBackup(), 4 * 60 * 60 * 1000);   // every 4 hours
setTimeout(() => this.regularBackup(), 5 * 60 * 1000);        // kickoff 5 min after startup
```

**MEASURED.** A four-hour tick that checks each period's elapsed time, plus a kickoff so a
freshly-started instance does not have to wait four hours. The standalone and mobile builds make
`scheduleBackups()` a no-op (`packages/trilium-core/src/services/backup.ts:99-100`) — those platforms
have no directory to write into.

### 4.3 Retention: three slots, overwritten

**MEASURED.** The filename is derived from the period, not the clock:

```ts
// apps/server/src/backup_provider.ts:88-92
const baseName = `backup-${sanitizedName}`;   // sanitizedName is "daily" | "weekly" | "monthly"
```

There is **no pruning code anywhere**. The daily backup overwrites yesterday's daily backup.

**INFERRED:** this is a deliberate and elegant retention policy. It bounds storage at three files
with no retention setting to configure, no deletion to get wrong, and — because each period has its
own slot — the weekly backup is never overwritten by a daily one. The cost is that there is no
history: an RTWiki user wanting "the state before I broke it on Tuesday" has no window.

---

## 5. Security posture

**MEASURED.**

**Name sanitisation.** `apps/server/src/backup_provider.ts:85`:

```ts
const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "");
```

with a comment citing CWE-22, and a rejection when nothing usable remains.

**Path containment on every read.** `resolveBackupPath` (`:177-186`) resolves the path and requires
it to be inside a known backup directory. The comment states the principle: *a path arriving from a
client is a request to name a file, not permission to reach it: without this, an endpoint taking one
would read any file the process can.*

The containment test is `isInsideDirectory` (`:329-333`), which uses `path.relative` rather than a
prefix comparison. The comment at `:328` gives the reason: a prefix test does not hold at a drive
root. **This is the kind of detail that is easy to get wrong and is worth copying verbatim in
substance.**

**No paths in logs.** `withoutDirectory` (`:440-448`) replaces the backup directory with
`<backup location>`. The reason is stated at `:436-439`: the directory carries the user's name and
the backend log is meant to be shareable for diagnostics without being censored first.

**The backup directory is created `0o700`** (`:387`).

---

## 6. The restore

### 6.1 What is validated

**MEASURED** from `apps/server/src/services/database_validation.ts`.

| # | Check | Line | Note |
|---|---|---|---|
| 1 | 16-byte SQLite header | `:74-86` | Spares the user an error about a malformed database when they picked a photograph |
| 2 | Opens read-only, its own connection | `:32-39` | The live database is never touched |
| 3 | `PRAGMA quick_check` | `:63` | **See below** |
| 4 | Expected table names present | `:64` | |
| 5 | Version option readable | `:65-66` | Read from the `options` table |
| 6 | Any throw is a rejection | `:47-55` | Classified `damaged-database` |

Two details are worth copying. Validation opens the file through **its own read-only connection**, so a
restore can never corrupt the database it is replacing (`:32-39`). And pages are read as needed
rather than the whole file at once — the comment at `:20-22` says so explicitly, and it matters for
multi-gigabyte knowledge bases.

### 6.2 Two gaps, stated plainly

**Trilium uses `quick_check`, not `integrity_check`** (`:63`). `quick_check` skips the per-index
consistency work that `integrity_check` performs, so it is faster and weaker.

**There is no `foreign_key_check` anywhere in the Trilium tree.** Verified by a whole-tree search:
zero matches. SQLite documents that `integrity_check` "does not find FOREIGN KEY errors", so nothing
in their path would catch an orphaned row.

**INFERRED:** neither is necessarily a bug for them — Trilium's own foreign keys may be sparse — but
both are gaps against [SECURITY.md](SECURITY.md) §8, which requires `integrity_check` **and** a
separate `foreign_key_check`. **RTWiki should not inherit either.**

### 6.3 How restore is offered

**MEASURED** from `apps/server/src/routes/api/setup_restore.ts` and
`apps/server/src/services/database_restore.ts`.

**Restore only happens from the first-run setup screen.** A restore against an instance that already
has a database is refused by name:

```ts
// apps/server/src/services/database_restore.ts:263
throw new RestoreFailure("restore-refused", "This instance already has a database; a restore only runs from the setup screen.");
```

That is a materially different design from RTWiki's need, and worth naming: RTWiki's restore has to
work on a running instance with content in it, so it has no "only from setup" safe harbour.

**Upload is chunked and bounded.** One upload at a time, a size ceiling, and a session that expires
(`setup_restore.ts:14-19`). The comment is explicit that these endpoints are reachable without
authentication on a first run, *because before a database exists there is nobody to authenticate*,
and that the cost is deliberately bounded. Where a knowledge base already exists behind the wizard,
`checkSetupAuth` asks for credentials.

**Progress is reported, not assumed.** `beginRestore` returns as soon as the restore is under way and
the client follows it through `status` (`:52-60`). `RestoreProgress` carries a `failedAt` step name,
and failures are logged with the step they failed at (`:314-320`).

**Errors are classified, not stringly typed.** `RestoreFailure` carries a `reason` — observed values
include `restore-refused`, `not-a-database`, `damaged-database`, `passphrase-required` — so the UI can
react differently to a wrong password than to a corrupt file.

**A restore of an encrypted backup updates the stored passphrase** (`:359`, `adoptPassphrase` in
`backup_provider.ts:194-198`). The reason given at `:194-198` is good: a restore replaces every
option saying how the instance backs up while leaving the password those options are carried out
with, so the instance would encrypt backups with the password of a database that is no longer there
and produce backups the user cannot open.

### 6.4 Is a bad restore reversible?

**No.** Once `beginRestore` has replaced the database there is no undo in the code read.

**INFERRED:** this is mitigated by timing rather than by mechanism — restore is confined to the
first-run screen, so there is normally nothing to lose. For RTWiki the answer has to differ: a
restore replaces a live wiki, so **the pre-restore database must be kept**, and the cheapest way to
keep it is to move it aside rather than delete it. **This is a design decision, not a Trilium finding.**

---

## 7. What "import" is — and is not

This is the distinction most likely to be got wrong, so it is worth being blunt.

**Trilium's import is not a restore and not a backup.** There are three separate things:

| Feature | What it is | Files |
|---|---|---|
| **Backup** | A consistent snapshot of the whole database, optionally compressed/encrypted | `backup_provider.ts`, `backup.ts` |
| **Restore** | Replaces the database with a backup, first-run only | `setup_restore.ts`, `database_restore.ts` |
| **Import** | Converts content from *another application's format* into Trilium notes | `markdown_import.tsx`, `onenote_import.ts`, `import_dialog.tsx` |

The third is a format converter. `markdown_import.tsx` reads Markdown; `onenote_import.ts` reads
Microsoft OneNote exports; `import_dialog.tsx` is the UI that chooses between them. **None of them
reads a backup, and none of them replaces the database.**

**INFERRED, and it is the important part for RTWiki:** "import" in almost every application means
neither backup nor restore, and treating it as a third mode of the same feature is how a feature
gets specified wrongly. [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) currently describes the import
pipeline and the backup directory in adjacent sections, which invites exactly that confusion.

**Could import lose content? Not established.** See below.

---

## 8. Standalone and mobile

**MEASURED** from `apps/client/src/services/backup_download.ts`.

On the standalone (browser) build there is no directory to write into, so **no backups are stored at
all**: a backup is streamed straight off the database into a browser download, with the extension
`.tnbackup` (`:15`). `isBackupDownloadSupported()` is the platform test, and `scheduleBackups()` is a
no-op there.

The comment at `:6-11` gives the reason: *the browser's storage holds the live database and could
rarely hold a copy of it beside itself*. On mobile there is no download manager, so the backup is
written onto the device and offered to the share sheet instead.

**INFERRED:** RTWiki has no equivalent split, because it is desktop-only with a real filesystem beside
the executable ([ADR-005](adr/ADR-005-portable-data-layout.md)). The relevant takeaway is the negative
one — there is no cloud destination in this design, and none is needed.

---

## 9. What this means for RTWiki

### 9.1 Confirmed, not changed

Nothing here displaces the analysis already in [SECURITY.md](SECURITY.md) §8 and §8.1. Three points
are now **corroborated by a working implementation** rather than reasoned alone:

1. **A consistent snapshot is the mechanism, and a file copy is not.** Trilium's `db.backup()` and
   RTWiki's `VACUUM INTO` are the same idea; the choice between them is forced by the driver
   (`better-sqlite3` has `.backup()`, `bun:sqlite` does not), not by preference.
2. **The container discipline matters.** Write to a partial name, rename last, delete the partial on
   failure, and never let the backup directory hold a plain database even briefly.
3. **`PRAGMA synchronous` should be set explicitly.** §8.1 flags that it is never set and that the
   durability guarantee currently rests on a build flag in a dependency RTWiki does not control.
   Re-verified: `PRAGMA synchronous` is **not** set anywhere in `src/`. A search for the substring
   "synchronous" returns five hits, all of them the English word in comments
   (`src/server/bootstrap.ts:165,167,341,344`; `src/server/index.ts:38`) — a false positive worth
   recording, because the next person to run that search will hit it too.

### 9.2 Worth copying

| From Trilium | Why |
|---|---|
| Fixed slots per period, no pruning (`backup_provider.ts:88-92`) | Bounds storage with no retention setting to get wrong, and each period cannot overwrite another |
| A kickoff run shortly after startup (`:79`) | A freshly-started instance does not wait a full period |
| Custom directory falls back to default, user told (`:104-116`) | The backup is the thing that matters; where it landed is a lesser problem |
| **Encrypted-or-local** rule (`:236-243`) | If the key is unavailable, still back up, but never into a synced folder |
| Path containment via `path.relative` (`:329-333`) | A prefix test fails at a drive root |
| Log redaction (`:440-448`) | The log stays shareable for diagnostics |
| Restore validated through its own read-only connection (`database_validation.ts:32-39`) | A restore can never corrupt the database it replaces |
| Classified error reasons (`database_restore.ts:430`) | The UI can distinguish a wrong password from a corrupt file |
| A spec beside nearly every source file | Not a feature, but the reason their intent is readable at all |

### 9.3 Worth **not** copying

| From Trilium | Why |
|---|---|
| `quick_check` over `integrity_check` (`database_validation.ts:63`) | Skips index consistency; [SECURITY.md](SECURITY.md) §8 step 4 specifies `integrity_check` |
| No `foreign_key_check` (zero matches tree-wide) | §8 step 5 requires it and SQLite documents that `integrity_check` does not cover it |
| `sync_mutex` around the snapshot (`backup_provider.ts:93`) | Trilium has a sync feature. RTWiki does not, and must not grow one to justify a mutex |
| Restore only from the first-run screen (`database_restore.ts:263`) | RTWiki's restore must work on a running instance. The safety comes from moving the old database aside, not from refusing to run |

### 9.4 The one design question this raises

**How does RTWiki make a bad restore reversible?**

Trilium does not try, because restore is confined to first run. RTWiki's restore replaces a live wiki,
so something must give. Three options, not yet decided:

1. **Move the current database aside** before restoring, and tell the user where it went. Cheapest,
   and nothing is ever deleted.
2. **Take an automatic backup immediately before every restore**, using the feature being built.
   Costs a restore's worth of time and disk.
3. **Restore into a temporary file, validate, then swap.** Safest, and the most moving parts.

**INFERRED:** (1) and (2) compose well and are both small. This is a decision for the owner, not a
finding from Trilium.

---

## What could not be established

- **The size and internal design of `@triliumnext/backup-container`.** It is called from one place and
  its entry points are known, but the package itself was not read. *What would establish it:* reading
  the package directory under `D:\Temp\Trilium\packages\backup-container`.
- **Whether import can lose content.** `markdown_import.tsx`, `onenote_import.ts` and
  `import_dialog.tsx` were located and their roles established from their call sites and names, but
  their conversion logic was not read end to end. *What would establish it:* reading the three files.
- **The encryption algorithm and its parameters.** The container delegates to the package; the choice
  between a stream or block cipher, the KDF, and the iteration count are all inside it. *What would
  establish it:* the same package directory.
- **How a restore's progress figures are computed**, and whether a long restore reports percentages or
  only steps. *What would establish it:* reading the `RestoreProgress` producer in
  `database_restore.ts`.
- **Whether `quick_check` is a deliberate speed choice or an oversight.** The code does not say, and
  the accompanying comment covers only the read-only connection and the lazy page reads.
  *What would establish it:* the commit that introduced `:63`, or the spec beside it.
- **Mobile backup specifics.** `backup_download.ts:44-47` says the backup is written to the device and
  offered to the share sheet, but the writing path was not traced.
- **Any test asserting that a backup is restorable.** The spec files beside the backup sources were not
  read. Their existence is suggestive but says nothing about what they assert, and this project's rule
  is that a file's presence is not evidence of coverage.

---

## Cross-references

- [SECURITY.md](SECURITY.md) §7, §8, §8.1 — RTWiki's restore requirements, and the constraints on how
  a backup must be taken
- [ADR-005](adr/ADR-005-portable-data-layout.md) — the portable data layout, and the existing
  `data/backups/` contract
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — the import pipeline, a separate feature
- [ADR-002](adr/ADR-002-bun-hono-sqlite.md) — the runtime and database decision
