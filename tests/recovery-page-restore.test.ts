import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  insertOperationCore,
  insertRevisionCore
} from '../src/server/repositories/page-repository.js'
import { pruneRecoveryData } from '../src/server/services/page-service.js'
import {
  MAX_PAGE_REVISIONS_PER_PAGE,
  RECOVERY_RETENTION_DAYS
} from '../src/shared/constants/index.js'
import {
  OperationKind,
  OperationStatus,
  RecoveryActor,
  RevisionCaptureKind
} from '../src/shared/schemas/recovery.js'
import {
  type RecoveryFixture,
  richAttachment,
  richParagraph,
  setupRecoveryFixture,
  teardownRecoveryFixture
} from './helpers/recovery-fixtures.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const BEFORE_UPDATE = RevisionCaptureKind[0]
const BEFORE_SOFT_DELETE = RevisionCaptureKind[1]
const PERMANENT_DELETE = OperationKind[4]

interface PageRow {
  id: string
  parent_id: string | null
  position: number
  structure_version: number
  deleted_at: string | null
  created_at: string
  content: string
  version: number
}

interface PageResponse {
  page: {
    id: string
    title: string
    parentId: string | null
    position: number
    createdAt: string
    updatedAt: string
    content: string
  }
}

interface ListResponse {
  pages: Array<{ id: string; parentId: string | null; position: number }>
  total: number
}

interface LinksResponse {
  links: Array<{ id: string }>
}

interface RevisionsResponse {
  revisions: Array<{ id: string; captureKind: string; createdAt: string }>
}

let f: RecoveryFixture

beforeEach(async () => {
  f = await setupRecoveryFixture()
})

afterEach(async () => {
  await teardownRecoveryFixture(f)
})

function row(id: string): PageRow {
  const found = f.db
    .query(
      'SELECT id, parent_id, position, structure_version, deleted_at, created_at, content, version FROM pages WHERE id = ?'
    )
    .get(id) as PageRow | undefined
  if (!found) throw new Error(`No page row for ${id}`)
  return found
}

function children(parentId: string | null): PageRow[] {
  return f.db
    .query(
      parentId === null
        ? 'SELECT id, parent_id, position, structure_version, deleted_at, created_at, content, version FROM pages WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY position, rowid'
        : 'SELECT id, parent_id, position, structure_version, deleted_at, created_at, content, version FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, rowid'
    )
    .all(...(parentId === null ? [] : [parentId])) as PageRow[]
}

function searchText(id: string): string {
  const found = f.db.query('SELECT content FROM search_index WHERE page_id = ?').get(id) as
    | { content: string }
    | undefined
  return found?.content ?? ''
}

/** The pre-delete revision id, read through the public history endpoint. */
async function softDeleteRevisionId(id: string): Promise<string> {
  const history = await f.json<RevisionsResponse>('GET', `/api/pages/${id}/revisions`)
  expect(history.status).toBe(200)
  const revision = history.body.revisions.find((r) => r.captureKind === BEFORE_SOFT_DELETE)
  expect(revision, 'a pre-delete revision was captured').toBeDefined()
  return revision?.id ?? ''
}

async function trashAndRestore(id: string): Promise<PageResponse['page']> {
  const revisionId = await softDeleteRevisionId(id)
  const restored = await f.json<PageResponse>(
    'POST',
    `/api/pages/${id}/revisions/${revisionId}/restore`
  )
  expect(restored.status).toBe(200)
  return restored.body.page
}

function richWithTextAndLink(text: string, targetId: string): string {
  return JSON.stringify([
    { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'link',
          href: `#/page/${targetId}`,
          content: [{ type: 'text', text: 'linked note', styles: {} }]
        }
      ]
    }
  ])
}

