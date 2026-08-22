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
    readonly status: number
  ) {
    super(message)
    this.name = 'HierarchyError'
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

export function updatePage(
  db: Database,
  id: string,
  fields: { title?: string; content?: string; pageType?: PageType; searchContent?: string }
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

  db.run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`, values)

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

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  const { search, limit = 50, offset = 0 } = options

  if (search && search.trim().length > 0) {
    const term = search.trim()
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

/** Living children of a parent (null = roots), ordered by position then rowid. */
export function listChildRefs(db: Database, parentId: string | null): SiblingRef[] {
  const rows =
    parentId === null
      ? db
          .query(
            'SELECT id, position FROM pages WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY position, rowid'
          )
          .all() as SiblingRef[]
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
    const destinationSiblings = sameParent
      ? withoutPage
      : listChildRefs(db, newParentId)

    const clamped = Math.max(0, Math.min(newPosition, destinationSiblings.length))
    destinationSiblings.splice(clamped, 0, { id: pageId, position: clamped })

    if (!sameParent) {
      db.run(
        'UPDATE pages SET parent_id = ?, updated_at = ?, version = version + 1 WHERE id = ?',
        [newParentId, new Date().toISOString(), pageId]
      )
      reindexSiblings(db, withoutPage)
    }
    reindexSiblings(db, destinationSiblings)

    const movedPage = getPageOrThrow(db, pageId)
    const finalOriginSiblings = sameParent
      ? destinationSiblings
      : listChildRefs(db, originParentId)

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
