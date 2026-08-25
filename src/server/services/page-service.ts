import type { Database } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import {
  createEmptyHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import { extractPageLinks, findLinkContext } from '@rtwiki/shared/schemas/page-links'
import type { CreatePageInput, UpdatePageInput } from '@rtwiki/shared/schemas/pages'
import {
  createStarterVisualContent,
  parseVisualPageContent,
  VISUAL_PAGE_TYPES,
  type VisualPageType
} from '@rtwiki/shared/schemas/visual-page-content'
import * as repo from '../repositories/page-repository.js'
import { HierarchyError } from '../repositories/page-repository.js'
import { extractSearchableContent } from './search-extraction.js'

/**
 * Raised when submitted content violates the canonical format for its page
 * type. Routes translate this into the existing structured 400 response;
 * it must never surface as a 500.
 */
export class PageValidationError extends Error {}

// Hierarchy violations originate in the repository transaction; re-exported
// here so routes map `status` onto HTTP without importing the repository.
export { HierarchyError } from '../repositories/page-repository.js'

/**
 * Resolves the stored content string for a newly created HTML page.
 *
 * Lenient creation (owner decision, Phase 4A): an omitted or empty content
 * string becomes the canonical empty document so the UI can create HTML
 * pages seamlessly. Any other value must already be canonical JSON — it is
 * validated but stored verbatim, never re-serialized or "fixed".
 *
 * Rich pages are unchanged: every string remains accepted.
 *
 * Dedicated Diagram / Mind Map pages: empty content becomes the starter
 * document; any other value must be canonical visual-page JSON.
 */
function resolveCreatedContent(pageType: PageType, content: string): string {
  if (pageType === 'html') {
    if (content === '') {
      return serializeHtmlContent(createEmptyHtmlContent())
    }
    const parsed = parseHtmlContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return content
  }
  if (pageType === 'diagram' || pageType === 'mindmap') {
    if (content === '') {
      return createStarterVisualContent(pageType)
    }
    const parsed = parseVisualPageContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return content
  }
  return content
}

/** True when the page type owns a dedicated Mermaid workspace. */
export function isVisualPageType(pageType: PageType): pageType is VisualPageType {
  return (VISUAL_PAGE_TYPES as readonly string[]).includes(pageType)
}

export function createPage(db: Database, input: CreatePageInput): Page {
  const id = crypto.randomUUID()
  const content = resolveCreatedContent(input.pageType, input.content)
  const searchContent = extractSearchableContent(input.pageType, content)

  // Parent validation and position allocation share one write transaction so
  // concurrent creates serialize into distinct sibling positions.
  db.run('BEGIN IMMEDIATE')
  try {
    if (input.parentId != null) {
      const parent = repo.getPage(db, input.parentId)
      if (!parent) {
        throw new HierarchyError('Parent page not found', 404)
      }
    }
    const position = repo.nextChildPosition(db, input.parentId ?? null)
    const page = repo.createPage(db, id, input.title, input.pageType, content, searchContent, {
      parentId: input.parentId ?? null,
      position
    })
    db.run('COMMIT')
    // Maintain the internal-link index for the new page (rich pages only).
    if (input.pageType === 'rich') {
      repo.replaceOutgoingLinks(db, id, extractPageLinks(content))
    }
    return page
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/**
 * Transactional hierarchy move. All validation reads happen after the write
 * lock is acquired (BEGIN IMMEDIATE), so concurrent moves serialize and the
 * ancestor walk can never race a competing structural change.
 */
export function movePage(
  db: Database,
  pageId: string,
  newParentId: string | null,
  newPosition: number
): import('../repositories/page-repository.js').MovePageResult {
  return repo.movePage(db, pageId, newParentId, newPosition)
}

export function getPage(db: Database, id: string): Page | null {
  return repo.getPage(db, id)
}

export function getPageOrThrow(db: Database, id: string): Page {
  return repo.getPageOrThrow(db, id)
}

/**
 * Updates title and/or content. Validation is strict on update: HTML-page
 * content must be canonical JSON exactly as submitted. Type conversion is
 * impossible here by construction — `UpdatePageInput` no longer carries a
 * page type (Phase 4A owner decision).
 *
 * Stored legacy/malformed content is never touched by this path: validation
 * applies to writes only, so reads keep returning stored bytes verbatim.
 */
export function updatePage(db: Database, id: string, input: UpdatePageInput): Page | null {
  const existing = repo.getPage(db, id)
  if (!existing) return null

  // Search text is recomputed on every write so the index always reflects
  // the current stored content for the page's (immutable) type.
  let searchContent: string | undefined
  if (input.content !== undefined) {
    if (existing.pageType === 'html') {
      const parsed = parseHtmlContent(input.content)
      if (!parsed.ok) {
        throw new PageValidationError(parsed.error)
      }
    }
    if (isVisualPageType(existing.pageType)) {
      const parsed = parseVisualPageContent(input.content)
      if (!parsed.ok) {
        throw new PageValidationError(parsed.error)
      }
    }
    searchContent = extractSearchableContent(existing.pageType, input.content)
  } else {
    searchContent = extractSearchableContent(existing.pageType, existing.content)
  }

  const updated = repo.updatePage(db, id, { ...input, searchContent })
  // Maintain the internal-link index on every content write. Non-rich page
  // types cannot carry wiki links, so their outgoing set is cleared.
  if (updated !== null && input.content !== undefined) {
    if (existing.pageType === 'rich') {
      repo.replaceOutgoingLinks(db, id, extractPageLinks(input.content))
    } else {
      repo.replaceOutgoingLinks(db, id, [])
    }
  }
  return updated
}

export function duplicatePage(db: Database, id: string): Page | null {
  const source = repo.getPage(db, id)
  if (!source) return null
  const searchContent = extractSearchableContent(source.pageType, source.content)
  const copy = repo.duplicatePage(db, id, searchContent)
  if (copy !== null && source.pageType === 'rich') {
    repo.copyOutgoingLinks(db, id, copy.id)
  }
  return copy
}

export function softDeletePage(db: Database, id: string): boolean {
  const deleted = repo.softDeletePage(db, id)
  if (deleted) {
    // Outgoing links die with the source; incoming links survive as broken
    // links so sources keep their stored IDs and can repair or remove them.
    repo.deleteOutgoingLinks(db, id)
  }
  return deleted
}

export interface BacklinkEntry {
  id: string
  title: string
  snippet: string | null
}

/** Living pages whose Rich Note content links to 	argetId. */
export function listBacklinks(db: Database, targetId: string): BacklinkEntry[] {
  const rows = repo.listBacklinks(db, targetId)
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: findLinkContext(repo.getPage(db, row.id)?.content ?? '', targetId)
  }))
}

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  return repo.listPages(db, options)
}
