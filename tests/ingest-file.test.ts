import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ingestFile } from '../src/server/ingest/ingest-file.js'
import type { IngestDependencies, IngestFileInput } from '../src/server/ingest/ingest-types.js'
import type { Logger } from '../src/server/logging/index.js'
import { parseMarkdownPageContent } from '../src/shared/schemas/markdown-content.js'

const enc = (s: string) => new TextEncoder().encode(s)

const silent: Logger = {
  info() {},
  warn() {},
  error() {},
  async flush() {},
  async close() {}
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-ingest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

/** CRC-32, needed to build a genuine ZIP container. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A real, minimal DOCX with a heading paragraph. */
function makeDocx(bodyXml: string, extraFiles: Array<[string, Uint8Array]> = []): Uint8Array {
  const files: Array<[string, Uint8Array]> = [
    [
      '[Content_Types].xml',
      enc(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    ],
    [
      '_rels/.rels',
      enc(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    ],
    [
      'word/document.xml',
      enc(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${bodyXml}</w:body></w:document>`
      )
    ],
    ...extraFiles
  ]
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nb = enc(name)
    const data = content
    const crc = crc32(data)
    const local = new Uint8Array(30 + nb.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nb.length, true)
    local.set(nb, 30)
    parts.push(local, data)
    const cd = new Uint8Array(46 + nb.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nb.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nb, 46)
    central.push(cd)
    offset += local.length + data.length
  }
  const cs = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, cs, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cs + 22)
  let p = 0
  for (const c of parts) {
    out.set(c, p)
    p += c.length
  }
  for (const c of central) {
    out.set(c, p)
    p += c.length
  }
  out.set(end, p)
  return out
}

function pngWithDimensions(w: number, h: number): Uint8Array {
  const out = new Uint8Array(33)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const dv = new DataView(out.buffer)
  dv.setUint32(8, 13, false)
  out.set(enc('IHDR'), 12)
  dv.setUint32(16, w, false)
  dv.setUint32(20, h, false)
  out[24] = 8
  out[25] = 2
  return out
}

function input(overrides: Partial<IngestFileInput> = {}): IngestFileInput {
  return {
    sourceKind: 'file',
    bytes: enc('hello world'),
    reportedType: 'text/plain',
    originalName: 'notes.txt',
    createPage: false,
    ...overrides
  }
}

describe('ingestFile', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let deps: IngestDependencies

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
    deps = { logger: silent }
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  describe('rejections', () => {
    it('rejects a non-file source before reading bytes', async () => {
      const result = await ingestFile(db, input({ sourceKind: 'paste' as never }), deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('unsupported_source')
        expect(result.status).toBe(400)
      }
    })

    it('rejects missing bytes with no_file', async () => {
      const result = await ingestFile(db, input({ bytes: null as never }), deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('no_file')
        expect(result.status).toBe(400)
      }
    })

    it('rejects empty bytes', async () => {
      const result = await ingestFile(db, input({ bytes: new Uint8Array(0) }), deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('empty')
        expect(result.status).toBe(400)
      }
    })

    it('rejects an empty file name as invalid_field', async () => {
      const result = await ingestFile(db, input({ originalName: '   ' }), deps)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('invalid_field')
    })

    it('rejects an unrecognised file as unsupported_type', async () => {
      const result = await ingestFile(
        db,
        input({ bytes: enc('just random bytes with no signature at all'), reportedType: null }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('unsupported_type')
        expect(result.status).toBe(415)
      }
    })

    it('rejects an SVG as svg_not_supported', async () => {
      const svg = enc('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')
      const result = await ingestFile(
        db,
        input({ bytes: svg, reportedType: 'image/svg+xml' }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('svg_not_supported')
        expect(result.status).toBe(415)
      }
    })

    it('rejects an oversized image as too_many_pixels', async () => {
      const result = await ingestFile(
        db,
        input({ bytes: pngWithDimensions(100000, 100000), reportedType: 'image/png' }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('too_many_pixels')
        expect(result.status).toBe(413)
      }
    })

    it('rejects a malformed container as extract_failed', async () => {
      const bytes = enc('PK\x03\x04garbage-not-a-real-archive')
      const result = await ingestFile(
        db,
        input({
          bytes,
          reportedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('extract_failed')
        expect(result.status).toBe(422)
      }
    })

    it('rejects a legacy CFB container as legacy_office', async () => {
      const cfb = new Uint8Array(512)
      cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      const result = await ingestFile(db, input({ bytes: cfb, reportedType: null }), deps)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('legacy_office')
        expect(result.status).toBe(422)
      }
    })

    it('rejects an encrypted document as password_protected', async () => {
      const bytes = readFileSync(join(import.meta.dir, 'fixtures', 'encrypted-docx.bin'))
      const result = await ingestFile(
        db,
        input({ bytes: new Uint8Array(bytes), reportedType: null }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('password_protected')
        expect(result.status).toBe(422)
      }
    })

    it('rejects a document with no extractable text as conversion_failed', async () => {
      // Conversion only runs when a page is requested. An attachment-only
      // ingest of the same bytes is accepted (detection already has its text).
      const result = await ingestFile(
        db,
        input({
          bytes: makeDocx(''),
          reportedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          originalName: 'empty.docx',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('conversion_failed')
        expect(result.status).toBe(422)
      }
    })

    it('rejects an image with createPage as conversion_failed', async () => {
      // Images can be attachments but cannot become editable pages. This is
      // intentional: the converter has no Markdown to produce from an image.
      const result = await ingestFile(
        db,
        input({
          bytes: pngWithDimensions(2, 2),
          reportedType: 'image/png',
          originalName: 'photo.png',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('conversion_failed')
        expect(result.status).toBe(422)
      }
    })

    it('rejects a missing parent as parent_not_found', async () => {
      const result = await ingestFile(
        db,
        input({
          createPage: true,
          parentId: '00000000-0000-0000-0000-000000000000'
        }),
        deps
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('parent_not_found')
        expect(result.status).toBe(404)
      }
    })
  })

  describe('successes', () => {
    it('stores an image attachment without conversion when createPage is false', async () => {
      // Stage 3 routes every attachment upload — including images — through
      // this path. Conversion must be skipped: an image has no Markdown, and
      // detection already produced everything the attachment row needs.
      const bytes = pngWithDimensions(2, 2)
      const result = await ingestFile(
        db,
        input({
          bytes,
          reportedType: 'image/png',
          originalName: 'photo.png',
          createPage: false
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.pageId).toBeNull()
      expect(result.warnings).toEqual([])
      expect(result.mimeType).toBe('image/png')

      const row = db
        .query('SELECT data, kind, byte_size FROM attachments WHERE id = ?')
        .get(result.attachmentId) as { data: Uint8Array | null; kind: string; byte_size: number }
      expect(row.kind).toBe('image')
      expect(row.byte_size).toBe(bytes.length)
      expect(row.data).not.toBeNull()
      expect(row.data).toEqual(bytes)
    })

    it('keeps signature-less raw text unflattened in the created page', async () => {
      const raw = '# Title\n\nFirst line\nSecond line\n'
      const result = await ingestFile(
        db,
        input({
          bytes: enc(raw),
          reportedType: 'text/plain',
          originalName: 'notes.txt',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.pageId).not.toBeNull()
      const page = (await import('../src/server/repositories/page-repository.js')).getPage(
        db,
        result.pageId!
      )
      expect(page).not.toBeNull()
      const parsed = parseMarkdownPageContent(page!.content)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value.markdown).toBe(raw)
    })

    it('retains the AST and converts a DOCX heading to Markdown', async () => {
      const body =
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Imported Heading</w:t></w:r></w:p>'
      const result = await ingestFile(
        db,
        input({
          bytes: makeDocx(body),
          reportedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          originalName: 'report.docx',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const page = (await import('../src/server/repositories/page-repository.js')).getPage(
        db,
        result.pageId!
      )
      const parsed = parseMarkdownPageContent(page!.content)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value.markdown).toContain('# Imported Heading')
    })

    it('stores embedded images in the same transaction and links them from the page', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      )
      const bodyXml = `<w:p><w:r><w:t>Text before picture</w:t></w:r></w:p>
        <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="914400" cy="914400"/>
          <wp:docPr id="1" name="Picture 1" descr="Embedded picture"/>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr>
              <pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
              <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
            </pic:pic>
          </a:graphicData></a:graphic>
        </wp:inline></w:drawing></w:r></w:p>`
      const docx = makeDocx(bodyXml, [
        [
          'word/_rels/document.xml.rels',
          enc(
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'
          )
        ],
        ['word/media/image1.png', new Uint8Array(png)]
      ])

      const result = await ingestFile(
        db,
        input({
          bytes: docx,
          reportedType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          originalName: 'with-image.docx',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // The page Markdown must reference a stored attachment URL, not a bare name.
      const page = (await import('../src/server/repositories/page-repository.js')).getPage(
        db,
        result.pageId!
      )
      const parsed = parseMarkdownPageContent(page!.content)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const match = parsed.value.markdown.match(/!\[[^\]]*\]\(\/api\/attachments\/([^)]+)\)/)
      expect(match).not.toBeNull()
      const imageId = match![1]!

      // The referenced image is a real attachment row with the exact embedded bytes.
      const imageRow = db
        .query('SELECT mime_type, kind, data FROM attachments WHERE id = ?')
        .get(imageId) as { mime_type: string; kind: string; data: Uint8Array }
      expect(imageRow.mime_type).toBe('image/png')
      expect(imageRow.kind).toBe('image')
      expect(imageRow.data.length).toBe(png.length)
      expect([...imageRow.data]).toEqual([...png])
      // No warning when every image was brought across.
      expect(result.warnings.map((w) => w.code)).not.toContain('images_not_imported')
    })

    it('always stores the original bytes, including for signature-less files (D1-A)', async () => {
      const bytes = enc('line one\nline two\n')
      const result = await ingestFile(
        db,
        input({ bytes, reportedType: 'text/plain', originalName: 'keep.txt', createPage: false }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const row = db
        .query('SELECT data, bytes_stored FROM attachments WHERE id = ?')
        .get(result.attachmentId) as {
        data: Uint8Array | null
        bytes_stored: number
      }
      expect(row.data).not.toBeNull()
      expect(new TextDecoder().decode(row.data!)).toBe('line one\nline two\n')
      expect(row.bytes_stored).toBe(1)
    })

    it('writes a provenance snapshot when a page is created', async () => {
      const result = await ingestFile(
        db,
        input({
          bytes: enc('provenance body'),
          reportedType: 'text/plain',
          originalName: 'prov.txt',
          createPage: true
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const pageId = result.pageId!
      const row = db
        .query(
          'SELECT page_id, attachment_id, source_kind, original_name FROM import_sources WHERE page_id = ?'
        )
        .get(pageId) as {
        page_id: string
        attachment_id: string
        source_kind: string
        original_name: string
      }
      expect(row.page_id).toBe(pageId)
      expect(row.attachment_id).toBe(result.attachmentId)
      expect(row.source_kind).toBe('file')
      expect(row.original_name).toBe('prov.txt')
    })

    it('does not create a page or provenance for attachment-only ingest', async () => {
      const result = await ingestFile(
        db,
        input({
          bytes: enc('attachment only'),
          reportedType: 'text/plain',
          originalName: 'only.txt',
          createPage: false
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.pageId).toBeNull()
      const row = db
        .query('SELECT id FROM import_sources WHERE attachment_id = ?')
        .get(result.attachmentId)
      expect(row).toBeNull()
    })

    it('accepts over-limit signature-less text on the attachment path (bytes are stored)', async () => {
      // The page path refuses this to avoid silently dropping content. The
      // attachment path stores the full bytes (D1-A), so only the search-index
      // text is capped and the upload must still succeed.
      const bytes = enc(`# Long\n\n${'x'.repeat(100_001)}`)
      const result = await ingestFile(
        db,
        input({
          bytes,
          reportedType: 'text/plain',
          originalName: 'large.txt',
          createPage: false
        }),
        deps
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.pageId).toBeNull()
      const row = db
        .query('SELECT data, length(extracted_text) AS text_len FROM attachments WHERE id = ?')
        .get(result.attachmentId) as { data: Uint8Array; text_len: number }
      expect(row.data).not.toBeNull()
      expect(row.data.length).toBe(bytes.length)
      expect(row.text_len).toBeLessThanOrEqual(100_000)
    })
  })
})
