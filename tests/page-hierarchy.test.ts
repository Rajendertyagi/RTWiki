import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { runMigrations } from '../src/server/database/migrations.js'
import {
  createPage,
  HierarchyError,
  movePage,
  nextChildPosition
} from '../src/server/repositories/page-repository.js'
import { createPageRoutes } from '../src/server/routes/pages.js'
import { getPage, softDeletePage } from '../src/server/services/page-service.js'

/**
 * Legacy pre-003 database: only migration 001 is recorded, so running the
 * framework applies 002 (page_type) and 003 (hierarchy + backfill) over
 * genuinely legacy rows - proving the deterministic backfill against real
 * pre-existing data.
 */
function makeLegacyDb(): Database {
  const db = new Database(':memory:')
  db.run(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)
  db.run("INSERT INTO _migrations (name) VALUES ('001_create_pages')")
  db.run(`
    CREATE TABLE pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      deleted_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )
  `)
  db.run(`
    CREATE TABLE search_index (
      page_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT ''
    )
  `)
  return db
}

interface HierarchyRow {
  id: string
  parent_id: string | null
  position: number
  deleted_at: string | null
}

function livingRoots(db: Database): HierarchyRow[] {
  return db
    .query(
      'SELECT id, parent_id, position, deleted_at FROM pages WHERE deleted_at IS NULL AND parent_id IS NULL ORDER BY position, rowid'
    )
    .all() as HierarchyRow[]
}

function addLegacyPage(db: Database, id: string, updatedAt: string): void {
  db.run(
    "INSERT INTO pages (id, title, content, created_at, updated_at, version) VALUES (?, ?, '', ?, ?, 1)",
    [id, id, updatedAt]
  )
  db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [id, id, ''])
}

describe('migration 003_page_hierarchy', () => {
  it('applies exactly once and backfills living roots in display order', () => {
    const db = makeLegacyDb()
    // Oldest first: display order (updated_at DESC) must be c(0), b(1), a(2).
    addLegacyPage(db, 'a', '2026-01-01T00:00:00.000Z')
    addLegacyPage(db, 'b', '2026-01-02T00:00:00.000Z')
    addLegacyPage(db, 'c', '2026-01-03T00:00:00.000Z')

    runMigrations(db)

    const names = db.query('_migrations').all() as Array<{ name: string }>
    expect(names.filter((n) => n.name === '003_page_hierarchy').length).toBe(1)

    const roots = livingRoots(db)
    expect(roots.map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(roots.map((r) => r.position)).toEqual([0, 1, 2])
    db.close()
  })

  it('excludes soft-deleted rows from sibling arithmetic', () => {
    const db = makeLegacyDb()
    addLegacyPage(db, 'a', '2026-01-01T00:00:00.000Z')
    addLegacyPage(db, 'b', '2026-01-02T00:00:00.000Z')
    db.run("UPDATE pages SET deleted_at = '2026-01-05T00:00:00.000Z' WHERE id = 'b'")

    runMigrations(db)

    const roots = livingRoots(db)
    expect(roots.length).toBe(1)
    expect(roots[0].id).toBe('a')
    expect(roots[0].position).toBe(0)
    db.close()
  })

  it('first-run databases gain hierarchy columns without legacy rows', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const cols = db.query("PRAGMA table_info('pages')").all() as Array<{ name: string }>
    expect(cols.some((c) => c.name === 'parent_id')).toBe(true)
    expect(cols.some((c) => c.name === 'position')).toBe(true)
    db.close()
  })
})

