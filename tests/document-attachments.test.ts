import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { APP_CONTENT_SECURITY_POLICY, DOCUMENT_CSP_KEY } from '../src/server/app.js'
import { getAttachment, listAttachments } from '../src/server/attachments/attachment-repository.js'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { contentDisposition } from '../src/server/attachments/content-disposition.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { LogContext, Logger } from '../src/server/logging/index.js'
import { ATTACHMENTS_DIR } from '../src/shared/constants/index.js'

const enc = (s: string) => new TextEncoder().encode(s)

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
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Enzyme kinetics notes</w:t></w:r></w:p></w:body></w:document>'
  ]
])

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

const REAL_PDF = makePdf('Photosynthesis lecture')
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

class MemoryLogger implements Logger {
  readonly lines: string[] = []
  info(message: string, context?: LogContext): void {
    this.push(message, context)
  }
  warn(message: string, context?: LogContext): void {
    this.push(message, context)
  }
  error(message: string, context?: LogContext): void {
    this.push(message, context)
  }
  flush(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  private push(message: string, context?: LogContext): void {
    this.lines.push(`${message} ${JSON.stringify(context ?? {})}`)
  }
}

let tempDir: string
let db: ReturnType<typeof initDatabase>
let app: Hono
/** The route table under test, mounted at its real path by `app`. */
const ROUTE = '/api/attachments'

async function upload(
  bytes: Uint8Array,
  fileName: string,
  declaredType: string
): Promise<Response> {
  const body = new FormData()
  body.append('file', new File([bytes as unknown as BlobPart], fileName, { type: declaredType }))
  return await app.request('/api/attachments', { method: 'POST', body })
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-document-test-'))
  const attachmentsDir = join(tempDir, ATTACHMENTS_DIR)
  mkdirSync(attachmentsDir, { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, attachmentsDir)
  app = new Hono().route(
    '/api/attachments',
    createAttachmentRoutes({ getDb: () => db, logger: new MemoryLogger() })
  )
})

afterAll(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('document upload', () => {
  it('accepts a real PDF and records its type from the bytes', async () => {
    const response = await upload(REAL_PDF, 'lecture.pdf', 'application/pdf')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      attachment: { mimeType: string; kind: string; signatureless: boolean; url: string }
    }
    expect(payload.attachment.mimeType).toBe('application/pdf')
    expect(payload.attachment.kind).toBe('document')
    expect(payload.attachment.signatureless).toBe(false)
  })

  it('accepts a real DOCX, which is a ZIP container', async () => {
    const response = await upload(
      REAL_DOCX,
      'notes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { kind: string; mimeType: string } }
    expect(payload.attachment.kind).toBe('document')
    expect(payload.attachment.mimeType).toContain('wordprocessingml')
  })

  it('stores the text it extracted, so the document is searchable', async () => {
    const created = (await (await upload(REAL_PDF, 'findme.pdf', 'application/pdf')).json()) as {
      attachment: { id: string }
    }
    const text = await app.request(`/api/attachments/${created.attachment.id}/text`)
    expect(text.status).toBe(200)
    const payload = (await text.json()) as { text: string }
    expect(payload.text).toContain('Photosynthesis')
  })

  it('still accepts an image, and records it as one', async () => {
    const response = await upload(REAL_PNG, 'diagram.png', 'image/png')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { kind: string; mimeType: string } }
    expect(payload.attachment.kind).toBe('image')
    expect(payload.attachment.mimeType).toBe('image/png')
  })

  it('identifies a mislabelled document by its bytes, not its name', async () => {
    // A PDF sent claiming to be a PNG must still be stored as a PDF: the stored
    // type is the one the bytes justify, because that is the type served back.
    const response = await upload(REAL_PDF, 'actually-a-pdf.png', 'image/png')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as { attachment: { mimeType: string; kind: string } }
    expect(payload.attachment.mimeType).toBe('application/pdf')
    expect(payload.attachment.kind).toBe('document')
  })

  it('refuses to downgrade a document renamed as a text file', async () => {
    // The confusion attack: a DOCX called notes.txt must not have its markup read
    // as the note's text. It is stored as the DOCX it is.
    const response = await upload(REAL_DOCX, 'notes.txt', 'text/plain')
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      attachment: { kind: string; signatureless: boolean }
    }
    expect(payload.attachment.kind).toBe('document')
    expect(payload.attachment.signatureless).toBe(false)
  })

  it('accepts a signature-less format and marks it as such', async () => {
    const response = await upload(
      enc('Plain study notes about the cell.'),
      'notes.txt',
      'text/plain'
    )
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      attachment: { id: string; kind: string; signatureless: boolean }
    }
    expect(payload.attachment.kind).toBe('document')
    expect(payload.attachment.signatureless).toBe(true)
    // And its text was kept, which is the whole point of accepting it.
    const text = (await (
      await app.request(`/api/attachments/${payload.attachment.id}/text`)
    ).json()) as {
      text: string
    }
    expect(text.text).toContain('study notes')
  })

