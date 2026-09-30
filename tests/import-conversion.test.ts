import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { Logger } from '../src/server/logging/index.js'
import { createPageRoutes } from '../src/server/routes/pages.js'
import { listPages } from '../src/server/services/page-service.js'
import { MAX_MARKDOWN_SOURCE_CHARS } from '../src/shared/constants/index.js'
import {
  CONVERSION_ADAPTERS,
  type ConvertedContent,
  convertImportedDocument,
  type ImportSourceDocument
} from '../src/shared/import/conversion.js'
import {
  parseMarkdownPageContent,
  serializeMarkdownContent
} from '../src/shared/schemas/markdown-content.js'
import { sanitizeFileName } from '../src/web/util/file-download.js'

/**
 * The 2H conversion boundary.
 *
 * ## What is being protected here
 *
 * 2H introduced a boundary between "we read a file" and "we create a page". The risk of a
 * boundary like that is that it becomes either **dead architecture** — a module nothing
 * calls, proving nothing — or a **behaviour change disguised as a refactor**. These tests
 * are aimed at both:
 *
 *  - the integrated path is exercised **through the real HTTP route and the real page
 *    service**, not by calling the adapter directly and asserting a mock was touched;
 *  - the derived title is pinned to the exact regex that used to live in `App.tsx`, so the
 *    extraction cannot quietly rename a user's pages;
 *  - the DOCX behaviour is pinned to *still being an attachment*, which is the thing a
 *    future converter is most likely to break by accident.
 */

const silent = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as unknown as Logger

function freshDb(): Database {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

const MARKDOWN_BODY = '# Photosynthesis\n\nLight energy becomes chemical energy in the chloroplast.'

/** What the adapter produced, asserted to have succeeded. */
function converted(format: string, source: Omit<ImportSourceDocument, 'format'>): ConvertedContent {
  const result = convertImportedDocument(format, source)
  if (!result.ok) throw new Error(`expected conversion to succeed, got: ${result.message}`)
  return result.value
}

describe('the conversion boundary: source in, editable content out', () => {
  it('converts Markdown source into a storable page representation', () => {
    const value = converted('md', { text: MARKDOWN_BODY, fileName: 'photosynthesis.md' })

    expect(value.pageType).toBe('markdown')
    // The output is what `pages.content` holds, so it must survive the reader the editor
    // and the server both use. Asserting the round-trip is what makes this a *content*
    // assertion rather than a string-shape assertion.
    const parsed = parseMarkdownPageContent(value.storedContent)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.markdown).toBe(MARKDOWN_BODY)
    expect(parsed.value.version).toBe(1)
  })

  it('never returns editor objects, so the editor cannot leak into the boundary', () => {
    // Requirement: the conversion is not coupled to BlockNote. The check is structural —
    // the serialised form carries only the versioned envelope, and nothing in the module
    // imports an editor package.
    const value = converted('md', { text: MARKDOWN_BODY, fileName: 'a.md' })
    const decoded = JSON.parse(value.storedContent) as Record<string, unknown>
    expect(Object.keys(decoded).sort()).toEqual(['markdown', 'version'])
    expect(value.storedContent).not.toContain('blockNote')
    expect(value.storedContent).not.toContain('blockContent')
  })

  it('resolves a format alias, so `.markdown` converts exactly as `.md` does', () => {
    // The alias is the policy's, not a second list: an import must not depend on which
    // surface it arrived through.
    const long = converted('.markdown', { text: 'body', fileName: 'x.markdown' })
    const short = converted('.md', { text: 'body', fileName: 'x.md' })
    expect(long.storedContent).toBe(short.storedContent)
    expect(long.title).toBe('x')
  })

  it('is a value, not a throw, on every failure', () => {
    // A converter that throws would turn a bad file into a broken import dialog. Every
    // refusal must arrive as data the caller can render.
    const attempts: Array<[string, Omit<ImportSourceDocument, 'format'>]> = [
      ['md', { text: '   ', fileName: 'empty.md' }],
      ['md', { text: 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1), fileName: 'huge.md' }],
      ['docx', { text: 'anything', fileName: 'paper.docx' }],
      ['csv', { text: 'a,b', fileName: 'data.csv' }]
    ]
    for (const [format, source] of attempts) {
      const result = convertImportedDocument(format, source)
      expect(result.ok, `${format} must not convert`).toBe(false)
      if (result.ok) continue
      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
      expect(['unsupported_conversion', 'source_refused']).toContain(result.reason)
    }
  })

  it('names the real reason a source was refused', () => {
    // "unsupported format" and "your file is too long" are different problems, and a user
    // can only act on the second one.
    const tooLong = convertImportedDocument('md', {
      text: 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1),
      fileName: 'huge.md'
    })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.reason).toBe('source_refused')
      // Names the number, because that is the thing the user has to measure against.
      expect(tooLong.message).toContain(MAX_MARKDOWN_SOURCE_CHARS.toLocaleString('en-US'))
    }

    const unsupported = convertImportedDocument('docx', { text: 'x', fileName: 'p.docx' })
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.reason).toBe('unsupported_conversion')

    const empty = convertImportedDocument('md', { text: '  \n\t ', fileName: 'blank.md' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('source_refused')
  })

  it('accepts a source exactly at the limit and refuses one character past it', () => {
    // The boundary of the boundary. If the check were off by one in either direction this
    // would be the test that caught it — and it pins the adapter to the same number the
    // server enforces, which is the whole point of re-checking here.
    const atLimit = 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS)
    expect(convertImportedDocument('md', { text: atLimit, fileName: 'a.md' }).ok).toBe(true)
    expect(convertImportedDocument('md', { text: `${atLimit}y`, fileName: 'a.md' }).ok).toBe(false)
  })

  it('reports warnings for a conversion that succeeded with something to say', () => {
    // Warnings are part of the contract, so they must be observable. A clean conversion
    // carries none, and the field exists for the future case that does.
    const clean = converted('md', { text: MARKDOWN_BODY, fileName: 'a.md' })
    expect(clean.warnings).toEqual([])
    expect(clean.title).toBe('a')
  })
})

