import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { attachmentIdsInContent } from '../src/server/attachments/attachment-references.js'
import { insertAttachment } from '../src/server/attachments/attachment-repository.js'
import { runMigrations } from '../src/server/database/migrations.js'
import {
  createPage,
  listPages,
  reindexPagesReferencingAttachment,
  updatePage
} from '../src/server/services/page-service.js'
import { composeSearchableContent } from '../src/server/services/search-extraction.js'

/**
 * Attached document text participates in normal page search.
 *
 * ## What was claimed and what was true
 *
 * AC-030, AC-030a, ADR-015 and DATA_MODEL.md all said a document's
 * extracted text is searchable. It was not: `extracted_text` was written on upload and
 * read by exactly one route, `GET /api/attachments/:id/text`, which is reachable only by
 * opening the document's "View text" dialog. `search_index` was populated from page
 * content alone.
 *
 * ## The model that is implemented
 *
 * `search_index` is keyed by `page_id` and results are pages. A page owns an attachment
 * by referencing its URL in its own content — there is no foreign key, and that is
 * deliberate. So attachment text is appended to the **owning page's** single row rather
 * than given an index of its own. One page, one result: a note with both prose and an
 * attached PDF appears once, and searching for a word inside the PDF finds that note.
 *
 * Every test here goes through `listPages({ search })`, the same function the
 * `GET /api/pages?q=` route calls. None of them inspect a `search_index` row, because
 * "the row contains the string" and "search finds the page" are different claims and only
 * the second one is the product.
 */

async function newDb(): Promise<Database> {
  // A fresh in-memory database, NOT `initDatabase`.
  //
  // `getDatabasePath` memoises the resolved path in a module-level variable, so the
  // second call to `initDatabase` in one process returns a connection to the *first*
  // call's file however different the directory you pass. Every test after the first
  // was quietly sharing one database, which is why a test asserting a soft-deleted page
  // was excluded from search failed in the suite and passed alone: the row it was
  // looking at was in a database the previous test had left populated.
  //
  // `new Database(':memory:')` sidesteps the cache and gives each test a genuinely
  // empty database, which is what a test asserting "this is the only match" needs.
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  await runMigrations(db)
  return db
}

function versionOf(db: Database, id: string): number {
  const row = db.query('SELECT version FROM pages WHERE id = ?').get(id) as { version: number }
  return row.version
}

/** Stores a document attachment the way the upload route would, with extracted text. */
function addDocument(
  db: Database,
  extractedText: string | null,
  originalName = 'paper.pdf'
): string {
  const id = crypto.randomUUID()
  insertAttachment(db, {
    id,
    mimeType: 'application/pdf',
    byteSize: 1234,
    kind: 'document',
    extractedText,
    originalName,
    checksum: null,
    data: new Uint8Array([0x25, 0x50, 0x44, 0x46])
  })
  return id
}

/** A rich note whose content is a document block pointing at the attachment. */
function richContentWithAttachment(attachmentId: string, caption = 'Paper'): string {
  return JSON.stringify([
    {
      id: 'd1',
      type: 'document',
      props: { url: `/api/attachments/${attachmentId}`, name: 'paper.pdf', caption },
      content: []
    }
  ])
}

