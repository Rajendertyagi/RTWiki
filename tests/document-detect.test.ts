import { describe, expect, it } from 'bun:test'
import {
  DOCUMENT_TEXT_MAX_CHARS,
  decodeText,
  inspectDocumentUpload,
  looksLikeText
} from '../src/server/attachments/document-detect.js'
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  ACCEPTED_DOCUMENT_FORMATS,
  acceptedDocumentFormatByExt,
  acceptedDocumentFormatFor,
  DOCUMENT_FILE_ACCEPT_ATTRIBUTE,
  SERVED_DOCUMENT_MIME_TYPES,
  signaturelessDocumentFormatFor
} from '../src/shared/attachments/document-formats.js'

const enc = (s: string) => new TextEncoder().encode(s)

/** CRC-32, needed to build a genuine ZIP container. */
const CRC_TABLE = (() => {
  const table: number[] = []
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

/** A real ZIP (stored, uncompressed) — the container a DOCX actually is. */
function zip(files: Array<[string, string]>): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nameBytes = enc(name)
    const data = enc(content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, data.length, true)
    dv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    parts.push(local, data)
    const cd = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(cd.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, data.length, true)
    cdv.setUint32(24, data.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const edv = new DataView(end.buffer)
  edv.setUint32(0, 0x06054b50, true)
  edv.setUint16(8, files.length, true)
  edv.setUint16(10, files.length, true)
  edv.setUint32(12, centralSize, true)
  edv.setUint32(16, offset, true)
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

/** A real .docx: the ZIP above, holding the parts Word requires. */
const REAL_DOCX = zip([
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
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Mitochondria are the powerhouse of the cell.</w:t></w:r></w:p></w:body></w:document>'
  ]
])

/** A real, minimal one-page PDF with extractable text. */
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

const REAL_PDF = makePdf('Krebs cycle begins with acetyl CoA')

describe('accepted document formats', () => {
  it('accepts PDF, the office families, RTF and EPUB', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'epub']) {
      expect(acceptedDocumentFormatByExt(ext), ext).not.toBeNull()
    }
  })

  it('marks exactly the signature-less trio as signature-less', () => {
    const signatureless = ACCEPTED_DOCUMENT_FORMATS.filter((f) => f.signatureless).map((f) => f.ext)
    expect(signatureless.sort()).toEqual(['html', 'md', 'txt'])
  })

  it('never serves a signature-less format as a document', () => {
    // The whole reason those formats are handled differently: their bytes cannot
    // identify them, so what is stored is text, not a file to render.
    for (const mime of SERVED_DOCUMENT_MIME_TYPES) {
      expect(signaturelessDocumentFormatFor(mime)).toBeNull()
    }
    expect(SERVED_DOCUMENT_MIME_TYPES).not.toContain('text/plain')
    expect(SERVED_DOCUMENT_MIME_TYPES).toContain('application/pdf')
  })

  it('resolves a parser format key and a media type to the same entry', () => {
    // One list, two lookup keys: a mismatch here is how the accepted set and the
    // parser's view drift apart.
    for (const format of ACCEPTED_DOCUMENT_FORMATS) {
      expect(acceptedDocumentFormatByExt(format.ext)?.mime).toBe(format.mime)
      expect(acceptedDocumentFormatFor(format.mime)?.ext).toBe(format.ext)
    }
  })

  it('refuses an executable and a script', () => {
    expect(acceptedDocumentFormatFor('application/x-msdownload')).toBeNull()
    expect(acceptedDocumentFormatFor('application/x-sh')).toBeNull()
    expect(acceptedDocumentFormatByExt('exe')).toBeNull()
  })

  it('offers the picker every accepted format and nothing else', () => {
    for (const mime of ACCEPTED_DOCUMENT_MIME_TYPES_FOR_TEST) {
      expect(DOCUMENT_FILE_ACCEPT_ATTRIBUTE).toContain(mime)
    }
    for (const ext of ACCEPTED_DOCUMENT_EXTENSIONS) {
      expect(DOCUMENT_FILE_ACCEPT_ATTRIBUTE).toContain(ext)
    }
  })
})

const ACCEPTED_DOCUMENT_MIME_TYPES_FOR_TEST = ACCEPTED_DOCUMENT_FORMATS.map((f) => f.mime)

describe('text heuristic', () => {
  it('accepts ordinary text', () => {
    expect(looksLikeText(enc('Study notes about photosynthesis.\n\nLine two.\tTabbed.'))).toBe(true)
  })

  it('refuses a NUL byte, which no text file has', () => {
    expect(looksLikeText(new Uint8Array([0x41, 0x00, 0x42]))).toBe(false)
  })

  it('refuses a binary blob', () => {
    expect(looksLikeText(new Uint8Array(64).fill(0x7f))).toBe(false)
  })

  it('refuses an empty buffer', () => {
    expect(looksLikeText(new Uint8Array(0))).toBe(false)
  })
})

