import type { getDb } from './index.js'
import { logger } from '../logging/index.js'

const MIGRATION_NAME = '001_create_pages'

/**
 * Applies the schema in a single transaction and records the applied migration
 * in the `_migrations` table so re-running is idempotent. On any failure the
 * transaction is rolled back and the error is re-thrown.
 */
export async function runMigrations(db: ReturnType<typeof getDb>): Promise<void> {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at TEXT,
        version INTEGER NOT NULL DEFAULT 0
      )
    `)

    db.run(`
      CREATE TABLE IF NOT EXISTS search_index (
        page_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
      )
    `)

    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
        title, content,
        content='search_index',
        content_rowid='page_id'
      )
    `)

    const existing = db.query('SELECT id FROM _migrations WHERE name = ?').get(MIGRATION_NAME)
    if (!existing) {
      db.run('INSERT INTO _migrations (name) VALUES (?)', [MIGRATION_NAME])
      logger.info('Migration applied', { event: 'migration', name: MIGRATION_NAME })
    } else {
      logger.info('Migration already applied', {
        event: 'migration',
        name: MIGRATION_NAME,
        skipped: true
      })
    }

    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    const message = err instanceof Error ? err.message : String(err)
    logger.error('Migration failed', { event: 'migration', error: message })
    throw err
  }
}
