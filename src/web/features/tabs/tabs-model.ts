/**
 * Pure session-tab model for the workspace tab strip.
 *
 * Tabs are an in-session view of open pages: they never own data, they only
 * reference page ids and mirror display fields. All transitions are pure
 * functions so the behaviour is unit-testable without React.
 */

export interface OpenTab {
  pageId: string
  title: string
  pageType: 'rich' | 'html'
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
  page: { id: string; title: string; pageType: 'rich' | 'html' },
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