describe('the adapter is registered, not inline, and is reachable by format key', () => {
  it('exposes exactly one converter, for Markdown', () => {
    // A count assertion, because it is the thing that would silently change: a second
    // adapter appearing means a second format became editable, which is a product decision.
    expect(CONVERSION_ADAPTERS).toHaveLength(1)
    expect(CONVERSION_ADAPTERS[0].formats).toEqual(['md'])
  })

  it('does not resolve a format the import policy rejects', () => {
    // `.csv` and `.tsv` are recorded as deliberately unsupported. The boundary must not be
    // a way around that, so an unregistered-and-unknown format cannot reach an adapter.
    expect(convertImportedDocument('.csv', { text: 'a,b', fileName: 'd.csv' }).ok).toBe(false)
    expect(convertImportedDocument('.tsv', { text: 'a\tb', fileName: 'd.tsv' }).ok).toBe(false)
  })
})

describe('title derivation is unchanged from the regex it replaced', () => {
  /*
   * The expression that used to sit in `App.tsx` — twice — and produced every imported
   * Markdown page's name. Pinned here so extracting it cannot quietly rename a user's
   * pages, which is the specific regression a "harmless" refactor of this code would cause.
   */
  const legacy = (fileName: string): string => fileName.replace(/\.(md|markdown)$/i, '').trim()

  const names = [
    'notes.md',
    'notes.markdown',
    'NOTES.MD',
    'Notes.MarkDown',
    'a.md.md',
    'a.markdown.md',
    'notes.txt',
    'notes',
    '.md',
    '.markdown',
    '  spaced.md  ',
    'no-ext',
    'report.MARKDOWN',
    'x.markdown.markdown',
    'trailing.md.bak',
    'dot.in.name.md',
    'weird..md',
    'semicolon;name.md',
    '....md'
  ]

  it.each(names)('derives the same title as the legacy regex for %j', (fileName) => {
    expect(converted('md', { text: 'body', fileName }).title).toBe(legacy(fileName))
  })

  it('leaves a name with no Markdown extension alone, as it always did', () => {
    // `notes.txt` is accepted by the picker (it is text), and the old regex left the
    // extension in place. Preserved deliberately: changing it would rename existing notes.
    expect(converted('md', { text: 'body', fileName: 'notes.txt' }).title).toBe('notes.txt')
  })

  it.each([
    'notes.md',
    'NOTES.MD',
    ' a.md ',
    'a.md ',
    ' .md',
    '',
    '  ',
    'weird..md',
    'a b.md',
    'x.MARKDOWN',
    'report.md.bak',
    '  spaced  .md  ',
    '..md..'
  ])('keeps the export filename sanitizer byte-identical for %j', (name) => {
    /*
     * `sanitizeFileName` was the *third* copy of this regex, and the only one that trimmed
     * before stripping rather than after. Unifying it on the other two orders silently
     * changed exported filenames: `"a.md "` became `a.md.md`. This pins the shipped result
     * to the function it replaced, whitespace cases included.
     */
    const legacy = (): string => {
      const withoutExt = name.trim().replace(/\.(md|markdown)$/i, '')
      const cleaned = withoutExt
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
      return (cleaned.length > 0 ? cleaned : 'untitled').slice(0, 80)
    }
    expect(sanitizeFileName(name)).toBe(legacy())
  })
})

