import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BLOB_STREAM_CHUNK_BYTES,
  insertAttachment,
  streamAttachmentBytes
} from '../src/server/attachments/attachment-repository.js'
import { contentDisposition } from '../src/server/attachments/content-disposition.js'
import { inspectDocumentUpload } from '../src/server/attachments/document-detect.js'
import { inspectImageUpload, pixelCount } from '../src/server/attachments/image-detect.js'

// The portable executable must be able to detect images with no Node, no Bun and
// no runtime installed. This is the check that a bundler-only test cannot make.
const text = (s: string) => new TextEncoder().encode(s)
// Named apart from `text` so the document check below is not shadowed by it.
const text_ = text

const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

const checks: Array<[string, Promise<unknown>, boolean]> = [
  ['real PNG accepted', inspectImageUpload(REAL_PNG).then((r) => r.ok), true],
  [
    'SVG refused with the specific reason',
    inspectImageUpload(
      text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    ).then((r) => !r.ok && r.reason === 'svg_not_supported'),
    true
  ],
  [
    'PNG signature + script refused',
    inspectImageUpload(
      new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...text('<script>alert(1)</script>')
      ])
    ).then((r) => !r.ok),
    true
  ],
  [
    'HTML refused',
    inspectImageUpload(text('<html><script>alert(1)</script></html>')).then((r) => !r.ok),
    true
  ],
  ['pixel count works', Promise.resolve(pixelCount(4000, 3000) === 12_000_000), true]
]

// Blobs and their streaming are the other half of the storage story (ADR-014),
// and they are exactly the kind of thing that works under Bun and fails once
// bundled into an executable, so they are checked here too.
async function checkBlobStorage(): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'rtwiki-compiled-blob-'))
  const db = new Database(join(dir, 'probe.sqlite'))
  try {
    db.exec('PRAGMA page_size = 8192')
    db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(
      "CREATE TABLE attachments (id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'image', extracted_text TEXT, original_name TEXT, checksum TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), data BLOB)"
    )

    // Larger than one chunk, so a stream that stopped early would be caught.
    const size = BLOB_STREAM_CHUNK_BYTES * 2 + 777
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = i % 251
    insertAttachment(db, {
      id: 'probe',
      mimeType: 'image/png',
      byteSize: size,
      kind: 'image',
      extractedText: null,
      originalName: 'probe.png',
      checksum: null,
      data: bytes
    })

    const stream = streamAttachmentBytes(db, 'probe')
    if (!stream) return false
    const received = new Uint8Array(await new Response(stream).arrayBuffer())
    if (received.byteLength !== size) return false
    for (let i = 0; i < size; i += 991) {
      if (received[i] !== i % 251) return false
    }
    return true
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

checks.push(['blob storage and streaming', checkBlobStorage(), true])

/**
 * The document parser, in the compiled executable.
 *
 * `officeparser` pulls `@napi-rs/canvas` — a native `.node` file — as an
 * optional dependency, which is the same shape that made `sharp` compile and
 * then fail at runtime. Text extraction is the part RTWiki actually depends on,
 * so that is what is checked, and it is checked more than once: a competing
 * library parsed a PDF exactly once per process and then failed on every later
 * call, which no single-call test would have caught.
 */
async function checkDocumentParsing(): Promise<boolean> {
  const pdf = buildPdf('Photosynthesis: light to chemical energy')
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await inspectDocumentUpload(pdf)
    if (!result.ok) return false
    if (result.format.mime !== 'application/pdf') return false
    if (!result.text.includes('Photosynthesis')) return false
  }
  // A signature-less format must still be reachable in the compiled build.
  const text = await inspectDocumentUpload(text_('plain notes'), 'text/plain;charset=utf-8')
  return text.ok && text.format.signatureless && text.text.includes('plain notes')
}

/** A real, minimal one-page PDF. */
function buildPdf(body: string): Uint8Array {
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

/** The download-name encoder, which has no dependencies and must still run. */
function checkContentDisposition(): boolean {
  const header = contentDisposition('attachment', 'a\r\nX-Injected: pwned.pdf', 'pdf')
  return !/[\r\n]/.test(header) && header.startsWith('attachment;')
}

checks.push(['document parsing (PDF, repeated)', checkDocumentParsing(), true])
checks.push(['download filename encoding', Promise.resolve(checkContentDisposition()), true])

let failures = 0
for (const [name, promise, want] of checks) {
  let got: unknown
  try {
    got = await promise
  } catch (e) {
    got = `THREW: ${(e as Error).message}`
  }
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

console.log(
  failures === 0
    ? '\nALL PASS - detection works in the compiled executable'
    : `\n${failures} FAILED`
)
process.exit(failures === 0 ? 0 : 1)
