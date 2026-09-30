import type { Database } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import {
  createEmptyHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import {
  createStarterMarkdownContent,
  parseMarkdownPageContent
} from '@rtwiki/shared/schemas/markdown-content'
import { extractPageLinks, findLinkContext } from '@rtwiki/shared/schemas/page-links'
import type { CreatePageInput, UpdatePageInput } from '@rtwiki/shared/schemas/pages'
import {
  createStarterVisualContent,
  parseVisualPageContent,
  VISUAL_PAGE_TYPES,
  type VisualPageType
} from '@rtwiki/shared/schemas/visual-page-content'
import {
  attachmentTextForContent,
  pageIdsReferencingAttachment
} from '../attachments/attachment-references.js'
import * as repo from '../repositories/page-repository.js'
import { HierarchyError } from '../repositories/page-repository.js'
import { composeSearchableContent, extractSearchableContent } from './search-extraction.js'

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
  if (pageType === 'diagram') {
    if (content === '') {
      return createStarterVisualContent()
    }
    const parsed = parseVisualPageContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return content
  }
  if (pageType === 'markdown') {
    if (content === '') {
      return createStarterMarkdownContent()
    }
    const parsed = parseMarkdownPageContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return content
  }
  return content
}

/**
 * Validates replacement content against the page's own (immutable) type.
 *
 * **This is the write path that matters, and create was not enough.** `updatePage`
 * previously re-validated HTML and the visual types but had no Markdown branch, so the
 * 100,000-character ceiling could be stepped over by autosave: a note could be written
 * past the limit its own editor then refuses to read back
 * (`markdown-workspace.tsx` -> `parseMarkdownPageContent` -> starter-content fallback),
 * and `search_index` would hold a body that create would have rejected outright.
 *
 * Empty content is **not** special-cased here. On create, `''` means "give me a starter
 * document"; on update it means "the caller sent nothing useful", and quietly replacing a
 * user's note with a template because a write arrived empty is data loss dressed as a
 * default. An empty update is therefore rejected.
 */
function validateReplacementContent(pageType: PageType, content: string): void {
  if (pageType === 'html') {
    const parsed = parseHtmlContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return
  }
  if (isVisualPageType(pageType)) {
    const parsed = parseVisualPageContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
    return
  }
  if (pageType === 'markdown') {
    const parsed = parseMarkdownPageContent(content)
    if (!parsed.ok) {
      throw new PageValidationError(parsed.error)
    }
  }
}

/** True when the page type owns a dedicated Mermaid workspace. */
export function isVisualPageType(pageType: PageType): pageType is VisualPageType {
  return (VISUAL_PAGE_TYPES as readonly string[]).includes(pageType)
}

/**
 * A page's complete searchable representation: its own text plus the extracted text of
 * every document it references.
 *
 * **The one place a search row is computed.** Every create, update, duplicate and
 * reindex goes through here, which is what makes the lifecycle correct by construction
 * rather than by remembering to re-index at each call site: adding a document block to a
 * note is a content change, so the note is saved, so it is re-indexed, so the document's
 * text becomes findable. The one mutation that does *not* change a page — deleting the
 * attachment itself — is handled explicitly in the attachment route, which recomputes the
 * pages that referenced it.
 */
function searchContentForPage(db: Database, pageType: PageType, storedContent: string): string {
  const own = extractSearchableContent(pageType, storedContent)
  return composeSearchableContent(own, attachmentTextForContent(db, storedContent))
}

/**
 * Recomputes the search rows of pages whose text may have changed because an attachment
 * was removed from underneath them.
 *
 * Called after an attachment row is deleted. Without it, the deleted document's words stay
 * findable and lead the user to a page that no longer shows the document — searchable
 * content that does not exist, which is the exact failure the retention sweep is meant to
 * prevent elsewhere.
 */
export function reindexPagesReferencingAttachment(db: Database, attachmentId: string): number {
  const pageIds = pageIdsReferencingAttachment(db, attachmentId)
  for (const pageId of pageIds) {
    const page = repo.getPage(db, pageId)
    if (page === null) continue
    repo.reindexPageSearch(db, pageId, searchContentForPage(db, page.pageType, page.content))
  }
  return pageIds.length
}

export function createPage(db: Database, input: CreatePageInput): Page {
  const id = crypto.randomUUID()
  const content = resolveCreatedContent(input.pageType, input.content)
  const searchContent = searchContentForPage(db, input.pageType, content)

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
    // One validator for every type, on the authoritative write path. This is what
    // closes the autosave bypass of the Markdown character limit; see the note on
    // `validateReplacementContent`.
    validateReplacementContent(existing.pageType, input.content)
    searchContent = searchContentForPage(db, existing.pageType, input.content)
  } else {
    searchContent = searchContentForPage(db, existing.pageType, existing.content)
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
  const searchContent = searchContentForPage(db, source.pageType, source.content)
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

/** Living pages this page links to (outgoing relationships). */
export function listOutgoingLinks(db: Database, sourceId: string): BacklinkEntry[] {
  const rows = repo.listOutgoingLinks(db, sourceId)
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: null
  }))
}

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  return repo.listPages(db, options)
}

export function listTrashedPages(db: Database): { pages: Page[]; total: number } {
  return repo.listTrashedPages(db)
}

export function restorePage(db: Database, id: string): Page | null {
  return repo.restorePage(db, id)
}

export function permanentlyDeletePage(db: Database, id: string): boolean {
  return repo.permanentlyDeletePage(db, id)
}
