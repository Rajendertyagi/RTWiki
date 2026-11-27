import type { Database } from 'bun:sqlite'
import { MAX_PAGE_REVISIONS_PER_PAGE, RECOVERY_RETENTION_DAYS } from '@rtwiki/shared/constants'
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
  type OperationKind,
  OperationKindSchema,
  type RecoveryActor,
  RecoveryActorSchema,
  type RevisionCaptureKind,
  RevisionCaptureKindSchema
} from '@rtwiki/shared/schemas/recovery'
import { parseRichContent } from '@rtwiki/shared/schemas/rich-content'
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

/**
 * Raised when an undo targets a revision that no longer exists or has aged out
 * of the retention window. The route maps it to 410 `recovery_data_expired`;
 * no mutation has happened when it is thrown.
 */
export class RecoveryDataExpiredError extends Error {
  constructor(message = 'This change is too old to undo.') {
    super(message)
    this.name = 'RecoveryDataExpiredError'
  }
}

// Hierarchy violations originate in the repository transaction; re-exported
// here so routes map `status` onto HTTP without importing the repository.
export { HierarchyError } from '../repositories/page-repository.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function resolveActor(actor: RecoveryActor | undefined): RecoveryActor {
  const value = actor ?? 'local-client'
  const parsed = RecoveryActorSchema.safeParse(value)
  if (!parsed.success) throw new PageValidationError('Invalid recovery actor')
  return parsed.data
}

function isExpired(capturedAt: string): boolean {
  return Date.parse(capturedAt) < Date.now() - RECOVERY_RETENTION_DAYS * MS_PER_DAY
}

/**
 * Captures a pre-mutation snapshot inside the caller's transaction. The
 * searchable text is always recomputed through the one shared extractor, never
 * copied from raw page JSON.
 */
function captureRevisionCore(
  db: Database,
  page: Page,
  searchContent: string,
  captureKind: RevisionCaptureKind,
  actor: RecoveryActor,
  extra: { childrenSnapshot?: string | null; linksSnapshot?: string | null } = {}
): string {
  const parsedKind = RevisionCaptureKindSchema.safeParse(captureKind)
  if (!parsedKind.success) throw new PageValidationError('Invalid revision capture kind')
  const id = crypto.randomUUID()
  repo.insertRevisionCore(db, {
    id,
    pageId: page.id,
    version: page.version,
    title: page.title,
    content: page.content,
    pageType: page.pageType,
    parentId: page.parentId,
    position: page.position,
    searchContent,
    childrenSnapshot: extra.childrenSnapshot ?? null,
    linksSnapshot: extra.linksSnapshot ?? null,
    captureKind: parsedKind.data,
    actor,
    capturedAt: new Date().toISOString(),
    createdAt: page.createdAt
  })
  return id
}

/**
 * Records one committed recovery operation. The chain rule is enforced here:
 * the newest still-open operation for the page gets this operation's
 * `before_revision_id` as its `after_revision_id`, so one revision can be
 * referenced by two operations and the retention prune must check both.
 */
function logOperationCore(
  db: Database,
  kind: OperationKind,
  targetPageId: string | null,
  beforeRevisionId: string | null,
  actor: RecoveryActor
): string {
  const parsedKind = OperationKindSchema.safeParse(kind)
  if (!parsedKind.success) throw new PageValidationError('Invalid operation kind')
  if (beforeRevisionId !== null && targetPageId !== null) {
    db.run(
      `UPDATE operation_log SET after_revision_id = ?
       WHERE id = (
         SELECT id FROM operation_log
         WHERE target_page_id = ? AND after_revision_id IS NULL
         ORDER BY created_at DESC, rowid DESC LIMIT 1
       )`,
      [beforeRevisionId, targetPageId]
    )
  }
  const id = crypto.randomUUID()
  repo.insertOperationCore(db, {
    id,
    operationKind: parsedKind.data,
    targetPageId,
    targetAttachmentId: null,
    beforeRevisionId,
    afterRevisionId: null,
    actor,
    status: 'committed',
    createdAt: new Date().toISOString()
  })
  return id
}

