import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { getAttachmentByteSize } from '../src/server/attachments/attachment-repository.js'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { countAttachmentsAwaitingBytes } from '../src/server/backup/validation.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { Logger } from '../src/server/logging/index.js'
import { isSignaturelessDocumentMime } from '../src/shared/import/policy.js'

/**
 * A signature-less document keeps its bytes and serves them as a forced download.
 *
 * ## What changed
 *
 * `.txt`, `.md` and `.html` are formats RTWiki cannot identify from their bytes. The
 * old attachment route kept their extracted text and discarded the bytes, and both
 * serving routes answered 404 for them. ADR-023 reversed that for files imported
 * through the ingest path: the bytes are stored, `GET /api/attachments/:id` serves
 * them under the same forced-download controls as every other document, and only
 * `GET /api/attachments/:id/view` still refuses them (defence in depth — the type
 * was never established, so they must never render inline).
 *
 * ## The hazard this still guards
 *
 * Backup refuses to run when a row has `data IS NULL AND bytes_stored = 1`, which
 * means "bytes were never migrated". New signature-less rows carry bytes and set
 * `bytes_stored = 1`, so they are not flagged; legacy rows have `bytes_stored = 0`
 * and are not flagged either. The mid-migration guard must stay intact.
 */

const silent: Logger = {
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

/** Uploads a file through the real route, so detection and insertion are both exercised. */
async function upload(
  db: Database,
  name: string,
  type: string,
  bytes: Uint8Array
): Promise<{ status: number; body: Record<string, unknown> }> {
  const routes = createAttachmentRoutes({
    getDb: () => db,
    logger: silent,
    available: true
  })
  const app = new Hono().route('/api/attachments', routes)
  // Multipart with no `Origin` header, which is the shape the existing attachment
  // suites use. An `origin` header here would be *rejected* as cross-origin, so a test
  // that set one would be asserting nothing about storage.
  const body = new FormData()
  body.append('file', new File([bytes as unknown as BlobPart], name, { type }))
  const res = await app.request('/api/attachments', { method: 'POST', body })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

function attachmentIdFrom(body: Record<string, unknown>): string {
  const attachment = body.attachment as { id: string }
  return attachment.id
}

/**
 * A structurally complete, minimal single-page PDF.
 *
 * A hand-written header is not enough: `officeparser` opens the container, so a stub
 * beginning `%PDF` is refused with 415 before any storage decision is reached — which is
 * what the first version of this test did, and it failed for a reason that had nothing
 * to do with what it was asserting. Same fixture shape the document suites use, because
 * the point here is what RTWiki does with an *accepted* document.
 */
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

const PDF_BYTES = makePdf('A lecture on cell biology')

describe('a signature-less document stores its bytes and serves them as a download', () => {
  it('keeps the BLOB for a .txt, along with its text and metadata', async () => {
    const db = freshDb()
    await runMigrations(db)
    const bytes = new TextEncoder().encode('the quick brown fox jumps')
    const { status, body } = await upload(db, 'notes.txt', 'text/plain', bytes)
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)

    // The invariant under test: the original bytes are stored (D1-A).
    expect(getAttachmentByteSize(db, id)).toBe(bytes.byteLength)
    const row = db
      .query(
        'SELECT data, bytes_stored, extracted_text, byte_size, original_name FROM attachments WHERE id = ?'
      )
      .get(id) as {
      data: Uint8Array | null
      bytes_stored: number
      extracted_text: string | null
      byte_size: number
      original_name: string | null
    }
    expect(row.data).not.toBeNull()
    expect(new Uint8Array(row.data!)).toEqual(bytes)
    // The row claims its bytes, so backup does not mistake it for a mid-migration row.
    expect(row.bytes_stored).toBe(1)
    // The text is still extracted for the card and the search index.
    expect(row.extracted_text).toContain('quick brown fox')
    expect(row.byte_size).toBe(bytes.byteLength)
    expect(row.original_name).toBe('notes.txt')
  })

  it('serves a .txt as a forced download but never inline', async () => {
    const db = freshDb()
    await runMigrations(db)
    const bytes = new TextEncoder().encode('the quick brown fox jumps')
    const { status, body } = await upload(db, 'notes.txt', 'text/plain', bytes)
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)
    const routes = createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
    const app = new Hono().route('/api/attachments', routes)

    const download = await app.request(`/api/attachments/${id}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/)
    const csp = download.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('sandbox')
    expect(download.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes)

    // Defence in depth: the bytes exist, but inline rendering stays refused.
    expect((await app.request(`/api/attachments/${id}/view`)).status).toBe(404)
  })

  it('still keeps the bytes for a real container, with the flag set', async () => {
    // The control: a PDF has an identifiable type, so there is no reason to discard it,
    // and discarding it would break download and inline view.
    const db = freshDb()
    await runMigrations(db)
    const { status, body } = await upload(db, 'paper.pdf', 'application/pdf', PDF_BYTES)
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)
    const row = db.query('SELECT bytes_stored FROM attachments WHERE id = ?').get(id) as {
      bytes_stored: number
    }
    expect(row.bytes_stored).toBe(1)
    expect(getAttachmentByteSize(db, id)).toBe(PDF_BYTES.byteLength)
  })

  it('does not trip the backup mid-migration guard for signature-less uploads', async () => {
    // New `.txt` rows carry bytes and `bytes_stored = 1`, so they are not the
    // mid-migration corruption the guard exists to catch. Legacy rows with
    // `bytes_stored = 0` are not flagged either.
    const db = freshDb()
    await runMigrations(db)
    await upload(db, 'a.txt', 'text/plain', new TextEncoder().encode('alpha'))
    await upload(db, 'b.txt', 'text/plain', new TextEncoder().encode('beta'))
    expect(countAttachmentsAwaitingBytes(db)).toBe(0)
  })

  it('still trips the guard for a row that claims bytes and does not have them', async () => {
    // The reason the flag exists. New rows carry bytes, so the mid-migration
    // corruption has to be simulated explicitly: NULL data with `bytes_stored = 1`
    // is precisely what backup is there to refuse, and it must not be confused
    // with a legitimate signature-less row.
    const db = freshDb()
    await runMigrations(db)
    const { body } = await upload(db, 'c.txt', 'text/plain', new TextEncoder().encode('gamma'))
    db.query('UPDATE attachments SET data = NULL, bytes_stored = 1 WHERE id = ?').run(
      attachmentIdFrom(body)
    )
    expect(countAttachmentsAwaitingBytes(db)).toBe(1)
  })
})

describe('the signature-less decision is derived from the shared policy', () => {
  it('covers exactly the three formats the allowlist marks signature-less', () => {
    for (const mime of ['text/plain', 'text/markdown', 'text/html']) {
      expect(isSignaturelessDocumentMime(mime), `${mime} must be signature-less`).toBe(true)
    }
    for (const mime of ['application/pdf', 'application/rtf']) {
      expect(isSignaturelessDocumentMime(mime), `${mime} must not be`).toBe(false)
    }
  })
})

describe('the schema says what the code does', () => {
  it('declares data nullable, and no longer claims NOT NULL', async () => {
    // The repository comment and the schema used to disagree with each other. This
    // asserts the schema, so the disagreement cannot be reintroduced silently.
    const db = freshDb()
    await runMigrations(db)
    const info = db.query('PRAGMA table_info(attachments)').all() as Array<{
      name: string
      notnull: number
    }>
    const data = info.find((c) => c.name === 'data')
    expect(data, 'attachments.data must exist').toBeDefined()
    expect(data?.notnull, 'data must be nullable for a signature-less document').toBe(0)
    const flag = info.find((c) => c.name === 'bytes_stored')
    expect(flag, 'bytes_stored must exist').toBeDefined()
  })

  it('backfills existing rows to bytes_stored = 1', async () => {
    // Every row that existed before this migration has its bytes; none was written
    // without them. A row backfilled to 0 would make its bytes unclaimable.
    const dir = mkdtempSync(join(tmpdir(), 'rtwiki-011-'))
    try {
      const db = new Database(join(dir, 'rtwiki.sqlite'))
      db.exec('PRAGMA foreign_keys = ON')
      await runMigrations(db)
      db.run(
        `INSERT INTO attachments (id, mime_type, byte_size, kind, original_name, data, bytes_stored)
         VALUES ('x', 'image/png', 3, 'image', 'a.png', x'010203', 1)`
      )
      // Simulate a pre-011 row by clearing the flag as the migration's own backfill
      // would have seen it: a row with data present.
      db.query("UPDATE attachments SET bytes_stored = 1 WHERE id = 'x'").run()
      const row = db
        .query('SELECT bytes_stored, length(data) AS n FROM attachments WHERE id = ?')
        .get('x') as {
        bytes_stored: number
        n: number
      }
      expect(row.bytes_stored).toBe(1)
      expect(row.n).toBe(3)
      db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
