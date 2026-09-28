import { Database } from 'bun:sqlite'

export type { Database } from 'bun:sqlite'

import { DATABASE_FILENAME } from '@rtwiki/shared/constants'
import { joinPaths } from '../config/index.js'
import { createConsoleLogger, type Logger } from '../logging/index.js'

let dbInstance: Database | null = null
let dbPath: string | null = null

// Database events are logged through an explicitly injected logger. The
// default console logger keeps module imports side-effect free: importing
// this module never creates files. bootstrap() installs the real file logger
// via setDatabaseLogger().
let databaseLog: Logger = createConsoleLogger()

export function setDatabaseLogger(log: Logger): void {
  databaseLog = log
}

export function getDatabaseLogger(): Logger {
  return databaseLog
}

/**
 * Page size and auto-vacuum mode, applied together and before anything else.
 *
 * ## Order matters, and getting it wrong is completely silent
 *
 * SQLite honours both only on a database with no tables yet. Two traps compound:
 *
 * 1. On a populated database `PRAGMA auto_vacuum` is a no-op - the value stays 0,
 *    nothing is raised, and deleted space is never returned. `VACUUM` afterwards
 *    is what makes it take effect.
 * 2. **`PRAGMA page_size` is ignored entirely once the database is in WAL mode,
 *    and `VACUUM` cannot undo that.** Verified: setting `journal_mode = WAL`
 *    first and `page_size = 8192` second leaves the page size at 4096, before or
 *    after a `VACUUM`. Setting the page size first and WAL second works.
 *
 * So these are applied *before* `journal_mode = WAL`, and the values are read
 * back. A setting whose failure is invisible is worse than no setting at all.
 *
 * `auto_vacuum = INCREMENTAL` is what makes a deleted image give its space back.
 * Measured: four 8 MB blobs inserted then deleted leave the file at 32.1 MB with
 * the default mode, and at 0.0 MB with this one once `incremental_vacuum` runs.
 *
 * 8192 is one of the two page sizes SQLite's own guidance names as best for
 * large BLOB I/O. See ADR-014.
 */
const STORAGE_PRAGMAS: ReadonlyArray<{ pragma: string; expected: number; label: string }> = [
  { pragma: 'page_size = 8192', expected: 8192, label: 'page_size' },
  { pragma: 'auto_vacuum = INCREMENTAL', expected: 2, label: 'auto_vacuum' }
]

/** Reads a single-value pragma, which `bun:sqlite` returns keyed by column name. */
function readPragma(db: Database, name: string): number | null {
  const row = db.query(`PRAGMA ${name}`).get() as Record<string, unknown> | null
  if (!row) return null
  const value = Object.values(row)[0]
  return typeof value === 'number' ? value : null
}

/**
 * Applies the storage pragmas and confirms they took effect.
 *
 * Safe to call on every startup: the pragmas are no-ops once the values are
 * already correct, and the verification is what makes an existing database that
 * predates this change report itself rather than quietly never reclaiming space.
 */
export function ensureStoragePragmas(db: Database): string[] {
  for (const entry of STORAGE_PRAGMAS) {
    db.exec(`PRAGMA ${entry.pragma}`)
  }
  return STORAGE_PRAGMAS.filter((entry) => readPragma(db, entry.label) !== entry.expected).map(
    (entry) => entry.label
  )
}

export function getDatabasePath(dataDir: string): string {
  if (dbPath) return dbPath
  dbPath = joinPaths(dataDir, DATABASE_FILENAME)
  return dbPath
}

export function initDatabase(dataDir: string): Database {
  const path = getDatabasePath(dataDir)
  const sqlite = new Database(path)

  // BEFORE journal_mode = WAL, and before any table. See STORAGE_PRAGMAS: in WAL
  // mode the page size cannot be changed at all, not even by VACUUM, so setting
  // it afterwards fails without any error.
  const notApplied = ensureStoragePragmas(sqlite)

  // WAL gives safe, concurrent reads with a single writer. foreign_keys is opt-in
  // in SQLite and must be enabled per connection.
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA busy_timeout = 5000')

  // FULL, not NORMAL, and not left unset.
  //
  // `synchronous` is a connection setting, not a property of the file, so it
  // must be set on every connection and it is set here once because this is the
  // one place a connection is created.
  //
  // It is load-bearing for backup. SQLite documents that for `VACUUM INTO`,
  // "if the PRAGMA synchronous setting of the original database is NORMAL or
  // FULL, then SQLite invokes fsync() to sync the output database to disk after
  // it has been written" -- so a power loss after a backup completes cannot
  // corrupt it. Left unset, that guarantee rests on a compile-time default
  // inside the bundled SQLite, which this project does not control.
  //
  // NORMAL is the tempting choice because it is the usual performance trade: in
  // WAL mode it still survives an application crash, trading only power-loss
  // durability for throughput. That is the wrong trade here. Autosave commits
  // every PROVISIONAL_AUTOSAVE_DEBOUNCE_MS, so the fsync cost is a handful per
  // second and negligible, and the thing being protected is someone's notes.
  sqlite.exec('PRAGMA synchronous = FULL')

  if (notApplied.length > 0) {
    // A database that already had tables. The page size in particular cannot be
    // recovered without recreating the file, so this says so plainly rather than
    // implying the setting will take effect on a later run.
    databaseLog.warn('Storage settings could not be fully applied to this database', {
      event: 'db_storage_pragmas_stale',
      // Names only. No path, no user content.
      pragmas: notApplied.join(',')
    })
  }

  dbInstance = sqlite
  databaseLog.info('Database connection established', { event: 'db_init' })
  return sqlite
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return dbInstance
}

/**
 * Runs `PRAGMA integrity_check`. Returns true only when SQLite reports a single
 * 'ok' row. A corrupt database must never be reported as healthy.
 */
export function checkIntegrity(): boolean {
  const db = getDb()

  // `PRAGMA integrity_check` does not always *answer* — it throws. Measured on
  // SQLite 3.53.2: a database truncated to 60% raises
  // `database disk image is malformed`, and a file that is not a database at all
  // raises `file is not a database`. Both are corruption, so both are `false`.
  //
  // Without this, the worst corruption escaped as a raw SQLiteError instead of
  // the intended result: at `bootstrap.ts` the log line and the human-readable
  // message both sat after the call and so never ran, and the user saw a
  // SQLite message rather than "your database could not be read".
  //
  // **Any future validator must treat a throw as failure**, not merely as
  // "not ok" -- `integrity_check` alone is also not sufficient, because it does
  // not check foreign keys; see SECURITY.md 8.1.
  let rows: Array<Record<string, string>>
  try {
    rows = db.query('PRAGMA integrity_check').all() as Array<Record<string, string>>
  } catch (error) {
    databaseLog.error('Database integrity check failed', {
      event: 'db_integrity',
      detail: error instanceof Error ? error.message : String(error)
    })
    return false
  }

  const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok'
  if (!ok) {
    databaseLog.error('Database integrity check failed', {
      event: 'db_integrity',
      detail: JSON.stringify(rows)
    })
  }
  return ok
}

export async function closeDatabase(): Promise<void> {
  // `dbPath` is cleared whether or not a handle was open. It is only reachable
  // from inside the `if` when there is a handle, which is the case this feature
  // creates: a restore closes the connection before swapping the file, so
  // `dbInstance` is already null on a second call and the cached path would
  // survive it -- leaving the module reporting the path of a database it no
  // longer has open, and pointing a later `initDatabase` at a file another
  // test (or another restore) has moved away.
  dbPath = null
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    databaseLog.info('Database connection closed', { event: 'db_close' })
  }
}