/**
 * Resolves the stored content string for a newly created HTML page.
 *
 * Lenient creation (owner decision, Phase 4A): an omitted or empty content
 * string becomes the canonical empty document so the UI can create HTML
 * pages seamlessly. Any other value must already be canonical JSON — it is
 * validated but stored verbatim, never re-serialized or "fixed".
 *
 * Rich pages: an empty string is still stored verbatim (the editor supplies
 * the canonical empty document on load), but any non-empty value must be a
 * structurally valid BlockNote document. Validation is structural only —
 * unknown block types are accepted so documents from a newer RTWiki survive.
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
  if (pageType === 'rich') {
    if (content === '') {
      return content
    }
    const parsed = parseRichContent(content)
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
 * default. An empty update is therefore rejected — including for Rich Notes,
 * whose non-empty content must be a structurally valid BlockNote document.
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
    return
  }
  if (pageType === 'rich') {
    // Empty is not a starter document on update: silently replacing a note
    // with a template because a write arrived empty is data loss.
    if (content === '') {
      throw new PageValidationError('Rich Note content cannot be empty.')
    }
    const parsed = parseRichContent(content)
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

/**
 * Creates a page without owning a transaction. The caller must already hold a
 * write lock (`BEGIN IMMEDIATE`); the ingest core uses this so the page, its
 * attachment and its provenance commit as one unit. `id` is supplied by the
 * caller so provenance can be written against it in the same transaction.
 */
export function createPageCore(db: Database, id: string, input: CreatePageInput): Page {
  const content = resolveCreatedContent(input.pageType, input.content)
  const searchContent = searchContentForPage(db, input.pageType, content)

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
  // Maintain the internal-link index for the new page (rich pages only). The
  // core variant avoids a nested BEGIN IMMEDIATE when the caller owns the lock.
  if (input.pageType === 'rich') {
    repo.replaceOutgoingLinksCore(db, id, extractPageLinks(content))
  }
  return page
}