describe('hierarchy behaviour', () => {
  function makeDb(): Database {
    const db = new Database(':memory:')
    runMigrations(db)
    return db
  }

  /** Seeds a living page at the end of its parent's children. */
  function seed(db: Database, id: string, title: string, parentId: string | null = null): void {
    const position = nextChildPosition(db, parentId)
    createPage(db, id, title, 'rich', JSON.stringify([{ type: 'paragraph' }]), title, {
      parentId,
      position
    })
  }

  it('allocates contiguous sibling positions on create', () => {
    const db = makeDb()
    seed(db, 'a', 'A')
    seed(db, 'b', 'B')
    seed(db, 'c', 'C')
    const positions = livingRoots(db).map((r) => r.position)
    expect(positions).toEqual([0, 1, 2])
    db.close()
  })

  it('same-parent move reorders with final-index-after-removal semantics', () => {
    const db = makeDb()
    seed(db, 'a', 'A')
    seed(db, 'b', 'B')
    seed(db, 'c', 'C')
    // Move last page to front: remove c → [a,b], insert at 0 → [c,a,b].
    const result = movePage(db, 'c', null, 0)
    expect(result.destinationSiblings.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(livingRoots(db).map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(livingRoots(db).map((r) => r.position)).toEqual([0, 1, 2])
    db.close()
  })

  it('cross-parent move reparents and reindexes both sibling sets', () => {
    const db = makeDb()
    seed(db, 'root', 'Root')
    seed(db, 'child', 'Child', 'root')
    seed(db, 'moved', 'Moved')
    // Move 'moved' under 'root' at index 0, before 'child'.
    const result = movePage(db, 'moved', 'root', 0)
    expect(result.page.parentId).toBe('root')
    expect(result.originSiblings.map((s) => s.id)).toEqual([])
    expect(result.destinationSiblings.map((s) => s.id)).toEqual(['moved', 'child'])
    const child = getPage(db, 'child')
    expect(child?.position).toBe(1)
    db.close()
  })

  it('rejects moving a page into its own descendant', () => {
    const db = makeDb()
    seed(db, 'p', 'P')
    seed(db, 'x', 'X', 'p')
    expect(() => movePage(db, 'p', 'x', 0)).toThrowError(HierarchyError)
    try {
      movePage(db, 'p', 'x', 0)
    } catch (err) {
      expect((err as HierarchyError).status).toBe(400)
      expect((err as Error).message).toContain('descendants')
    }
    db.close()
  })

  it('rejects self-moves', () => {
    const db = makeDb()
    seed(db, 'solo', 'Solo')
    expect(() => movePage(db, 'solo', 'solo', 0)).toThrowError(HierarchyError)
    db.close()
  })

  it('moving to the current position is a valid idempotent operation', () => {
    const db = makeDb()
    seed(db, 'a', 'A')
    seed(db, 'b', 'B')
    const result = movePage(db, 'b', null, 1)
    expect(result.destinationSiblings.map((s) => s.id)).toEqual(['a', 'b'])
    db.close()
  })

  it('clamps oversized positions to the destination end', () => {
    const db = makeDb()
    seed(db, 'a', 'A')
    seed(db, 'b', 'B')
    const result = movePage(db, 'a', null, 999)
    expect(result.destinationSiblings.map((s) => s.id)).toEqual(['b', 'a'])
    db.close()
  })

  it('nextChildPosition appends after the highest living sibling', () => {
    const db = makeDb()
    seed(db, 'a', 'A')
    seed(db, 'b', 'B')
    expect(nextChildPosition(db, null)).toBe(2)
    db.close()
  })

  it('deleting a mid-tree parent promotes children at the former position', () => {
    const db = makeDb()
    seed(db, 'g1', 'G1')
    seed(db, 'g2', 'G2')
    seed(db, 'p', 'P', 'g1')
    seed(db, 'c1', 'C1', 'p')
    seed(db, 'c2', 'C2', 'p')
    // g1 children: [P]; promote C1,C2 into g1 at P's former position (0).
    softDeletePage(db, 'p')
    const promoted = db
      .query(
        'SELECT id, position FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, rowid'
      )
      .all('g1') as Array<{ id: string; position: number }>
    expect(promoted.map((r) => r.id)).toEqual(['c1', 'c2', 'g2'])
    expect(promoted.map((r) => r.position)).toEqual([0, 1, 2])
    // Deleted page leaves no FTS entry; promoted children remain searchable.
    const fts = db.query('SELECT page_id FROM search_index ORDER BY page_id').all() as Array<{
      page_id: string
    }>
    expect(fts.map((f) => f.page_id).sort()).toEqual(['c1', 'c2', 'g1', 'g2'])
    db.close()
  })
})

describe('PATCH rejects hierarchy changes', () => {
  it('returns 400 when parentId is supplied to PATCH', async () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const routes = createPageRoutes(() => db)
    const app = new Hono().route('/api/pages', routes)

    const res = await app.request('/api/pages/p1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', parentId: 'p2' })
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('move')
    db.close()
  })
})
