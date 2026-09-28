/**
 * Restore (docs/BACKUP_PLAN.md §7).
 *
 * A restore replaces a live wiki, so this module is deliberately the most
 * conservative code in the feature:
 *
 *  - The candidate is validated by `validation.ts` before anything is moved.
 *  - The current database is *moved aside*, never deleted, so a bad restore is
 *    recoverable by hand (SECURITY.md §8).
 *  - The WAL sidecars move with it. This is the one thing the plan does not
 *    spell out and it is not optional -- see `PRE_RESTORE_SIDECARS`.
 *  - The backup file is copied, not consumed, so restoring a slot leaves that
 *    slot intact and a second restore of the same file is still possible.
 *  - There is no relaunch. Nothing respawns this process
 *    (`consumeRestartRequest` has no production call site and `launcher.ts`
 *    opens a browser, not the server), so the user is told plainly to close and
 *    reopen RTWiki.
 */

import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
import { DATABASE_FILENAME, PRE_RESTORE_FILENAME_PREFIX } from '@rtwiki/shared/constants'
import { joinPaths } from '../config/index.js'
import {
  closeDatabase,
  type Database,
  getDatabaseLogger,
  getDatabasePath
} from '../database/index.js'
import { backupsDirFor } from './backup-service.js'
import { type ValidationOutcome, validateBackupFile } from './validation.js'

/**
 * The live database's own sidecars, moved aside alongside it.
 *
 * RTWiki runs in WAL mode, so a working database is three files: the main
 * database plus `-wal` (committed transactions not yet checkpointed into it)
 * and `-shm`. Restoring by replacing only the main file would leave the
 * previous database's `-wal` sitting next to the new one, and SQLite treats a
 * WAL whose contents do not match its database as a hot journal -- it replays
 * it, writing the old wiki's pages straight back over the one just restored.
 * The failure is silent and the restore appears to have worked.
 *
 * They are moved under the pre-restore base name, which keeps the set
 * recoverable by hand: rename all three back and the previous wiki returns.
 */
const PRE_RESTORE_SIDECARS = ['', '-wal', '-shm'] as const

export type RestoreFailure =
  | { kind: 'unavailable' }
  | { kind: 'invalid'; outcome: Extract<ValidationOutcome, { ok: false }> }
  | { kind: 'path-outside-backups'; filename: string }
  | { kind: 'swap-failed'; detail: string }

export type RestoreOutcome =
  | { ok: true; preRestorePath: string }
  | { ok: false; reason: RestoreFailure }

/**
 * Resolves a client-supplied filename to a file inside the backups directory.
 *
 * A path from a client is a request to *name* a file, not permission to reach
 * one. The name is taken as a basename first, so `..` and absolute paths cannot
 * even be expressed, and the containment test is then re-applied with
 * `path.relative` rather than a prefix comparison -- a prefix test does not hold
 * at a drive root, which is exactly where this data lives.
 */
export function resolveBackupCandidate(
  dataDir: string,
  filename: string
): { path: string } | { outside: string } {
  const name = basename(filename)
  if (name !== filename || name === '' || name === '.' || name === '..') {
    return { outside: filename }
  }
  const dir = backupsDirFor(dataDir)
  const resolved = joinPaths(dir, name)
  const rel = relative(dir, resolved)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { outside: filename }
  }
  return { path: resolved }
}

/**
 * A filesystem-safe timestamp.
 *
 * `toISOString()` contains colons, which Windows will not accept in a filename,
 * so the time part is written with dashes. A pre-restore copy that cannot be
 * written is a copy that is not kept.
 */
function preRestoreStamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-')
}

/**
 * Validates a candidate without changing anything.
 *
 * Exposed separately so the confirm dialog can show the date, the size and the
 * verdict *before* the user commits -- the validation is cheap and the
 * destructive part is not.
 *
 * There is deliberately no "is this the live database?" branch. The candidate is
 * always `backups/<filename>`, and the live database is always
 * `data/rtwiki.sqlite`, so containment already makes the two disjoint: a client
 * that asks for `rtwiki.sqlite` gets the path `backups/rtwiki.sqlite`, which is
 * not the live file and will fail validation as not-a-file. A check for an
 * impossible state would be a branch nothing can ever reach.
 */