describe('the real import path runs the conversion', () => {
  /** The page API, wired to a real database and mounted where the app mounts it. */
  async function pageApi(db: Database): Promise<Hono> {
    await runMigrations(db)
    return new Hono().route(
      '/api/pages',
      createPageRoutes(() => db)
    )
  }

  const JSON_HEADERS = {
    'content-type': 'application/json',
    origin: 'http://localhost:8080',
    host: 'localhost:8080'
  }

  it('creates a real page whose stored content is the adapter output', async () => {
    /*
     * The integration requirement: a real import reaches the real page service, and what
     * lands in the database is byte-for-byte what the boundary produced.
     *
     * This goes through `createPage` over HTTP rather than calling the adapter directly,
     * so it fails if the adapter is ever bypassed by the integration — which is the whole
     * difference between a boundary and a module.
     */
    const db = freshDb()
    const app = await pageApi(db)
    const value = converted('md', { text: MARKDOWN_BODY, fileName: 'photosynthesis.md' })

    const response = await app.request('/api/pages', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: value.title,
        pageType: value.pageType,
        content: value.storedContent
      })
    })
    expect(response.status).toBe(201)

    const body = (await response.json()) as {
      page: { id: string; title: string; pageType: string }
    }
    // The title the adapter derived is the title the page got: no second derivation.
    expect(body.page.title).toBe('photosynthesis')
    expect(body.page.pageType).toBe('markdown')

    // And the note is real: it is in the database, holding the converted content, and the
    // page service can hand it back.
    const stored = db.query('SELECT title, content FROM pages WHERE id = ?').get(body.page.id) as {
      title: string
      content: string
    }
    expect(stored.title).toBe('photosynthesis')
    expect(stored.content).toBe(value.storedContent)
    const reparsed = parseMarkdownPageContent(stored.content)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(reparsed.value.markdown).toBe(MARKDOWN_BODY)
  })

  it('keeps converted content searchable, so the import is findable', async () => {
    // The end-to-end proof that this is real content and not a string that merely parses:
    // a word that appears only in the imported body must return the page through the real
    // search path.
    const db = freshDb()
    const app = await pageApi(db)
    const value = converted('md', {
      text: '# Notes\n\nThe thylakoid membrane hosts the light-dependent reactions.',
      fileName: 'biology.md'
    })
    await app.request('/api/pages', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: value.title,
        pageType: value.pageType,
        content: value.storedContent
      })
    })
    const results = listPages(db, { search: 'thylakoid' })
    expect(results.total).toBe(1)
    expect(results.pages).toHaveLength(1)
    expect(results.pages[0].title).toBe('biology')
  })

  it('refuses an over-length import over the real route and leaves no page behind', async () => {
    /*
     * The negative path, end to end — and the first version of this test was vacuous: it
     * built the app, never called it, and then asserted the page table was empty. A test
     * that proves nothing by construction is worse than no test, so this one now actually
     * posts the content the adapter refused.
     */
    const db = freshDb()
    const app = await pageApi(db)
    const overLength = 'x'.repeat(MAX_MARKDOWN_SOURCE_CHARS + 1)

    // The adapter refuses it...
    const refused = convertImportedDocument('md', { text: overLength, fileName: 'huge.md' })
    expect(refused.ok).toBe(false)

    // ...and the server refuses it independently, so the guarantee does not rest on the
    // adapter having been consulted.
    const response = await app.request('/api/pages', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: 'huge',
        pageType: 'markdown',
        content: serializeMarkdownContent({ version: 1, markdown: overLength })
      })
    })
    expect(response.status).toBe(400)
    // For the right reason. A 400 is also what a malformed body would produce, so the
    // status alone would pass even if the route were rejecting something unrelated; the
    // message is what proves the limit is what refused it.
    const failure = (await response.json()) as { error?: string }
    expect(failure.error ?? '').toContain(MAX_MARKDOWN_SOURCE_CHARS.toLocaleString('en-US'))

    // Nothing was written: not the page, and not a search row that would point at nothing.
    const pages = db.query('SELECT count(*) AS n FROM pages').get() as { n: number }
    expect(pages.n).toBe(0)
    const indexed = db.query('SELECT count(*) AS n FROM search_index').get() as { n: number }
    expect(indexed.n).toBe(0)
  })
})

