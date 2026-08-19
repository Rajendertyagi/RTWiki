import type { getDb } from './index.js'
import { logger } from '../logging/index.js'

export async function runMigrations(db: ReturnType<typeof getDb>): Promise<void> {
  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  // Create pages table
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

  // Create search index table
  db.run(`
    CREATE TABLE IF NOT EXISTS search_index (
      page_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    )
  `)

  // Create FTS5 virtual table
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index_fts USING fts5(
      title, content,
      content='search_index',
      content_rowid='page_id'
    )
  `)

  // Mark migration as applied
  const existing = db.query('SELECT id FROM _migrations WHERE name = ?').get('001_create_pages')
  if (!existing) {
    db.run('INSERT INTO _migrations (name) VALUES (?)', '001_create_pages')
    logger.info('Migration "001_create_pages" applied successfully')
  } else {
    logger.info('Migration "001_create_pages" already applied, skipping')
  }
}
