import type { Database } from 'bun:sqlite'
import { attachmentIdsInContent } from './attachment-references.js'
import { deleteAttachment, listAttachments } from './attachment-repository.js'

/**
 * Reclaims attachments no document refers to any more.
 *
 * ## Why this exists
 *
 * An `image` block stores a URL, and the `attachments` table has no foreign key to
 * `pages` (ADR-013). Two things follow, and this addresses the second:
 *
 * 1. There is no "images on this page" list, because there is no page to scope
 *    one by. That is a product decision — a cascade would destroy an image still
 *    used in another note — and it is deliberately not changed here.
 * 2. Deleting a note leaves its images behind with nothing pointing at them. This
 *    was not hypothetical: the development database was found holding 14 image
 *    rows that no document referenced.
 *
 * ## What counts as "referenced"
 *
 * The stored URL embeds the attachment id, so a reference is found by searching
 * page content for that id — including content in the **recycle bin**. A binned
 * page can be restored, so its images must survive; a retention pass that ignored
 * the bin would destroy the images of a note the user had merely deleted by
 * mistake, which is worse than the leak it fixes.
 *
 * ## Why a threshold, and why a dry run
 *
 * The alternative to an age threshold is deleting on page-delete, which is exactly
 * the cascade that was rejected. With a threshold, the worst case is that an
 * image survives a little longer than it needs to — recoverable. The failure in
 * the other direction is unrecoverable.
 *
 * So the default is deliberately generous, and the scan is available on its own:
 * `findUnreferencedAttachments` answers "what would go" without touching anything,
 * which is what a caller should run first and what a test asserts against.
 */
export interface UnreferencedAttachment {
  id: string
  originalName: string | null
  byteSize: number
  createdAt: string
  /** How long the row has been unreferenced, or null when that cannot be known. */
  unreferencedForMs: number | null
}

export interface RetentionOptions {
  /**
   * How old an attachment must be before it may be reclaimed.
   *
   * Generous on purpose. It exists to bound a leak, not to tidy up, and every
   * day of extra caution costs disk that the user can see and nothing else.
   */
  minAgeMs?: number
  /** Injected so the policy is testable without a real clock. */
  now?: number
}

/**
 * The default minimum age before an unreferenced attachment may be reclaimed.
 *
 * 30 days. Long enough that a note deleted by mistake has been noticed and
 * restored, and short enough that a family's disk does not grow without bound.
 */
export const DEFAULT_UNREFERENCED_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The attachment ids any document still refers to.
 *
 * Read once for the whole table rather than per attachment: the naive version
 * scans every page for every row, which is quadratic in exactly the case the leak
 * makes large. One pass builds a set, and each attachment is then a lookup.
 *
 * Includes trashed pages, deliberately — see the module note.
 */
function referencedIds(db: Database): Set<string> {
  const referenced = new Set<string>()
  // No `WHERE deleted_at IS NULL` here, and that omission is the point: a page in
  // the recycle bin can be restored, and its images are still its images.
  const pages = db.query('SELECT content FROM pages').all() as Array<{ content: string | null }>
  for (const row of pages) {
    const content = row.content
    if (typeof content !== 'string' || content.length === 0) continue
    // The shared reference reader, so "what does this page reference" has exactly one
    // definition. Search uses the same one to decide whose text to index; a second copy
    // of this regex is how the two would quietly disagree about ownership.
    for (const id of attachmentIdsInContent(content)) referenced.add(id)
  }
  return referenced
}

/**
 * Every attachment no document refers to, with how long it has been that way.
 *
 * Read-only. A caller can show the result, log it, or count it without anything
 * being at risk, which is what makes the destructive half below safe to expose.
 */
export function findUnreferencedAttachments(
  db: Database,
  now: number = Date.now()
): UnreferencedAttachment[] {
  const referenced = referencedIds(db)
  const orphans: UnreferencedAttachment[] = []
  for (const attachment of listAttachments(db)) {
    if (referenced.has(attachment.id)) continue
    const createdAt = Date.parse(attachment.createdAt)
    // `null` rather than zero for a timestamp that will not parse. "Unknown age"
    // and "brand new" are different facts, and collapsing them to zero would let a
    // caller with a zero threshold delete a row whose age nobody can establish.
    const unreferencedForMs = Number.isNaN(createdAt) ? null : Math.max(0, now - createdAt)
    orphans.push({
      id: attachment.id,
      originalName: attachment.originalName,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt,
      unreferencedForMs
    })
  }
  return orphans
}

export interface RetentionResult {
  /** Rows deleted, and their ids. */
  reclaimed: string[]
  /** Bytes reclaimed. */
  bytes: number
  /** Unreferenced rows found but too young to touch. */
  tooYoung: UnreferencedAttachment[]
  /** A row that could not be deleted, with the reason. Named so it is not silent. */
  failed: Array<{ id: string; reason: string }>
}

/**
 * Deletes unreferenced attachments that are old enough.
 *
 * Reports rather than throws. A single unremovable row must not abandon the rest
 * of the pass, and it must not be invisible: a row that survives a reclaim is
 * either a lock or a bug, and the next run should not rediscover it silently.
 */
export function reclaimUnreferencedAttachments(
  db: Database,
  options: RetentionOptions = {}
): RetentionResult {
  const { minAgeMs = DEFAULT_UNREFERENCED_MIN_AGE_MS, now = Date.now() } = options
  const result: RetentionResult = { reclaimed: [], bytes: 0, tooYoung: [], failed: [] }

  for (const orphan of findUnreferencedAttachments(db, now)) {
    // An unknown age is never old enough. That holds even at `minAgeMs: 0`,
    // because "zero" means "no waiting", not "delete a row we know nothing about".
    if (orphan.unreferencedForMs === null || orphan.unreferencedForMs < minAgeMs) {
      result.tooYoung.push(orphan)
      continue
    }
    try {
      // A false return means the row vanished between the scan and the delete —
      // a concurrent reclaim having got there first. Not a failure, and not
      // reported as one.
      if (!deleteAttachment(db, orphan.id)) continue
      result.reclaimed.push(orphan.id)
      result.bytes += orphan.byteSize
    } catch (error) {
      result.failed.push({
        id: orphan.id,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return result
}
