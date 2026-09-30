import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'

/**
 * Migration `010_mindmap_pages_to_diagram`.
 *
 * The Mind Map page is retired, and the page-type enum no longer accepts
 * `mindmap`. That makes this migration load-bearing rather than cosmetic: the
 * enum guards the whole page response, so a single surviving row would fail
 * validation for every page in the list, not just its own.
 *
 * The interesting case is the database that already has the row, because a fresh
 * database never exercises the UPDATE at all. Each test therefore rolls the
 * recorded migration back before re-running, which is what an upgrade from a
 * previous build actually looks like.
 */
describe('migration 010: mindmap pages become diagram pages', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  /** Re-runs migrations as if this build were being applied to an older database. */
  async function runAsUpgrade(): Promise<void> {
    db.run('DELETE FROM _migrations WHERE name = ?', ['010_mindmap_pages_to_diagram'])
    await runMigrations(db)
  }

  function pageTypeOf(title: string): string | undefined {
    const row = db.query('SELECT page_type FROM pages WHERE title = ?').get(title) as
      | { page_type: string }
      | undefined
    return row?.page_type
  }

  beforeEach(async () => {
    tempDir = join(tmpdir(), `rtwiki-m010-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterEach(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('rewrites a surviving mindmap row to diagram', async () => {
    db.run(
      "INSERT INTO pages (id, title, content, page_type, parent_id, position) VALUES ('p1', 'Old MindMap', '', 'mindmap', NULL, 0)"
    )
    expect(pageTypeOf('Old MindMap')).toBe('mindmap')

    await runAsUpgrade()

    expect(pageTypeOf('Old MindMap')).toBe('diagram')
  })

  it('leaves every other page type exactly as it was', async () => {
    for (const [id, title, type] of [
      ['p1', 'A Rich Note', 'rich'],
      ['p2', 'An Html Page', 'html'],
      ['p3', 'A Markdown Note', 'markdown'],
      ['p4', 'A Diagram Page', 'diagram'],
      ['p5', 'An Old MindMap', 'mindmap']
    ] as const) {
      db.run(
        'INSERT INTO pages (id, title, content, page_type, parent_id, position) VALUES (?, ?, ?, ?, NULL, 0)',
        [id, title, '', type]
      )
    }

    await runAsUpgrade()

    expect(pageTypeOf('A Rich Note')).toBe('rich')
    expect(pageTypeOf('An Html Page')).toBe('html')
    expect(pageTypeOf('A Markdown Note')).toBe('markdown')
    expect(pageTypeOf('A Diagram Page')).toBe('diagram')
    expect(pageTypeOf('An Old MindMap')).toBe('diagram')
  })

  it('keeps the row rather than deleting it, with its content and place intact', async () => {
    // The content is a v2 visual page whose own stored `type` is still `mindmap`;
    // that marker is normalised on read (visual-page-content.ts) rather than
    // rewritten here, so the row must survive for that to be reachable.
    const content = JSON.stringify({
      version: 2,
      type: 'mindmap',
      blocks: [{ id: 'a', source: 'mindmap\n  root((One))' }]
    })
    db.run(
      "INSERT INTO pages (id, title, content, page_type, parent_id, position) VALUES ('p1', 'Keep Me', ?, 'mindmap', NULL, 0)",
      [content]
    )

    await runAsUpgrade()

    const row = db
      .query("SELECT page_type, content, parent_id FROM pages WHERE title = 'Keep Me'")
      .get() as { page_type: string; content: string; parent_id: string | null } | undefined
    expect(row).toBeDefined()
    expect(row?.page_type).toBe('diagram')
    expect(row?.parent_id).toBeNull()
    expect(JSON.parse(row?.content ?? '{}').blocks[0].source).toBe('mindmap\n  root((One))')
  })

  it('is recorded, and a re-run changes nothing', async () => {
    db.run(
      "INSERT INTO pages (id, title, content, page_type, parent_id, position) VALUES ('p1', 'Twice', '', 'mindmap', NULL, 0)"
    )

    await runAsUpgrade()
    expect(
      db.query('SELECT name FROM _migrations WHERE name = ?').get('010_mindmap_pages_to_diagram')
    ).toBeDefined()

    await runMigrations(db)
    await runMigrations(db)

    expect(pageTypeOf('Twice')).toBe('diagram')
    const count = db
      .query("SELECT COUNT(*) AS n FROM _migrations WHERE name = '010_mindmap_pages_to_diagram'")
      .get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('leaves no mindmap row behind on a fresh database', async () => {
    // The empty case still has to hold: a build that migrated an old database and
    // then created a new one must not reintroduce the value.
    await runAsUpgrade()
    const stragglers = db
      .query("SELECT COUNT(*) AS n FROM pages WHERE page_type = 'mindmap'")
      .get() as { n: number }
    expect(stragglers.n).toBe(0)
  })
})
