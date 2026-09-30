import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { insertAttachment } from '../src/server/attachments/attachment-repository.js'
import { createAttachmentRoutes } from '../src/server/attachments/attachment-routes.js'
import { runMigrations } from '../src/server/database/migrations.js'

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never

describe('the /text contract', () => {
  it('returns exactly text and kind, and no filename', async () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await runMigrations(db)
    insertAttachment(db, {
      id: 'a1',
      mimeType: 'application/pdf',
      byteSize: 4,
      kind: 'document',
      extractedText: 'cell biology notes',
      originalName: 'secret-name.pdf',
      checksum: null,
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46])
    })
    const app = new Hono().route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
    )
    const res = await app.request('/api/attachments/a1/text')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    // The contract is narrow on purpose: a document card asks this endpoint for the
    // text it is about to show, and the filename it already holds in its own block props.
    expect(Object.keys(body).sort()).toEqual(['kind', 'text'])
    expect(body.text).toBe('cell biology notes')
    expect(body.kind).toBe('document')
    // Specifically NOT returned. The client used to ask for it on every mount and
    // silently got nothing, because the route never had it.
    expect(body).not.toHaveProperty('originalName')
  })

  it('reports an image as kind image with empty text, not an error', async () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await runMigrations(db)
    insertAttachment(db, {
      id: 'i1',
      mimeType: 'image/png',
      byteSize: 2,
      kind: 'image',
      extractedText: null,
      originalName: 'a.png',
      checksum: null,
      data: new Uint8Array([0x89, 0x50])
    })
    const app = new Hono().route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
    )
    const res = await app.request('/api/attachments/i1/text')
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.kind).toBe('image')
    expect(body.text).toBe('')
  })

  it('404s an unknown id rather than returning an empty document', async () => {
    const db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    await runMigrations(db)
    const app = new Hono().route(
      '/api/attachments',
      createAttachmentRoutes({ getDb: () => db, logger: silent, available: true })
    )
    expect((await app.request('/api/attachments/nope/text')).status).toBe(404)
  })
})
