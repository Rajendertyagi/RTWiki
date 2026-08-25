import type { Page } from '@rtwiki/shared/contracts/pages'

/**
 * Bounded client-side record of genuinely opened pages, persisted across
 * restarts via localStorage. Deliberately metadata-only (IDs + timestamps):
 * no schema change, no `updated_at` mutation, dashboard/home never recorded,
 * and virtual HTML subfiles resolve to their parent page by the caller.
 */

const STORAGE_KEY = 'rtwiki.recent-pages'
export const RECENT_PAGES_MAX = 20

export interface RecentPageEntry {
  id: string
  openedAt: number
}

export function loadRecentPages(): RecentPageEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const entries: RecentPageEntry[] = []
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as RecentPageEntry).id === 'string' &&
        typeof (item as RecentPageEntry).openedAt === 'number'
      ) {
        entries.push({
          id: (item as RecentPageEntry).id,
          openedAt: (item as RecentPageEntry).openedAt
        })
      }
    }
    // Newest first; bound enforced on write too, but prune here defensively.
    entries.sort((a, b) => b.openedAt - a.openedAt)
    return entries.slice(0, RECENT_PAGES_MAX)
  } catch {
    return []
  }
}

/** Records an open: moves the page to the top, bounds the list at 20. */
export function recordRecentPage(pageId: string): void {
  if (!pageId) return
  const entries = loadRecentPages().filter((e) => e.id !== pageId)
  entries.unshift({ id: pageId, openedAt: Date.now() })
  saveEntries(entries.slice(0, RECENT_PAGES_MAX))
}

export function clearRecentPages(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode etc.) — recents are best-effort.
  }
}

function saveEntries(entries: RecentPageEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable — recents are best-effort.
  }
}

/**
 * Resolves stored IDs against the current living pages, discarding deleted
 * or missing entries, preserving newest-first order.
 */
export function resolveRecentPages(entries: RecentPageEntry[], pages: Page[]): Page[] {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const out: Page[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const page = byId.get(entry.id)
    if (page && !seen.has(entry.id)) {
      out.push(page)
      seen.add(entry.id)
    }
  }
  return out
}