/** Transactional wrapper preserving the existing behaviour for all callers. */
export function createPage(db: Database, input: CreatePageInput): Page {
  const id = crypto.randomUUID()
  db.run('BEGIN IMMEDIATE')
  try {
    const page = createPageCore(db, id, input)
    db.run('COMMIT')
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
export function updatePage(
  db: Database,
  id: string,
  input: UpdatePageInput,
  actor?: RecoveryActor
): Page | null {
  const resolvedActor = resolveActor(actor)
  // The read, validation, revision capture, CAS write, search update, link
  // replacement and operation row all share one write lock. A stale version
  // rolls the whole unit back, so no revision or log row survives a 409.
  db.run('BEGIN IMMEDIATE')
  try {
    const existing = repo.getPage(db, id)
    if (!existing) {
      db.run('COMMIT')
      return null
    }
    // A no-field write is a no-op in the repository; it is not an operation
    // and must not produce a revision or a log row.
    if (input.title === undefined && input.content === undefined) {
      db.run('COMMIT')
      return existing
    }

    // Search text is recomputed on every write so the index always reflects
    // the current stored content for the page's (immutable) type.
    let searchContent: string
    if (input.content !== undefined) {
      // One validator for every type, on the authoritative write path. This is what
      // closes the autosave bypass of the Markdown character limit; see the note on
      // `validateReplacementContent`.
      validateReplacementContent(existing.pageType, input.content)
      searchContent = searchContentForPage(db, existing.pageType, input.content)
    } else {
      searchContent = searchContentForPage(db, existing.pageType, existing.content)
    }

    const beforeRevisionId = captureRevisionCore(
      db,
      existing,
      searchContentForPage(db, existing.pageType, existing.content),
      'before_update',
      resolvedActor
    )
    const updated = repo.updatePageCore(db, id, { ...input, searchContent })
    // Maintain the internal-link index on every content write. Non-rich page
    // types cannot carry wiki links, so their outgoing set is cleared.
    if (updated !== null && input.content !== undefined) {
      repo.replaceOutgoingLinksCore(
        db,
        id,
        existing.pageType === 'rich' ? extractPageLinks(input.content) : []
      )
    }
    logOperationCore(db, 'page.update', id, beforeRevisionId, resolvedActor)
    db.run('COMMIT')
    return updated
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
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

export function softDeletePage(db: Database, id: string, actor?: RecoveryActor): boolean {
  const resolvedActor = resolveActor(actor)
  db.run('BEGIN IMMEDIATE')
  try {
    const existing = repo.getPage(db, id)
    if (!existing) {
      db.run('COMMIT')
      return false
    }
    // The snapshot's search text comes from the shared extractor, not from the
    // raw stored JSON. Outgoing links die with the source; incoming links
    // survive as broken links so sources keep their stored IDs.
    const searchContent = searchContentForPage(db, existing.pageType, existing.content)
    const revisionId = repo.softDeletePageCore(db, id, searchContent, resolvedActor)
    if (revisionId === null) {
      db.run('COMMIT')
      return false
    }
    logOperationCore(db, 'page.trash', id, revisionId, resolvedActor)
    db.run('COMMIT')
    return true
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
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

export interface RestorePageInput {
  /** When present, use the revision-backed path; otherwise the legacy fallback. */
  revisionId?: string
  actor?: RecoveryActor
}

export function restorePage(db: Database, id: string, input: RestorePageInput = {}): Page | null {
  const resolvedActor = resolveActor(input.actor)
  db.run('BEGIN IMMEDIATE')
  try {
    const existing = db
      .query(
        'SELECT id, title, content, page_type, parent_id, position, created_at, updated_at, deleted_at, version FROM pages WHERE id = ?'
      )
      .get(id) as Record<string, unknown> | undefined
    if (!existing) {
      db.run('COMMIT')
      return null
    }

    const pageType = String(existing.page_type) as PageType
    const currentContent = String(existing.content ?? '')

    // A living page has no trash state to restore; the only valid operation is
    // an undo to a prior revision. The legacy fallback below is exclusively for
    // pre-015 trash, where no snapshot was captured.
    if (existing.deleted_at === null) {
      if (input.revisionId === undefined) {
        db.run('COMMIT')
        return null
      }
      const revision = repo.getRevision(db, input.revisionId, id) ?? undefined
      if (!revision || isExpired(revision.capturedAt) || revision.searchContent === null) {
        throw new RecoveryDataExpiredError()
      }
      // Capture the current living state so the undo itself is undoable.
      const beforeRevisionId = captureRevisionCore(
        db,
        {
          id: String(existing.id),
          title: String(existing.title ?? ''),
          content: currentContent,
          pageType,
          parentId: (existing.parent_id as string) || null,
          position: Number(existing.position ?? 0),
          createdAt: String(existing.created_at),
          updatedAt: String(existing.updated_at),
          deletedAt: null,
          version: Number(existing.version ?? 0)
        },
        searchContentForPage(db, pageType, currentContent),
        'before_restore',
        resolvedActor
      )
      const page = repo.restoreLivingPageCore(db, id, {
        revision,
        // Outgoing links are a derived index of the canonical content. A
        // before_update revision carries no links_snapshot, so derive them
        // from the revision's own content — the same rule updatePage uses.
        links: extractPageLinks(revision.content),
        searchContent: revision.searchContent
      })
      if (page === null) {
        db.run('COMMIT')
        return null
      }
      logOperationCore(db, 'page.revision.restore', id, beforeRevisionId, resolvedActor)
      db.run('COMMIT')
      return page
    }

    // --- Trashed page: existing restore-to-living behaviour (unchanged) -----
    let revision: repo.RevisionSnapshot | undefined
    let children: repo.ChildSnapshot[] | undefined
    let links: string[] | undefined
    let searchContent: string

    if (input.revisionId !== undefined) {
      revision = repo.getRevision(db, input.revisionId, id) ?? undefined
      if (!revision || isExpired(revision.capturedAt)) {
        throw new RecoveryDataExpiredError()
      }
      // Validate every required snapshot field BEFORE any mutation. A partial
      // or corrupt snapshot is treated exactly like an expired one: 410, no
      // writes, no half-restored page.
      if (
        revision.searchContent === null ||
        revision.childrenSnapshot === null ||
        revision.linksSnapshot === null
      ) {
        throw new RecoveryDataExpiredError()
      }
      try {
        const parsedChildren: unknown = JSON.parse(revision.childrenSnapshot)
        const parsedLinks: unknown = JSON.parse(revision.linksSnapshot)
        if (!Array.isArray(parsedChildren) || !Array.isArray(parsedLinks)) {
          throw new RecoveryDataExpiredError()
        }
        children = parsedChildren as repo.ChildSnapshot[]
        links = parsedLinks as string[]
      } catch (err) {
        if (err instanceof RecoveryDataExpiredError) throw err
        throw new RecoveryDataExpiredError()
      }
      searchContent = revision.searchContent
    } else {
      searchContent = searchContentForPage(db, pageType, currentContent)
    }

    // Capture the current trashed state so the restore itself is undoable.
    const beforeRevisionId = captureRevisionCore(
      db,
      {
        id: String(existing.id),
        title: String(existing.title ?? ''),
        content: currentContent,
        pageType,
        parentId: (existing.parent_id as string) || null,
        position: Number(existing.position ?? 0),
        createdAt: String(existing.created_at),
        updatedAt: String(existing.updated_at),
        deletedAt: String(existing.deleted_at),
        version: Number(existing.version ?? 0)
      },
      searchContentForPage(db, pageType, currentContent),
      'before_restore',
      resolvedActor
    )

    const page = repo.restorePageCore(db, id, {
      revision,
      children,
      links,
      searchContent,
      actor: resolvedActor
    })
    if (page === null) {
      db.run('COMMIT')
      return null
    }
    logOperationCore(
      db,
      revision ? 'page.revision.restore' : 'page.restore',
      id,
      beforeRevisionId,
      resolvedActor
    )
    db.run('COMMIT')
    return page
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

export function permanentlyDeletePage(db: Database, id: string, actor?: RecoveryActor): boolean {
  const resolvedActor = resolveActor(actor)
  db.run('BEGIN IMMEDIATE')
  try {
    const deleted = repo.permanentlyDeletePageCore(db, id, resolvedActor)
    db.run('COMMIT')
    return deleted
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

/** Bounded newest-first revision history for one page. */
export function listPageRevisions(
  db: Database,
  id: string,
  limit: number = MAX_PAGE_REVISIONS_PER_PAGE
): repo.RevisionSnapshot[] {
  return repo.listRevisions(db, id, limit)
}

/**
 * Id of the newest usable pre-delete snapshot, when one exists. The normal
 * trash-restore route uses it so hierarchy, links and search text come back;
 * pages trashed before migration 015 have no snapshot and fall back to legacy.
 */
export function latestPreDeleteRevisionId(db: Database, id: string): string | undefined {
  return repo.findLatestPreDeleteRevision(db, id)?.id
}

/** Bounded newest-first recent operations for the recovery view. */
export function listRecoveryOperations(db: Database, limit: number): repo.OperationRecord[] {
  return repo.listOperations(db, limit)
}

/** One transactional retention pass; call once at startup. */
export function pruneRecoveryData(db: Database): repo.PruneResult {
  const cutoff = new Date(Date.now() - RECOVERY_RETENTION_DAYS * MS_PER_DAY).toISOString()
  return repo.pruneRecoveryData(db, cutoff, MAX_PAGE_REVISIONS_PER_PAGE)
}
