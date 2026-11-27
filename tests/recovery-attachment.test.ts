import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { getAttachment, listAttachments } from '../src/server/attachments/attachment-repository.js'
import {
  purgeExpiredTrashedAttachments,
  reclaimUnreferencedAttachments
} from '../src/server/attachments/attachment-retention.js'
import { TRASHED_ATTACHMENT_RETENTION_DAYS } from '../src/shared/constants/index.js'
import { RevisionCaptureKind } from '../src/shared/schemas/recovery.js'
import {
  type RecoveryFixture,
  richAttachment,
  richParagraph,
  setupRecoveryFixture,
  teardownRecoveryFixture
} from './helpers/recovery-fixtures.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
const OLD = new Date(NOW - (TRASHED_ATTACHMENT_RETENTION_DAYS + 5) * MS_PER_DAY).toISOString()
const YOUNG = new Date(NOW - MS_PER_DAY).toISOString()
const BEFORE_SOFT_DELETE = RevisionCaptureKind[1]
const BEFORE_UPDATE = RevisionCaptureKind[0]

interface TrashResponse {
  attachments: Array<{ id: string; deletedAt: string | null }>
  total: number
}

interface RestoreResponse {
  attachment: { id: string; deletedAt: string | null }
}

interface ListResponse {
  pages: Array<{ id: string }>
  total: number
}

interface RevisionsResponse {
  revisions: Array<{ id: string; captureKind: string }>
}

let f: RecoveryFixture

beforeEach(async () => {
  f = await setupRecoveryFixture()
})

afterEach(async () => {
  await teardownRecoveryFixture(f)
})

function exists(id: string): boolean {
  // bun:sqlite returns `null`, not `undefined`, for a missing row.
  return f.db.query('SELECT 1 FROM attachments WHERE id = ?').get(id) != null
}

function bytes(id: string): Uint8Array | null {
  const row = f.db.query('SELECT data FROM attachments WHERE id = ?').get(id) as
    | { data: Uint8Array | null }
    | undefined
  return row?.data ?? null
}

describe('trashed attachment purge policy', () => {
  it('keeps a trashed attachment still referenced by a trashed page', async () => {
    const id = f.attachment({ deletedAt: OLD })
    f.db.run(
      `INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version)
       VALUES (?, 'Trashed owner', ?, 'rich', NULL, 0, ?, ?, ?, 1)`,
      [randomUUID(), richAttachment(id, 'still mine'), OLD, OLD, OLD]
    )

    const result = purgeExpiredTrashedAttachments(f.db, { now: NOW })

    expect(result.purged).not.toContain(id)
    expect(result.retained).toContainEqual({ id, reason: 'page-reference' })
    expect(exists(id)).toBe(true)
    expect(bytes(id)).not.toBeNull()
  })

  it('keeps a young unreferenced attachment but purges an old one', async () => {
    const young = f.attachment({ deletedAt: YOUNG })
    const old = f.attachment({ deletedAt: OLD })

    const result = purgeExpiredTrashedAttachments(f.db, { now: NOW })

    expect(result.retained).toContainEqual({ id: young, reason: 'young' })
    expect(result.purged).toContain(old)
    expect(exists(young)).toBe(true)
    expect(exists(old)).toBe(false)
  })

  it('keeps an attachment referenced only by a retained revision, and restoring keeps the asset', async () => {
    const id = f.attachment({
      mimeType: 'text/plain',
      kind: 'document',
      extractedText: 'REVISION_ONLY_TEXT_8A3C',
      deletedAt: OLD
    })
    const page = f.page({
      title: 'Owner',
      content: richAttachment(id, 'revision-only reference')
    })
    expect((await f.json('DELETE', `/api/pages/${page.id}`)).status).toBe(200)

    // Remove the URL from the living page content so the ONLY remaining holder
    // is the retained pre-delete revision snapshot.
    f.db.run('UPDATE pages SET content = ? WHERE id = ?', [richParagraph('no attachment'), page.id])

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    const revisionId = history.body.revisions.find((r) => r.captureKind === BEFORE_SOFT_DELETE)?.id
    expect(revisionId).toBeDefined()

    const result = purgeExpiredTrashedAttachments(f.db, { now: NOW })
    expect(result.retained).toContainEqual({ id, reason: 'revision-reference' })
    expect(exists(id)).toBe(true)

    const restored = await f.json<RestoreResponse>('POST', `/api/attachments/${id}/restore`)
    expect(restored.status).toBe(200)
    expect(restored.body.attachment.deletedAt).toBeNull()
    expect((await f.request(`/api/attachments/${id}`)).status).toBe(200)

    // The page can still be restored from its revision and the asset is intact.
    const pageRestore = await f.json(
      'POST',
      `/api/pages/${page.id}/revisions/${revisionId}/restore`
    )
    expect(pageRestore.status).toBe(200)
    expect(exists(id)).toBe(true)
  })

  it('keeps a restored attachment out of the trash purge', async () => {
    const id = f.attachment({ deletedAt: OLD })
    const restored = await f.json<RestoreResponse>('POST', `/api/attachments/${id}/restore`)
    expect(restored.status).toBe(200)

    const result = purgeExpiredTrashedAttachments(f.db, { now: NOW })
    expect(result.purged).not.toContain(id)
    expect(exists(id)).toBe(true)
    expect(bytes(id)).not.toBeNull()
  })
})

