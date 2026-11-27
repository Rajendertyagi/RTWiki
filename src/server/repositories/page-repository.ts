import type { Database, SQLQueryBindings } from 'bun:sqlite'
import { RECOVERY_RETENTION_DAYS } from '@rtwiki/shared/constants'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import type {
  OperationKind,
  OperationStatus,
  RecoveryActor,
  RevisionCaptureKind
} from '@rtwiki/shared/schemas/recovery'

export interface SiblingRef {
  id: string
  position: number
}

/** One direct child as recorded in a deletion snapshot. */
export interface ChildSnapshot {
  id: string
  parent_id: string
  position: number
  structure_version: number
}

/** A complete pre-mutation page snapshot, stored in `page_revisions`. */
export interface RevisionSnapshot {
  id: string
  pageId: string
  version: number
  title: string
  content: string
  pageType: PageType
  parentId: string | null
  position: number
  searchContent: string | null
  childrenSnapshot: string | null
  linksSnapshot: string | null
  captureKind: RevisionCaptureKind
  actor: RecoveryActor
  capturedAt: string
  createdAt: string
}

/** A committed recovery operation, stored in `operation_log`. */
export interface OperationRecord {
  id: string
  operationKind: OperationKind
  targetPageId: string | null
  targetAttachmentId: string | null
  beforeRevisionId: string | null
  afterRevisionId: string | null
  actor: RecoveryActor
  status: OperationStatus
  createdAt: string
}

export interface PruneResult {
  operationsDeleted: number
  revisionsDeleted: number
}

export interface MovePageResult {
  page: Page
  originParentId: string | null
  originSiblings: SiblingRef[]
  destinationParentId: string | null
  destinationSiblings: SiblingRef[]
}

/**
 * Hierarchy-rule violation raised inside repository transactions. The route
 * layer maps `status` onto the HTTP response; the transaction rolls back.
 */
export class HierarchyError extends Error {
  constructor(
    message: string,
    // Literal union so Hono's typed c.json(status) overload accepts it.
    readonly status: 400 | 404 | 500
  ) {
    super(message)
    this.name = 'HierarchyError'
  }
}

/**
 * Raised when a write carries a version that is no longer the stored one: the
 * page changed after the writer read it (a second tab or window). The write is
 * rejected whole — no field is stored and nothing is re-indexed — and the route
 * layer answers 409 Conflict.
 *
 * Rejection, not a merge. A rejected write the user is told about is strictly
 * better than a silent overwrite, and two divergent documents cannot be
 * reconciled safely here.
 */
export class PageVersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number
  ) {
    super(
      `Page version conflict: write expected version ${expectedVersion}, stored version is ${actualVersion}`
    )
    this.name = 'PageVersionConflictError'
  }
}

// ---------- Recovery data primitives ----------
// These are `Core` functions: they assume the caller already holds a
// BEGIN IMMEDIATE write lock and never open one themselves. The service layer
// owns the transaction so a revision, its page mutation, the search row, the
// link index and the operation row all commit as one unit.

export function insertRevisionCore(db: Database, revision: RevisionSnapshot): void {
  db.run(
    `INSERT INTO page_revisions
       (id, page_id, version, title, content, page_type, parent_id, position,
        search_content, children_snapshot, links_snapshot, capture_kind, actor, captured_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      revision.id,
      revision.pageId,
      revision.version,
      revision.title,
      revision.content,
      revision.pageType,
      revision.parentId,
      revision.position,
      revision.searchContent,
      revision.childrenSnapshot,
      revision.linksSnapshot,
      revision.captureKind,
      revision.actor,
      revision.capturedAt,
      revision.createdAt
    ]
  )
}

export function insertOperationCore(db: Database, operation: OperationRecord): void {
  db.run(
    `INSERT INTO operation_log
       (id, operation_kind, target_page_id, target_attachment_id, before_revision_id,
        after_revision_id, actor, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      operation.id,
      operation.operationKind,
      operation.targetPageId,
      operation.targetAttachmentId,
      operation.beforeRevisionId,
      operation.afterRevisionId,
      operation.actor,
      operation.status,
      operation.createdAt
    ]
  )
}

function revisionRowToSnapshot(row: Record<string, unknown>): RevisionSnapshot {
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    version: Number(row.version),
    title: row.title as string,
    content: row.content as string,
    pageType: row.page_type as PageType,
    parentId: (row.parent_id as string) || null,
    position: Number(row.position),
    searchContent: (row.search_content as string) ?? null,
    childrenSnapshot: (row.children_snapshot as string) ?? null,
    linksSnapshot: (row.links_snapshot as string) ?? null,
    captureKind: row.capture_kind as RevisionCaptureKind,
    actor: row.actor as RecoveryActor,
    capturedAt: row.captured_at as string,
    createdAt: row.created_at as string
  }
}

export function getRevision(db: Database, id: string, pageId: string): RevisionSnapshot | null {
  const row = db
    .query('SELECT * FROM page_revisions WHERE id = ? AND page_id = ?')
    .get(id, pageId) as Record<string, unknown> | undefined
  return row ? revisionRowToSnapshot(row) : null
}

