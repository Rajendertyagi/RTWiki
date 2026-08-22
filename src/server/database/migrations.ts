import { getDatabaseLogger, type getDb } from './index.js'

export async function runMigrations(db: ReturnType<typeof getDb>): Promise<void> {
  await applyMigration(db, '001_create_pages', (db) => {
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
  })

  await applyMigration(db, '002_add_page_type', (db) => {
    db.run("ALTER TABLE pages ADD COLUMN page_type TEXT NOT NULL DEFAULT 'rich'")
  })
}

async function applyMigration(
  db: ReturnType<typeof getDb>,
  name: string,
  up: (db: ReturnType<typeof getDb>) => void
): Promise<void> {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    const existing = db.query('SELECT id FROM _migrations WHERE name = ?').get(name)
    if (existing) {
      db.run('COMMIT')
      getDatabaseLogger().info('Migration already applied', {
        event: 'migration',
        name,
        skipped: true
      })
      return
    }
    up(db)
    db.run('INSERT INTO _migrations (name) VALUES (?)', [name])
    db.run('COMMIT')
    getDatabaseLogger().info('Migration applied', { event: 'migration', name })
  } catch (err) {
    db.run('ROLLBACK')
    const message = err instanceof Error ? err.message : String(err)
    getDatabaseLogger().error('Migration failed', {
      event: 'migration',
      name,
      error: message
    })
    throw err
  }
}
