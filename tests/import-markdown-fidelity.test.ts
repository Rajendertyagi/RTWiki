import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { runMigrations } from '../src/server/database/migrations.js'
import { ingestFile } from '../src/server/ingest/ingest-file.js'
import type { IngestDependencies } from '../src/server/ingest/ingest-types.js'
import { getPage } from '../src/server/repositories/page-repository.js'
import { parseMarkdownPageContent } from '../src/shared/schemas/markdown-content.js'

/**
 * The exact regression this stage exists to prevent.
 *
 * The old client read the file with `FileReader`, flattened nothing, and posted
 * the text through a conversion adapter. The ingest path must preserve the
 * original bytes' line breaks — including the blank lines around a fenced code
 * block — all the way into `pages.content`. A single `.replace(/\s+/g, ' ')`
 * anywhere on that path would turn this into one long line and break every
 * fenced block, list and heading in the imported note.
 */
const SOURCE = '# H\n\n- a\n- b\n\n```js\ncode\n```'

const deps: IngestDependencies = {
  logger: {
    info() {},
    warn() {},
    error() {},
    async flush() {},
    async close() {}
  }
}

describe('Markdown import fidelity', () => {
  it('keeps a fenced code block and its newlines byte-for-byte', async () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await runMigrations(db)

    const result = await ingestFile(
      db,
      {
        sourceKind: 'file',
        bytes: new TextEncoder().encode(SOURCE),
        reportedType: 'text/markdown',
        originalName: 'regression.md',
        createPage: true
      },
      deps
    )
    expect(result.ok).toBe(true)
    if (!result.ok || result.pageId === null) return

    const page = getPage(db, result.pageId)
    expect(page).not.toBeNull()
    if (!page) return
    const parsed = parseMarkdownPageContent(page.content)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.markdown).toBe(SOURCE)
  })
})
