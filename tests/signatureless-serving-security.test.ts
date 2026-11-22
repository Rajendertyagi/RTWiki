import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { Logger } from '../src/server/logging/index.js'

/**
 * D1-A security controls for signature-less bytes (ADR-023).
 *
 * A file whose type cannot be established from its bytes used to be refused on
 * both serving routes. Now the bytes are stored and the download route serves
 * them under exactly the controls every other document gets: forced download,
 * per-response sandbox CSP, `nosniff`, private caching, id addressing and a
 * streamed body. The inline view route still refuses them.
 */

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as unknown as Logger

function freshApp(): { db: Database; app: Hono } {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const routes = createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
  return { db, app: new Hono().route('/api/attachments', routes) }
}

async function upload(
  app: Hono,
  name: string,
  type: string,
  bytes: Uint8Array
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData()
  form.append('file', new File([bytes as unknown as BlobPart], name, { type }))
  const res = await app.request('/api/attachments', { method: 'POST', body: form })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

function attachmentIdFrom(body: Record<string, unknown>): string {
  return (body.attachment as { id: string }).id
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

describe('signature-less bytes are served under the full download controls', () => {
  it('forces an uploaded HTML file to download, with no inline rendering path', async () => {
    const { db, app } = freshApp()
    await runMigrations(db)
    const bytes = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>')
    const { status, body } = await upload(app, 'page.html', 'text/html', bytes)
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)

    const download = await app.request(`/api/attachments/${id}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
    const csp = download.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'; sandbox")
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
    expect(download.headers.get('cache-control')).toBe('private, no-cache')
    // The exact bytes come back, so the script is delivered as a file, not run.
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)

    const view = await app.request(`/api/attachments/${id}/view`)
    expect(view.status).toBe(404)
  })

  it('takes the type from the bytes, not the name: a PDF renamed .txt is served as PDF', async () => {
    const { db, app } = freshApp()
    await runMigrations(db)
    const bytes = makePdf('A lecture on cell biology')
    const { status, body } = await upload(app, 'disguised.txt', 'text/plain', bytes)
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)

    const record = body.attachment as { mimeType: string; signatureless: boolean }
    expect(record.mimeType).toBe('application/pdf')
    expect(record.signatureless).toBe(false)

    const download = await app.request(`/api/attachments/${id}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/pdf')
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([...bytes])
  })
})