/** Newest-first, bounded history for one page. */
export function listRevisions(db: Database, pageId: string, limit: number): RevisionSnapshot[] {
  return (
    db
      .query(
        'SELECT * FROM page_revisions WHERE page_id = ? ORDER BY captured_at DESC, id DESC LIMIT ?'
      )
      .all(pageId, limit) as Array<Record<string, unknown>>
  ).map(revisionRowToSnapshot)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Newest eligible pre-delete snapshot for a page, or null when the page was
 * trashed before migration 015 (no snapshot) or every snapshot has expired.
 *
 * The normal trash-restore endpoint uses this to recover hierarchy, links and
 * search text without the caller naming a revision. Expired snapshots are
 * excluded here rather than handed to `restorePage`, which would answer 410:
 * a normal restore must always succeed, with reduced fidelity when no usable
 * snapshot exists. The non-null checks likewise keep a partial snapshot from
 * reaching the service's strict validation and turning into a 410.
 */
export function findLatestPreDeleteRevision(db: Database, pageId: string): RevisionSnapshot | null {
  const cutoff = new Date(Date.now() - RECOVERY_RETENTION_DAYS * MS_PER_DAY).toISOString()
  const row = db
    .query(
      `SELECT * FROM page_revisions
       WHERE page_id = ?
         AND capture_kind = 'before_soft_delete'
         AND captured_at >= ?
         AND search_content IS NOT NULL
         AND children_snapshot IS NOT NULL
         AND links_snapshot IS NOT NULL
       ORDER BY captured_at DESC, id DESC
       LIMIT 1`
    )
    .get(pageId, cutoff) as Record<string, unknown> | undefined
  return row ? revisionRowToSnapshot(row) : null
}

/** Newest-first, bounded recent operations. */
export function listOperations(db: Database, limit: number): OperationRecord[] {
  return (
    db
      .query('SELECT * FROM operation_log ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>
  ).map(
    (row) =>
      ({
        id: row.id as string,
        operationKind: row.operation_kind as OperationKind,
        targetPageId: (row.target_page_id as string) || null,
        targetAttachmentId: (row.target_attachment_id as string) || null,
        beforeRevisionId: (row.before_revision_id as string) || null,
        afterRevisionId: (row.after_revision_id as string) || null,
        actor: row.actor as RecoveryActor,
        status: row.status as OperationStatus,
        createdAt: row.created_at as string
      }) satisfies OperationRecord
  )
}

/** Outgoing link targets, in a deterministic order for snapshot comparison. */
export function listOutgoingLinkTargets(db: Database, sourceId: string): string[] {
  return (
    db
      .query('SELECT target_id FROM page_links WHERE source_id = ? ORDER BY target_id')
      .all(sourceId) as Array<{ target_id: string }>
  ).map((row) => row.target_id)
}

export function getStructureVersion(db: Database, id: string): number {
  const row = db.query('SELECT structure_version FROM pages WHERE id = ?').get(id) as
    | { structure_version: number }
    | undefined
  return row ? Number(row.structure_version) : 0
}

/**
 * One transactional retention pass. Expired operations go first; a revision is
 * then eligible only when it is not the newest for its page, is past the age or
 * per-page cap policy, and is referenced by no remaining operation. The final
 * assertion is what makes a dangling reference impossible rather than merely
 * unlikely: if it fails, the caller rolls the whole pass back.
 */
export function pruneRecoveryDataCore(
  db: Database,
  cutoffIso: string,
  maxPerPage: number
): PruneResult {
  const operationsDeleted = db.run('DELETE FROM operation_log WHERE created_at < ?', [
    cutoffIso
  ]).changes
  const revisionsDeleted = db.run(
    `DELETE FROM page_revisions
     WHERE id IN (
       SELECT ranked.id FROM (
         SELECT id, captured_at,
                ROW_NUMBER() OVER (PARTITION BY page_id ORDER BY captured_at DESC, id DESC) AS rn
         FROM page_revisions
       ) ranked
       WHERE ranked.rn > 1 AND (ranked.rn > ? OR ranked.captured_at < ?)
     )
     AND id NOT IN (SELECT before_revision_id FROM operation_log WHERE before_revision_id IS NOT NULL)
     AND id NOT IN (SELECT after_revision_id FROM operation_log WHERE after_revision_id IS NOT NULL)`,
    [maxPerPage, cutoffIso]
  ).changes

  const dangling = db
    .query(
      `SELECT COUNT(*) AS n FROM operation_log ol
       WHERE (ol.before_revision_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM page_revisions pr WHERE pr.id = ol.before_revision_id))
          OR (ol.after_revision_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM page_revisions pr WHERE pr.id = ol.after_revision_id))`
    )
    .get() as { n: number }
  if (Number(dangling.n) > 0) {
    throw new Error('Recovery prune would leave dangling revision references')
  }
  return { operationsDeleted, revisionsDeleted }
}

export function pruneRecoveryData(
  db: Database,
  cutoffIso: string,
  maxPerPage: number
): PruneResult {
  db.run('BEGIN IMMEDIATE')
  try {
    const result = pruneRecoveryDataCore(db, cutoffIso, maxPerPage)
    db.run('COMMIT')
    return result
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

export function createPage(
  db: Database,
  id: string,
  title: string,
  pageType: PageType,
  content: string,
  searchContent: string,
  hierarchy: { parentId: string | null; position: number } = { parentId: null, position: 0 }
): Page {
  const now = new Date().toISOString()
  db.run(
    'INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
    [id, title, content, pageType, hierarchy.parentId, hierarchy.position, now, now]
  )
  db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [
    id,
    title,
    searchContent
  ])
  return getPageOrThrow(db, id)
}

/** Next free position at the end of the given parent's living children. */
export function nextChildPosition(db: Database, parentId: string | null): number {
  const row = db
    .query(
      'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM pages WHERE parent_id IS ? AND deleted_at IS NULL'
    )
    .get(parentId) as { pos: number }
  return Number(row.pos)
}

export function getPage(db: Database, id: string): Page | null {
  const row = db
    .query(
      'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE id = ? AND deleted_at IS NULL'
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToPage(row)
}

export function getPageOrThrow(db: Database, id: string): Page {
  const page = getPage(db, id)
  if (!page) {
    throw new Error(`Page not found: ${id}`)
  }
  return page
}

/**
 * Applies a partial update, guarded by an optimistic lock.
 *
 * `fields.version` is the version the writer read. The write is one
 * compare-and-swap statement — `WHERE id = ? AND version = ?` — so a writer
 * whose read has been superseded matches no row, changes nothing, and is
 * reported through `PageVersionConflictError` (409 at the route). That check is
 * the ONLY gate: it lives in the single UPDATE rather than in a preceding read,
 * so it cannot be skipped by a caller and cannot race a competing write.
 *
 * A request that changes no field is a no-op: it returns the stored page
 * without writing or bumping the version, so there is nothing to conflict over.
 */
export function updatePageCore(
  db: Database,
  id: string,
  fields: {
    title?: string
    content?: string
    pageType?: PageType
    searchContent?: string
    /** The version this writer read. Required: there is no unguarded write. */
    version: number
  }
): Page | null {
  const existing = getPage(db, id)
  if (!existing) return null

  const sets: string[] = []
  const values: SQLQueryBindings[] = []

  if (fields.title !== undefined) {
    sets.push('title = ?')
    values.push(fields.title)
  }
  if (fields.content !== undefined) {
    sets.push('content = ?')
    values.push(fields.content)
  }
  if (fields.pageType !== undefined) {
    sets.push('page_type = ?')
    values.push(fields.pageType)
  }

  if (sets.length === 0) return existing

  sets.push('updated_at = ?')
  values.push(new Date().toISOString())
  sets.push('version = version + 1')
  values.push(id)
  values.push(fields.version)

  const result = db.run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ? AND version = ?`, values)
  if (result.changes === 0) {
    // The row is still there (checked above and nothing else writes on this
    // connection), so zero changes means the version moved on.
    throw new PageVersionConflictError(fields.version, getPageOrThrow(db, id).version)
  }

  const updated = getPageOrThrow(db, id)
  // The service layer resolves the searchable text for every write; falling
  // back to the stored content preserves the legacy rich-page behavior.
  const indexedContent = fields.searchContent ?? updated.content
  db.run(
    'INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?) ON CONFLICT(page_id) DO UPDATE SET title = ?, content = ?',
    [id, updated.title, indexedContent, updated.title, indexedContent]
  )

  return updated
}

/** Transactional wrapper for callers that do not already hold a write lock. */
export function updatePage(
  db: Database,
  id: string,
  fields: {
    title?: string
    content?: string
    pageType?: PageType
    searchContent?: string
    version: number
  }
): Page | null {
  db.run('BEGIN IMMEDIATE')
  try {
    const updated = updatePageCore(db, id, fields)
    db.run('COMMIT')
    return updated
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/**
 * Replaces only a page's search row, leaving the page itself untouched.
 *
 * A separate writer rather than `updatePage` on purpose. `updatePage` is the content
 * write path: it demands the optimistic-lock `version` and bumps it, and using it to
 * recompute search text would mean a reindex masquerades as a user edit — bumping
 * `version`, resetting anything version-driven, and racing a concurrent save.
 *
 * Re-indexing happens on a mutation that did not come from an editor at all (an
 * attachment was deleted), so it must not look like one. No transaction here either: it
 * is a single statement, and `updatePage` commits its own search row separately too.
 */
export function reindexPageSearch(db: Database, id: string, searchContent: string): void {
  db.run('UPDATE search_index SET content = ? WHERE page_id = ?', [searchContent, id])
  // A page that has never been indexed has no row to update. Re-insert rather than leave
  // its text unsearchable, taking the title from the page itself.
  db.run(
    `INSERT INTO search_index (page_id, title, content)
     SELECT id, title, ? FROM pages WHERE id = ? AND deleted_at IS NULL
     ON CONFLICT(page_id) DO UPDATE SET content = excluded.content`,
    [searchContent, id]
  )
}

export function duplicatePage(db: Database, id: string, searchContent?: string): Page | null {
  const source = getPage(db, id)
  if (!source) return null

  const newId = crypto.randomUUID()
  const now = new Date().toISOString()

  // Single transaction: the copy lands immediately after the source among the
  // same parent's living children; later siblings shift down contiguously.
  db.run('BEGIN IMMEDIATE')
  try {
    // Later siblings move, so their structure_version moves with them. The
    // copy itself is a new row and starts at the migration default of 0.
    db.run(
      'UPDATE pages SET position = position + 1, structure_version = structure_version + 1 WHERE parent_id IS ? AND deleted_at IS NULL AND position > ?',
      [source.parentId, source.position]
    )
    db.run(
      'INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        newId,
        `${source.title} - Copy`,
        source.content,
        source.pageType,
        source.parentId,
        source.position + 1,
        now,
        now,
        source.version
      ]
    )
    db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [
      newId,
      `${source.title} - Copy`,
      searchContent ?? source.content
    ])
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }

  return getPageOrThrow(db, newId)
}

/**
 * Soft-deletes a page and promotes its direct living children into the
 * deleted page's parent at the deleted page's former position, preserving
 * their relative order.
 *
 * Everything — the pre-delete revision, the page row, the search row, the
 * outgoing links, the child promotion and the operation row — is written by
 * the caller's single transaction. `searchContent` is supplied by the service
 * layer because it is the only place that knows how to extract searchable
 * text; computing it here would duplicate that rule.
 *
 * Returns the captured revision id, or null when the page does not exist.
 */
export function softDeletePageCore(
  db: Database,
  id: string,
  searchContent: string,
  actor: RecoveryActor
): string | null {
  const existing = getPage(db, id)
  if (!existing) return null

  const now = new Date().toISOString()
  const children = listChildRefs(db, id)
  const parentId = existing.parentId

  // Promotion changes every child's parent_id, so exactly one
  // structure_version increment applies to each. The recorded value is what
  // the child's counter will be AFTER this deletion's sibling reindex;
  // restore uses it to tell an untouched child from one the user has moved.
  const childrenSnapshot: ChildSnapshot[] = children.map((child) => ({
    id: child.id,
    parent_id: id,
    position: child.position,
    structure_version: getStructureVersion(db, child.id) + 1
  }))
  const linksSnapshot = listOutgoingLinkTargets(db, id)

  const revisionId = crypto.randomUUID()
  insertRevisionCore(db, {
    id: revisionId,
    pageId: id,
    version: existing.version,
    title: existing.title,
    content: existing.content,
    pageType: existing.pageType,
    parentId: existing.parentId,
    position: existing.position,
    searchContent,
    childrenSnapshot: JSON.stringify(childrenSnapshot),
    linksSnapshot: JSON.stringify(linksSnapshot),
    captureKind: 'before_soft_delete',
    actor,
    capturedAt: now,
    createdAt: existing.createdAt
  })

  // The deleted page is still living at this point, so exclude it explicitly
  // from its own parent's sibling list before inserting the promoted children.
  const grandparentSiblings = listChildRefs(db, parentId)
    .filter((sibling) => sibling.id !== id)
    .map((sibling) => sibling.id)
  const insertAt = Math.max(0, Math.min(existing.position, grandparentSiblings.length))
  const newOrder = [
    ...grandparentSiblings.slice(0, insertAt),
    ...children.map((child) => child.id),
    ...grandparentSiblings.slice(insertAt)
  ]
  writeSiblingOrder(db, parentId, newOrder)

  db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [now, id])
  db.run('DELETE FROM search_index WHERE page_id = ?', [id])
  db.run('DELETE FROM page_links WHERE source_id = ?', [id])

  return revisionId
}

/** Transactional wrapper for callers that do not already hold a write lock. */
export function softDeletePage(
  db: Database,
  id: string,
  searchContent: string,
  actor: RecoveryActor
): boolean {
  db.run('BEGIN IMMEDIATE')
  try {
    const revisionId = softDeletePageCore(db, id, searchContent, actor)
    db.run('COMMIT')
    return revisionId !== null
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/**
 * Lists all soft-deleted pages ordered by deleted_at descending.
 */
export function listTrashedPages(db: Database): { pages: Page[]; total: number } {
  const pages = db
    .query(
      'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    )
    .all()
    .map((r) => rowToPage(r as Record<string, unknown>))

  return { pages, total: pages.length }
}

export interface RestorePageOptions {
  /** Present for the revision-backed path; absent for the legacy fallback. */
  revision?: RevisionSnapshot
  /** Parsed snapshot arrays. The service validates them before opening this path. */
  children?: ChildSnapshot[]
  links?: string[]
  /**
   * Search text for the restored page, recomputed by the service from the
   * restored content under current attachment visibility. Used by BOTH paths:
   * a snapshot's stored `search_content` is immutable history and may include
   * text from an attachment that has since been trashed, so replaying it would
   * make that text findable again. Optional only for legacy callers that have
   * no recomputed value, which fall back to the snapshot text.
   */
  searchContent?: string
  actor: RecoveryActor
}

/**
 * Restores a soft-deleted page. Two distinct paths:
 *
 * A. With a revision, the page row, search row, links, original position and
 *    eligible children are all recovered. Children come back only when they
 *    are still living, still under the grandparent they were promoted to, and
 *    their structure_version still matches the post-promotion value recorded
 *    at deletion time.
 * B. Without a revision (pre-015 trash), only the row and a best-effort search
 *    row are recovered. Nothing is fabricated: no children, links or original
 *    position are invented from data that was never captured.
 *
 * The caller owns the transaction; all reads here happen after its write lock.
 */
export function restorePageCore(
  db: Database,
  id: string,
  options: RestorePageOptions
): Page | null {
  const existing = db
    .query(
      'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE id = ?'
    )
    .get(id) as Record<string, unknown> | undefined

  if (!existing || existing.deleted_at === null) return null

  const now = new Date().toISOString()
  const revision = options.revision ?? null

  if (revision !== null) {
    // --- Path A: revision-backed -------------------------------------------
    let targetParentId = revision.parentId
    if (targetParentId !== null) {
      const parentRow = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(targetParentId) as
        | { deleted_at: string | null }
        | undefined
      if (!parentRow || parentRow.deleted_at !== null) {
        targetParentId = null
      }
    }

    // The grandparent is the ORIGINAL parent, even if it has since been
    // deleted: that is where the deletion promoted the children to.
    const promotedParentId = revision.parentId

    // Eligibility MUST be decided before any structural write. Re-inserting
    // the restored page shifts the promoted children's positions, which would
    // bump their structure_version and make them look as though the user had
    // moved them. Reading first keeps the check about the user's actions, not
    // about the order this function happens to perform its writes in.
    const eligible = (options.children ?? []).filter((child) => {
      const row = db
        .query('SELECT parent_id, structure_version, deleted_at FROM pages WHERE id = ?')
        .get(child.id) as
        | { parent_id: string | null; structure_version: number; deleted_at: string | null }
        | undefined
      if (!row || row.deleted_at !== null) return false
      if ((row.parent_id ?? null) !== promotedParentId) return false
      return Number(row.structure_version) === child.structure_version
    })
    const eligibleIds = new Set(eligible.map((child) => child.id))
    const promotedSiblings = listChildRefs(db, promotedParentId)
      .map((sibling) => sibling.id)
      .filter((siblingId) => !eligibleIds.has(siblingId))

    // When the page returns to the same level its children were promoted to,
    // removing the children and making room for the page is ONE ordered
    // rewrite, so a surviving sibling is not bumped twice by one restore.
    if (targetParentId === promotedParentId) {
      const insertAt = Math.max(0, Math.min(revision.position, promotedSiblings.length))
      const pageOrder = [
        ...promotedSiblings.slice(0, insertAt),
        id,
        ...promotedSiblings.slice(insertAt)
      ]
      writeSiblingOrder(db, targetParentId, pageOrder, {
        id,
        createdAt: revision.createdAt,
        updatedAt: now
      })
    } else {
      // Different levels: compact the promoted parent's list first, then make
      // room at the page's target level (root, when the grandparent is gone).
      writeSiblingOrder(db, promotedParentId, promotedSiblings)
      const siblings = listChildRefs(db, targetParentId).map((sibling) => sibling.id)
      const insertAt = Math.max(0, Math.min(revision.position, siblings.length))
      const pageOrder = [...siblings.slice(0, insertAt), id, ...siblings.slice(insertAt)]
      writeSiblingOrder(db, targetParentId, pageOrder, {
        id,
        createdAt: revision.createdAt,
        updatedAt: now
      })
    }

    db.run(
      `INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET title = excluded.title, content = excluded.content`,
      // Prefer the service's recomputed text; fall back to the snapshot only for
      // callers that did not supply one. The revision row is never mutated.
      [id, revision.title, options.searchContent ?? revision.searchContent ?? '']
    )
    replaceOutgoingLinksCore(db, id, options.links ?? [])

    // Insert eligible children under the restored page in recorded order.
    const restoredChildren = listChildRefs(db, id).map((sibling) => sibling.id)
    const childOrder = [...restoredChildren]
    for (const child of [...eligible].sort((a, b) => a.position - b.position)) {
      const childAt = Math.max(0, Math.min(child.position, childOrder.length))
      childOrder.splice(childAt, 0, child.id)
    }
    writeSiblingOrder(db, id, childOrder)
  } else {
    // --- Path B: legacy fallback -------------------------------------------
    let targetParentId = existing.parent_id as string | null
    if (targetParentId !== null) {
      const parentRow = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(targetParentId) as
        | { deleted_at: string | null }
        | undefined
      if (!parentRow || parentRow.deleted_at !== null) {
        targetParentId = null
      }
    }
    const siblings = listChildRefs(db, targetParentId).map((sibling) => sibling.id)
    writeSiblingOrder(db, targetParentId, [...siblings, id], {
      id,
      createdAt: String(existing.created_at),
      updatedAt: now
    })
    const title = String(existing.title ?? '')
    const searchContent = options.searchContent ?? String(existing.content ?? '')
    db.run(
      `INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET title = excluded.title, content = excluded.content`,
      [id, title, searchContent]
    )
  }

  return getPage(db, id)
}

/** Transactional wrapper for callers that do not already hold a write lock. */
export function restorePage(db: Database, id: string, options: RestorePageOptions): Page | null {
  db.run('BEGIN IMMEDIATE')
  try {
    const page = restorePageCore(db, id, options)
    db.run('COMMIT')
    return page
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/**
 * Undoes a LIVING page's last change by restoring a prior revision. This is a
 * distinct path from `restorePageCore`: the page never left the tree, so there
 * is no `deleted_at` to clear and no promoted children to re-parent — nothing
 * is fabricated. The page row's content fields, original parent, position and
 * created_at all come from the revision; search text is re-indexed, outgoing
 * links are replaced, and `version` is bumped so concurrent writers get a 409.
 *
 * The caller owns the transaction; every read here happens after its write
 * lock. Returns null when the page is missing or is not living.
 */
export function restoreLivingPageCore(
  db: Database,
  id: string,
  options: {
    revision: RevisionSnapshot
    links: string[]
    searchContent: string
  }
): Page | null {
  const existing = db.query('SELECT parent_id, deleted_at FROM pages WHERE id = ?').get(id) as
    | { parent_id: string | null; deleted_at: string | null }
    | undefined

  if (!existing || existing.deleted_at !== null) return null

  const revision = options.revision
  const now = new Date().toISOString()

  // Resolve the target parent exactly as the trashed-page restore does: the
  // revision's original parent, but only while that parent is still living;
  // otherwise the page returns to the root level.
  let targetParentId = revision.parentId
  if (targetParentId !== null) {
    const parentRow = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(targetParentId) as
      | { deleted_at: string | null }
      | undefined
    if (!parentRow || parentRow.deleted_at !== null) {
      targetParentId = null
    }
  }

  const originParentId = existing.parent_id ?? null

  // Make room at the target level. The page is already living, so exclude it
  // from the target siblings before inserting it at the recorded position.
  const targetSiblings = listChildRefs(db, targetParentId)
    .filter((sibling) => sibling.id !== id)
    .map((sibling) => sibling.id)
  const insertAt = Math.max(0, Math.min(revision.position, targetSiblings.length))
  const pageOrder = [...targetSiblings.slice(0, insertAt), id, ...targetSiblings.slice(insertAt)]
  writeSiblingOrder(db, targetParentId, pageOrder)

  // A parent change leaves a hole in the origin sibling list; compact it.
  if (originParentId !== targetParentId) {
    const originSiblings = listChildRefs(db, originParentId)
      .filter((sibling) => sibling.id !== id)
      .map((sibling) => sibling.id)
    writeSiblingOrder(db, originParentId, originSiblings)
  }

  // Restore the page row from the revision. `writeSiblingOrder` above already
  // placed the page and bumped structure_version for the move; this statement
  // restores the content fields, the original created_at, a fresh updated_at
  // and bumps version. deleted_at is deliberately untouched — the page never
  // left the tree — and children are never re-parented or invented.
  db.run(
    `UPDATE pages SET title = ?, content = ?, page_type = ?, created_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [revision.title, revision.content, revision.pageType, revision.createdAt, now, id]
  )

  db.run(
    `INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)
     ON CONFLICT(page_id) DO UPDATE SET title = excluded.title, content = excluded.content`,
    [id, revision.title, options.searchContent]
  )
  replaceOutgoingLinksCore(db, id, options.links)

  return getPage(db, id)
}

/**
 * Permanently deletes a soft-deleted page. Revision history and every
 * historical operation for the page are purged first, then one metadata-only
 * event is recorded, then the page and its search row go. No revision id is
 * referenced by that event, so nothing can resurrect the page afterwards.
 */
export function permanentlyDeletePageCore(db: Database, id: string, actor: RecoveryActor): boolean {
  const existing = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(id) as
    | { deleted_at: string | null }
    | undefined

  if (!existing || existing.deleted_at === null) return false

  db.run('DELETE FROM page_revisions WHERE page_id = ?', [id])
  db.run('DELETE FROM operation_log WHERE target_page_id = ?', [id])
  insertOperationCore(db, {
    id: crypto.randomUUID(),
    operationKind: 'page.permanent_delete',
    targetPageId: id,
    targetAttachmentId: null,
    beforeRevisionId: null,
    afterRevisionId: null,
    actor,
    status: 'committed',
    createdAt: new Date().toISOString()
  })
  db.run('DELETE FROM search_index WHERE page_id = ?', [id])
  db.run('DELETE FROM pages WHERE id = ?', [id])
  return true
}

/** Transactional wrapper for callers that do not already hold a write lock. */
export function permanentlyDeletePage(db: Database, id: string, actor: RecoveryActor): boolean {
  db.run('BEGIN IMMEDIATE')
  try {
    const deleted = permanentlyDeletePageCore(db, id, actor)
    db.run('COMMIT')
    return deleted
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  const { search, limit = 50, offset = 0 } = options

  if (search && search.trim().length > 0) {
    const term = search.trim()
    // The `rowid` in this ORDER BY is a tie-break on `updated_at`, and it is not
    // stable across a backup: SQLite documents that a VACUUM "may change the
    // ROWIDs of entries in any tables that do not have an explicit INTEGER
    // PRIMARY KEY", and `pages` is `id TEXT PRIMARY KEY`. `VACUUM INTO` works
    // the same way, so a page restored from a backup can come back in a
    // different order among pages whose `updated_at` is identical to the
    // millisecond. No content is affected, and a tie needs a shared timestamp to
    // happen at all -- but if you are reading this to change the ordering, the
    // tie-break is not the stable thing to build on. See docs/BACKUP_PLAN.md 3.3.
    const pages = db
      .query(
        `SELECT p.id, p.title, p.content, p.page_type, p.parent_id, p.position, p.created_at, p.updated_at, p.deleted_at, p.version
         FROM pages p INNER JOIN search_index si ON si.page_id = p.id
         WHERE p.deleted_at IS NULL AND (si.title LIKE ? OR si.content LIKE ?)
         ORDER BY p.updated_at DESC, p.rowid DESC LIMIT ? OFFSET ?`
      )
      .all(`%${term}%`, `%${term}%`, limit, offset)
      .map((r) => rowToPage(r as Record<string, unknown>))

    const countRow = db
      .query(
        `SELECT COUNT(*) as count FROM pages p INNER JOIN search_index si ON si.page_id = p.id
         WHERE p.deleted_at IS NULL AND (si.title LIKE ? OR si.content LIKE ?)`
      )
      .get(`%${term}%`, `%${term}%`) as { count: number }

    return { pages, total: countRow.count }
  }

  // Same tie-break caveat as the search query above: `rowid` breaks ties on
  // `updated_at` and is not preserved by `VACUUM INTO`, so the order of pages
  // sharing a timestamp can differ between the live database and one restored
  // from a backup. Content is unaffected. See docs/BACKUP_PLAN.md 3.3.
  const pages = db
    .query(
      'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE deleted_at IS NULL ORDER BY updated_at DESC, rowid DESC LIMIT ? OFFSET ?'
    )
    .all(limit, offset)
    .map((r) => rowToPage(r as Record<string, unknown>))

  const countRow = db
    .query('SELECT COUNT(*) as count FROM pages WHERE deleted_at IS NULL')
    .get() as { count: number }

  return { pages, total: countRow.count }
}

function rowToPage(row: Record<string, unknown>): Page {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    pageType: row.page_type as string as PageType,
    parentId: (row.parent_id as string) || null,
    position: Number(row.position ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) || null,
    version: row.version as number
  }
}

/* -------------------------------------------------------------------------
 * Hierarchy primitives
 * All structural mutations run on the ambient connection inside a
 * BEGIN IMMEDIATE…COMMIT/ROLLBACK transaction opened by the caller.
 * ------------------------------------------------------------------------- */

/** Living parent id of a page, or null for roots. Missing/deleted → undefined. */
export function getParentId(db: Database, pageId: string): string | null | undefined {
  const row = db
    .query('SELECT parent_id FROM pages WHERE id = ? AND deleted_at IS NULL')
    .get(pageId) as { parent_id: string | null } | undefined
  if (!row) return undefined
  return row.parent_id || null
}

/**
 * Living children of a parent (null = roots), ordered by position then rowid.
 *
 * `rowid` is the tie-break when two siblings share a `position`, and it is not
 * preserved by `VACUUM INTO` -- SQLite documents that a VACUUM "may change the
 * ROWIDs of entries in any tables that do not have an explicit INTEGER PRIMARY
 * KEY", and `pages` is `id TEXT PRIMARY KEY`. So a restore can swap two tied
 * siblings in the tree.
 *
 * This is bounded, and deliberately not fixed here. `(parent_id, position)` is
 * not `UNIQUE` in the schema, so a tie is possible in principle, but every
 * writer of `position` sits inside a `BEGIN IMMEDIATE` transaction and a
 * duplicate-position query over the working databases returns zero rows. The
 * `UNIQUE` index that would make the tie-break unreachable by construction needs
 * its own migration and a cleanup pass over real user data, which is separate
 * work. The residual risk is a future unprotected writer, not the code here.
 * See docs/BACKUP_PLAN.md 3.3.
 */
export function listChildRefs(db: Database, parentId: string | null): SiblingRef[] {
  const rows =
    parentId === null
      ? (db
          .query(
            'SELECT id, position FROM pages WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY position, rowid'
          )
          .all() as SiblingRef[])
      : (db
          .query(
            'SELECT id, position FROM pages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, rowid'
          )
          .all(parentId) as SiblingRef[])
  return rows.map((r) => ({ id: r.id, position: Number(r.position) }))
}

/**
 * Rewrites sibling positions to a contiguous 0..n-1 order. A row whose
 * position actually changes also increments structure_version: a same-parent
 * reorder is a movement for recovery purposes. `skipId` is for a page whose
 * structure_version was already bumped for a parent change in the same
 * transaction — it is still placed, but not bumped twice.
 */
function reindexSiblings(db: Database, siblings: SiblingRef[], skipId?: string): void {
  siblings.forEach((sibling, index) => {
    if (sibling.id === skipId) {
      db.run('UPDATE pages SET position = ? WHERE id = ?', [index, sibling.id])
      return
    }
    const row = db.query('SELECT position FROM pages WHERE id = ?').get(sibling.id) as
      | { position: number }
      | undefined
    if (!row || Number(row.position) === index) return
    db.run(
      'UPDATE pages SET position = ?, structure_version = structure_version + 1 WHERE id = ?',
      [index, sibling.id]
    )
  })
}

interface RestoreOverride {
  id: string
  createdAt: string
  updatedAt: string
}

/**
 * Writes an exact sibling order at `parentId`, making room and compacting in
 * one pass. Every row whose parent_id or position changes gets one
 * structure_version increment. `restore` supplies the extra columns for the
 * page re-entering the tree; its created_at is the ORIGINAL timestamp from the
 * snapshot, never the restore time.
 */
function writeSiblingOrder(
  db: Database,
  parentId: string | null,
  orderedIds: string[],
  restore?: RestoreOverride
): void {
  orderedIds.forEach((id, index) => {
    const row = db.query('SELECT parent_id, position FROM pages WHERE id = ?').get(id) as
      | { parent_id: string | null; position: number }
      | undefined
    if (!row) return
    const isRestored = restore?.id === id
    const parentChanged = (row.parent_id ?? null) !== parentId
    const positionChanged = Number(row.position) !== index
    if (!isRestored && !parentChanged && !positionChanged) return

    const sets: string[] = ['parent_id = ?', 'position = ?']
    const values: SQLQueryBindings[] = [parentId, index]
    if (parentChanged || positionChanged) {
      sets.push('structure_version = structure_version + 1')
    }
    if (isRestored && restore) {
      sets.push('deleted_at = NULL', 'created_at = ?', 'updated_at = ?', 'version = version + 1')
      values.push(restore.createdAt, restore.updatedAt)
    }
    values.push(id)
    db.run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`, values)
  })
}

/**
 * Transactionally moves a living page to `newParentId` at `newPosition`
 * (final zero-based index after removing the page from its origin siblings;
 * clamped to the destination end when oversized).
 *
 * Rejects self-moves and moves into own descendants; the visited-ID walk also
 * trips safely on manually corrupted cycles. Rolls back completely on any
 * failure.
 */
export function movePage(
  db: Database,
  pageId: string,
  newParentId: string | null,
  newPosition: number
): MovePageResult {
  db.run('BEGIN IMMEDIATE')
  try {
    const page = getPage(db, pageId)
    if (!page) {
      throw new HierarchyError('Page not found', 404)
    }

    let parentExists = true
    if (newParentId !== null) {
      parentExists = getPage(db, newParentId) !== null
      if (!parentExists) {
        throw new HierarchyError('Parent page not found', 404)
      }
    }

    if (newParentId === pageId) {
      throw new HierarchyError('Cannot move a page into itself', 400)
    }

    if (newParentId !== null) {
      // Iterative ancestor walk with visited-ID protection against corrupted
      // cycles and a hard ceiling as an integrity tripwire.
      const visited = new Set<string>([pageId])
      let cursor: string | null = newParentId
      let steps = 0
      while (cursor !== null) {
        if (visited.has(cursor)) {
          throw new HierarchyError('Cannot move a page into itself or its descendants', 400)
        }
        visited.add(cursor)
        const next = getParentId(db, cursor)
        if (next === undefined) {
          throw new HierarchyError('Parent page not found', 404)
        }
        cursor = next
        steps += 1
        if (steps > 10_000) {
          throw new HierarchyError('Hierarchy integrity failure', 500)
        }
      }
    }

    const originParentId = getParentId(db, pageId) ?? null
    const originSiblings = listChildRefs(db, originParentId)
    const withoutPage = originSiblings.filter((s) => s.id !== pageId)

    const sameParent = originParentId === newParentId
    const destinationSiblings = sameParent ? withoutPage : listChildRefs(db, newParentId)

    const clamped = Math.max(0, Math.min(newPosition, destinationSiblings.length))
    destinationSiblings.splice(clamped, 0, { id: pageId, position: clamped })

    if (!sameParent) {
      // The parent change is one structural mutation; the subsequent position
      // write for the same page must not bump the counter a second time.
      db.run(
        'UPDATE pages SET parent_id = ?, updated_at = ?, version = version + 1, structure_version = structure_version + 1 WHERE id = ?',
        [newParentId, new Date().toISOString(), pageId]
      )
      reindexSiblings(db, withoutPage)
      reindexSiblings(db, destinationSiblings, pageId)
    } else {
      // Same-parent reorder: the moved page's position change is detected by
      // reindexSiblings and bumps its structure_version there.
      reindexSiblings(db, destinationSiblings)
    }

    const movedPage = getPageOrThrow(db, pageId)
    const finalOriginSiblings = sameParent ? destinationSiblings : listChildRefs(db, originParentId)

    db.run('COMMIT')
    return {
      page: movedPage,
      originParentId,
      originSiblings: sameParent ? destinationSiblings : finalOriginSiblings,
      destinationParentId: newParentId,
      destinationSiblings
    }
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

// ---------- Internal page links (backlink index) ----------

export interface PageLinkRef {
  sourceId: string
  sourceTitle: string
  snippet: string | null
}

/**
 * Replaces a page's outgoing internal-link set atomically. Called on every
 * successful Rich Note content save; targets may reference deleted pages
 * (broken links), so no existence check and no FK constraint apply.
 */
export function replaceOutgoingLinksCore(
  db: Database,
  sourceId: string,
  targetIds: string[]
): void {
  db.run('DELETE FROM page_links WHERE source_id = ?', [sourceId])
  for (const targetId of targetIds) {
    db.run('INSERT OR IGNORE INTO page_links (source_id, target_id) VALUES (?, ?)', [
      sourceId,
      targetId
    ])
  }
}

/** Transactional wrapper for callers that do not already hold a write lock. */
export function replaceOutgoingLinks(db: Database, sourceId: string, targetIds: string[]): void {
  db.run('BEGIN IMMEDIATE')
  try {
    replaceOutgoingLinksCore(db, sourceId, targetIds)
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/** Removes a page's outgoing links. Incoming links are kept (broken links). */
export function deleteOutgoingLinks(db: Database, id: string): void {
  db.run('DELETE FROM page_links WHERE source_id = ?', [id])
}

/** Copies outgoing links to a duplicated page (duplicate fidelity). */
export function copyOutgoingLinks(db: Database, sourceId: string, newId: string): void {
  db.run(
    'INSERT OR IGNORE INTO page_links (source_id, target_id) SELECT ?, target_id FROM page_links WHERE source_id = ?',
    [newId, sourceId]
  )
}

/**
 * Lists living pages that link to `targetId`, newest-modified first, with an
 * optional readable snippet around the link occurrence.
 */
export function listBacklinks(
  db: Database,
  targetId: string
): Array<{ id: string; title: string; updatedAt: string }> {
  return db
    .query(
      `SELECT p.id, p.title, p.updated_at FROM page_links pl
       INNER JOIN pages p ON p.id = pl.source_id
       WHERE pl.target_id = ? AND p.deleted_at IS NULL
       ORDER BY p.updated_at DESC`
    )
    .all(targetId) as Array<{ id: string; title: string; updatedAt: string }>
}

/**
 * Living pages that this page links to (outgoing relationships from the
 * maintained page_links index). Mirrors listBacklinks but reads the source side.
 */
export function listOutgoingLinks(
  db: Database,
  sourceId: string
): Array<{ id: string; title: string; updatedAt: string }> {
  return db
    .query(
      `SELECT p.id, p.title, p.updated_at FROM page_links pl
       INNER JOIN pages p ON p.id = pl.target_id
       WHERE pl.source_id = ? AND p.deleted_at IS NULL
       ORDER BY p.updated_at DESC`
    )
    .all(sourceId) as Array<{ id: string; title: string; updatedAt: string }>
}