describe('text decoding', () => {
  it('decodes UTF-8', () => {
    expect(decodeText(enc('café'))).toBe('café')
  })

  it('strips a UTF-8 byte-order mark', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('hello')]))).toBe('hello')
  })

  it('decodes UTF-16 with a byte-order mark rather than losing the text', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])
    expect(decodeText(utf16)).toBe('hi')
  })

  it('falls back rather than producing replacement characters', () => {
    // 0x92 is valid windows-1252 (a curly quote) and invalid UTF-8. Decoding it
    // as UTF-8 lossily would turn a whole document into U+FFFD.
    const cp1252 = new Uint8Array([0x48, 0x69, 0x92, 0x73])
    const decoded = decodeText(cp1252)
    expect(decoded).not.toContain('�')
    expect(decoded).toContain('Hi')
  })
})

describe('document inspection', () => {
  it('identifies a real PDF from its bytes and extracts its text', async () => {
    const result = await inspectDocumentUpload(REAL_PDF)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format.mime).toBe('application/pdf')
    expect(result.text).toContain('Krebs')
  })

  it('identifies a real DOCX from its bytes and extracts its text', async () => {
    const result = await inspectDocumentUpload(REAL_DOCX)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.format.ext).toBe('docx')
    expect(result.text).toContain('Mitochondria')
  })

  it('parses repeatedly in one process', async () => {
    // This is the failure that ruled out a competing library: it parsed a PDF
    // exactly once per process and then failed on every later call.
    for (let i = 0; i < 4; i++) {
      const pdf = await inspectDocumentUpload(REAL_PDF)
      const docx = await inspectDocumentUpload(REAL_DOCX)
      expect(pdf.ok, `pdf call ${i + 1}`).toBe(true)
      expect(docx.ok, `docx call ${i + 1}`).toBe(true)
    }
  })

  it('ignores a mislabelled declared type and uses the bytes', async () => {
    // A PDF that claims to be a .txt is still a PDF. Checking the claim first
    // would let an attacker rename any document to a text extension and have its
    // contents read as the note's text.
    const result = await inspectDocumentUpload(REAL_PDF, 'text/plain')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.mime).toBe('application/pdf')
  })

  it('refuses to downgrade a container to a signature-less format', async () => {
    // The same attack from the other direction: a DOCX renamed .html must not
    // have its OOXML markup read as HTML, and must not be stored as a `.html`.
    for (const type of ['text/html', 'text/markdown', 'text/plain']) {
      const result = await inspectDocumentUpload(REAL_DOCX, type)
      expect(result.ok, type).toBe(true)
      if (!result.ok) continue
      expect(result.format.signatureless, type).toBe(false)
      expect(result.format.ext, type).toBe('docx')
      // And the extracted text is the document's prose, not its XML.
      expect(result.text, type).not.toContain('<?xml')
      expect(result.text, type).toContain('Mitochondria')
    }
  })

  it('reads a signature-less format from the reported type', async () => {
    for (const [type, body] of [
      ['text/plain', 'Plain study notes.'],
      ['text/markdown', '# Heading\n\nBody text.'],
      ['text/html', '<p>Paragraph body.</p>']
    ] as Array<[string, string]>) {
      const result = await inspectDocumentUpload(enc(body), type)
      expect(result.ok, type).toBe(true)
      if (!result.ok) continue
      expect(result.format.signatureless).toBe(true)
      expect(result.text.length).toBeGreaterThan(0)
    }
  })

  it('accepts a reported type that carries a charset', async () => {
    // A `File` built from text reports `text/plain;charset=utf-8`. An exact
    // lookup never matches that, so without trimming every text upload is
    // refused - which is exactly what happened before this was found.
    const result = await inspectDocumentUpload(
      enc('Notes with a charset.'),
      'text/plain;charset=utf-8'
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.format.mime).toBe('text/plain')
  })

  it('refuses a signature-less claim on bytes that are actually binary', async () => {
    // The extension says .txt, the bytes say executable. The claim loses.
    const result = await inspectDocumentUpload(
      new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]),
      'text/plain'
    )
    expect(result.ok).toBe(false)
  })

  it('refuses an empty upload', async () => {
    expect(await inspectDocumentUpload(new Uint8Array(0))).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses files that are not documents at all', async () => {
    for (const [label, bytes] of [
      [
        'a PNG',
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)])
      ],
      ['a shell script', enc('#!/bin/sh\nrm -rf /')],
      ['an HTML page claiming to be a PDF', enc('<html><script>alert(1)</script></html>')],
      ['random bytes', new Uint8Array([1, 2, 3, 4, 5])]
    ] as Array<[string, Uint8Array]>) {
      const result = await inspectDocumentUpload(bytes)
      expect(result.ok, label).toBe(false)
    }
  })

  it('caps extracted text so one document cannot flood the index', async () => {
    const huge = enc('word '.repeat(DOCUMENT_TEXT_MAX_CHARS))
    const result = await inspectDocumentUpload(huge, 'text/plain')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text.length).toBeLessThanOrEqual(DOCUMENT_TEXT_MAX_CHARS)
  })
})
