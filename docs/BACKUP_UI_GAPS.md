# Backup UI and options — gaps against Trilium

Recorded on `feat/backup-restore` at `d78419b`. **This document changes no code.** It
records what the backup panel does, what it should do, and which of the differences are
defects, which are deliberate, and which were never built.

Every claim below names the file and line it came from, so a later reader can re-check it
rather than take it on trust. Where a claim is only partly true, that is said explicitly.

## Summary

The backup **engine** is sound and genuinely follows Trilium. The **panel** does not.

Two defects make the settings screen hard to read, and one of them — "Back up now"
overwrites the previous copy instead of creating a new one — is a real loss of data
durability, not a cosmetic gap.

## What the panel actually renders

As reported from the running application, the Backup section shows:

```text
Daily    Last taken just now    Every hours [24]
Weekly   Last taken 5 min ago   Every hours [168]
Monthly  Last taken 5 min ago   Every hours [720]

Daily | Restore |
9/28/2026  336 KB  rtwiki-backup-daily
9/28/2026  336 KB  rtwiki-backup-weekly
9/28/2026  336 KB  rtwiki-backup-monthly
```

All three files carry the same size and timestamp because all three were taken in
sequence, each overwriting the slot before it. That is the fixed-slot model working as
designed — but see §2.1, because it is also why the button is dangerous.

## 1. Defects in the current build

### 1.1 The interval label is mangled, and the unit is wrong

`src/web/features/settings/backup-panel.tsx:270`

```tsx
label={UI_TEXT.backupEveryHours.replace('{hours}', '').trim()}
```

`UI_TEXT.backupEveryHours` is `'Every {hours} hours'`
(`src/web/config/index.ts`). The placeholder is stripped, leaving the static label
**"Every"** — but the trailing word *hours* was never inside the placeholder, so it
survives as **"Every hours"**. The number then goes in the box beside it.

The deeper problem is not the string. The stored value is in hours because the API is
hourly (`intervalHours`), and the field renders that raw number. **168 and 720 are not
meaningful to a person** — they are 7 days and 30 days. Nobody should be asked to type
`720`.

*Not yet verified against a rendered page:* whether a user can also type a value of `0`
or a negative number, and what the server does with it. The client coerces with
`Number.isFinite` (`backup-panel.tsx:273`) and `Number.isInteger` on blur, which admits
negative integers.

### 1.2 The table headers do not describe the cells

`src/web/features/settings/backup-panel.tsx:311-317`

```tsx
<Table.Thead>
  <Table.Tr>
    <Table.Th>{PERIOD_LABEL.daily}</Table.Th>   // renders "Daily"
    <Table.Th>{UI_TEXT.backupRestore}</Table.Th> // renders "Restore"
    <Table.Th />
  </Table.Tr>
</Table.Thead>
```

The body cells (`:323`, `:329`, `:334`) hold **date and size**, then **filename**, then
the **Restore button**.

So the column headed **Daily** contains a timestamp, and the column headed **Restore**
contains a filename. The header row reuses `PERIOD_LABEL`, the same constants that label
the toggle rows above it, and was never revised when the table was written.

**Probable cause:** the per-slot configurable interval is a feature Trilium does not
have. It made the toggle rows a list of period labels, and the table was then built from
those same labels. Our one *extra* feature is the likely cause of the defect.

Correct headers for a per-slot table would be something like *Last taken / Size / File /
—*.

## 2. Gaps against Trilium

### 2.1 "Back up now" overwrites the previous backup — the one that matters

Trilium has **two** distinct paths:

| Path | Trilium | Result |
|---|---|---|
| Scheduled | `periodBackup("lastDailyBackupDate", "daily", …)` → `backupNow("daily")` → `baseName = "backup-daily"` | fixed name, overwritten |
| Manual / setup | `backupAs(settings)` → writes `settings.name` as given, defaulting to `Trilium data (2026-09-28 14-30-05)` | **new file every time, never overwritten** |

Evidence: `packages/trilium-core/src/services/backup.ts:123-125` and `:143` call
`this.backupNow(backupType)`; `apps/server/src/backup_provider.ts:90` builds
`` const baseName = `backup-${sanitizedName}` ``; `apps/server/src/backup_provider.ts:118`
is `backupAs`, which passes `settings.name` through untouched because the setup screen
shows it to the user. The default name comes from
`packages/commons/src/lib/backup_name.ts` → `defaultBackupName(now)`.

RTWiki implemented only the first path. Its manual button takes a **slot**
(`backup-panel.tsx:281`, `data-testid={`backup-run-${slot}`}`) and writes that slot.

**Consequence: pressing "Back up" on Daily destroys the previous daily backup.** In
Trilium, pressing back-up creates a new file and keeps the old one.

That is precisely the moment a cautious user clicks — before a risky edit, before
reinstalling the app, before anything else — and in RTWiki it discards the last known-good
copy. This is the substantive finding behind the "there is no history" complaint: the
history is not hidden, it is **never written**.

### 2.2 The backup folder is never listed

`src/server/backup/backup-service.ts:177` — `listBackups` maps the three fixed slots and
returns. It never enumerates the directory. `readdirSync` is imported at `:20` but used at
`:156` for something else, not for listing backups.

