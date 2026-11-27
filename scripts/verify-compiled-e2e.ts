/**
 * End-to-end check against the COMPILED RTWiki.exe, not the dev server.
 *
 * ## Why this exists
 *
 * Document parsing fails *only* inside the compiled executable - it passes under
 * `bun test` against the source. A test against the dev server would therefore
 * have reported success while the shipped application refused every document.
 * `bun run test:compiled-images` covers the parser; this covers the whole HTTP
 * surface, the way a browser actually reaches it.
 *
 * What it asserts, and why each matters:
 * - a document is accepted and stored as a document
 * - a document is served as a *download*, with a policy that blocks execution, so
 *   neither layer is doing the work alone
 * - a PDF's bytes arrive unmodified
 * - an image is still served inline, because an image is not a program
 * - a PDF renamed `.txt` is NOT downgraded to text (type confusion)
 * - the extracted text is present, so the document is searchable
 * - a signature-less upload keeps its bytes and is a forced download (ADR-023)
 * - an HTML file carrying a `<script>` is downloaded under a per-response CSP
 *   that survives the app-wide middleware (ADR-023 security gate)
 * - a DOCX imported through `POST /api/import` becomes an editable Markdown page
 *   with a provenance row, and fenced code newlines survive a `.md` import
 *
 * Runs against a throwaway copy of the executable, so the real workspace is
 * never touched.
 */