describe('revision-backed page restore', () => {
  it('recovers hierarchy, child positions, links and search text', async () => {
    const linkTarget = f.page({ title: 'Link target' })
    const needle = 'UNIQUE_SEARCH_NEEDLE_4A7C'
    const parent = f.page({
      title: 'Parent',
      content: richWithTextAndLink(needle, linkTarget.id)
    })
    const child = f.page({ title: 'Child', parentId: parent.id, position: 0 })
    const originalCreatedAt = row(parent.id).created_at
    const originalPosition = row(parent.id).position

    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    // Trash removes the page from ordinary reads, search and the link index.
    expect((await f.json('GET', `/api/pages/${parent.id}`)).status).toBe(404)
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(0)
    expect(row(child.id).parent_id).toBeNull()

    const restored = await trashAndRestore(parent.id)

    expect(restored.id).toBe(parent.id)
    expect(restored.parentId).toBeNull()
    expect(restored.position).toBe(originalPosition)
    expect(restored.createdAt).toBe(originalCreatedAt)
    expect(row(child.id).parent_id).toBe(parent.id)
    expect(row(child.id).position).toBe(0)

    const links = await f.json<LinksResponse>('GET', `/api/pages/${parent.id}/links`)
    expect(links.body.links.map((l) => l.id)).toContain(linkTarget.id)

    const search = await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)
    expect(search.body.pages.map((p) => p.id)).toContain(parent.id)
    expect(searchText(parent.id)).toContain(needle)
  })

  it('normal restore recovers hierarchy, positions, links and search text', async () => {
    const linkTarget = f.page({ title: 'Link target' })
    const needle = 'NORMAL_RESTORE_NEEDLE_8E3B'
    const parent = f.page({
      title: 'Parent',
      content: richWithTextAndLink(needle, linkTarget.id)
    })
    const child = f.page({ title: 'Child', parentId: parent.id, position: 0 })
    const originalCreatedAt = row(parent.id).created_at
    const originalPosition = row(parent.id).position

    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    expect((await f.json('GET', `/api/pages/${parent.id}`)).status).toBe(404)
    expect((await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)).body.total).toBe(0)
    expect(row(child.id).parent_id).toBeNull()

    // The Trash UI's endpoint: no revision id in the URL. The route must find
    // the pre-delete snapshot itself rather than taking the legacy fallback.
    const restored = await f.json<PageResponse>('POST', `/api/pages/${parent.id}/restore`)
    expect(restored.status).toBe(200)

    expect(restored.body.page.id).toBe(parent.id)
    expect(restored.body.page.parentId).toBeNull()
    expect(restored.body.page.position).toBe(originalPosition)
    expect(restored.body.page.createdAt).toBe(originalCreatedAt)
    expect(row(child.id).parent_id).toBe(parent.id)
    expect(row(child.id).position).toBe(0)

    const links = await f.json<LinksResponse>('GET', `/api/pages/${parent.id}/links`)
    expect(links.body.links.map((l) => l.id)).toContain(linkTarget.id)

    const search = await f.json<ListResponse>('GET', `/api/pages?q=${needle}`)
    expect(search.body.pages.map((p) => p.id)).toContain(parent.id)
    expect(searchText(parent.id)).toContain(needle)
  })

  it('leaves a child moved to another parent where the user put it', async () => {
    const otherParent = f.page({ title: 'Other parent' })
    const parent = f.page({ title: 'Parent' })
    const child = f.page({ title: 'Child', parentId: parent.id, position: 0 })

    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    expect(row(child.id).parent_id).toBeNull()

    const moved = await f.json<PageResponse>('POST', `/api/pages/${child.id}/move`, {
      newParentId: otherParent.id,
      newPosition: 0
    })
    expect(moved.status).toBe(200)

    await trashAndRestore(parent.id)

    expect(row(child.id).parent_id).toBe(otherParent.id)
    expect(row(parent.id).deleted_at).toBeNull()
  })

  it('leaves a same-parent reordered child reordered, not re-parented', async () => {
    const parent = f.page({ title: 'Parent', position: 0 })
    const sibling = f.page({ title: 'Sibling', position: 1 })
    const child = f.page({ title: 'Child', parentId: parent.id, position: 0 })

    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    // Promotion puts the child before the sibling at root.
    expect(children(null).map((p) => p.id)).toEqual([child.id, sibling.id])

    const reordered = await f.json<PageResponse>('POST', `/api/pages/${child.id}/move`, {
      newParentId: null,
      newPosition: 1
    })
    expect(reordered.status).toBe(200)
    expect(children(null).map((p) => p.id)).toEqual([sibling.id, child.id])

    await trashAndRestore(parent.id)

    // The child's structure_version changed, so restore must not claim it back.
    expect(row(child.id).parent_id).toBeNull()
    expect(children(null).map((p) => p.id)).toContain(child.id)
    expect(children(null).findIndex((p) => p.id === child.id)).toBeGreaterThan(
      children(null).findIndex((p) => p.id === sibling.id)
    )
    expect(row(parent.id).deleted_at).toBeNull()
  })

  it('falls back to root without data loss when the original parent is also deleted', async () => {
    const grandparent = f.page({ title: 'Grandparent' })
    const parent = f.page({ title: 'Parent', parentId: grandparent.id, position: 0 })
    const child = f.page({ title: 'Child', parentId: parent.id, position: 0 })
    const childContent = richParagraph('CHILD_SURVIVES_9D2F')
    const updated = await f.json<PageResponse>('PATCH', `/api/pages/${child.id}`, {
      title: 'Child',
      content: childContent,
      version: row(child.id).version ?? 1
    })
    expect(updated.status).toBe(200)

    // Trash the parent FIRST, while its original parent is still living, so
    // the snapshot records that parent. Then trash the grandparent too.
    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    expect((await f.json('DELETE', `/api/pages/${grandparent.id}`)).status).toBe(200)

    const restored = await trashAndRestore(parent.id)

    expect(restored.parentId).toBeNull()
    expect(row(parent.id).deleted_at).toBeNull()
    expect(row(child.id).parent_id).toBeNull()
    expect((await f.json('GET', `/api/pages/${child.id}`)).status).toBe(200)
    expect(searchText(child.id)).toContain('CHILD_SURVIVES_9D2F')
  })

  it('restores a root page with children without a position collision', async () => {
    const rootA = f.page({ title: 'Root A', position: 0 })
    const rootB = f.page({ title: 'Root B', position: 1 })
    const child = f.page({ title: 'Child', parentId: rootA.id, position: 0 })

    expect((await f.json('DELETE', `/api/pages/${rootA.id}`)).status).toBe(200)
    expect(children(null).map((p) => p.id)).toEqual([child.id, rootB.id])

    await trashAndRestore(rootA.id)

    const roots = children(null)
    expect(roots.map((p) => p.id)).toEqual([rootA.id, rootB.id])
    expect(roots.map((p) => p.position)).toEqual([0, 1])
    expect(new Set(roots.map((p) => p.position)).size).toBe(roots.length)
    expect(children(rootA.id).map((p) => p.id)).toEqual([child.id])
  })

  it('restores several children in recorded order with compacted, hole-free positions', async () => {
    const first = f.page({ title: 'First', position: 0 })
    const parent = f.page({ title: 'Parent', position: 1 })
    const last = f.page({ title: 'Last', position: 2 })
    const c1 = f.page({ title: 'C1', parentId: parent.id, position: 0 })
    const c2 = f.page({ title: 'C2', parentId: parent.id, position: 1 })
    const c3 = f.page({ title: 'C3', parentId: parent.id, position: 2 })

    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    expect(children(null).map((p) => p.id)).toEqual([first.id, c1.id, c2.id, c3.id, last.id])

    await trashAndRestore(parent.id)

    expect(children(null).map((p) => p.id)).toEqual([first.id, parent.id, last.id])
    expect(children(null).map((p) => p.position)).toEqual([0, 1, 2])
    expect(children(parent.id).map((p) => p.id)).toEqual([c1.id, c2.id, c3.id])
    expect(children(parent.id).map((p) => p.position)).toEqual([0, 1, 2])
  })
})

