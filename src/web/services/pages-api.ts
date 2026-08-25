import type { CreatePageRequest, Page, UpdatePageRequest } from '@rtwiki/shared/contracts/pages'

const API_BASE = '/api'

interface ApiError {
  error: string
}

export interface PagesResult {
  pages: Page[]
  total: number
}

/**
 * Batch size for complete-collection retrieval. Matches the API's default
 * page window so each request is a normal, cacheable list call.
 */
export const PAGE_LIST_BATCH_LIMIT = 50

/**
 * Retrieves the complete living-page collection through successive bounded
 * windows of the existing paginated list endpoint.
 *
 * Safety properties:
 * - Batches are accumulated locally and published only on full success, so a
 *   failed later batch can never replace state with a partial collection.
 * - A seen-ID set drops duplicates if rows shift across window boundaries.
 * - The offset advances by the number of rows actually received, which stays
 *   correct even when rows are created or deleted mid-pagination.
 * - The loop bound is derived from the server-reported total (plus one batch
 *   of slack for concurrent inserts), so pagination always terminates.
 */
export async function listAllPages(signal?: AbortSignal): Promise<PagesResult> {
  const collected: Page[] = []
  const seenIds = new Set<string>()
  let offset = 0
  // Covers collections up to one full batch before the first response sizes
  // the bound from the authoritative total.
  let remainingBatches = 2

  while (remainingBatches > 0) {
    remainingBatches -= 1
    const result = await listPages(signal, { limit: PAGE_LIST_BATCH_LIMIT, offset })

    for (const page of result.pages) {
      if (!seenIds.has(page.id)) {
        seenIds.add(page.id)
        collected.push(page)
      }
    }

    // A short batch is the definitive end-of-collection signal; the reported
    // total ending the loop early is the equivalent optimization.
    if (result.pages.length < PAGE_LIST_BATCH_LIMIT || collected.length >= result.total) {
      return { pages: collected, total: collected.length }
    }

    offset += result.pages.length
    // One extra batch of slack absorbs rows inserted mid-pagination.
    const outstanding = Math.max(0, result.total - collected.length)
    remainingBatches = Math.ceil(outstanding / PAGE_LIST_BATCH_LIMIT) + 1
  }

  throw new Error('Failed to load the complete page list')
}

export async function listPages(
  signal: AbortSignal | undefined,
  params?: { q?: string; limit?: number; offset?: number }
): Promise<PagesResult> {
  const query = new URLSearchParams()
  if (params?.q) query.set('q', params.q)
  if (params?.limit) query.set('limit', String(params.limit))
  if (params?.offset) query.set('offset', String(params.offset))
  const qs = query.toString()
  const url = `${API_BASE}/pages${qs ? `?${qs}` : ''}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to list pages (${res.status})`)
  }
  return (await res.json()) as PagesResult
}

export async function createPage(request: CreatePageRequest, signal?: AbortSignal): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to create page (${res.status})`)
  }
  const data = (await res.json()) as { page: Page }
  return data.page
}

export interface MovePageRequest {
  newParentId: string | null
  newPosition: number
}

export interface MoveReconciliation {
  /** The authoritative moved-page snapshot under the server's `page` key. */
  page: Page
  originParentId: string | null
  originSiblings: Array<{ id: string; position: number }>
  destinationParentId: string | null
  destinationSiblings: Array<{ id: string; position: number }>
}

export async function movePage(
  id: string,
  request: MovePageRequest,
  signal?: AbortSignal
): Promise<MoveReconciliation> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to move page (${res.status})`)
  }
  return (await res.json()) as MoveReconciliation
}

export async function updatePage(
  id: string,
  request: UpdatePageRequest,
  signal?: AbortSignal
): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to update page (${res.status})`)
  }
  const data = (await res.json()) as { page: Page }
  return data.page
}

export async function duplicatePage(id: string, signal?: AbortSignal): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    signal
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to duplicate page (${res.status})`)
  }
  const data = (await res.json()) as { page: Page }
  return data.page
}

export async function deletePage(id: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal
  })
  if (!res.ok) {
    const body = (await res.json()) as ApiError
    throw new Error(body.error || `Failed to delete page (${res.status})`)
  }
}
/**
 * Lists living pages whose Rich Note content links to `pageId` (exact
 * ID-based relationships from the maintained page_links index).
 */
export async function getBacklinks(
  pageId: string,
  signal?: AbortSignal
): Promise<Array<{ id: string; title: string; snippet: string | null }>> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(pageId)}/backlinks`, { signal })
  if (!res.ok) {
    throw new Error(`Backlinks request failed (${res.status})`)
  }
  const body = (await res.json()) as {
    backlinks: Array<{ id: string; title: string; snippet: string | null }>
  }
  return body.backlinks
}
