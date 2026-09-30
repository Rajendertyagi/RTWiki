import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { insertAttachment } from '../src/server/attachments/attachment-repository.js'
import { reclaimUnreferencedAttachments } from '../src/server/attachments/attachment-retention.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'

/**
 * The two failure modes the reclaim pass must not have.
 *
 * The first is deleting an image a note still uses. The second is subtler and was
 * the actual bug avoided during implementation: reporting a *scan* as a *delete*.
 * `findUnreferencedAttachments` is read-only and exists so a caller can look before
 * it leaps, and a test that only exercised the destructive half would not notice
 * the two being confused.
 */
describe('attachment retention — scan and reclaim are separate', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  const NOW = Date.parse('2026-09-29T12:00:00.000Z')
  const DAY = 24 * 60 * 60 * 1000

  function addAttachment(id: string, createdAt: string): void {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    insertAttachment(db, {
      id,
      mimeType: 'image/png',
      byteSize: bytes.byteLength,
      kind: 'image',
      extractedText: null,
      originalName: `${id}.png`,
      checksum: null,
      data: bytes
    })
    db.run('UPDATE attachments SET created_at = ? WHERE id = ?', [createdAt, id])
  }

  function addPage(id: string, content: string, deletedAt: string | null): void {
    db.run(
      'INSERT INTO pages (id, title, content, page_type, parent_id, position, deleted_at) VALUES (?, ?, ?, ?, NULL, 0, ?)',
      [id, 'A page', content, 'rich', deletedAt]
    )
  }

  function using(attachmentId: string): string {
    return JSON.stringify([
      {
        id: 'b1',
        type: 'image',
        props: { url: `/api/attachments/${attachmentId}` },
        content: [],
        children: []
      }
    ])
  }

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `rtwiki-retain-wiring-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterEach(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('the scan deletes nothing on its own', async () => {
    // A caller that wants to report "you have N unused images" must be able to ask
    // without acting. If the scan deleted, the feature could not exist.
    addAttachment('old-orphan', new Date(NOW - 90 * DAY).toISOString())
    const { findUnreferencedAttachments } = await import(
      '../src/server/attachments/attachment-retention.js'
    )

    const found = findUnreferencedAttachments(db, NOW)
    expect(found.map((f) => f.id)).toEqual(['old-orphan'])
    // Still there: the scan looked and did not touch.
    expect(db.query('SELECT id FROM attachments WHERE id = ?').get('old-orphan')).not.toBeNull()
  })

  it('reclaims an orphan while keeping every referenced image', async () => {
    addAttachment('orphan', new Date(NOW - 90 * DAY).toISOString())
    addAttachment('live', new Date(NOW - 90 * DAY).toISOString())
    addAttachment('binned', new Date(NOW - 90 * DAY).toISOString())
    addPage('p1', using('live'), null)
    addPage('p2', using('binned'), '2026-09-01T00:00:00.000Z')

    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual(['orphan'])
    const remaining = (
      db.query('SELECT id FROM attachments ORDER BY id').all() as Array<{ id: string }>
    ).map((r) => r.id)
    expect(remaining).toEqual(['binned', 'live'])
  })

  it('reports a document that references two images and reclaims neither', async () => {
    // The realistic shape of a study note: several pictures, one page.
    addAttachment('one', new Date(NOW - 90 * DAY).toISOString())
    addAttachment('two', new Date(NOW - 90 * DAY).toISOString())
    addAttachment('gone', new Date(NOW - 90 * DAY).toISOString())
    addPage(
      'p1',
      JSON.stringify([
        {
          id: 'b1',
          type: 'image',
          props: { url: '/api/attachments/one' },
          content: [],
          children: []
        },
        {
          id: 'b2',
          type: 'image',
          props: { url: '/api/attachments/two' },
          content: [],
          children: []
        }
      ]),
      null
    )

    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual(['gone'])
  })

  it('reclaims nothing when every attachment is referenced', async () => {
    addAttachment('a', new Date(NOW - 90 * DAY).toISOString())
    addPage('p1', using('a'), null)
    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('does not treat a document attachment with no image block as a leak to reclaim', async () => {
    // A document's bytes are referenced by a `documentBlock`, not an `image` block,
    // and the URL shape is the same. This asserts the scan's reference test is
    // about the URL and not about the block type, so both kinds are protected.
    addAttachment('doc', new Date(NOW - 90 * DAY).toISOString())
    addPage(
      'p1',
      JSON.stringify([
        {
          id: 'b1',
          type: 'documentBlock',
          props: { url: '/api/attachments/doc' },
          content: [],
          children: []
        }
      ]),
      null
    )

    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual([])
  })
})
