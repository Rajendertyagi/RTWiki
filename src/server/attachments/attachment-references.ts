import type { Database } from '../database/index.js'

/**
 * Which page an attachment belongs to.
 *
 * ## The model is a reference, not a foreign key
 *
 * `attachments` has no `page_id`, and there is deliberately no join table. A page owns an
 * attachment because the attachment's URL appears in that page's stored content — which
 * is what `attachment-retention.ts` has always scanned for when deciding what may be
 * reclaimed, and what a document block actually stores.
 *
 * This matters for search. "The text of a document attached to a page" is not a join; it
 * is a lookup driven by the page's own content, exactly as ownership is. Introducing a
 * second, different notion of ownership for search would mean two answers to "which page
 * does this document belong to", and they would disagree the first time a page referenced
 * an attachment without embedding it.
 *
 * The id shape is matched loosely — an id anywhere in the content is a reference, however
 * it was written — for the same reason retention does it: a reference is a reference.
 */

/** An attachment id as it appears in stored page content. */
export const ATTACHMENT_ID_IN_CONTENT = /\/api\/attachments\/([A-Za-z0-9_-]{1,64})/g

/**
 * Every attachment id referenced by a page's stored content, de-duplicated and in
 * first-appearance order.
 *
 * Order is stable so that a page whose attachments are re-indexed twice produces the same
 * search row both times; a search index that reordered itself would make a "nothing
 * changed" reindex look like a change.
 */
export function attachmentIdsInContent(content: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const match of content.matchAll(ATTACHMENT_ID_IN_CONTENT)) {
    const id = match[1]
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    ordered.push(id)
  }
  return ordered
}

/**
 * The ids of every page whose content references the given attachment.
 *
 * Needed when an attachment is deleted or reclaimed: the page rows still hold its URL, so
 * their search text must be recomputed or the deleted document's words stay findable and
 * lead to a page that no longer shows it.
 */
export function pageIdsReferencingAttachment(db: Database, attachmentId: string): string[] {
  // A parameter cannot be interpolated into the regex, so the shape is matched with LIKE
  // and the id is then verified by the same regex. The `%` around the id is safe: a UUID
  // contains none, and a false positive from the LIKE is discarded by the check below.
  // Parameters bind at `.all(...)`, not `.query(...)` — see `bun-types/sqlite.d.ts`.
  const rows = db
    .query(
      `SELECT id, content FROM pages
       WHERE content LIKE '%' || ? || '%'
         AND content LIKE '%/api/attachments/%'`
    )
    .all(attachmentId) as Array<{ id: string; content: string }>
  const confirmed: string[] = []
  for (const row of rows) {
    if (attachmentIdsInContent(row.content).includes(attachmentId)) confirmed.push(row.id)
  }
  return confirmed
}

/**
 * The extracted text of the attachments a page references, in the page's own order.
 *
 * Returns `[]` for a page with no attachments, for an image (which has no text by
 * construction), and for an attachment that has since been deleted — a dangling URL in
 * page content is normal after an attachment is removed, and must not throw.
 */
export function attachmentTextForContent(db: Database, content: string): string[] {
  const ids = attachmentIdsInContent(content)
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  const rows = db
    .query(
      `SELECT id, extracted_text FROM attachments
       WHERE id IN (${placeholders}) AND extracted_text IS NOT NULL AND extracted_text <> ''`
    )
    .all(...ids) as Array<{ id: string; extracted_text: string | null }>
  const byId = new Map(rows.map((row) => [row.id, row.extracted_text ?? '']))
  const out: string[] = []
  for (const id of ids) {
    const text = byId.get(id)
    // Skip a dangling reference: the row is gone, so there is nothing to say about it.
    if (text !== undefined && text !== '') out.push(text)
  }
  return out
}