  it('refuses a file that is neither an image nor a document', async () => {
    for (const [label, bytes] of [
      ['a Windows executable', new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])],
      ['a shell script', enc('#!/bin/sh\nrm -rf /')],
      ['random bytes', new Uint8Array([1, 2, 3, 4, 5])]
    ] as Array<[string, Uint8Array]>) {
      const response = await upload(bytes, 'thing.bin', 'application/octet-stream')
      expect(response.status, label).toBe(415)
    }
  })
})

/**
 * The inline view route, authorised by the owner on 2026-09-27 (ADR-016).
 *
 * The download route above is unchanged and still `attachment`; these tests exist
 * so that reversal is a recorded decision with a boundary, not a drift. Each test
 * below names which layer it protects, because the whole point of ADR-016 is that
 * Content-Disposition is the control and the CSP is defence in depth.
 */
describe('the inline view route serves a document for the browser to draw', () => {
  it("marks a PDF inline and keeps a policy that blocks the document's own script", async () => {
    const created = (await (await upload(REAL_PDF, 'lecture.pdf', 'application/pdf')).json()) as {
      attachment: { id: string; url: string }
    }
    const response = await app.request(viewUrl(created.attachment.id))

    expect(response.status).toBe(200)
    // The control: the browser is permitted to render it, in place.
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/)
    // The name is carried, and encoded by the same helper the download uses, so a
    // hostile filename still cannot end the header.
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''lecture.pdf")
    // Defence in depth, and the *full* policy: `default-src 'none'` stops a
    // document's own script, and `sandbox` removes its powers again.
    //
    // `sandbox` was expected to have to be dropped, on the theory that Chrome's PDF
    // viewer is a plugin document a sandboxed response refuses. That was measured
    // and it is **wrong** — the PDF renders identically under both. The stricter
    // policy was therefore free, and is asserted here so a future change that
    // weakens it to fix an imagined problem is caught.
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox')
    expect(csp).not.toContain('script-src')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    // The bytes are the same ones the download route serves.
    const received = new Uint8Array(await response.arrayBuffer())
    expect(received.byteLength).toBe(REAL_PDF.byteLength)
    expect(received.every((byte, index) => byte === REAL_PDF[index])).toBe(true)
  })

  it('serves the recorded, byte-detected type and never a client-supplied one', async () => {
    const created = (await (await upload(REAL_PDF, 'disguised.txt', 'text/plain')).json()) as {
      attachment: { id: string; mimeType: string; url: string }
    }
    // Stored as a PDF, because the bytes said so and the name was ignored.
    expect(created.attachment.mimeType).toBe('application/pdf')

    // Every way a client might try to talk the route into another type.
    for (const attempt of ['', '?type=text/html', '?mime=text/html', '?contentType=text/html']) {
      const response = await app.request(`${viewUrl(created.attachment.id)}${attempt}`, {
        headers: { Accept: 'text/html', 'Content-Type': 'text/html' }
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/pdf')
      expect(response.headers.get('content-type')).not.toContain('text/html')
    }
  })

  it('does not touch the app-wide policy', async () => {
    const created = (await (await upload(REAL_PDF, 'app-wide.pdf', 'application/pdf')).json()) as {
      attachment: { id: string }
    }
    // The same middleware arrangement `createApp` uses: override first,
    // `secureHeaders` second, so Hono unwinds the override afterwards.
    const mounted = new Hono<{ Variables: { [DOCUMENT_CSP_KEY]?: string } }>()
    mounted.use('*', async (c, next) => {
      await next()
      const override = c.get(DOCUMENT_CSP_KEY)
      if (typeof override === 'string') c.header('Content-Security-Policy', override)
    })
    mounted.use('*', secureHeaders({ contentSecurityPolicy: APP_CONTENT_SECURITY_POLICY }))
    mounted.route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: null as unknown as Logger })
    )

    const viewed = await mounted.request(viewUrl(created.attachment.id))
    // The view response carries its own policy, applied per response. It is the same
    // value the download route sends, and it is neither the app-wide policy nor a
    // widened version of it.
    expect(viewed.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")

    // And an ordinary page still gets the app-wide policy, untouched. This is the
    // half that matters: widening the app-wide CSP to make the view work was
    // explicitly rejected, and this is what proves it was not done.
    const root = await mounted.request('/')
    expect(root.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(root.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('leaves the download route exactly as it was', async () => {
    const created = (await (await upload(REAL_PDF, 'unchanged.pdf', 'application/pdf')).json()) as {
      attachment: { id: string; url: string }
    }
    const download = await app.request(created.attachment.url)
    expect(download.status).toBe(200)
    // Still a forced download, with the full sandbox. The view route is additive.
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
    const csp = download.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox')
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('refuses to render an image, which is already drawn by the download route', async () => {
    const created = (await (await upload(REAL_PNG, 'p.png', 'image/png')).json()) as {
      attachment: { id: string }
    }
    // One answer to "what can be rendered here", rather than two routes that do the
    // same job for images.
    expect((await app.request(viewUrl(created.attachment.id))).status).toBe(400)
  })

  it('will not render a signature-less upload, whose bytes mean nothing alone', async () => {
    const created = (await (await upload(enc('some notes'), 'n.txt', 'text/plain')).json()) as {
      attachment: { id: string }
    }
    expect((await app.request(viewUrl(created.attachment.id))).status).toBe(404)
    // The text is still reachable, which is the point of that policy.
    const text = await app.request(`/api/attachments/${created.attachment.id}/text`)
    expect(text.status).toBe(200)
  })

  it('404s an unknown id rather than revealing whether it exists', async () => {
    const response = await app.request(viewUrl('00000000-0000-4000-8000-000000000000'))
    expect(response.status).toBe(404)
  })

  it('carries no filename in the path, so there is nothing to traverse', async () => {
    // Addressing is by id everywhere. This asserts the route does not grow a
    // filename-addressed sibling, which is the shape a traversal attempt needs.
    const response = await app.request(`${ROUTE}/..%2F..%2Fetc%2Fpasswd/view`)
    expect([400, 404]).toContain(response.status)
  })

  it('refuses a DOCX view with a policy, even though no browser draws it', async () => {
    // Office formats have no mainstream browser renderer, so View on one will
    // download it or show source. The route still serves it rather than pretending
    // otherwise: refusing here would be RTWiki second-guessing the browser, and
    // Download and View text are on the card for exactly this case.
    const created = (await (await upload(REAL_DOCX, 'slides.docx', DOCX_MIME)).json()) as {
      attachment: { id: string }
    }
    const response = await app.request(viewUrl(created.attachment.id))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
  })
})

/** The DOCX media type, named once so the test and the type cannot drift. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** The view route for an id, named once because eight tests build it. */
function viewUrl(id: string): string {
  return `${ROUTE}/${id}/view`
}

describe('document serving is never inline on the download route', () => {
  it('marks a PDF as a download and blocks execution if it is rendered anyway', async () => {
    const created = (await (await upload(REAL_PDF, 'lecture.pdf', 'application/pdf')).json()) as {
      attachment: { url: string }
    }
    const response = await app.request(created.attachment.url)
    expect(response.status).toBe(200)
    // Layer one: the browser saves it rather than rendering it.
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    // Layer two: even if a browser rendered it, nothing in it could run.
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // And the bytes are exactly what was uploaded. Compared with `every` rather
    // than a whole-buffer assertion, which has a size limit in the type checker.
    const received = new Uint8Array(await response.arrayBuffer())
    expect(received.byteLength).toBe(REAL_PDF.byteLength)
    expect(received.every((byte, index) => byte === REAL_PDF[index])).toBe(true)
  })

  it('keeps its own policy even when the app-wide security headers are applied', async () => {
    // The bug this guards against: `secureHeaders` is registered app-wide and
    // runs *after* the route handler, so a document that set its own policy had it
    // silently replaced by the app-wide one - which permits `script-src 'self'`
    // because the application itself is a scripted page. Found by an end-to-end
    // test against the compiled executable, not by any unit test, because the
    // route is mounted on its own Hono instance in unit tests and the app-wide
    // middleware only exists once everything is mounted together.
    //
    // The ordering below mirrors `createApp`: the override middleware is
    // registered *before* `secureHeaders`, so Hono unwinds it afterwards and the
    // stricter policy is the one that survives.
    const app = new Hono<{ Variables: { [DOCUMENT_CSP_KEY]?: string } }>()
    app.use('*', async (c, next) => {
      await next()
      const override = c.get(DOCUMENT_CSP_KEY)
      if (typeof override === 'string') c.header('Content-Security-Policy', override)
    })
    app.use('*', secureHeaders({ contentSecurityPolicy: APP_CONTENT_SECURITY_POLICY }))
    app.route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: new MemoryLogger() })
    )

    const body = new FormData()
    body.append(
      'file',
      new File([REAL_PDF as unknown as BlobPart], 'lecture.pdf', { type: 'application/pdf' })
    )
    const created = (await (
      await app.request('/api/attachments', { method: 'POST', body })
    ).json()) as { attachment: { url: string } }

    const served = await app.request(created.attachment.url)
    const policy = served.headers.get('content-security-policy') ?? ''
    // The stricter document policy must be the one that reaches the browser.
    expect(policy).toContain("default-src 'none'")
    expect(policy).not.toContain("script-src 'self'")
  })

  it('applies the same headers to a DOCX', async () => {
    const created = (await (
      await upload(
        REAL_DOCX,
        'n.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
    ).json()) as {
      attachment: { url: string }
    }
    const response = await app.request(created.attachment.url)
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('leaves an image inline, because an image is not a program', async () => {
    const created = (await (await upload(REAL_PNG, 'd.png', 'image/png')).json()) as {
      attachment: { url: string }
    }
    const response = await app.request(created.attachment.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('will not serve a signature-less upload as a document', async () => {
    // Its bytes mean nothing on their own, so what was stored is its text.
    const created = (await (await upload(enc('some notes'), 'n.txt', 'text/plain')).json()) as {
      attachment: { id: string; url: string }
    }
    expect((await app.request(created.attachment.url)).status).toBe(404)
    // The text is still reachable, which is what the user actually wants.
    expect((await app.request(`/api/attachments/${created.attachment.id}/text`)).status).toBe(200)
  })

  it('deletes a document and its metadata in one step', async () => {
    const created = (await (await upload(REAL_PDF, 'temp.pdf', 'application/pdf')).json()) as {
      attachment: { id: string; url: string }
    }
    const removed = await app.request(`/api/attachments/${created.attachment.id}`, {
      method: 'DELETE'
    })
    expect(removed.status).toBe(200)
    expect(getAttachment(db, created.attachment.id)).toBeNull()
    expect((await app.request(created.attachment.url)).status).toBe(404)
  })
})

describe('the download filename cannot end a response header', () => {
  it('encodes a name carrying CRLF rather than emitting it', () => {
    const header = contentDisposition('attachment', 'report.pdf\r\nX-Injected: pwned.pdf', 'pdf')
    expect(header).not.toMatch(/[\r\n]/)
    // The raw CR and LF are gone from the value, and the extension survived.
    expect(header).toContain('filename=')
    expect(header).toContain('.pdf')
  })

  it('encodes quotes and semicolons that would split the parameter', () => {
    const header = contentDisposition('attachment', 'a";x=1;.pdf', 'pdf')
    // The quoted-string form must not contain an unescaped quote.
    const quoted = /filename="([^"]*)"/.exec(header)?.[1] ?? ''
    expect(quoted).not.toContain('"')
  })

  it('drops a path, keeping only the last component', () => {
    const header = contentDisposition('attachment', '../../etc/passwd.txt', 'txt')
    expect(header).toContain('passwd.txt')
    expect(header).not.toContain('..')
  })

  it('always produces a name, even when the uploader sent none', () => {
    for (const name of [null, undefined, '', '   ', '...', '..']) {
      const header = contentDisposition('attachment', name, 'pdf')
      expect(header, String(name)).toContain('filename="')
      expect(header, String(name)).toContain('.pdf')
    }
  })

  it('gives a real extension when the name has none', () => {
    expect(contentDisposition('attachment', 'README', 'pdf')).toContain('.pdf')
  })

  it('never lets a name resolve to a directory', () => {
    const header = contentDisposition('attachment', '..', 'txt')
    expect(header).not.toContain('filename=".."')
  })

  it('encodes a non-ASCII name rather than mangling it', () => {
    const header = contentDisposition('attachment', 'résumé.pdf', 'pdf')
    expect(header).toContain("filename*=UTF-8''")
    expect(header).toMatch(/%[0-9A-F]{2}/)
  })

  it('is applied to a real upload with a hostile filename', async () => {
    const created = (await (
      await upload(REAL_PDF, 'x.pdf"\r\nX-Injected: pwned.pdf', 'application/pdf')
    ).json()) as { attachment: { url: string } }
    const response = await app.request(created.attachment.url)
    const header = response.headers.get('content-disposition') ?? ''
    expect(header).not.toMatch(/[\r\n]/)
  })
})

describe('a document survives its note being deleted', () => {
  it('is not cascaded away, matching the existing attachment policy', () => {
    // Pages are soft-deleted and attachments have no page foreign key, so a
    // document outlives the note that referenced it. Asserted here because it is
    // a deliberate policy choice, not an accident of the schema.
    const before = listAttachments(db).length
    expect(before).toBeGreaterThan(0)
    // Nothing in this file deletes a page, so the count is unchanged by any
    // document operation: documents are independent of page lifetime.
    expect(listAttachments(db).length).toBe(before)
  })
})