describe('legacy and undo paths', () => {
  it('restores a page trashed before migration 015 with reduced fidelity and no data loss', async () => {
    // A pre-015 trash has no revision snapshot: the row was trashed directly and
    // its search row was removed. The legacy fallback must still bring it back.
    const id = randomUUID()
    const content = richParagraph('LEGACY_TRASH_NEEDLE_5B1E')
    const createdAt = new Date(Date.now() - 10 * MS_PER_DAY).toISOString()
    f.db.run(
      `INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version)
       VALUES (?, 'Legacy page', ?, 'rich', NULL, 0, ?, ?, ?, 1)`,
      [id, content, createdAt, createdAt, createdAt]
    )

    const restored = await f.json<PageResponse>('POST', `/api/pages/${id}/restore`)
    expect(restored.status).toBe(200)
    expect(restored.body.page.id).toBe(id)
    expect(restored.body.page.createdAt).toBe(createdAt)
    expect(restored.body.page.content).toBe(content)
    expect(row(id).deleted_at).toBeNull()

    const search = await f.json<ListResponse>('GET', '/api/pages?q=LEGACY_TRASH_NEEDLE_5B1E')
    expect(search.body.pages.map((p) => p.id)).toContain(id)
  })

  it('answers 410 recovery_data_expired for an expired revision without mutating anything', async () => {
    const parent = f.page({ title: 'Parent' })
    expect((await f.json('DELETE', `/api/pages/${parent.id}`)).status).toBe(200)
    const revisionId = await softDeleteRevisionId(parent.id)
    const operationsBefore = (
      f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }
    ).n
    const revisionsBefore = (
      f.db.query('SELECT COUNT(*) AS n FROM page_revisions').get() as { n: number }
    ).n

    const expiredAt = new Date(
      Date.now() - (RECOVERY_RETENTION_DAYS + 5) * MS_PER_DAY
    ).toISOString()
    f.db.run('UPDATE page_revisions SET captured_at = ? WHERE id = ?', [expiredAt, revisionId])

    const result = await f.json<{ error: string; code: string }>(
      'POST',
      `/api/pages/${parent.id}/revisions/${revisionId}/restore`
    )
    expect(result.status).toBe(410)
    expect(result.body.code).toBe('recovery_data_expired')

    expect(row(parent.id).deleted_at).not.toBeNull()
    expect((await f.json('GET', `/api/pages/${parent.id}`)).status).toBe(404)
    expect((f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }).n).toBe(
      operationsBefore
    )
    expect((f.db.query('SELECT COUNT(*) AS n FROM page_revisions').get() as { n: number }).n).toBe(
      revisionsBefore
    )
  })

  it('prunes without leaving a dangling revision reference, even when one revision is shared', async () => {
    const pageId = randomUUID()
    const old = new Date(Date.now() - (RECOVERY_RETENTION_DAYS + 5) * MS_PER_DAY).toISOString()
    const now = new Date().toISOString()
    const sharedId = randomUUID()
    const newestId = randomUUID()

    insertRevisionCore(f.db, {
      id: sharedId,
      pageId,
      version: 1,
      title: 'Old',
      content: '',
      pageType: 'rich',
      parentId: null,
      position: 0,
      searchContent: '',
      childrenSnapshot: '[]',
      linksSnapshot: '[]',
      captureKind: RevisionCaptureKind[0],
      actor: RecoveryActor[0],
      capturedAt: old,
      createdAt: old
    })
    insertRevisionCore(f.db, {
      id: newestId,
      pageId,
      version: 2,
      title: 'New',
      content: '',
      pageType: 'rich',
      parentId: null,
      position: 0,
      searchContent: '',
      childrenSnapshot: '[]',
      linksSnapshot: '[]',
      captureKind: RevisionCaptureKind[0],
      actor: RecoveryActor[0],
      capturedAt: now,
      createdAt: now
    })
    // The expired operation points at the shared revision as its `before`; a
    // retained operation points at the SAME revision as its `after`. Deleting
    // the revision because the first operation expired would dangle the second.
    insertOperationCore(f.db, {
      id: randomUUID(),
      operationKind: OperationKind[0],
      targetPageId: pageId,
      targetAttachmentId: null,
      beforeRevisionId: sharedId,
      afterRevisionId: null,
      actor: RecoveryActor[0],
      status: OperationStatus[0],
      createdAt: old
    })
    insertOperationCore(f.db, {
      id: randomUUID(),
      operationKind: OperationKind[1],
      targetPageId: pageId,
      targetAttachmentId: null,
      beforeRevisionId: null,
      afterRevisionId: sharedId,
      actor: RecoveryActor[0],
      status: OperationStatus[0],
      createdAt: now
    })

    const result = pruneRecoveryData(f.db)

    expect(result.operationsDeleted).toBe(1)
    // bun:sqlite returns `null` for a missing row, so `toBeDefined` would pass
    // on a pruned revision. Assert non-null explicitly.
    expect(f.db.query('SELECT 1 FROM page_revisions WHERE id = ?').get(sharedId)).not.toBeNull()
    expect(f.db.query('SELECT 1 FROM page_revisions WHERE id = ?').get(newestId)).not.toBeNull()
    const dangling = f.db
      .query(
        `SELECT COUNT(*) AS n FROM operation_log ol
         WHERE (ol.before_revision_id IS NOT NULL AND NOT EXISTS
                 (SELECT 1 FROM page_revisions pr WHERE pr.id = ol.before_revision_id))
            OR (ol.after_revision_id IS NOT NULL AND NOT EXISTS
                 (SELECT 1 FROM page_revisions pr WHERE pr.id = ol.after_revision_id))`
      )
      .get() as { n: number }
    expect(dangling.n).toBe(0)
    expect(MAX_PAGE_REVISIONS_PER_PAGE).toBeGreaterThan(1)
  })
})