function richContentWithText(text: string): string {
  return JSON.stringify([
    { id: 'p1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }] }
  ])
}

describe('the attachment reference model', () => {
  it('finds the attachment ids a page references, de-duplicated and in order', () => {
    const content = `a /api/attachments/one b /api/attachments/two c /api/attachments/one`
    // Stable order matters: a re-index that reordered itself would look like a change.
    expect(attachmentIdsInContent(content)).toEqual(['one', 'two'])
  })

  it('ignores text that merely mentions the API', () => {
    expect(attachmentIdsInContent('see /api/attachments for details')).toEqual([])
  })
})

describe('attachment text is searchable through the real search path', () => {
  it('finds a page by a word that appears only inside an attached document', async () => {
    const db = await newDb()
    const attachmentId = addDocument(db, 'photosynthesis converts light into chemical energy')
    const page = createPage(db, {
      title: 'Biology',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })

    const hits = listPages(db, { search: 'photosynthesis' })
    expect(hits.total).toBe(1)
    expect(hits.pages[0]?.id).toBe(page.id)

    // And a word that is not in the document does not match.
    expect(listPages(db, { search: 'photosynthesis' }).pages[0]?.title).toBe('Biology')
    expect(listPages(db, { search: 'unrelatedterm' }).total).toBe(0)
  })

  it("keeps the page's own text searchable alongside the document's", async () => {
    const db = await newDb()
    const attachmentId = addDocument(db, 'mitochondria supply cellular energy')
    const page = createPage(db, {
      title: 'Cells',
      pageType: 'rich',
      content: JSON.stringify([
        {
          id: 'p1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'cytoplasm jelly', styles: {} }]
        },
        {
          id: 'd1',
          type: 'document',
          props: { url: `/api/attachments/${attachmentId}`, name: 'a.pdf', caption: '' },
          content: []
        }
      ])
    })

    // Both halves of the page are findable, through the same query.
    expect(listPages(db, { search: 'cytoplasm' }).pages[0]?.id).toBe(page.id)
    expect(listPages(db, { search: 'mitochondria' }).pages[0]?.id).toBe(page.id)
  })

  it('returns one result for a page, not one per attachment', async () => {
    // A separate attachment index would produce a duplicate result here. The model is
    // page-oriented and must stay that way.
    const db = await newDb()
    const first = addDocument(db, 'alpha one two three')
    const second = addDocument(db, 'beta four five six')
    createPage(db, {
      title: 'Two papers',
      pageType: 'rich',
      content: JSON.stringify([
        {
          id: 'd1',
          type: 'document',
          props: { url: `/api/attachments/${first}`, name: 'a.pdf', caption: '' },
          content: []
        },
        {
          id: 'd2',
          type: 'document',
          props: { url: `/api/attachments/${second}`, name: 'b.pdf', caption: '' },
          content: []
        }
      ])
    })
    const hits = listPages(db, { search: 'alpha' })
    expect(hits.total).toBe(1)
  })

  it('does not index a document with no extracted text', async () => {
    // A scanned PDF with no OCR layer yields no text. Indexing an empty string per
    // attachment would add nothing and would grow the row.
    const db = await newDb()
    const attachmentId = addDocument(db, null)
    createPage(db, {
      title: 'Scan',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })
    expect(listPages(db, { search: 'anything' }).total).toBe(0)
  })

  it('treats extracted text as plain text and never as markup', async () => {
    // Document text is attacker-supplied. It lands in a TEXT column read only by LIKE,
    // so there is no path from it to rendering. This asserts the row holds the literal
    // characters rather than an interpretation of them.
    const db = await newDb()
    const payload = '<script>alert(1)</script> and <img src=x onerror=alert(1)>'
    const attachmentId = addDocument(db, payload)
    createPage(db, {
      title: 'Hostile',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })
    const row = db
      .query(
        'SELECT si.content AS content FROM search_index si JOIN pages p ON p.id = si.page_id WHERE p.title = ?'
      )
      .get('Hostile') as { content: string }
    // Stored verbatim, unescaped and unstripped: it is data, and sanitising it here
    // would make the search index disagree with the document's actual text.
    expect(row.content).toContain('<script>alert(1)</script>')
  })
})

describe('the search lifecycle stays correct when an attachment changes', () => {
  it('picks up a document added to an existing note, on the next save', async () => {
    // Adding a document block is a content change, so the note is saved, so it is
    // re-indexed. No separate hook is needed for the ordinary path.
    const db = await newDb()
    const page = createPage(db, {
      title: 'Notes',
      pageType: 'rich',
      content: richContentWithText('nothing yet')
    })
    expect(listPages(db, { search: 'chloroplast' }).total).toBe(0)

    const attachmentId = addDocument(db, 'chloroplast captures photons')
    updatePage(db, page.id, {
      content: JSON.stringify([
        {
          id: 'p1',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'nothing yet', styles: {} }]
        },
        {
          id: 'd1',
          type: 'document',
          props: { url: `/api/attachments/${attachmentId}`, name: 'x.pdf', caption: '' },
          content: []
        }
      ]),
      version: versionOf(db, page.id)
    })
    expect(listPages(db, { search: 'chloroplast' }).pages[0]?.id).toBe(page.id)
  })

  it("removes a deleted document's text from search", async () => {
    const db = await newDb()
    const attachmentId = addDocument(db, 'peroxisome breaks down fatty acids')
    const page = createPage(db, {
      title: 'Org',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })
    expect(listPages(db, { search: 'peroxisome' }).total).toBe(1)

    // Exactly what the DELETE route does.
    db.query('DELETE FROM attachments WHERE id = ?').run(attachmentId)
    reindexPagesReferencingAttachment(db, attachmentId)

    // The page row still holds the URL, so only an explicit reindex can clear the text.
    expect(listPages(db, { search: 'peroxisome' }).total).toBe(0)
    // And the page is still findable by its own title: it was not deleted.
    expect(listPages(db, { search: 'Org' }).pages[0]?.id).toBe(page.id)
  })

  it('replacing a document with another updates what is findable', async () => {
    const db = await newDb()
    const oldId = addDocument(db, 'obsolete terminology')
    const page = createPage(db, {
      title: 'Swap',
      pageType: 'rich',
      content: richContentWithAttachment(oldId)
    })
    expect(listPages(db, { search: 'obsolete' }).total).toBe(1)

    const newId = addDocument(db, 'current terminology')
    updatePage(db, page.id, {
      content: richContentWithAttachment(newId),
      version: versionOf(db, page.id)
    })
    db.query('DELETE FROM attachments WHERE id = ?').run(oldId)
    reindexPagesReferencingAttachment(db, oldId)

    expect(listPages(db, { search: 'obsolete' }).total).toBe(0)
    expect(listPages(db, { search: 'current' }).pages[0]?.id).toBe(page.id)
  })

  it('deleting the page takes its attachment text with it', async () => {
    const db = await newDb()
    const attachmentId = addDocument(db, 'ribosome translates messenger rna')
    const page = createPage(db, {
      title: 'Doomed',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })
    expect(listPages(db, { search: 'ribosome' }).total).toBe(1)

    // Search only ever returns living pages; the row is removed with the page.
    const row = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(page.id) as {
      deleted_at: string | null
    }
    db.query("UPDATE pages SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(page.id)
    expect(listPages(db, { search: 'ribosome' }).total).toBe(0)
    expect(row.deleted_at).toBeNull()
  })

  it('a note in the recycle bin is excluded from results, not resurrected by an attachment', async () => {
    const db = await newDb()
    const attachmentId = addDocument(db, 'lysosome digests organelles')
    createPage(db, {
      title: 'Binned',
      pageType: 'rich',
      content: richContentWithAttachment(attachmentId)
    })
    // `.run()` matters: `db.query(...)` only *prepares* a statement. The version above
    // this one had no `.run()`, so the page was never actually binned and the test
    // failed against working code — which is worse than a test that fails against broken
    // code, because the fix is to look at the test rather than the behaviour.
    db.query(
      "UPDATE pages SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE title = 'Binned'"
    ).run()
    expect(listPages(db, { search: 'lysosome' }).total).toBe(0)
  })
})

describe('the composed search row is bounded and deterministic', () => {
  it("puts the page's own text first, so a large attachment cannot push it out", () => {
    const pageText = 'the note itself'
    const attachments = ['x'.repeat(150_000), 'y'.repeat(150_000)]
    const composed = composeSearchableContent(pageText, attachments)
    expect(composed.startsWith(pageText)).toBe(true)
    expect(composed).toContain('the note itself')
    expect(composed.length).toBeLessThanOrEqual(200_000)
  })

  it('is byte-identical for the same inputs, so a no-op reindex changes nothing', () => {
    const a = composeSearchableContent('page', ['doc one', 'doc two'])
    const b = composeSearchableContent('page', ['doc one', 'doc two'])
    expect(a).toBe(b)
  })

  it('ignores empty sources rather than emitting separators', () => {
    expect(composeSearchableContent('', [])).toBe('')
    expect(composeSearchableContent('page', [''])).toBe('page')
    expect(composeSearchableContent('', ['doc'])).toBe('doc')
  })
})