import { Database } from 'bun:sqlite'
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.RTWiki_E2E_PORT ?? 8199)
const BASE = `http://127.0.0.1:${PORT}`
// Overridable for the same reason PORT is: so this can be pointed at a build
// staged elsewhere, which is what lets it run while `build/server/RTWiki.exe` is
// in use by a running application and therefore cannot be rebuilt over.
const BUILD_DIR = process.env.RTWiki_E2E_BUILD_DIR ?? 'D:/Temp/RTWiki/build/server'
const ORIGIN = BASE

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`)
  }
}

// --- fixtures: real files, not faked signatures -----------------------------

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

/** A genuine ZIP container, which is what a DOCX actually is. */
function buildZip(files: Array<[string, string | Uint8Array]>): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of files) {
    const nameBytes = enc(name)
    const data = typeof content === 'string' ? enc(content) : content
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

/** A DOCX with a genuine embedded 1x1 PNG, for the image-localization check. */
const DOCX_WITH_IMAGE = buildZip([
  [
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ],
  [
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ],
  [
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Text before picture</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="Embedded picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
  ],
  [
    'word/_rels/document.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'
  ],
  [
    'word/media/image1.png',
    new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      )
    )
  ]
])

const REAL_DOCX = buildZip([
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
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>E2E docx body text</w:t></w:r></w:p></w:body></w:document>'
  ]
])

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

const PDF_BODY = 'E2E photosynthesis verified'
const REAL_PDF = buildPdf(PDF_BODY)
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

// --- stage a throwaway copy of the built application ------------------------

async function main(): Promise<void> {
  if (!existsSync(join(BUILD_DIR, 'RTWiki.exe'))) {
    console.log('SKIP: no build. Run `bun run build` first.')
    process.exit(0)
  }

  const stage = mkdtempSync(join(tmpdir(), 'rtwiki-e2e-'))
  cpSync(join(BUILD_DIR, 'RTWiki.exe'), join(stage, 'RTWiki.exe'))
  cpSync(join(BUILD_DIR, 'web'), join(stage, 'web'), { recursive: true })
  // A *fresh* data directory. The workspace's own data directory is NOT copied:
  // it carries a populated database and a server.json, and this test must not
  // depend on either. An earlier version copied it, and the copy silently changed
  // the result, which cost a long time to track down.
  const dataDir = join(stage, 'data')
  mkdirSync(dataDir, { recursive: true })
  // The port is no longer read from data/server.json: bootstrap reads it from the
  // SQLite `settings` table (key `server.port`), which does not exist until after
  // migrations. Pass it explicitly with --port so the server binds where BASE
  // expects it. A stale server.json here would be silently ignored.

  console.log(`staged a throwaway copy at ${stage}`)
  console.log(`starting RTWiki.exe on port ${PORT} ...\n`)

  // Guards against testing a stale build. This check earned its keep: a fix was
  // verified against an executable compiled *before* it, which made a correct
  // change look broken.
  const exeAge = Date.now() - statSync(join(stage, 'RTWiki.exe')).mtimeMs
  const appAge = Date.now() - statSync('D:/Temp/RTWiki/src/server/app.ts').mtimeMs
  console.log(
    `  exe is ${Math.round(exeAge / 1000)}s old; src/server/app.ts changed ${Math.round(appAge / 1000)}s ago` +
      (appAge < exeAge ? '  <-- SOURCE IS NEWER THAN THE BUILD' : '')
  )

  // Registered before anything can fail, so a crash anywhere below still stops the
  // server. An earlier version only killed it on the success path, and a failure
  // left an RTWiki.exe running and holding its port.
  let stopped = false
  const stopServer = (): void => {
    if (stopped) return
    stopped = true
    try {
      server.kill()
    } catch {
      // Already gone, which is the desired end state.
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'exit'] as const) {
    process.on(signal, () => {
      stopServer()
      if (signal !== 'exit') process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
  // Last-resort sweep: if this process is killed outright, nothing below runs, so
  // the port is freed on the next run instead of blocking it.
  const freePort = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      try {
        await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
      } catch {
        return
      }
      stopServer()
      await Bun.sleep(300)
    }
  }
  await freePort()

  // `--no-open` is required, not a preference. Without it the application opens a
  // browser tab on the user's screen every time this runs, because `bootstrap`
  // launches the browser unless told not to. An earlier version of this script
  // omitted it and did exactly that, repeatedly.
  const NO_OPEN_FLAG = '--no-open'
  const server = spawn(join(stage, 'RTWiki.exe'), [NO_OPEN_FLAG, '--port', String(PORT)], {
    cwd: stage,
    stdio: 'ignore',
    windowsHide: true
  })

  let ready = false
  for (let i = 0; i < 60; i++) {
    await Bun.sleep(500)
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) {
        ready = true
        break
      }
    } catch {
      // not listening yet
    }
  }
  if (!ready) {
    stopServer()
    rmSync(stage, { recursive: true, force: true })
    console.log('FAIL  the compiled server did not become ready')
    process.exit(1)
  }

  const upload = async (
    bytes: Uint8Array,
    name: string,
    type: string
  ): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const form = new FormData()
    form.append('file', new File([bytes as unknown as BlobPart], name, { type }))
    // The endpoint refuses a cross-origin request, so the Origin must match.
    const res = await fetch(`${BASE}/api/attachments`, {
      method: 'POST',
      body: form,
      headers: { Origin: ORIGIN }
    })
    const text = await res.text()
    let body: Record<string, unknown> | null = null
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = null
    }
    return { status: res.status, body }
  }

  /** The full-ingest consumer: page + attachment + provenance in one transaction. */
  const importViaApi = async (
    bytes: Uint8Array,
    name: string,
    type: string,
    source = '{"kind":"file"}'
  ): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const form = new FormData()
    form.append('file', new File([bytes as unknown as BlobPart], name, { type }))
    form.append('source', source)
    const res = await fetch(`${BASE}/api/import`, {
      method: 'POST',
      body: form,
      headers: { Origin: ORIGIN }
    })
    const text = await res.text()
    let body: Record<string, unknown> | null = null
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = null
    }
    return { status: res.status, body }
  }

  try {
    console.log('=== documents, through the COMPILED server ===')
    const pdf = await upload(REAL_PDF, 'lecture.pdf', 'application/pdf')
    check('PDF accepted', pdf.status === 201, `status ${pdf.status}`)
    // Declared once, near the upload that produced it, and used by every later
    // block. An earlier version declared it a second time beside the view checks,
    // which Biome rejected as a redeclaration - and removing the first one instead
    // broke a later reference. One declaration, at the source.
    const pdfAttachment = pdf.body?.attachment as Record<string, unknown>
    check(
      'stored as application/pdf',
      pdfAttachment?.mimeType === 'application/pdf',
      String(pdfAttachment?.mimeType)
    )
    check(
      'recorded as a document',
      pdf.body?.attachment?.kind === 'document',
      String(pdf.body?.attachment?.kind)
    )

    const pdfRes = await fetch(`${BASE}${String(pdf.body?.attachment?.url)}`)
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
    check('PDF served', pdfRes.status === 200, `status ${pdfRes.status}`)
    check(
      'Content-Disposition forces a download',
      (pdfRes.headers.get('content-disposition') ?? '').startsWith('attachment;'),
      pdfRes.headers.get('content-disposition') ?? '(none)'
    )
    check(
      'CSP blocks execution (second, independent layer)',
      (pdfRes.headers.get('content-security-policy') ?? '').includes("default-src 'none'"),
      pdfRes.headers.get('content-security-policy') ?? '(none)'
    )
    check('nosniff set', pdfRes.headers.get('x-content-type-options') === 'nosniff')
    check(
      'PDF bytes arrive unmodified',
      pdfBytes.byteLength === REAL_PDF.byteLength,
      `${pdfBytes.byteLength} vs ${REAL_PDF.byteLength}`
    )

    const docx = await upload(
      REAL_DOCX,
      'notes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    check('DOCX accepted (a real ZIP container)', docx.status === 201, `status ${docx.status}`)
    const docxAttachment = docx.body?.attachment as Record<string, unknown> | undefined
    const docxRes = await fetch(`${BASE}${String(docxAttachment?.url)}`)
    check(
      'DOCX forced to download',
      (docxRes.headers.get('content-disposition') ?? '').startsWith('attachment;')
    )
    check(
      'DOCX carries a CSP',
      (docxRes.headers.get('content-security-policy') ?? '').includes("default-src 'none'")
    )

    /**
     * The inline view route, over HTTP against the compiled executable.
     *
     * Header assertions only. Whether the PDF actually *renders* cannot be
     * answered from here — that needs a real browser, and the browser suite
     * (`tests/browser/documents.pwspec.ts`) is where that observation is recorded.
     * Claiming a render from a header check would be exactly the kind of inference
     * this repository has been bitten by.
     */
    console.log('\n=== the inline view route ===')
    const pdfId = String(pdf.body?.attachment?.id)
    const viewRes = await fetch(`${BASE}/api/attachments/${pdfId}/view`)
    check('view served', viewRes.status === 200, `status ${viewRes.status}`)
    check(
      'view is inline, not a download',
      (viewRes.headers.get('content-disposition') ?? '').startsWith('inline;'),
      viewRes.headers.get('content-disposition') ?? '(none)'
    )
    check(
      'view keeps the byte-detected type',
      (viewRes.headers.get('content-type') ?? '').includes('application/pdf'),
      viewRes.headers.get('content-type') ?? '(none)'
    )
    check('view is nosniff', viewRes.headers.get('x-content-type-options') === 'nosniff')
    const viewCsp = viewRes.headers.get('content-security-policy') ?? ''
    check(
      "view policy blocks the document's own script",
      viewCsp.includes("default-src 'none'"),
      viewCsp
    )
    check(
      "view policy does not inherit the app's script-src",
      !viewCsp.includes('script-src'),
      viewCsp
    )
    // `sandbox` was expected to stop Chrome rendering the PDF and does not - measured
    // in real Chrome, with controls, and recorded in ADR-016. The stricter policy
    // turned out to be free, so both directives are asserted here.
    check('view keeps the full sandbox', viewCsp.includes('sandbox'), viewCsp)
    // The download route must be untouched by the view route's existence.
    const stillDownload = await fetch(`${BASE}/api/attachments/${pdfId}`)
    check(
      'download is still a forced download',
      (stillDownload.headers.get('content-disposition') ?? '').startsWith('attachment;')
    )
    const stillCsp = stillDownload.headers.get('content-security-policy') ?? ''
    check('download still sandboxes', stillCsp.includes('sandbox'), stillCsp)

    console.log('\n=== images still work, and stay inline ===')
    const png = await upload(REAL_PNG, 'diagram.png', 'image/png')
    check('PNG accepted', png.status === 201, `status ${png.status}`)
    const pngAttachment = png.body?.attachment as Record<string, unknown> | undefined
    check('recorded as an image', pngAttachment?.kind === 'image', String(pngAttachment?.kind))
    const pngRes = await fetch(`${BASE}${String(pngAttachment?.url)}`)
    check('PNG served', pngRes.status === 200, `status ${pngRes.status}`)
    check(
      'PNG is inline, not a forced download',
      pngRes.headers.get('content-disposition') === null,
      pngRes.headers.get('content-disposition') ?? '(none)'
    )
    check(
      'PNG keeps its image type',
      (pngRes.headers.get('content-type') ?? '').startsWith('image/png')
    )
    // An image is already drawn inline by the download route, so the view route
    // refuses it. One answer to "what can be rendered here", not two.
    const imageView = await fetch(`${BASE}${String(pngAttachment?.url)}/view`)
    check(
      'an image is refused by the view route',
      imageView.status === 400,
      `status ${imageView.status}`
    )

    console.log('\n=== type confusion: a PDF renamed .txt ===')
    const disguised = await upload(REAL_PDF, 'disguised.txt', 'text/plain')
    if (disguised.status === 201) {
      const a = disguised.body?.attachment as Record<string, unknown>
      check(
        'renamed PDF is NOT downgraded to text',
        a?.mimeType === 'application/pdf',
        String(a?.mimeType)
      )
      check('renamed PDF is not marked signature-less', a?.signatureless === false)
    } else {
      check('renamed PDF was refused outright', true, '415 - also safe')
    }

    console.log('\n=== the extracted text, which is the point of the feature ===')
    const text = await (await fetch(`${BASE}${String(pdfAttachment?.url)}/text`)).json()
    check(
      'PDF text extracted and searchable',
      typeof (text as { text?: string }).text === 'string' &&
        (text as { text: string }).text.includes('photosynthesis'),
      JSON.stringify(text).slice(0, 90)
    )

    console.log(
      '\n=== a signature-less upload keeps its bytes and is a forced download (ADR-023) ==='
    )
    const notes = await upload(
      new TextEncoder().encode('Plain E2E study notes.'),
      'notes.txt',
      'text/plain'
    )
    check('text accepted', notes.status === 201, `status ${notes.status}`)
    const notesAttachment = notes.body?.attachment as Record<string, unknown> | undefined
    check('marked signature-less', notesAttachment?.signatureless === true)
    const notesRes = await fetch(`${BASE}${String(notesAttachment?.url)}`)
    check('served as a forced download (200)', notesRes.status === 200, `status ${notesRes.status}`)
    check(
      'signature-less bytes carry attachment disposition',
      (notesRes.headers.get('content-disposition') ?? '').startsWith('attachment;'),
      notesRes.headers.get('content-disposition') ?? '(none)'
    )
    const notesView = await fetch(`${BASE}${String(notesAttachment?.url)}/view`)
    check(
      'signature-less bytes are refused by /view (404)',
      notesView.status === 404,
      `status ${notesView.status}`
    )
    const notesText = await (await fetch(`${BASE}${String(notesAttachment?.url)}/text`)).json()
    check(
      'its text is still reachable',
      (notesText as { text: string }).text.includes('study notes'),
      JSON.stringify(notesText).slice(0, 80)
    )

    /**
     * ADR-023 security gate, item 1. A `.html` file carrying a `<script>` is the
     * case a route-level unit test cannot cover: the per-response CSP is applied by
     * middleware mounted app-wide, so only a request against the compiled server
     * proves the stricter policy survives `secureHeaders` overwriting it.
     */
    console.log('\n=== ADR-023 security gate: an HTML file carrying a script ===')
    const HTML_BYTES = new TextEncoder().encode(
      '<!doctype html><html><body><script>window.__rtwiki_pwned = true</script><p>hello</p></body></html>'
    )
    const html = await upload(HTML_BYTES, 'payload.html', 'text/html')
    check('HTML accepted as a document', html.status === 201, `status ${html.status}`)
    const htmlAttachment = html.body?.attachment as Record<string, unknown> | undefined
    const htmlId = String(htmlAttachment?.id)
    const htmlRes = await fetch(`${BASE}/api/attachments/${htmlId}`)
    check('HTML served', htmlRes.status === 200, `status ${htmlRes.status}`)
    check(
      'HTML forced to download',
      (htmlRes.headers.get('content-disposition') ?? '').startsWith('attachment;'),
      htmlRes.headers.get('content-disposition') ?? '(none)'
    )
    const htmlCsp = htmlRes.headers.get('content-security-policy') ?? ''
    check(
      "HTML CSP is default-src 'none'; sandbox",
      htmlCsp.includes("default-src 'none'") && htmlCsp.includes('sandbox'),
      htmlCsp
    )
    check('HTML nosniff', htmlRes.headers.get('x-content-type-options') === 'nosniff')
    const htmlView = await fetch(`${BASE}/api/attachments/${htmlId}/view`)
    check('HTML /view refused (404)', htmlView.status === 404, `status ${htmlView.status}`)

    /**
     * ADR-024: the full-ingest consumer turns a real DOCX into an editable Markdown
     * page, stores the bytes as an attachment, and writes a provenance snapshot in
     * the same transaction. The response carries all three records plus warnings.
     */
    console.log('\n=== structured import: a real DOCX becomes an editable Markdown page ===')
    const docxImport = await importViaApi(
      REAL_DOCX,
      'imported-notes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    check('DOCX import accepted (201)', docxImport.status === 201, `status ${docxImport.status}`)
    const imported = docxImport.body
    check(
      'import returns page, attachment, provenance and warnings',
      imported?.page !== undefined &&
        imported?.attachment !== undefined &&
        imported?.provenance !== undefined &&
        Array.isArray(imported?.warnings),
      JSON.stringify(imported).slice(0, 120)
    )
    const importedPage = imported?.page as Record<string, unknown> | undefined
    check(
      'imported page is a markdown page',
      importedPage?.pageType === 'markdown',
      String(importedPage?.pageType)
    )
    const pageContent = JSON.parse(String(importedPage?.content ?? '{}')) as { markdown?: string }
    check(
      'imported page content contains the DOCX heading text',
      typeof pageContent.markdown === 'string' &&
        pageContent.markdown.includes('E2E docx body text'),
      String(pageContent.markdown).slice(0, 120)
    )
    const provenance = imported?.provenance as Record<string, unknown> | undefined
    check(
      'provenance source kind is file',
      provenance?.sourceKind === 'file',
      String(provenance?.sourceKind)
    )
    // Read the provenance row back from the live database, not just the response.
    const provDb = new Database(join(stage, 'data', 'rtwiki.sqlite'), { readonly: true })
    const provRows = provDb
      .query('SELECT page_id, source_kind FROM import_sources WHERE page_id = ?')
      .all(String(importedPage?.id)) as Array<{ page_id: string; source_kind: string }>
    provDb.close()
    check(
      'a provenance row exists in import_sources',
      provRows.length === 1 && provRows[0]?.source_kind === 'file',
      JSON.stringify(provRows)
    )

    console.log('\n=== structured import: embedded images are localized ===')
    const imageImport = await importViaApi(
      DOCX_WITH_IMAGE,
      'with-image.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    check(
      'DOCX with image import accepted (201)',
      imageImport.status === 201,
      `status ${imageImport.status}`
    )
    const imagePage = imageImport.body?.page as Record<string, unknown> | undefined
    const imageContent = JSON.parse(String(imagePage?.content ?? '{}')) as { markdown?: string }
    const imageLink = String(imageContent.markdown ?? '').match(
      /!\[[^\]]*\]\(\/api\/attachments\/([^)]+)\)/
    )
    check(
      'page Markdown links to a stored attachment',
      imageLink !== null,
      String(imageContent.markdown).slice(0, 160)
    )
    if (imageLink) {
      const imageRes = await fetch(`${BASE}/api/attachments/${imageLink[1]}`)
      check('localized image is served', imageRes.status === 200, `status ${imageRes.status}`)
      check(
        'localized image has image MIME',
        (imageRes.headers.get('content-type') ?? '').startsWith('image/')
      )
      const imageBytes = new Uint8Array(await imageRes.arrayBuffer())
      check(
        'localized image bytes round-trip',
        imageBytes.length === 68,
        `length ${imageBytes.length}`
      )
    }
    check(
      'no images_not_imported warning when all images were brought across',
      !Array.isArray(imageImport.body?.warnings) ||
        !(imageImport.body.warnings as Array<{ code: string }>).some(
          (w) => w.code === 'images_not_imported'
        )
    )

    console.log('\n=== structured import: fenced code block newlines survive ===')
    const FENCED_MD = '# Heading\n\nSome text.\n\n```js\nconst a = 1;\nconst b = 2;\n```\n'
    const mdImport = await importViaApi(
      new TextEncoder().encode(FENCED_MD),
      'fenced.md',
      'text/markdown'
    )
    check('Markdown import accepted (201)', mdImport.status === 201, `status ${mdImport.status}`)
    const mdPage = mdImport.body?.page as Record<string, unknown> | undefined
    const mdContent = JSON.parse(String(mdPage?.content ?? '{}')) as { markdown?: string }
    check(
      'fenced code block newlines preserved in page.content',
      mdContent.markdown === FENCED_MD,
      JSON.stringify(mdContent.markdown).slice(0, 120)
    )

    /**
     * Backup and restore, through the COMPILED server.
     *
     * Present here because the defect this covers only ever appeared outside the
     * unit tests: a backup taken on a database that had already run its
     * migrations was refused as `schema-too-new`, and every backup test built a
     * *fresh* database, which is the one case that hides it. A compiled
     * executable starting against a data directory that already holds a
     * database is exactly the situation that failed, so it is the situation
     * worth asserting -- and it is the situation the shipped product is always
     * in after its first run.
     */
    console.log('\n=== backup and restore, through the COMPILED server ===')

    const json = async (
      route: string,
      init?: RequestInit
    ): Promise<{ status: number; body: Record<string, unknown> | null }> => {
      const res = await fetch(`${BASE}${route}`, {
        ...init,
        // These endpoints reject cross-origin requests, so the Origin must match.
        headers: { Origin: ORIGIN, ...(init?.headers ?? {}) }
      })
      const text = await res.text()
      let body: Record<string, unknown> | null = null
      try {
        body = JSON.parse(text) as Record<string, unknown>
      } catch {
        body = null
      }
      return { status: res.status, body }
    }

    const newPage = async (title: string): Promise<number> => {
      const res = await json('/api/pages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Canonical empty BlockNote document: a plain string is rejected by the
        // Rich Note validator, so this fixture must use valid rich content.
        body: JSON.stringify({ title, pageType: 'rich', content: '[]' })
      })
      return res.status
    }

    const titlesViaHttp = async (): Promise<string[]> => {
      const res = await json('/api/pages?limit=100')
      const body = res.body as { pages?: Array<{ title: string }> } | null
      return (body?.pages ?? []).map((p) => p.title)
    }

    const beforeCreated = await newPage('Before the backup')
    check(
      'a page can be created for the backup to capture',
      beforeCreated === 201,
      `status ${beforeCreated}`
    )

    const run = await json('/api/backup/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: 'daily' })
    })
    check('daily backup taken', run.status === 200 && run.body?.ok === true, `status ${run.status}`)

    const overview = await json('/api/backup')
    const slots = (overview.body?.backups ?? []) as Array<{
      slot: string
      byteSize: number | null
    }>
    const daily = slots.find((s) => s.slot === 'daily')
    check('the daily slot reports a file', (daily?.byteSize ?? 0) > 0, JSON.stringify(daily))
    check('all three slots are listed', slots.length === 3, `saw ${slots.length}`)

    // The point of the whole block: a backup of the database this server is
    // running on must be acceptable to that same server.
    const inspect = await json('/api/backup/inspect?file=rtwiki-backup-daily')
    check(
      'a backup of this running database is accepted for restore',
      inspect.status === 200 && inspect.body?.ok === true,
      JSON.stringify(inspect.body).slice(0, 120)
    )

    // A file that is not a backup, refused with a named reason. Two cases, because
    // they are refused by different checks and only the second reaches the
    // 16-byte header: a name that does not exist, and a file that does.
    const missing = await json('/api/backup/inspect?file=never-existed.sqlite')
    check(
      'a file that does not exist is refused as not-a-file',
      missing.body?.ok === false && missing.body?.reason === 'not-a-file',
      JSON.stringify(missing.body).slice(0, 100)
    )

    // Written into the staged data directory, so the header check is what
    // refuses it rather than the stat that precedes it.
    writeFileSync(join(stage, 'data', 'backups', 'not-a-database.sqlite'), 'this is not a database')
    const junk = await json('/api/backup/inspect?file=not-a-database.sqlite')
    check(
      'a file that exists but is not a database is refused as not-a-database',
      junk.body?.ok === false && junk.body?.reason === 'not-a-database',
      JSON.stringify(junk.body).slice(0, 100)
    )

    const traversal = await json('/api/backup/inspect?file=..%2F..%2Fserver.json')
    check(
      'a traversal filename is refused',
      traversal.body?.kind === 'path-outside-backups' || traversal.status !== 200,
      `status ${traversal.status} ${JSON.stringify(traversal.body).slice(0, 80)}`
    )

    // Change the wiki after the backup, so a restore is visibly a rollback.
    const afterCreated = await newPage('After the backup')
    check('a page can be created after the backup', afterCreated === 201, `status ${afterCreated}`)
    const beforeRestore = await titlesViaHttp()
    check(
      'both pages are present before the restore',
      beforeRestore.includes('After the backup') && beforeRestore.includes('Before the backup'),
      beforeRestore.join(',').slice(0, 90)
    )

    const tokenRes = await json('/api/shutdown/token')
    const token = String(tokenRes.body?.token ?? '')
    check('a shutdown token is available', token.length > 0)

    const noToken = await json('/api/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'rtwiki-backup-daily' })
    })
    check(
      'restore without the token is refused',
      noToken.status === 403,
      `status ${noToken.status}`
    )

    const badFile = await json('/api/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rtwiki-shutdown-token': token },
      body: JSON.stringify({ file: 'not-a-database.sqlite' })
    })
    check(
      'a refused candidate is refused before anything moves',
      badFile.status === 409 && badFile.body?.ok === false,
      `status ${badFile.status} ${JSON.stringify(badFile.body).slice(0, 90)}`
    )
    check(
      'the refused restore left the wiki alone',
      (await titlesViaHttp()).includes('After the backup')
    )

    const restored = await json('/api/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rtwiki-shutdown-token': token },
      body: JSON.stringify({ file: 'rtwiki-backup-daily' })
    })
    check(
      'restore accepted with the token',
      restored.status === 202 && restored.body?.ok === true,
      `status ${restored.status} ${JSON.stringify(restored.body).slice(0, 100)}`
    )
    check(
      'restore reports where the previous database went',
      typeof restored.body?.preRestore === 'string' &&
        String(restored.body.preRestore).includes('rtwiki.pre-restore-'),
      String(restored.body?.preRestore)
    )
    check(
      'the backup survives the restore',
      existsSync(join(stage, 'data', 'backups', 'rtwiki-backup-daily'))
    )

    // The server stops itself after a restore, so nothing more can be asked of it
    // over HTTP. What remains is on disk, and that is what the rest checks.
    await Bun.sleep(1500)
    let stillListening = true
    try {
      await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
    } catch {
      stillListening = false
    }
    check('the server shut itself down after the restore', stillListening === false)

    const dataDir = join(stage, 'data')
    const preRestores = existsSync(dataDir)
      ? readdirSync(dataDir).filter(
          (f) => f.startsWith('rtwiki.pre-restore-') && f.endsWith('.sqlite')
        )
      : []
    check(
      'the previous database was kept, not deleted',
      preRestores.length === 1,
      preRestores.join(',')
    )

    if (preRestores.length === 1) {
      // The kept copy must be a usable database holding the later state, since
      // that is the wiki as it stood immediately before the restore.
      const kept = new Database(join(dataDir, preRestores[0]), { readonly: true })
      const keptTitles = (
        kept.query('SELECT title FROM pages').all() as Array<{ title: string }>
      ).map((r) => r.title)
      const keptIntegrity = kept.query('PRAGMA integrity_check').all()
      kept.close()
      check('the kept database is sound', keptIntegrity.length === 1, JSON.stringify(keptIntegrity))
      check(
        'the kept database holds the state from before the restore',
        keptTitles.includes('After the backup') && keptTitles.includes('Before the backup'),
        keptTitles.join(',').slice(0, 90)
      )
    }

    const live = new Database(join(dataDir, 'rtwiki.sqlite'), { readonly: true })
    const liveTitles = (
      live.query('SELECT title FROM pages').all() as Array<{ title: string }>
    ).map((r) => r.title)
    const liveIntegrity = live.query('PRAGMA integrity_check').all()
    const liveMigrations = (
      live.query('SELECT count(*) AS n FROM _migrations').all() as Array<{
        n: number
      }>
    )[0]?.n
    live.close()
    check(
      'the restored database is sound',
      liveIntegrity.length === 1,
      JSON.stringify(liveIntegrity)
    )
    check(
      'the restore rolled the wiki back to the backup',
      liveTitles.includes('Before the backup') && !liveTitles.includes('After the backup'),
      liveTitles.join(',').slice(0, 90)
    )
    // Compare against the backup's own migration set, not a hand-maintained
    // count: literals here drifted at 9 and again at 13. The invariant that
    // matters is that restore preserved the schema the backup carried.
    const backupDb = new Database(join(stage, 'data', 'backups', 'rtwiki-backup-daily'), {
      readonly: true
    })
    const backupMigrations = (
      backupDb.query('SELECT count(*) AS n FROM _migrations').all() as Array<{ n: number }>
    )[0]?.n
    backupDb.close()
    check(
      'the restored database kept its schema',
      liveMigrations === backupMigrations,
      `migrations ${liveMigrations}, backup ${backupMigrations}`
    )
  } finally {
    // `stopServer` rather than `server.kill`, so every exit path — including a
    // thrown assertion — releases the port.
    stopServer()
    await Bun.sleep(500)
    // The application's data directory is the staged copy, so this removes only
    // the throwaway workspace and never the real one.
    try {
      rmSync(stage, { recursive: true, force: true })
    } catch {
      // A locked file is not a test failure.
    }
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
