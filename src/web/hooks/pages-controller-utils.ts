import type { Page } from '@rtwiki/shared/contracts/pages'

/**
 * Pure helper: find the page to select after deleting a page.
 *
 * If the deleted page was the selected page, the caller should select null
 * (return to dashboard). If a different page was selected, keep it.
 */
export function findSelectionAfterDeletion(
  selectedPage: Page | null,
  deletedId: string
): Page | null {
  if (!selectedPage) return null
  if (selectedPage.id === deletedId) return null
  return selectedPage
}

/**
 * Pure helper: sync the selected page with the latest pages list.
 *
 * Returns the updated selected page, or null if it was removed.
 */
export function syncSelectionWithPages(selectedPage: Page | null, pages: Page[]): Page | null {
  if (!selectedPage) return null
  const found = pages.find((p) => p.id === selectedPage.id) ?? null
  return found
}

/**
 * Pure helper: find a page by ID in the pages list.
 */
export function findPageById(pages: Page[], id: string): Page | null {
  return pages.find((p) => p.id === id) ?? null
}

/**
 * Pure helper: filter pages by search query (title match, case-insensitive).
 */
export function filterPagesByQuery(pages: Page[], query: string): Page[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return pages
  return pages.filter((p) => p.title.toLowerCase().includes(trimmed))
}
