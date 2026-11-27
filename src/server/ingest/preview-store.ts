import { IMPORT_PREVIEW_MAX_ENTRIES, IMPORT_PREVIEW_TTL_MS } from '@rtwiki/shared/constants'
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
 * - Both the entry count and the age are bounded (shared constants), so a
 *   long-running session cannot grow the map without limit. Expired entries are
 *   swept on every write; when the map is still full, the oldest entry is
 *   evicted. Eviction only ever discards an uncommitted preview — never data.
 *
 * This is deliberately not a literal process-wide singleton: each app instance
 * owns its own store, so tests and multiple app instances cannot see each
 * other's pending previews (AGENTS.md §5 — explicit dependencies, no hidden
 * globals).
 */
export interface PreviewStore {
  /** Stores a prepared batch and returns its one-time id. */
  store(prepareds: readonly PreparedImport[]): string
  /** Returns and removes a batch, or null when the id is unknown or expired. */
  take(id: string): PreparedImport[] | null
}

interface PreviewEntry {
  readonly prepareds: readonly PreparedImport[]
  readonly createdAt: number
}

export function createPreviewStore(
  ttlMs: number = IMPORT_PREVIEW_TTL_MS,
  maxEntries: number = IMPORT_PREVIEW_MAX_ENTRIES
): PreviewStore {
  const entries = new Map<string, PreviewEntry>()

  function sweep(now: number): void {
    for (const [id, entry] of entries) {
      if (now - entry.createdAt > ttlMs) entries.delete(id)
    }
  }

  return {
    store(prepareds) {
      const now = Date.now()
      sweep(now)
      // Map iteration order is insertion order, so the first key is the oldest.
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
      const id = crypto.randomUUID()
      entries.set(id, { prepareds, createdAt: now })
      return id
    },
    take(id) {
      const entry = entries.get(id)
      if (!entry) return null
      entries.delete(id)
      if (Date.now() - entry.createdAt > ttlMs) return null
      return [...entry.prepareds]
    }
  }
}
