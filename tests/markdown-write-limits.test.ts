import type { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { createPage, PageValidationError, updatePage } from '../src/server/services/page-service.js'
import { MAX_MARKDOWN_SOURCE_CHARS } from '../src/shared/constants/index.js'
import { serializeMarkdownContent } from '../src/shared/schemas/markdown-content'

/**
 * The authoritative write path for a page's content.
 *
 * The Markdown character limit used to be enforced on **create only**. `updatePage`
 * re-validated HTML and the visual page types but had no Markdown branch, so a note
 * could be autosaved past 100,000 characters — past the point its own editor would read
 * it back, where `markdown-workspace` falls back to the starter template. The user
 * pasted a large document, autosave stored it, and the note then rendered as a blank
 * template with the real content apparently gone. Nothing errored at any point: create
 * was the only door with a lock on it.
 */

/** A real migrated database, not a stub: content and its search row are written together. */
async function newDb(): Promise<Database> {
  const dir = join(tmpdir(), `rtwiki-mdlimit-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  const db = initDatabase(dir)
  await runMigrations(db)
  return db
}

/** The current optimistic-lock version, so an update is not rejected as stale. */
function currentVersion(db: Database, id: string): number {
  const row = db.query('SELECT version FROM pages WHERE id = ?').get(id) as { version: number }
  return row.version
}

function wrap(source: string): string {
  return serializeMarkdownContent({ version: 1, markdown: source })
}

describe('the Markdown character limit is enforced on every write', () => {
  it('accepts content at the limit on update', async () => {
    const db = await newDb()
    const page = createPage(db, { title: 'Doc', pageType: 'markdown', content: '' })
    const updated = updatePage(db, page.id, {
      content: wrap('x'.repeat(MAX_MARKDOWN_SOURCE_CHARS)),
      version: currentVersion(db, page.id)
    })
    expect(updated).not.toBeNull()
  })

  it('refuses content over the limit on update, which autosave would otherwise walk past', async () => {
    const db = await newDb()
    const page = createPage(db, { title: 'Doc', pageType: 'markdown', content: '' })
    let thrown: unknown = null
    try {
      updatePage(db, page.id, {
        content: wrap('x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1)),
        version: currentVersion(db, page.id)
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown, 'updatePage must refuse an over-length note').toBeInstanceOf(PageValidationError)
    if (thrown instanceof PageValidationError) {
      expect(thrown.message).toContain('100,000')
    }
  })

  it('leaves the stored note untouched when an update is refused', async () => {
    // A refused write must not half-apply. If the row were rewritten before validation,
    // the user would lose their note to an error that claimed to protect it.
    const db = await newDb()
    const page = createPage(db, { title: 'Doc', pageType: 'markdown', content: '' })
    const good = wrap('# Keep me')
    updatePage(db, page.id, { content: good, version: currentVersion(db, page.id) })
    expect(() =>
      updatePage(db, page.id, {
        content: wrap('y'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1)),
        version: 1
      })
    ).toThrow()
    const row = db.query('SELECT content FROM pages WHERE id = ?').get(page.id) as {
      content: string
    }
    expect(row.content).toBe(good)
  })

  it('refuses malformed content on update for the other constrained types too', async () => {
    // The same door, for the types that already had one, so the fix does not become a
    // Markdown special case that quietly skips everything else.
    const db = await newDb()
    const html = createPage(db, { title: 'H', pageType: 'html', content: '' })
    expect(() =>
      updatePage(db, html.id, { content: 'not json at all', version: currentVersion(db, html.id) })
    ).toThrow()
  })

  it('does not replace a note with a starter template when an update arrives empty', async () => {
    // On create, '' means "give me a starter document". On update it means the caller
    // sent nothing usable, and silently substituting a template would destroy the note.
    const db = await newDb()
    const page = createPage(db, { title: 'Doc', pageType: 'markdown', content: '' })
    const good = wrap('# Real content')
    updatePage(db, page.id, { content: good, version: currentVersion(db, page.id) })
    expect(() => updatePage(db, page.id, { content: '', version: 1 })).toThrow()
    const row = db.query('SELECT content FROM pages WHERE id = ?').get(page.id) as {
      content: string
    }
    expect(row.content).toBe(good)
  })

  it('still creates a starter document when the content is empty', async () => {
    // The create-side default is unchanged; only update changed.
    const db = await newDb()
    const page = createPage(db, { title: 'Fresh', pageType: 'markdown', content: '' })
    expect(page.content).toContain('markdown')
  })

  it('does not put an over-length body into the search index', async () => {
    // The index is written in the same transaction as the content, so a refusal has to
    // stop the row being created at all. Otherwise search would surface a body the
    // editor cannot open.
    const db = await newDb()
    const page = createPage(db, { title: 'Doc', pageType: 'markdown', content: '' })
    const before = db
      .query('SELECT length(content) AS n FROM search_index WHERE page_id = ?')
      .get(page.id) as { n: number }
    expect(() =>
      updatePage(db, page.id, {
        content: wrap('z'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1)),
        version: 1
      })
    ).toThrow()
    const after = db
      .query('SELECT length(content) AS n FROM search_index WHERE page_id = ?')
      .get(page.id) as { n: number }
    expect(after.n).toBe(before.n)
  })
})
