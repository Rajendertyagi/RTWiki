import type { Database } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'

export function createPage(
  db: Database,
  id: string,
  title: string,
  pageType: PageType,
  content: string
): Page {
  const now = new Date().toISOString()
  db.run(
    'INSERT INTO pages (id, title, content, page_type, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id, title, content, pageType, now, now]
  )
  db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [id, title, content])
  return getPageOrThrow(db, id)
}

export function getPage(db: Database, id: string): Page | null {
  const row = db
    .query('SELECT id, title, content, page_type, created_at, updated_at, deleted_at, version FROM pages WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToPage(row)
}

export function getPageOrThrow(db: Database, id: string): Page {
  const page = getPage(db, id)
  if (!page) throw new Error(`Page not found: ${id}`)
  return page
}

export function updatePage(
  db: Database,
  id: string,
  fields: { title?: string; content?: string; pageType?: PageType }
): Page | null {
  const existing = getPage(db, id)
  if (!existing) return null

  const sets: string[] = []
  const values: unknown[] = []

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
  db.run(
    'INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?) ON CONFLICT(page_id) DO UPDATE SET title = ?, content = ?',
    [id, updated.title, updated.content, updated.title, updated.content]
  )

  return updated
}

export function duplicatePage(db: Database, id: string): Page | null {
  const source = getPage(db, id)
  if (!source) return null

  const newId = crypto.randomUUID()
  const now = new Date().toISOString()

  db.run(
    'INSERT INTO pages (id, title, content, page_type, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [newId, `${source.title} - Copy`, source.content, source.pageType, now, now, source.version]
  )
  db.run('INSERT INTO search_index (page_id, title, content) VALUES (?, ?, ?)', [
    newId,
    `${source.title} - Copy`,
    source.content
  ])

  return getPageOrThrow(db, newId)
}

export function softDeletePage(db: Database, id: string): boolean {
  const existing = getPage(db, id)
  if (!existing) return false

  const now = new Date().toISOString()
  db.run('UPDATE pages SET deleted_at = ? WHERE id = ?', [now, id])
  db.run('DELETE FROM search_index WHERE page_id = ?', [id])
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
        `SELECT p.id, p.title, p.content, p.page_type, p.created_at, p.updated_at, p.deleted_at, p.version
         FROM pages p INNER JOIN search_index si ON si.page_id = p.id
         WHERE p.deleted_at IS NULL AND (si.title LIKE ? OR si.content LIKE ?)
         ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`
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
      'SELECT id, title, content, page_type, created_at, updated_at, deleted_at, version FROM pages WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    )
    .all(limit, offset)
    .map((r) => rowToPage(r as Record<string, unknown>))

  const countRow = db.query('SELECT COUNT(*) as count FROM pages WHERE deleted_at IS NULL').get() as {
    count: number
  }

  return { pages, total: countRow.count }
}

function rowToPage(row: Record<string, unknown>): Page {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    pageType: (row.page_type as string) as PageType,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) || null,
    version: row.version as number
  }
}