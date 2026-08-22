import type { Database } from 'bun:sqlite'
import {
  createEmptyHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '@rtwiki/shared/schemas/html-content'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import type { CreatePageInput, UpdatePageInput } from '@rtwiki/shared/schemas/pages'
import * as repo from '../repositories/page-repository.js'

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
  return repo.createPage(db, id, input.title, input.pageType, content)
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
  if (input.content !== undefined) {
    const existing = repo.getPage(db, id)
    if (!existing) return null
    if (existing.pageType === 'html') {
      const parsed = parseHtmlContent(input.content)
      if (!parsed.ok) {
        throw new PageValidationError(parsed.error)
      }
    }
  }
  return repo.updatePage(db, id, input)
}

export function duplicatePage(db: Database, id: string): Page | null {
  return repo.duplicatePage(db, id)
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