describe('permanent page deletion', () => {
  it('purges revisions and history, records one metadata-only event, and stays atomic', async () => {
    const page = f.page({ title: 'Doomed', content: richParagraph('DOOMED_NEEDLE') })
    expect((await f.json('DELETE', `/api/pages/${page.id}`)).status).toBe(200)
    expect((await f.json('GET', `/api/pages/${page.id}/revisions`)).status).toBe(200)

    const removed = await f.json<{ ok: boolean }>(
      'DELETE',
      `/api/pages/${page.id}/permanent?confirm=permanent`
    )
    expect(removed.status).toBe(200)
    expect(removed.body.ok).toBe(true)

    expect((await f.json('GET', `/api/pages/${page.id}`)).status).toBe(404)
    expect((await f.json('GET', `/api/pages/${page.id}/revisions`)).status).toBe(404)
    expect(
      f.db.query('SELECT COUNT(*) AS n FROM page_revisions WHERE page_id = ?').get(page.id)
    ).toEqual({ n: 0 })

    const events = f.db
      .query('SELECT * FROM operation_log WHERE target_page_id = ?')
      .all(page.id) as Array<Record<string, unknown>>
    expect(events).toHaveLength(1)
    expect(events[0]?.operation_kind).toBe(PERMANENT_DELETE)
    expect(events[0]?.before_revision_id).toBeNull()
    expect(events[0]?.after_revision_id).toBeNull()
    expect(events[0]?.status).toBe(OperationStatus[0])

    // A living page cannot be permanently deleted, and a refused call writes nothing.
    const living = f.page({ title: 'Living' })
    const before = (f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }).n
    const refused = await f.json('DELETE', `/api/pages/${living.id}/permanent?confirm=permanent`)
    expect(refused.status).toBe(404)
    expect((f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }).n).toBe(
      before
    )
  })
})

