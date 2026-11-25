import { describe, expect, it } from 'bun:test'
import { documentToMarkdown, extractImages } from '../src/server/ingest/document-to-markdown.js'
import { acceptedDocumentFormatByExt } from '../src/shared/attachments/document-formats.js'
import { acceptedImageFormatFor } from '../src/shared/attachments/image-formats.js'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

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

/**
 * A real, minimal DOCX: a stored (uncompressed) ZIP holding the parts Word
 * requires. Copied from tests/import-conversion.test.ts so the conversion is
 * exercised against a document that genuinely is a DOCX, not a `PK` prefix.
 */
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
    const nameBytes = enc(name)
    const data = content
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

const DOCX_FORMAT = acceptedDocumentFormatByExt('docx')!

/** A synthetic AST whose `to('md')` returns a fixed result. */
function fakeAst(value: string, messages: unknown[] = []): unknown {
  return {
    to: async (target: string) => {
      if (target !== 'md') throw new Error(`unexpected target ${target}`)
      return { value, messages }
    }
  }
}

describe('documentToMarkdown', () => {
  it('passes signature-less raw text through unchanged, including line breaks', async () => {
    const rawText = '# Title\n\nFirst line\nSecond line\n'
    const result = await documentToMarkdown({
      kind: 'text',
      format: acceptedDocumentFormatByExt('md')!,
      rawText,
      truncated: false
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.markdown).toBe(rawText)
      expect(result.warnings).toEqual([])
    }
  })

  it('uses ast.to(md) on a real DOCX and preserves a heading', async () => {
    const body =
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>My Heading</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Some paragraph text</w:t></w:r></w:p>'
    const bytes = makeDocx(body)
    const { parseOffice } = await import('officeparser')
    const ast = await parseOffice(bytes, {
      fileType: 'docx',
      pdfParserConfig: { separateProcess: false }
    } as never)
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast,
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.markdown).toContain('# My Heading')
      expect(result.markdown).toContain('Some paragraph text')
    }
  })

  it('preserves headings, lists and code fences returned by the library', async () => {
    const markdown = '# Heading\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n'
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast: fakeAst(markdown),
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.markdown).toBe(markdown)
  })

  it('emits images_not_imported when the library reports an image issue', async () => {
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast: fakeAst('Some text', [
        { code: 'IMAGE_NOT_INLINED', type: 'warning', message: 'skipped' }
      ]),
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toContain('images_not_imported')
    }
  })

  it('emits images_not_imported when images were present but could not be stored', async () => {
    const ast = {
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
      to: async () => ({ value: 'Text', messages: [] })
    }
    const result = await documentToMarkdown(
      {
        kind: 'document',
        format: DOCX_FORMAT,
        ast,
        searchText: ''
      },
      { skippedImages: 1 }
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.map((w) => w.code)).toContain('images_not_imported')
  })

  it('renders image nodes as links to stored attachments via onNode', async () => {
    const ast = {
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', name: 'image1.png' }],
      to: async (_target: string, config: { onNode?: (node: unknown) => string | void }) => {
        // Simulate the library calling onNode for an image node.
        const rendered = config.onNode?.({
          type: 'image',
          metadata: { attachmentName: 'image1.png', altText: 'A chart' }
        })
        return { value: `Text\n${rendered ?? ''}`, messages: [] }
      }
    }
    const result = await documentToMarkdown(
      { kind: 'document', format: DOCX_FORMAT, ast, searchText: '' },
      { imageUrlResolver: (name) => (name === 'image1.png' ? '/api/attachments/img-1' : null) }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.markdown).toContain('![A chart](/api/attachments/img-1)')
      expect(result.warnings.map((w) => w.code)).not.toContain('images_not_imported')
    }
  })

  it('escapes crafted alt text so it cannot inject Markdown structure', async () => {
    const maliciousAlt = 'x](https://evil.example) ![y\n[click](javascript:alert(1))'
    const ast = {
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', name: 'image1.png' }],
      to: async (_target: string, config: { onNode?: (node: unknown) => string | void }) => {
        const rendered = config.onNode?.({
          type: 'image',
          metadata: { attachmentName: 'image1.png', altText: maliciousAlt }
        })
        return { value: String(rendered ?? ''), messages: [] }
      }
    }
    const result = await documentToMarkdown(
      { kind: 'document', format: DOCX_FORMAT, ast, searchText: '' },
      { imageUrlResolver: () => '/api/attachments/img-1' }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The only unescaped `](` must be the one closing our own label before the URL.
    expect(result.markdown).toContain('](/api/attachments/img-1)')
    expect(result.markdown).not.toContain('](https://evil.example)')
    expect(result.markdown).not.toContain('[click](javascript:')
    expect(result.markdown).not.toContain('\n')
    expect(result.markdown).toContain('\\]')
    expect(result.markdown).toContain('\\[')
  })

  it('warns when an image node cannot be resolved to a stored attachment', async () => {
    const ast = {
      attachments: [{ type: 'image', mimeType: 'image/png', data: 'AAAA', name: 'image1.png' }],
      to: async (_target: string, config: { onNode?: (node: unknown) => string | void }) => {
        config.onNode?.({ type: 'image', metadata: { attachmentName: 'image1.png' } })
        return { value: 'Text', messages: [] }
      }
    }
    let unresolved = 0
    const result = await documentToMarkdown(
      { kind: 'document', format: DOCX_FORMAT, ast, searchText: '' },
      {
        imageUrlResolver: () => null,
        onUnresolvedImage: () => {
          unresolved++
        },
        skippedImages: () => unresolved
      }
    )
    expect(result.ok).toBe(true)
    expect(unresolved).toBe(1)
    if (result.ok) expect(result.warnings.map((w) => w.code)).toContain('images_not_imported')
  })

  it('extracts a real embedded image from a DOCX and rewrites its Markdown reference', async () => {
    // A 1x1 PNG, embedded as a genuine DOCX part with a drawing relationship.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    )
    const bodyXml = `<w:p><w:r><w:t>Before image</w:t></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/>
        <wp:docPr id="1" name="Picture 1" descr="A test image"/>
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

    // Parse the real DOCX through the same path the ingest core uses.
    const { inspectDocumentUpload } = await import('../src/server/attachments/document-detect.js')
    const inspected = await inspectDocumentUpload(
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(inspected.ok).toBe(true)
    if (!inspected.ok) return

    // The AST is not exposed by inspectDocumentUpload, so parse once more with
    // the same options to obtain it for the extraction assertion.
    const { parseOffice } = await import('officeparser')
    const ast = await parseOffice(docx, {
      extractAttachments: true,
      pdfParserConfig: { separateProcess: false }
    } as never)
    const extraction = extractImages(ast)
    expect(extraction.images.length).toBe(1)
    expect(extraction.images[0]?.mimeType).toBe('image/png')
    expect(extraction.images[0]?.bytes.length).toBe(png.length)

    const result = await documentToMarkdown(
      {
        kind: 'document',
        format: DOCX_FORMAT,
        ast,
        searchText: inspected.ok ? inspected.text : ''
      },
      {
        imageUrlResolver: (name) =>
          name === extraction.images[0]?.name ? '/api/attachments/img-1' : null
      }
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.markdown).toContain('/api/attachments/img-1')
      expect(result.markdown).toContain('Before image')
    }
  })

  it('surfaces the library parse-time CONTENT_PART_NOT_READ warning', async () => {
    const ast = {
      warnings: [
        {
          code: 'CONTENT_PART_NOT_READ',
          type: 'warning',
          message: 'A part of the document was not read'
        }
      ],
      to: async () => ({ value: 'Text that was recovered', messages: [] })
    }
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast,
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toContain('parts_not_read')
      expect(result.warnings.find((w) => w.code === 'parts_not_read')?.message).toContain(
        'could not be read'
      )
    }
  })

  it('does not warn about unread parts when the library reports none', async () => {
    const ast = {
      warnings: [],
      to: async () => ({ value: 'Text', messages: [] })
    }
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast,
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.map((w) => w.code)).not.toContain('parts_not_read')
  })

  it('emits empty_extraction when the library reports no text', async () => {
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast: fakeAst('A caption', [
        { code: 'PDF_NO_TEXT_EXTRACTED', type: 'warning', message: 'no text' }
      ]),
      searchText: ''
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings.map((w) => w.code)).toContain('empty_extraction')
  })

  it('refuses empty output with conversion_failed', async () => {
    const result = await documentToMarkdown({
      kind: 'document',
      format: DOCX_FORMAT,
      ast: fakeAst('   \n  '),
      searchText: ''
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conversion_failed')
  })

  it('refuses an image, which has no text to convert', async () => {
    const result = await documentToMarkdown({
      kind: 'image',
      format: acceptedImageFormatFor('image/png')!,
      width: 1,
      height: 1
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conversion_failed')
  })
})
