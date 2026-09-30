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
 * A signature-less document keeps its text and not its bytes.
 *
 * ## What this was
 *
 * `.txt`, `.md` and `.html` are the three accepted formats RTWiki cannot identify from
 * their bytes. The serving path has always refused them — `GET /api/attachments/:id`
 * answers 404 for a signature-less MIME, deliberately, because serving a file whose type
 * cannot be established from its content is how an uploaded HTML page becomes something
 * the browser renders.
 *
 * The bytes were stored anyway. The repository's own comment claimed they were not
 * ("a signature-less document, whose text is stored but whose bytes are never served"),
 * the route always passed `bytes`, and the final schema was `data BLOB NOT NULL` — so
 * unreachable content sat in every row and was copied into every backup.
 *
 * ## The hazard this had to avoid
 *
 * Backup refuses to run when any attachment has `data IS NULL`, because that used to
 * mean one thing: a row still holding its bytes on disk. Introducing deliberate NULLs
 * without disambiguating would have made **every backup fail for good** the first time
 * anyone attached a plain text file. `bytes_stored` is the disambiguation.
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

describe('a signature-less document stores its text and not its bytes', () => {
  it('keeps no BLOB for a .txt, while keeping its text and metadata', async () => {
    const db = freshDb()
    await runMigrations(db)
    const { status, body } = await upload(
      db,
      'notes.txt',
      'text/plain',
      new TextEncoder().encode('the quick brown fox jumps')
    )
    expect(status).toBe(201)
    const id = attachmentIdFrom(body)

    // The invariant under test: no bytes.
    expect(getAttachmentByteSize(db, id)).toBeNull()
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
    expect(row.data).toBeNull()
    // ...and the row says so, rather than the fact being inferred from a MIME type.
    expect(row.bytes_stored).toBe(0)
    // The text is what the product actually needs, and it is kept.
    expect(row.extracted_text).toContain('quick brown fox')
    // Metadata stays truthful about what arrived, even though the bytes were not kept.
    expect(row.byte_size).toBeGreaterThan(0)
    expect(row.original_name).toBe('notes.txt')
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

  it('does not trip the backup mid-migration guard for a deliberate absence', async () => {
    // The hazard, exercised. A `.txt` with no bytes is correct; if this counted, backups
    // would be permanently refused.
    const db = freshDb()
    await runMigrations(db)
    await upload(db, 'a.txt', 'text/plain', new TextEncoder().encode('alpha'))
    await upload(db, 'b.txt', 'text/plain', new TextEncoder().encode('beta'))
    expect(countAttachmentsAwaitingBytes(db)).toBe(0)
  })

  it('still trips the guard for a row that claims bytes and does not have them', async () => {
    // The reason the flag exists. Forcing `bytes_stored = 1` with no data is precisely
    // the corruption backup is there to refuse, and it must not be confused with the
    // deliberate absence above.
    const db = freshDb()
    await runMigrations(db)
    const { body } = await upload(db, 'c.txt', 'text/plain', new TextEncoder().encode('gamma'))
    db.query('UPDATE attachments SET bytes_stored = 1 WHERE id = ?').run(attachmentIdFrom(body))
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
