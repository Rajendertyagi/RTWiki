import type { Database, SQLQueryBindings } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'

export interface SiblingRef {
  id: string
  position: number
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
export function updatePage(
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
    db.run(
      'UPDATE pages SET position = position + 1 WHERE parent_id IS ? AND deleted_at IS NULL AND position > ?',
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
 * their relative order. One transaction; only the deleted page's FTS entry
 * is removed.
 */
export function softDeletePage(db: Database, id: string): boolean {
  const existing = getPage(db, id)
  if (!existing) return false

  const now = new Date().toISOString()
  db.run('BEGIN IMMEDIATE')
  try {
    const children = listChildRefs(db, id)
    const parentId = existing.parentId

    if (children.length > 0 && parentId !== null) {
      // Make room at the deleted page's former position for its children.
      db.run(
        'UPDATE pages SET position = position + ? WHERE parent_id = ? AND deleted_at IS NULL AND position > ?',
        [children.length, parentId, existing.position]
      )
    }

    db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [now, id])
    db.run('DELETE FROM search_index WHERE page_id = ?', [id])

    children.forEach((child, index) => {
      db.run('UPDATE pages SET parent_id = ?, position = ? WHERE id = ?', [
        parentId,
        parentId !== null ? existing.position + index : index,
        child.id
      ])
    })

    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  return true
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

/**
 * Restores a soft-deleted page by resetting deleted_at to NULL and re-indexing into FTS.
 * If the original parent is soft-deleted or missing, the page is restored at root level (parent_id = null).
 */
export function restorePage(db: Database, id: string): Page | null {
  const existing = db
    .query(
      'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE id = ?'
    )
    .get(id) as Record<string, unknown> | null

  if (!existing || existing.deleted_at === null) return null

  db.run('BEGIN IMMEDIATE')
  try {
    let targetParentId = existing.parent_id as string | null
    if (targetParentId !== null) {
      const parentRow = db
        .query('SELECT deleted_at FROM pages WHERE id = ?')
        .get(targetParentId) as { deleted_at: string | null } | null

      if (!parentRow || parentRow.deleted_at !== null) {
        targetParentId = null
      }
    }

    // Determine position at target parent level
    const maxPosRow = db
      .query(
        'SELECT MAX(position) as max_pos FROM pages WHERE parent_id IS ? AND deleted_at IS NULL'
      )
      .get(targetParentId) as { max_pos: number | null }
    const nextPos = (maxPosRow.max_pos ?? -1) + 1

    db.run(
      'UPDATE pages SET deleted_at = NULL, parent_id = ?, position = ?, updated_at = ? WHERE id = ?',
      [targetParentId, nextPos, new Date().toISOString(), id]
    )

    // Re-add to FTS search index
    db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [
      id,
      String(existing.title ?? ''),
      String(existing.content ?? '')
    ])

    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }

  return getPage(db, id)
}

/**
 * Permanently deletes a soft-deleted page from the database.
 */
export function permanentlyDeletePage(db: Database, id: string): boolean {
  const existing = db.query('SELECT deleted_at FROM pages WHERE id = ?').get(id) as {
    deleted_at: string | null
  } | null

  if (!existing || existing.deleted_at === null) return false

  db.run('BEGIN IMMEDIATE')
  try {
    db.run('DELETE FROM search_index WHERE page_id = ?', [id])
    db.run('DELETE FROM pages WHERE id = ?', [id])
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
  return true
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

function reindexSiblings(db: Database, siblings: SiblingRef[]): void {
  siblings.forEach((sibling, index) => {
    db.run('UPDATE pages SET position = ? WHERE id = ?', [index, sibling.id])
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
      db.run('UPDATE pages SET parent_id = ?, updated_at = ?, version = version + 1 WHERE id = ?', [
        newParentId,
        new Date().toISOString(),
        pageId
      ])
      reindexSiblings(db, withoutPage)
    }
    reindexSiblings(db, destinationSiblings)

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
export function replaceOutgoingLinks(db: Database, sourceId: string, targetIds: string[]): void {
  db.run('BEGIN IMMEDIATE')
  try {
    db.run('DELETE FROM page_links WHERE source_id = ?', [sourceId])
    for (const targetId of targetIds) {
      db.run('INSERT OR IGNORE INTO page_links (source_id, target_id) VALUES (?, ?)', [
        sourceId,
        targetId
      ])
    }
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