describe('living-page revision restore', () => {
  it('undoes a content edit on a living page through its revision', async () => {
    const original = richParagraph('ORIGINAL_CONTENT_3E8A')
    const page = f.page({ title: 'Living', content: original })
    const changed = await f.json<PageResponse>('PATCH', `/api/pages/${page.id}`, {
      title: 'Living',
      content: richParagraph('CHANGED_CONTENT_7C1B'),
      version: row(page.id).version ?? 1
    })
    expect(changed.status).toBe(200)

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    expect(history.status).toBe(200)
    const beforeUpdate = history.body.revisions.find((r) => r.captureKind === BEFORE_UPDATE)
    expect(beforeUpdate).toBeDefined()

    const undone = await f.json<PageResponse>(
      'POST',
      `/api/pages/${page.id}/revisions/${beforeUpdate?.id}/restore`
    )
    expect(undone.status).toBe(200)
    expect(undone.body.page.content).toBe(original)
    expect(searchText(page.id)).toContain('ORIGINAL_CONTENT_3E8A')
  })
})

describe('trash restore vs explicit revision restore', () => {
  it('rejects trash restoration of a living page without modifying it', async () => {
    const content = richParagraph('LIVING_TRASH_REFUSAL_A1B2')
    const page = f.page({ title: 'Living', content })
    const before = row(page.id)

    const result = await f.json<{ error: string }>('POST', `/api/pages/${page.id}/restore`)
    expect(result.status).toBe(404)
    expect(result.body.error).toBe('Page not found in trash')

    const after = row(page.id)
    expect(after.content).toBe(content)
    expect(after.version).toBe(before.version)
    expect(after.created_at).toBe(before.created_at)
    expect(after.deleted_at).toBeNull()
    expect((await f.json('GET', `/api/pages/${page.id}`)).status).toBe(200)
  })

  it('cannot revert a living page through trash using a stale pre-delete revision', async () => {
    const original = richParagraph('STALE_REVISION_ORIGINAL_C3D4')
    const page = f.page({ title: 'Stale', content: original })

    // Trash then restore through the normal endpoint. The page is living again,
    // but its `before_soft_delete` snapshot is still in the history table — the
    // exact state that used to let a second trash-restore silently undo it.
    expect((await f.json('DELETE', `/api/pages/${page.id}`)).status).toBe(200)
    const firstRestore = await f.json<PageResponse>('POST', `/api/pages/${page.id}/restore`)
    expect(firstRestore.status).toBe(200)
    expect(row(page.id).deleted_at).toBeNull()

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    expect(history.status).toBe(200)
    expect(history.body.revisions.some((r) => r.captureKind === BEFORE_SOFT_DELETE)).toBe(true)

    // Move the living page forward so a revert would be observable.
    const livingContent = richParagraph('STALE_REVISION_LIVING_E5F6')
    const updated = await f.json<PageResponse>('PATCH', `/api/pages/${page.id}`, {
      title: 'Stale',
      content: livingContent,
      version: row(page.id).version ?? 1
    })
    expect(updated.status).toBe(200)
    const versionBefore = row(page.id).version

    const secondRestore = await f.json<{ error: string }>('POST', `/api/pages/${page.id}/restore`)
    expect(secondRestore.status).toBe(404)
    expect(secondRestore.body.error).toBe('Page not found in trash')

    const after = row(page.id)
    expect(after.content).toBe(livingContent)
    expect(after.version).toBe(versionBefore)
    expect(after.deleted_at).toBeNull()
  })

  it('restores an explicitly requested historical revision of a living page and bumps the version', async () => {
    const original = richParagraph('HISTORICAL_ORIGINAL_G7H8')
    const page = f.page({ title: 'Historical', content: original })

    const changed = await f.json<PageResponse>('PATCH', `/api/pages/${page.id}`, {
      title: 'Historical',
      content: richParagraph('HISTORICAL_CHANGED_I9J0'),
      version: row(page.id).version ?? 1
    })
    expect(changed.status).toBe(200)
    const versionAfterUpdate = row(page.id).version

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    expect(history.status).toBe(200)
    const beforeUpdate = history.body.revisions.find((r) => r.captureKind === BEFORE_UPDATE)
    expect(beforeUpdate).toBeDefined()

    const restored = await f.json<PageResponse>(
      'POST',
      `/api/pages/${page.id}/revisions/${beforeUpdate?.id}/restore`
    )
    expect(restored.status).toBe(200)
    expect(restored.body.page.content).toBe(original)
    expect(row(page.id).version).toBe((versionAfterUpdate ?? 1) + 1)
    expect(searchText(page.id)).toContain('HISTORICAL_ORIGINAL_G7H8')
  })

  it('makes no mutation when the requested revision belongs to a different page', async () => {
    const contentA = richParagraph('WRONG_PAGE_A_K1L2')
    const pageA = f.page({ title: 'Page A', content: contentA })
    const pageB = f.page({ title: 'Page B', content: richParagraph('WRONG_PAGE_B_M3N4') })

    // Give page B a revision of its own by updating it.
    const updatedB = await f.json<PageResponse>('PATCH', `/api/pages/${pageB.id}`, {
      title: 'Page B',
      content: richParagraph('WRONG_PAGE_B_CHANGED_O5P6'),
      version: row(pageB.id).version ?? 1
    })
    expect(updatedB.status).toBe(200)
    const historyB = await f.json<RevisionsResponse>('GET', `/api/pages/${pageB.id}/revisions`)
    expect(historyB.status).toBe(200)
    const revisionOfB = historyB.body.revisions.find((r) => r.captureKind === BEFORE_UPDATE)
    expect(revisionOfB).toBeDefined()

    const versionBefore = row(pageA.id).version
    const operationsBefore = (
      f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }
    ).n
    const revisionsBefore = (
      f.db.query('SELECT COUNT(*) AS n FROM page_revisions').get() as { n: number }
    ).n

    const result = await f.json<{ error: string; code: string }>(
      'POST',
      `/api/pages/${pageA.id}/revisions/${revisionOfB?.id}/restore`
    )
    expect(result.status).toBe(410)
    expect(result.body.code).toBe('recovery_data_expired')

    const after = row(pageA.id)
    expect(after.content).toBe(contentA)
    expect(after.version).toBe(versionBefore)
    expect((f.db.query('SELECT COUNT(*) AS n FROM operation_log').get() as { n: number }).n).toBe(
      operationsBefore
    )
    expect((f.db.query('SELECT COUNT(*) AS n FROM page_revisions').get() as { n: number }).n).toBe(
      revisionsBefore
    )
  })

  it('rejects a stale concurrent writer after a restore bumps the version', async () => {
    const original = richParagraph('CAS_ORIGINAL_Q7R8')
    const page = f.page({ title: 'CAS', content: original })

    const changed = await f.json<PageResponse>('PATCH', `/api/pages/${page.id}`, {
      title: 'CAS',
      content: richParagraph('CAS_CHANGED_S9T0'),
      version: row(page.id).version ?? 1
    })
    expect(changed.status).toBe(200)
    const preRestoreVersion = row(page.id).version

    const history = await f.json<RevisionsResponse>('GET', `/api/pages/${page.id}/revisions`)
    expect(history.status).toBe(200)
    const beforeUpdate = history.body.revisions.find((r) => r.captureKind === BEFORE_UPDATE)
    expect(beforeUpdate).toBeDefined()

    const restored = await f.json<PageResponse>(
      'POST',
      `/api/pages/${page.id}/revisions/${beforeUpdate?.id}/restore`
    )
    expect(restored.status).toBe(200)
    expect(restored.body.page.content).toBe(original)
    expect(row(page.id).version).toBe((preRestoreVersion ?? 1) + 1)

    const stale = await f.json<{ error: string }>('PATCH', `/api/pages/${page.id}`, {
      title: 'CAS',
      content: richParagraph('CAS_STALE_U1V2'),
      version: preRestoreVersion
    })
    expect(stale.status).toBe(409)
    expect(row(page.id).content).toBe(original)
  })
})

describe('attachment references survive page recovery', () => {
  it('keeps a referenced asset when a page is trashed and restored', async () => {
    const attachmentId = f.attachment({
      mimeType: 'text/plain',
      kind: 'document',
      extractedText: 'ATTACHED_DOCUMENT_TEXT_6F4D'
    })
    const page = f.page({
      title: 'With attachment',
      content: richAttachment(attachmentId, 'document text follows')
    })
    expect(searchText(page.id)).toContain('ATTACHED_DOCUMENT_TEXT_6F4D')

    expect((await f.json('DELETE', `/api/pages/${page.id}`)).status).toBe(200)
    await trashAndRestore(page.id)

    expect(searchText(page.id)).toContain('ATTACHED_DOCUMENT_TEXT_6F4D')
    expect(f.db.query('SELECT 1 FROM attachments WHERE id = ?').get(attachmentId)).not.toBeNull()
  })
})