export function inspectBackup(
  dataDir: string,
  filename: string
): ValidationOutcome | RestoreFailure {
  if (!dataDir) return { kind: 'unavailable' }
  const resolved = resolveBackupCandidate(dataDir, filename)
  if ('outside' in resolved) {
    return { kind: 'path-outside-backups', filename: resolved.outside }
  }
  return validateBackupFile(resolved.path)
}

/**
 * Performs the swap. Assumes the candidate has already been confirmed.
 *
 * Does not shut the process down; the route that calls this does that
 * afterwards, so a failed swap can still be reported to the user with the wiki
 * intact. The database connection *is* closed here, before anything moves --
 * see the note on `closeDatabase` below.
 */
export async function performRestore(
  dataDir: string,
  filename: string,
  now: Date = new Date()
): Promise<RestoreOutcome> {
  const inspected = inspectBackup(dataDir, filename)
  if ('kind' in inspected) return { ok: false, reason: inspected }
  if (!inspected.ok) return { ok: false, reason: { kind: 'invalid', outcome: inspected } }
  const source = inspected.candidate.path
  const live = getDatabasePath(dataDir)
  const preRestore = joinPaths(
    dataDir,
    `${PRE_RESTORE_FILENAME_PREFIX}${preRestoreStamp(now)}${DATABASE_FILENAME}`
  )

  // The connection is closed *before* anything is moved, not after.
  //
  // SQLite on Windows does not open its files with FILE_SHARE_DELETE, so a
  // rename of a database that is still open fails with EBUSY/EPERM. Closing
  // first is also simply correct: replacing a database file out from under a
  // live connection would leave that connection writing to a file nobody is
  // reading. `closeDatabase` is idempotent, so the shutdown that follows does
  // not mind.
  await closeDatabase()

  try {
    // 1. Move the current database aside, with its WAL sidecars. Nothing is
    //    deleted at any point in this function.
    for (const suffix of PRE_RESTORE_SIDECARS) {
      const from = `${live}${suffix}`
      if (!existsSync(from)) continue
      renameSync(from, `${preRestore}${suffix}`)
    }

    // 2. Put the backup in place. Copied rather than moved: moving would
    //    consume the slot, leaving no daily after a daily restore and making a
    //    second attempt impossible.
    copyFileSync(source, live)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // A partial swap is the one state this cannot leave behind. If the copy
    // failed after the move, the previous wiki is intact under the pre-restore
    // name, so put it back rather than leaving RTWiki with no database at all.
    if (!existsSync(live) && existsSync(preRestore)) {
      try {
        for (const suffix of PRE_RESTORE_SIDECARS) {
          if (existsSync(`${preRestore}${suffix}`))
            renameSync(`${preRestore}${suffix}`, `${live}${suffix}`)
        }
        rmSync(source, { force: true })
        getDatabaseLogger().error('Restore rolled back after a failed copy', {
          event: 'restore_rollback'
        })
      } catch (rollbackError) {
        getDatabaseLogger().error(
          'Restore rollback failed; the previous database is at the pre-restore path',
          {
            event: 'restore_rollback_failed',
            detail: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }
        )
      }
    }
    return { ok: false, reason: { kind: 'swap-failed', detail } }
  }

  getDatabaseLogger().info('Database replaced from backup', {
    event: 'restore_written',
    // The pre-restore filename, not a full path: the data directory carries the
    // user's name (SECURITY.md 10). The user is told the full location by the
    // UI, which can show it without writing it to a shareable log.
    preRestore
  })

  return { ok: true, preRestorePath: preRestore }
}

/** Exposed for the route's own typing; not a second source of truth. */
export type { Database }
