import {
  IMPORT_PREVIEW_MAX_ENTRIES,
  IMPORT_PREVIEW_MAX_FILES_PER_PREVIEW,
  IMPORT_PREVIEW_MAX_TOTAL_BYTES,
  IMPORT_PREVIEW_TTL_MS
} from '@rtwiki/shared/constants'
import type { PreparedImport } from './ingest-types.js'

/**
 * Process-local, non-durable holding area between `POST /api/import/preview`
 * and `POST /api/import/confirm`.
 *
 * Design decisions (unspecified behaviour, chosen to be safe and reversible):
 *
 * - The store lives in the Hono app instance, not on disk and not in SQLite. A
 *   restart discards every pending preview; the client must preview again. It
 *   is never a source of truth — the database is.
 * - A preview is **consumed on read** (`take` deletes it). A second confirm with
 *   the same id therefore cannot create a duplicate set of pages. If a commit
 *   fails, the client simply previews again; no partial state survives.
 * - `discard` releases a preview the client cancelled, so its bytes stop being
 *   retained immediately instead of waiting for expiry. It is idempotent.
 * - The entry count, the total retained bytes and the age are all bounded
 *   (shared constants), so a long-running session cannot grow the map without
 *   limit. Expired entries are swept on **every** operation — store, take and
 *   discard — not just on write. When storing would exceed the byte budget, the
 *   oldest entries are evicted until it fits. Eviction and discard only ever
 *   drop an uncommitted preview — never data.
 *
 * This is deliberately not a literal process-wide singleton: each app instance
 * owns its own store, so tests and multiple app instances cannot see each
 * other's pending previews (AGENTS.md §5 — explicit dependencies, no hidden
 * globals).
 */
export interface PreviewStore {
  /**
   * Stores a prepared batch and returns its one-time id, or `null` when the
   * batch has more files than a single preview may hold.
   */
  store(prepareds: readonly PreparedImport[]): string | null
  /** Returns and removes a batch, or null when the id is unknown or expired. */
  take(id: string): PreparedImport[] | null
  /** Releases a cancelled preview. Returns true only when an entry was removed. */
  discard(id: string): boolean
  /** Number of live entries, for diagnostics and bounds tests. */
  readonly size: number
}

interface PreviewEntry {
  readonly prepareds: readonly PreparedImport[]
  readonly createdAt: number
  /** Actual retained bytes: primary attachment plus every extracted image. */
  readonly bytes: number
}

/**
 * The real in-memory footprint of a prepared batch. `byteSize` describes the
 * primary file to the user, but the descriptor also holds its verbatim bytes
 * and any images extracted from a document; all of those stay resident until
 * confirm or discard.
 */
function retainedBytes(prepareds: readonly PreparedImport[]): number {
  let total = 0
  for (const prepared of prepareds) {
    total += prepared.attachment.data.byteLength
    for (const image of prepared.images) total += image.data.byteLength
  }
  return total
}

export function createPreviewStore(
  ttlMs: number = IMPORT_PREVIEW_TTL_MS,
  maxEntries: number = IMPORT_PREVIEW_MAX_ENTRIES,
  maxTotalBytes: number = IMPORT_PREVIEW_MAX_TOTAL_BYTES,
  maxFilesPerPreview: number = IMPORT_PREVIEW_MAX_FILES_PER_PREVIEW
): PreviewStore {
  const entries = new Map<string, PreviewEntry>()
  let totalBytes = 0

  function sweep(now: number): void {
    for (const [id, entry] of entries) {
      if (now - entry.createdAt > ttlMs) {
        entries.delete(id)
        totalBytes -= entry.bytes
      }
    }
  }

  return {
    get size(): number {
      return entries.size
    },

    store(prepareds) {
      const now = Date.now()
      sweep(now)
      if (prepareds.length > maxFilesPerPreview) return null

      const bytes = retainedBytes(prepareds)
      // Map iteration order is insertion order, so the first key is the oldest.
      // A single preview is admitted even when it alone exceeds the budget: the
      // multipart body limit already bounds one request, and refusing an
      // explicitly requested preview would be worse than a bounded overshoot.
      while (entries.size > 0 && totalBytes + bytes > maxTotalBytes) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        const removed = entries.get(oldest.value)
        entries.delete(oldest.value)
        if (removed) totalBytes -= removed.bytes
      }
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        const removed = entries.get(oldest.value)
        entries.delete(oldest.value)
        if (removed) totalBytes -= removed.bytes
      }

      const id = crypto.randomUUID()
      entries.set(id, { prepareds, createdAt: now, bytes })
      totalBytes += bytes
      return id
    },

    take(id) {
      sweep(Date.now())
      const entry = entries.get(id)
      if (!entry) return null
      entries.delete(id)
      totalBytes -= entry.bytes
      return [...entry.prepareds]
    },

    discard(id) {
      sweep(Date.now())
      const entry = entries.get(id)
      if (!entry) return false
      entries.delete(id)
      totalBytes -= entry.bytes
      return true
    }
  }
}
