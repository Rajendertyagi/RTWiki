/**
 * Restore validation (docs/BACKUP_PLAN.md §7.1; docs/SECURITY.md §8).
 *
 * A restore replaces a live wiki, so this is the one place in the feature where
 * a wrong answer destroys data. Every check below exists because a weaker one
 * was measured to pass on a file that should have been refused.
 *
 * The steps run in order and stop at the first failure, returning a classified
 * reason rather than a message. The UI resolves the reason through `UI_TEXT`, so
 * a user is told *which* check failed ("this file is not a database") instead of
 * "invalid backup".
 *
 * Nothing here writes, and nothing here touches the live connection: a candidate
 * is opened through its own read-only handle, so validating a file can never
 * corrupt the database a restore would replace.
 */

import { Database } from 'bun:sqlite'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { BackupValidationReason } from '@rtwiki/shared/constants'
import { getDatabaseLogger } from '../database/index.js'
import { requiredMigrationNames } from '../database/migrations.js'

/** Bytes 0-15 of every SQLite file: "SQLite format 3" plus a NUL terminator. */
const SQLITE_HEADER = 'SQLite format 3\u0000'
const SQLITE_HEADER_BYTES = 16

export interface BackupCandidate {
  path: string
  byteSize: number
  modifiedAt: string
}

export type ValidationOutcome =
  | { ok: true; candidate: BackupCandidate }
  | { ok: false; reason: BackupValidationReason }

function refuse(reason: BackupValidationReason, detail?: string): ValidationOutcome {
  // Detail is a SQLite message or a file stat, never user content and never a
  // path -- the backup directory carries the user's name (SECURITY.md §10).
  getDatabaseLogger().warn('Backup file refused', {
    event: 'backup_validate',
    reason,
    ...(detail ? { detail } : {})
  })
  return { ok: false, reason }
}

/**
 * Step 1: the 16-byte header.
 *
 * Checked before opening so that selecting a photograph gets "this is not a
 * database" rather than SQLite's own "file is not a database" -- the same
 * distinction, but in words chosen for this application.
 */
function hasSqliteHeader(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return false
  }
  try {
    const header = Buffer.alloc(SQLITE_HEADER_BYTES)
    if (readSync(fd, header, 0, SQLITE_HEADER_BYTES, 0) < SQLITE_HEADER_BYTES) return false
    return header.toString('latin1') === SQLITE_HEADER
  } catch {
    return false
  } finally {
    closeSync(fd)
  }
}

/**
 * Steps 3 and 4: `PRAGMA integrity_check`, treating a throw as failure.
 *
 * `integrity_check` does not always answer -- it throws. Measured on SQLite
 * 3.53.2: a database truncated to 60% raises `database disk image is malformed`
 * and a file that is not a database at all raises `file is not a database`.
 * Both are corruption. A validator that only inspected returned rows would read
 * the throw as "no rows returned" and, depending on its own shape, could report
 * a wrecked file as merely unverified.
 */
function passesIntegrityCheck(db: Database): boolean | 'corrupt' {
  let rows: Array<Record<string, string>>
  try {
    rows = db.query('PRAGMA integrity_check').all() as Array<Record<string, string>>
  } catch (error) {
    getDatabaseLogger().error('Backup integrity check threw', {
      event: 'backup_validate',
      detail: error instanceof Error ? error.message : String(error)
    })
    return 'corrupt'
  }
  return rows.length === 1 && rows[0]?.integrity_check === 'ok'
}

/**
 * Step 5: `PRAGMA foreign_key_check`, which must return zero rows.
 *
 * Separate from `integrity_check` because SQLite documents that
 * `integrity_check` "does not find FOREIGN KEY errors". An orphaned row passes
 * every other check here and would be restored into a database whose own
 * `PRAGMA foreign_keys = ON` then rejects writes against it.
 */
function hasForeignKeyViolations(db: Database): boolean {
  return db.query('PRAGMA foreign_key_check').all().length > 0
}

