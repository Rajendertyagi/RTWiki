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

  await applyMigration(db, '003_page_hierarchy', (db) => {
    // Adjacency-list hierarchy (ADR: Page Hierarchy Data Model).
    // Adding an FK column via ADD COLUMN requires a NULL default - satisfied here.
    db.run('ALTER TABLE pages ADD COLUMN parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL')
    db.run('ALTER TABLE pages ADD COLUMN position INTEGER NOT NULL DEFAULT 0')

    // Deterministic backfill: every living page becomes a root positioned to
    // mirror the previous flat display order (updated_at DESC, rowid DESC).
    // Soft-deleted rows are excluded from sibling arithmetic.
    db.run(`
      UPDATE pages
      SET position = (
        SELECT COUNT(*)
        FROM pages AS p2
        WHERE p2.parent_id IS NULL
          AND p2.deleted_at IS NULL
          AND (
            p2.updated_at > pages.updated_at
            OR (p2.updated_at = pages.updated_at AND p2.rowid > pages.rowid)
          )
      )
      WHERE parent_id IS NULL AND deleted_at IS NULL
    `)

    db.run(
      'CREATE INDEX idx_pages_parent_position ON pages(parent_id, position) WHERE deleted_at IS NULL'
    )
  })

  await applyMigration(db, '004_page_links', (db) => {
    // Exact internal-link relationships between Rich Notes, maintained
    // transactionally on content save. No FK constraints: a link to a
    // deleted target must survive as a broken link (the source keeps its
    // stored ID), and deleting a linked target must never be blocked.
    db.run(`
      CREATE TABLE IF NOT EXISTS page_links (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id)
      )
    `)
    db.run('CREATE INDEX idx_page_links_target ON page_links(target_id)')
  })

  await applyMigration(db, '005_schedule', (db) => {
    // Study timetable: weekly/one-off periods, one-off reminders, and
    // user-created presets. No FK constraints: a linked page may be deleted,
    // and presets are independent user data.
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_entries (
        id TEXT PRIMARY KEY,
        recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('weekly', 'oneoff')),
        title TEXT NOT NULL,
        weekdays TEXT,
        date TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        linked_page_id TEXT,
        category TEXT,
        color TEXT,
        notes TEXT,
        notifications TEXT NOT NULL DEFAULT '{"enabled":true,"start":true,"fiveMinBefore":true,"customOffsets":[]}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        due_datetime TEXT NOT NULL,
        linked_page_id TEXT,
        message TEXT,
        notifications TEXT NOT NULL DEFAULT '{"enabled":true,"customOffsets":[]}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS schedule_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    db.run('CREATE INDEX idx_schedule_entries_enabled ON schedule_entries(enabled)')
    db.run('CREATE INDEX idx_reminders_enabled ON reminders(enabled)')
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
