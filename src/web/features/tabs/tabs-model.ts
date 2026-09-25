/**
 * Pure session-tab model for the workspace tab strip.
 *
 * Tabs are an in-session view of open pages: they never own data, they only
 * reference page ids and mirror display fields. All transitions are pure
 * functions so the behaviour is unit-testable without React.
 */

import type { PageType } from '@rtwiki/shared/contracts/pages'

export interface OpenTab {
  pageId: string
  title: string
  pageType: PageType
}

export interface CloseTabResult {
  tabs: OpenTab[]
  /** Tab to activate after closing, or null when the last tab closed. */
  activatePageId: string | null
}

export function findTab(tabs: OpenTab[], pageId: string): OpenTab | undefined {
  return tabs.find((tab) => tab.pageId === pageId)
}

/**
 * Opens a page in a tab. Opening an already-open page only activates its
 * existing tab — never a duplicate.
 */
export function openInTabs(
  tabs: OpenTab[],
  page: { id: string; title: string; pageType: PageType },
  untitledLabel: string
): OpenTab[] {
  if (findTab(tabs, page.id)) return tabs
  return [...tabs, { pageId: page.id, title: page.title || untitledLabel, pageType: page.pageType }]
}

/** Activates an existing tab without mutating anything. */
export function activationIsAlreadyOpen(tabs: OpenTab[], pageId: string): boolean {
  return findTab(tabs, pageId) !== undefined
}

/**
 * Closes a tab. Closing the active tab activates the nearest sensible
 * neighbour (right first, else left); closing a background tab leaves the
 * active selection untouched. Closing the final tab yields null (Home).
 */
export function closeInTabs(
  tabs: OpenTab[],
  pageId: string,
  activePageId: string | null
): CloseTabResult {
  const index = tabs.findIndex((tab) => tab.pageId === pageId)
  if (index === -1) return { tabs, activatePageId: activePageId }
  const next = tabs.filter((tab) => tab.pageId !== pageId)
  if (next.length === 0) return { tabs: next, activatePageId: null }
  if (activePageId !== pageId) return { tabs: next, activatePageId: activePageId }
  const neighbour = next[Math.min(index, next.length - 1)]
  return { tabs: next, activatePageId: neighbour.pageId }
}

/** Renames every tab mirroring the renamed page. */
export function renameInTabs(
  tabs: OpenTab[],
  pageId: string,
  title: string,
  untitledLabel: string
): OpenTab[] {
  return tabs.map((tab) =>
    tab.pageId === pageId ? { ...tab, title: title || untitledLabel } : tab
  )
}

/** Removes tabs whose pages were deleted. */
export function removeFromTabs(tabs: OpenTab[], deletedIds: ReadonlySet<string>): OpenTab[] {
  return tabs.filter((tab) => !deletedIds.has(tab.pageId))
}

/**
 * Moves the tab at `from` to `to`, leaving the others in order.
 *
 * The single source of truth for tab reordering, shared by the pointer drag and
 * the Ctrl+Arrow keyboard shortcut, so both produce identical results. A no-op
 * that returns the *same array reference* when nothing moves, so React can skip
 * the re-render.
 *
 * Out-of-range indices are ignored rather than throwing: the indices come from
 * measured pointer positions and from key repeat, and a stale one must not be
 * able to corrupt the order.
 */
export function moveInTabs(tabs: OpenTab[], from: number, to: number): OpenTab[] {
  const last = tabs.length - 1
  if (from < 0 || from > last || to < 0 || to > last || from === to) return tabs
  const next = [...tabs]
  const [moved] = next.splice(from, 1)
  if (!moved) return tabs
  next.splice(to, 0, moved)
  return next
}

/**
 * Reorders tabs to match an externally supplied list of ids.
 *
 * This is what the drag reports: Motion computes the new order during the drag
 * and hands it over whole. Ids that are not currently open are ignored, and
 * tabs the caller left out are **appended in their existing order** rather than
 * dropped, so a partial or stale list can never silently discard an open tab.
 */
export function reorderInTabs(tabs: OpenTab[], orderedIds: readonly string[]): OpenTab[] {
  const byId = new Map(tabs.map((tab) => [tab.pageId, tab]))
  const next: OpenTab[] = []
  const taken = new Set<string>()
  for (const id of orderedIds) {
    const tab = byId.get(id)
    // Guard duplicates too: an id listed twice must not clone the tab.
    if (tab && !taken.has(id)) {
      next.push(tab)
      taken.add(id)
    }
  }
  if (next.length === tabs.length) {
    // Every tab was accounted for, so nothing needs appending. Return the
    // original array when the order is also unchanged, so React can skip the
    // re-render - length alone is not enough, the order may still have moved.
    const unchanged = next.every((tab, i) => tabs[i] === tab)
    return unchanged ? tabs : next
  }
  for (const tab of tabs) {
    if (!taken.has(tab.pageId)) next.push(tab)
  }
  return next
}