Trilium does the opposite: `apps/server/src/backup_provider.ts:67` is
`getBackupDirectories().flatMap(listBackupsIn)` and `:290` `listBackupsIn` calls
`fs.readdirSync(directory)` at `:293`.

So a file dropped into `data/backups/` by hand, or left by an older version, is invisible
to the UI. Trilium's list shows it; ours cannot.

### 2.3 No backup location setting

Confirmed absent. There is no `customDbBackupDir` equivalent, no directory picker, and no
setting of any kind: a search of `src/shared/constants/index.ts` and `src/server/backup/`
for a location, directory or dialog option returns nothing.

Trilium has it, and has a defined fallback: `apps/server/src/backup_provider.ts:95` reads
`this.getCustomBackupDir()`, and if the write to the custom directory throws it logs the
reason and **falls back to the default directory** rather than losing the backup, showing
the user a toast (`custom_directory_unwritable`).

This option has nothing to do with encryption and was never declined — it was simply never
built. On a machine where the application folder might be deleted or replaced, a backup
stored inside that folder is lost with it.

### 2.4 No delete for a single backup

Neither project has it. It is listed here only because it is a consequence of §2.1: with
scheduled slots fixed and no manual files created, there is nothing a user could delete,
and a corrupt daily is overwritten by the next run with no way to clear it.

## 3. What is genuinely Trilium-faithful — verified

These were re-checked against Trilium's source for this document and hold up:

| Decision | Trilium evidence | Status |
|---|---|---|
| Scheduled backups overwrite a fixed, named file | `backup.ts:123-125` → `backupNow("daily")` → `backup-daily` (`backup_provider.ts:90`) | matches |
| No retention, no pruning, no rotation anywhere | no retention, unlink, rotate or age-cutoff code found in the backup path | matches |
| Interval check plus a kickoff after startup | `backup.ts:123-125` checked on a loop | matches |
| A missed run is caught up, not skipped | `periodBackup` compares against the stored last-run date | matches |

The fixed-slot decision is correct. It is not the cause of §2.1 — §2.1 is the *absence* of
the second, manual path that Trilium has alongside it.

## 4. Correction to an earlier claim

An earlier draft of this analysis, and `docs/BACKUP_PLAN.md:342`, state that fixed slots
with no history "follows Trilium exactly". That is **true of the scheduled path and false
of the manual one**, and the distinction matters:

- Scheduled: both projects overwrite a fixed file. Faithful.
- Manual: Trilium creates a new timestamped file every time and keeps them all. RTWiki
  overwrites a slot.

So "Trilium has no history" is not correct. Trilium keeps every **manual** backup forever;
it is only the three **scheduled** files that are replaced. The panel's real omission is
that the manual path was never built, not that history was deliberately dropped.

## 5. Proposed change — awaiting approval, not built

Nothing below has been implemented.

1. **Keep the three scheduled slots exactly as they are.** They are faithful to Trilium
   and they keep `data/backups/` tidy.
2. **Replace the three per-slot "Back up" buttons with one "Take a backup now"** that
   writes a new timestamped file and does not touch any slot. This is the fix for §2.1 and
   the precondition for everything else.
3. **List the backup folder for real** — enumerate the directory, as Trilium does, so
   manual files appear, with a count and newest-age summary line.
4. **Then** delete-one and the location picker become meaningful, because there is
   finally more than one file and somewhere else to put it.

Two smaller fixes stand on their own and are worth doing regardless: the mangled interval
label (§1.1, changed to read *Every day / week / month* with hours behind a preset, so
`168` and `720` are never shown) and the table headers (§1.2).

## 6. Scope and honesty notes

- **This document implements nothing.** Every defect above is open.
- **Defects 1.1 and 1.2 were confirmed still present at `d78419b`.** The panel file grew
  after they were first observed, so both were re-checked rather than assumed. Both are
  unchanged; the header row is byte-identical.
- **The browser spec does not catch either defect.**
  `tests/browser/backup-panel.pwspec.ts` asserts on `data-testid` attributes, so it passes
  or fails without reference to whether a person could read the table. Per
  [AGENTS.md](../AGENTS.md) §11 this behaviour needs a test; a test that only proves the
  markup exists does not discharge that.
- **One claim is unverified:** whether a bogus interval (zero, negative) is accepted by the
  server. Named in §1.1 as open rather than asserted.
- **`docs/backup-ui-comparison.html` is now partly inaccurate.** It lists "no history" and
  "delete one backup — neither has it" as if they were both deliberate. §4 above supersedes
  it. That file is an untracked scratch artifact, not documentation.

## Related documents

- [Backup research](BACKUP_RESEARCH.md) — the Trilium study this work came from. Contains
  no UI or settings-screen analysis, which is the root of §2.3.
- [Backup plan](BACKUP_PLAN.md) — the design. Correct on the engine, silent on the panel.
- [Handover](HANDOVER.md) — full project status for a project manager. (Untracked.)
- [Known bugs](KNOWN_BUGS.md)
- [Security](SECURITY.md) §8 — backup and restore