/**
 * Step 6: the backup's `_migrations` against the running build's required set.
 *
 * Rejects in both directions. A backup carrying a migration this build has
 * never heard of was written by a newer RTWiki, and restoring it would run this
 * build against a schema it does not understand. A backup missing one the build
 * expects would leave the schema half-migrated -- pages present, columns absent,
 * with nothing failing loudly.
 *
 * `user_version` is deliberately not consulted: nothing in `src/` reads it, so
 * `_migrations` is the only authority that reflects what this build actually did.
 */
function schemaMatchesBuild(db: Database): BackupValidationReason | null {
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
    .get()
  if (!table) {
    // A valid SQLite file that is not an RTWiki database. It is missing every
    // migration, including the one that creates `_migrations` itself.
    return 'schema-missing-migration'
  }

  const present = new Set(
    (db.query('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  )
  const required = requiredMigrationNames()
  if (required.length === 0) {
    // A programming error, not a bad file: migrations have not run in this
    // process, so there is no correct set to compare against. Refusing is the
    // safe direction -- a restore that cannot be validated must not proceed.
    getDatabaseLogger().error('Cannot validate backup schema: no migrations required by this build')
    return 'schema-missing-migration'
  }

  for (const name of required) {
    if (!present.has(name)) return 'schema-missing-migration'
  }
  for (const name of present) {
    if (!required.includes(name)) return 'schema-too-new'
  }
  return null
}

/**
 * Runs the file-level validation steps against a candidate backup, in order.
 *
 * Step 7 -- user confirmation -- is not here. It is a decision, not a check, and
 * it belongs to the UI; the route that calls this must not act on a `true`
 * result without it having happened.
 */
export function validateBackupFile(path: string): ValidationOutcome {
  // Existence and size, which the confirmation dialog also reports.
  let byteSize: number
  let modifiedMs: number
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return refuse('not-a-file')
    byteSize = stat.size
    modifiedMs = stat.mtimeMs
  } catch (error) {
    return refuse('not-a-file', error instanceof Error ? error.message : String(error))
  }

  if (!hasSqliteHeader(path)) return refuse('not-a-database')

  // Its own read-only connection, never the live one.
  let db: Database
  try {
    db = new Database(path, { readonly: true })
  } catch (error) {
    return refuse('not-a-database', error instanceof Error ? error.message : String(error))
  }

  try {
    const integrity = passesIntegrityCheck(db)
    // Both non-true outcomes are corruption: one is an explicit refusal from
    // step 4, the other a check that answered with something other than `ok`.
    if (integrity !== true) return refuse('corrupt')

    if (hasForeignKeyViolations(db)) return refuse('foreign-key-violation')

    const schemaProblem = schemaMatchesBuild(db)
    if (schemaProblem) return refuse(schemaProblem)
  } catch (error) {
    // A throw from any step is a refusal, never a pass. Same rule as
    // `integrity_check` itself, applied to the whole sequence.
    return refuse('corrupt', error instanceof Error ? error.message : String(error))
  } finally {
    try {
      db.close()
    } catch {
      // A read-only handle that will not close is not worth failing a
      // validation over; the file is closed when the handle is collected.
    }
  }

  return {
    ok: true,
    candidate: { path, byteSize, modifiedAt: new Date(modifiedMs).toISOString() }
  }
}

/**
 * Whether the live database is mid-migration, in which case a one-file backup
 * would silently omit attachment bytes that still live in `data/attachments/`.
 *
 * Called before a backup is taken, not on a candidate. The plan's answer is to
 * refuse loudly rather than make the backup two-part: a partial backup that
 * looks complete is the failure worth avoiding.
 */
export function countAttachmentsAwaitingBytes(db: Database): number {
  try {
    const row = db.query('SELECT count(*) AS n FROM attachments WHERE data IS NULL').get() as {
      n: number
    } | null
    return row?.n ?? 0
  } catch {
    // No `attachments` table, or no `data` column: nothing is mid-migration as
    // far as this build is concerned. A database that predates ADR-014 keeps its
    // bytes in files, but it also has no rows the column could be missing for.
    return 0
  }
}
