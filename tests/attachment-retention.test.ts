import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAttachment, insertAttachment } from '../src/server/attachments/attachment-repository.js'
import {
  DEFAULT_UNREFERENCED_MIN_AGE_MS,
  findUnreferencedAttachments,
  reclaimUnreferencedAttachments
} from '../src/server/attachments/attachment-retention.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'

/**
 * Reclaiming attachments that no document refers to.
 *
 * The two things this must never do are delete an image a note still uses, and
 * delete an image belonging to a note in the recycle bin. Both are asserted
 * directly rather than inferred, because the second is the one a reasonable-looking
 * implementation gets wrong by forgetting a `WHERE deleted_at IS NULL`.
 */
describe('attachment retention', () => {
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
    // `created_at` has a database default, so the age of a fixture is set directly
    // rather than by waiting for a clock.
    db.run('UPDATE attachments SET created_at = ? WHERE id = ?', [createdAt, id])
  }

  function addPage(id: string, title: string, content: string, deletedAt: string | null): void {
    db.run(
      'INSERT INTO pages (id, title, content, page_type, parent_id, position, deleted_at) VALUES (?, ?, ?, ?, NULL, 0, ?)',
      [id, title, content, 'rich', deletedAt]
    )
  }

  /** A page that displays the attachment, which is how one is actually stored. */
  function pageUsing(attachmentId: string): string {
    return JSON.stringify([
      {
        id: 'b1',
        type: 'image',
        props: { url: `/api/attachments/${attachmentId}`, caption: '' },
        content: [{ type: 'text', text: '' }],
        children: []
      }
    ])
  }

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `rtwiki-retention-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    mkdirSync(tempDir, { recursive: true })
    db = initDatabase(tempDir)
    await runMigrations(db)
  })

  afterEach(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('finds an attachment no page refers to', () => {
    addAttachment('orphan', '2026-01-01T00:00:00.000Z')
    addPage('p1', 'Has an image', pageUsing('used'), null)

    const orphans = findUnreferencedAttachments(db, NOW)
    expect(orphans.map((o) => o.id)).toEqual(['orphan'])
  })

  it('leaves an attachment a living page refers to alone', () => {
    addAttachment('used', '2026-01-01T00:00:00.000Z')
    addPage('p1', 'Has an image', pageUsing('used'), null)

    expect(findUnreferencedAttachments(db, NOW)).toEqual([])
  })

  it('leaves an attachment a TRASHED page refers to alone', () => {
    // The case that matters most. A binned page can be restored, so deleting its
    // images would destroy content the user deleted by mistake — worse than the
    // leak this pass exists to fix.
    addAttachment('binned', '2026-01-01T00:00:00.000Z')
    addPage('p1', 'Binned note', pageUsing('binned'), '2026-09-01T00:00:00.000Z')

    expect(findUnreferencedAttachments(db, NOW)).toEqual([])
  })

  it('reclaims an old unreferenced attachment', () => {
    addAttachment('orphan', new Date(NOW - 60 * DAY).toISOString())
    addPage('p1', 'Has an image', pageUsing('used'), null)

    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual(['orphan'])
    expect(result.bytes).toBeGreaterThan(0)
    // `get` returns `null` for no row and throws for a query error, so the absence
    // is asserted through the repository's own reader rather than by shape.
    expect(getAttachment(db, 'orphan')).toBeNull()
  })

  it('refuses to reclaim one that is merely young', () => {
    // An image uploaded and then removed from a note ten minutes ago is a user
    // mid-edit, not garbage. The threshold is what keeps this pass from being the
    // more destructive thing.
    addAttachment('fresh', new Date(NOW - 10 * 60 * 1000).toISOString())
    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result.reclaimed).toEqual([])
    expect(result.tooYoung.map((t) => t.id)).toEqual(['fresh'])
    expect(db.query('SELECT id FROM attachments WHERE id = ?').get('fresh')).toBeDefined()
  })

  it('honours an explicit minimum age', () => {
    addAttachment('mid', new Date(NOW - 3 * DAY).toISOString())
    const result = reclaimUnreferencedAttachments(db, { now: NOW, minAgeMs: DAY })
    expect(result.reclaimed).toEqual(['mid'])
  })

  it('never reclaims a referenced attachment, however old it is', () => {
    addAttachment('ancient', '2020-01-01T00:00:00.000Z')
    addPage('p1', 'Old note with an image', pageUsing('ancient'), null)

    const result = reclaimUnreferencedAttachments(db, { now: NOW, minAgeMs: 0 })
    expect(result.reclaimed).toEqual([])
    expect(db.query('SELECT id FROM attachments WHERE id = ?').get('ancient')).toBeDefined()
  })

  it('reads a reference from any page shape, not only a single image block', () => {
    // The scan looks for the attachment id anywhere in stored text rather than
    // parsing BlockNote structure. This is what that looseness buys: a reference
    // in a shape this function does not understand is still a reference.
    addAttachment('deep', '2020-01-01T00:00:00.000Z')
    addPage(
      'p1',
      'Nested',
      JSON.stringify([
        {
          id: 'b1',
          type: 'paragraph',
          children: [
            { id: 'b2', type: 'image', props: { url: '/api/attachments/deep' }, children: [] }
          ]
        }
      ]),
      null
    )

    expect(findUnreferencedAttachments(db, NOW)).toEqual([])
  })

  it('treats an unparseable timestamp as new, so a damaged row is never deleted', () => {
    // With `minAgeMs: 0` the age comparison alone would delete it, because the
    // damage reads as "infinitely old". Zero is not a real policy — it is here to
    // show the guard holds even when the threshold would otherwise permit the
    // delete.
    addAttachment('damaged', '2020-01-01T00:00:00.000Z')
    db.run("UPDATE attachments SET created_at = 'not-a-date' WHERE id = 'damaged'")
    const result = reclaimUnreferencedAttachments(db, { now: NOW, minAgeMs: 0 })
    expect(result.reclaimed).toEqual([])
    expect(result.tooYoung.map((t) => t.id)).toEqual(['damaged'])
  })

  it('has a generous default age, not an eager one', () => {
    expect(DEFAULT_UNREFERENCED_MIN_AGE_MS).toBeGreaterThanOrEqual(7 * DAY)
  })

  it('is idempotent: a second pass finds nothing left to do', () => {
    addAttachment('orphan', new Date(NOW - 60 * DAY).toISOString())
    reclaimUnreferencedAttachments(db, { now: NOW })
    const second = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(second.reclaimed).toEqual([])
    expect(second.tooYoung).toEqual([])
  })

  it('does nothing at all on an empty database', () => {
    const result = reclaimUnreferencedAttachments(db, { now: NOW })
    expect(result).toEqual({ reclaimed: [], bytes: 0, tooYoung: [], failed: [] })
  })
})
