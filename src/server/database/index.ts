import { Database } from 'bun:sqlite'
import { joinPaths } from '../config/index.js'
import { logger } from '../logging/index.js'

let dbInstance: Database | null = null
let dbPath: string | null = null

export function getDatabasePath(dataDir: string): string {
  if (dbPath) return dbPath
  dbPath = joinPaths(dataDir, 'rtwiki.sqlite')
  return dbPath
}

export function initDatabase(dataDir: string): Database {
  const path = getDatabasePath(dataDir)
  const sqlite = new Database(path)

  // WAL gives safe, concurrent reads with a single writer. foreign_keys is opt-in
  // in SQLite and must be enabled per connection.
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA busy_timeout = 5000')

  dbInstance = sqlite
  logger.info('Database connection established', { event: 'db_init' })
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
  const rows = db.query('PRAGMA integrity_check').all() as Array<Record<string, string>>
  const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok'
  if (!ok) {
    logger.error('Database integrity check failed', { event: 'db_integrity', detail: JSON.stringify(rows) })
  }
  return ok
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    dbPath = null
    logger.info('Database connection closed', { event: 'db_close' })
  }
}
