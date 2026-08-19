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

  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA journal_mode = WAL')

  dbInstance = sqlite
  logger.info(`Database initialized at ${path}`)
  return sqlite
}

export function getDb(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return dbInstance
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    dbPath = null
    logger.info('Database connection closed')
  }
}