describe('soft-deleted attachment filtering contract', () => {
  it('is hidden from every normal read but visible in trash, and survives the living-orphan sweep', async () => {
    const needle = 'FILTER_CONTRACT_TEXT_2D9B'
    const id = f.attachment({
      mimeType: 'application/pdf',
      kind: 'document',
      extractedText: needle,
      originalName: 'contract.pdf'
    })
    const page = f.page({ title: 'Referencing page', content: richAttachment(id, 'see doc') })
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(1)

    const removed = await f.json<{ ok: boolean }>('DELETE', `/api/attachments/${id}`)
    expect(removed.status).toBe(200)

    // Normal reads refuse it.
    expect((await f.request(`/api/attachments/${id}`)).status).toBe(404)
    expect((await f.request(`/api/attachments/${id}/view`)).status).toBe(404)
    expect((await f.request(`/api/attachments/${id}/text`)).status).toBe(404)
    expect(listAttachments(f.db).map((a) => a.id)).not.toContain(id)
    expect(getAttachment(f.db, id)).toBeNull()
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(0)

    // Only the trash path exposes it, with its bytes still intact.
    const trash = await f.json<TrashResponse>('GET', '/api/attachments/trash')
    expect(trash.status).toBe(200)
    expect(trash.body.attachments.map((a) => a.id)).toContain(id)
    expect(trash.body.attachments.find((a) => a.id === id)?.deletedAt).not.toBeNull()
    expect(bytes(id)).not.toBeNull()

    // The living-orphan sweep must not hard-delete a trashed row, even with a
    // zero age threshold and a clock far in the future.
    const reclaimed = reclaimUnreferencedAttachments(f.db, {
      now: NOW + 365 * MS_PER_DAY,
      minAgeMs: 0
    })
    expect(reclaimed.reclaimed).not.toContain(id)
    expect(exists(id)).toBe(true)

    // Restore returns it to every normal read and to search.
    const restored = await f.json<RestoreResponse>('POST', `/api/attachments/${id}/restore`)
    expect(restored.status).toBe(200)
    expect((await f.request(`/api/attachments/${id}`)).status).toBe(200)
    expect((await f.request(`/api/attachments/${id}/text`)).status).toBe(200)
    expect(listAttachments(f.db).map((a) => a.id)).toContain(id)
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(1)
    expect(page.id).toBeTruthy()
  })
})

describe('living-orphan sweep respects retained revisions', () => {
  it('keeps a living attachment held only by a revision, then reclaims it once that revision is pruned', async () => {
    const needle = 'REVISION_HELD_LIVING_4C1E'
    const id = f.attachment({
      mimeType: 'text/plain',
      kind: 'document',
      extractedText: needle,
      originalName: 'held.txt'
    })
    const page = f.page({
      title: 'Owner',
      content: richAttachment(id, 'reference to be removed')
    })
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(1)

    // Move the living page off the attachment. The before-update revision keeps
    // the old content (and its extracted text), so the revision is now the only
    // holder of the URL.
    const version = (
      f.db.query('SELECT version FROM pages WHERE id = ?').get(page.id) as { version: number }
    ).version
    const updated = await f.json('PATCH', `/api/pages/${page.id}`, {
      title: 'Owner',
      content: richParagraph('reference removed'),
      version
    })
    expect(updated.status).toBe(200)
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(0)

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    const revisionId = history.body.revisions.find((r) => r.captureKind === BEFORE_UPDATE)?.id ?? ''
    expect(revisionId).not.toBe('')
    const snapshot = f.db
      .query('SELECT content, search_content FROM page_revisions WHERE id = ?')
      .get(revisionId) as { content: string; search_content: string }
    expect(snapshot.content).toContain(`/api/attachments/${id}`)

    // The living-orphan sweep must respect that revision: the asset stays
    // downloadable, so a later revision restore cannot lose it.
    const first = reclaimUnreferencedAttachments(f.db, {
      now: NOW + 365 * MS_PER_DAY,
      minAgeMs: 0
    })
    expect(first.reclaimed).not.toContain(id)
    expect(exists(id)).toBe(true)
    expect((await f.request(`/api/attachments/${id}`)).status).toBe(200)

    // Simulate the retention prune removing that revision (and its operation).
    // With no holder left, the same sweep reclaims the attachment and it stops
    // downloading.
    f.db.run('DELETE FROM operation_log WHERE before_revision_id = ?', [revisionId])
    f.db.run('DELETE FROM page_revisions WHERE id = ?', [revisionId])
    const second = reclaimUnreferencedAttachments(f.db, {
      now: NOW + 365 * MS_PER_DAY,
      minAgeMs: 0
    })
    expect(second.reclaimed).toContain(id)
    expect(exists(id)).toBe(false)
    expect((await f.request(`/api/attachments/${id}`)).status).toBe(404)
  })
})
