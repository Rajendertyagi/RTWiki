import type { Database } from 'bun:sqlite'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import {
  createEmptyHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import type { CreatePageInput, UpdatePageInput } from '@rtwiki/shared/schemas/pages'
import * as repo from '../repositories/page-repository.js'
import { extractSearchableContent } from './search-extraction.js'

/**
 * Raised when submitted content violates the canonical format for its page
 * type. Routes translate this into the existing structured 400 response;
 * it must never surface as a 500.
 */
export class PageValidationError extends Error {}

/**
 * Resolves the stored content string for a newly created HTML page.
 *
 * Lenient creation (owner decision, Phase 4A): an omitted or empty content
 * string becomes the canonical empty document so the UI can create HTML
 * pages seamlessly. Any other value must already be canonical JSON — it is
 * validated but stored verbatim, never re-serialized or "fixed".
 *
 * Rich pages are unchanged: every string remains accepted.
 */
function resolveCreatedContent(pageType: PageType, content: string): string {
  if (pageType !== 'html') {
    return content
  }
  if (content === '') {
    return serializeHtmlContent(createEmptyHtmlContent())
  }
  const parsed = parseHtmlContent(content)
  if (!parsed.ok) {
    throw new PageValidationError(parsed.error)
  }
  return content
}

export function createPage(db: Database, input: CreatePageInput): Page {
  const id = crypto.randomUUID()
  const content = resolveCreatedContent(input.pageType, input.content)
  const searchContent = extractSearchableContent(input.pageType, content)
  return repo.createPage(db, id, input.title, input.pageType, content, searchContent)
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
    searchContent = extractSearchableContent(existing.pageType, input.content)
  } else {
    searchContent = extractSearchableContent(existing.pageType, existing.content)
  }

  return repo.updatePage(db, id, { ...input, searchContent })
}

export function duplicatePage(db: Database, id: string): Page | null {
  const source = repo.getPage(db, id)
  if (!source) return null
  const searchContent = extractSearchableContent(source.pageType, source.content)
  return repo.duplicatePage(db, id, searchContent)
}

export function softDeletePage(db: Database, id: string): boolean {
  return repo.softDeletePage(db, id)
}

export function listPages(
  db: Database,
  options: { search?: string; limit?: number; offset?: number } = {}
): { pages: Page[]; total: number } {
  return repo.listPages(db, options)
}