describe('the attachment pipeline is untouched by the boundary', () => {
  async function attachmentApi(db: Database): Promise<Hono> {
    await runMigrations(db)
    return new Hono().route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
    )
  }

  /**
   * A real, minimal DOCX: a stored (uncompressed) ZIP holding the parts Word requires.
   *
   * Written rather than faked because the point of the test below is what happens to a
   * document that genuinely *is* a DOCX. A byte string beginning `PK` is not one — content
   * sniffing refuses it, and a test that then accepts either outcome would pass no matter
   * what RTWiki did with documents.
   *
   * Stored entries keep this short: a stored entry's size *is* its length, so there is no
   * deflate to implement, and the archive is a few hundred bytes.
   */
  function makeDocx(body: string): Uint8Array {
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
    const crcTable = (() => {
      const table = new Uint32Array(256)
      for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
      }
      return table
    })()
    const crc32 = (b: Uint8Array): number => {
      let c = 0xffffffff
      for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }

    const files: Array<[string, string]> = [
      [
        '[Content_Types].xml',
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ],
      [
        '_rels/.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      ],
      [
        'word/document.xml',
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`
      ]
    ]

    const parts: Uint8Array[] = []
    const central: Uint8Array[] = []
    let offset = 0
    for (const [name, content] of files) {
      const nameBytes = enc(name)
      const data = enc(content)
      const crc = crc32(data)
      const local = new Uint8Array(30 + nameBytes.length)
      const lv = new DataView(local.buffer)
      lv.setUint32(0, 0x04034b50, true)
      lv.setUint16(4, 20, true)
      lv.setUint32(14, crc, true)
      lv.setUint32(18, data.length, true)
      lv.setUint32(22, data.length, true)
      lv.setUint16(26, nameBytes.length, true)
      local.set(nameBytes, 30)
      parts.push(local, data)
      const cd = new Uint8Array(46 + nameBytes.length)
      const cv = new DataView(cd.buffer)
      cv.setUint32(0, 0x02014b50, true)
      cv.setUint16(4, 20, true)
      cv.setUint16(6, 20, true)
      cv.setUint32(16, crc, true)
      cv.setUint32(20, data.length, true)
      cv.setUint32(24, data.length, true)
      cv.setUint16(28, nameBytes.length, true)
      cv.setUint32(42, offset, true)
      cd.set(nameBytes, 46)
      central.push(cd)
      offset += local.length + data.length
    }
    const centralSize = central.reduce((n, c) => n + c.length, 0)
    const end = new Uint8Array(22)
    const ev = new DataView(end.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, files.length, true)
    ev.setUint16(10, files.length, true)
    ev.setUint32(12, centralSize, true)
    ev.setUint32(16, offset, true)
    const out = new Uint8Array(offset + centralSize + 22)
    let p = 0
    for (const chunk of parts) {
      out.set(chunk, p)
      p += chunk.length
    }
    for (const c of central) {
      out.set(c, p)
      p += c.length
    }
    out.set(end, p)
    return out
  }

  /** A structurally complete, minimal single-page PDF. */
  function makePdf(body: string): Uint8Array {
    const content = `BT /F1 18 Tf 60 700 Td (${body}) Tj ET`
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ]
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, index) => {
      offsets.push(pdf.length)
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
    return new Uint8Array(Buffer.from(pdf, 'latin1'))
  }

  it('still stores a DOCX as an attachment, and does not convert it into a note', async () => {
    /*
     * The fixture is a real, structurally complete DOCX and the outcome is pinned to the
     * one that must happen. It was originally a PK-prefixed byte string with an
     * assertion that accepted *either* 201 or 415; an assertion tolerating two opposite
     * results proves nothing, and would have kept passing after the behaviour changed.
     */
    const docx = makeDocx('Oxidative phosphorylation')
    const db = freshDb()
    const app = await attachmentApi(db)
    const form = new FormData()
    form.append(
      'file',
      new File([docx as unknown as BlobPart], 'paper.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      })
    )
    const response = await app.request('/api/attachments', { method: 'POST', body: form })

    expect(response.status).toBe(201)
    const row = db
      .query('SELECT kind, byte_size, extracted_text, length(data) AS stored FROM attachments')
      .get() as { kind: string; byte_size: number; extracted_text: string; stored: number }
    // Stored as a document, with its bytes kept and its text extracted for search.
    expect(row.kind).toBe('document')
    expect(row.stored).toBe(row.byte_size)
    expect(row.extracted_text).toContain('Oxidative phosphorylation')

    // And, the point of the test: an attachment, not an editable note. No page exists, so
    // the conversion boundary did not run over it.
    const pages = db.query('SELECT count(*) AS n FROM pages').get() as { n: number }
    expect(pages.n).toBe(0)
  })

  it('still extracts a PDF and keeps its bytes, with no page created', async () => {
    const db = freshDb()
    const app = await attachmentApi(db)
    const form = new FormData()
    form.append(
      'file',
      new File([makePdf('Cytoskeleton notes') as unknown as BlobPart], 'p.pdf', {
        type: 'application/pdf'
      })
    )
    const response = await app.request('/api/attachments', { method: 'POST', body: form })
    expect(response.status).toBe(201)
    const row = db.query('SELECT extracted_text, length(data) AS n FROM attachments').get() as {
      extracted_text: string
      n: number
    }
    expect(row.extracted_text).toContain('Cytoskeleton')
    expect(row.n).toBeGreaterThan(0)
    const pages = db.query('SELECT count(*) AS n FROM pages').get() as { n: number }
    expect(pages.n).toBe(0)
  })

  it('reports no editable conversion for the document formats it cannot convert', () => {
    // The explicit statement of scope, in the place a future contributor will read it.
    for (const format of ['docx', 'pdf', 'xlsx', 'pptx', 'odt']) {
      const result = convertImportedDocument(format, { text: 'body', fileName: `f.${format}` })
      expect(result.ok, `${format} must not have an editable converter`).toBe(false)
      if (!result.ok) expect(result.reason).toBe('unsupported_conversion')
    }
  })
})
