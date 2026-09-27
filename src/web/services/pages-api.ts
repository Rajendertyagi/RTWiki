import type { CreatePageRequest, Page, UpdatePageRequest } from '@rtwiki/shared/contracts/pages'

const API_BASE = '/api'

interface ApiError {
  error: string
}

/**
 * The page version this client last observed, per page, and the pages whose
 * write the server has already refused as stale.
 *
 * Both are module state, not a cache the caller has to remember to keep
 * correct: every `Page` this module returns flows through `observePage`, and no
 * other code path can write one. Two tabs get two independent registries, which
 * is exactly what makes the conflict detectable.
 */
const observedVersions = new Map<string, number>()
const conflictedPages = new Map<string, number>()

/**
 * A write was rejected because the stored page version had moved on. Distinct
 * from every other failure so a caller can tell "this page changed elsewhere"
 * apart from "the network is down" — the two need opposite responses.
 */
export class PageVersionConflictError extends Error {
  /** The HTTP status that produced this error, so callers can branch on it. */
  readonly status = 409

  constructor(
    readonly pageId: string,
    /** The version this client offered; the stored one had already moved on. */
    readonly offeredVersion: number,
    message: string
  ) {
    super(message)
    this.name = 'PageVersionConflictError'
  }
}

const CONFLICT_FALLBACK_MESSAGE = 'This page was changed elsewhere, so your changes were not saved.'

/**
 * Records the version a page was last seen at. A page that has already been
 * refused is never re-baselined: a background list refresh would otherwise
 * quietly teach this client the other tab's version and the next autosave would
 * overwrite it — the very last-write-wins behaviour this guard exists to stop.
 * Only a page reload, which re-reads the content too, starts over.
 */
function observePage(page: Page): void {
  if (conflictedPages.has(page.id)) return
  observedVersions.set(page.id, page.version)
}

/** Server error text, or `fallback` when the body is missing or not JSON. */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ApiError
    return body.error || fallback
  } catch {
    return fallback
  }
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
  const result = (await res.json()) as PagesResult
  for (const page of result.pages) {
    observePage(page)
  }
  return result
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
  observePage(data.page)
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
  const reconciliation = (await res.json()) as MoveReconciliation
  // A cross-parent move bumps the page version, so the moved page carries the
  // new baseline this client must write against.
  observePage(reconciliation.page)
  return reconciliation
}

/**
 * Persists an edit, guarded by the page version this client last read.
 *
 * The server applies the write only if that version is still current and
 * answers 409 otherwise. A 409 is handled here rather than passed on as a
 * generic failure, because the two need opposite responses:
 *
 * - The page is latched. No further write for it is attempted — not even with
 *   the newer version, which would be last-write-wins with extra steps — so a
 *   caller that retries in a loop cannot overwrite anything.
 * - The conflict is thrown as a `PageVersionConflictError` carrying the page id
 *   and the server's own wording, so the caller can tell the user what
 *   happened. Nothing about the caller's content is touched here: the pending
 *   text stays exactly where it is (in the editor, and in the autosave
 *   controller's pending snapshot) for the user to copy before reloading.
 * - Recovery is a page reload, which re-reads the content as well as the
 *   version. The latch is deliberately not cleared by a list refresh, because
 *   that would silently re-adopt the other tab's version.
 *
 * With no version observed for the page there is no baseline to write against,
 * and a read-then-write would be exactly the blind overwrite this guards
 * against, so the write is refused before any request is made.
 */
export async function updatePage(
  id: string,
  request: UpdatePageRequest,
  signal?: AbortSignal
): Promise<Page> {
  const conflictedVersion = conflictedPages.get(id)
  if (conflictedVersion !== undefined) {
    throw new PageVersionConflictError(id, conflictedVersion, CONFLICT_FALLBACK_MESSAGE)
  }

  const version = request.version ?? observedVersions.get(id)
  if (version === undefined) {
    throw new Error(
      'This page cannot be saved because its version is unknown here. Reload the page and try again.'
    )
  }

  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, version }),
    signal
  })

  if (res.status === 409) {
    const message = await readErrorMessage(res, CONFLICT_FALLBACK_MESSAGE)
    conflictedPages.set(id, version)
    throw new PageVersionConflictError(id, version, message)
  }
  if (!res.ok) {
    const message = await readErrorMessage(res, `Failed to update page (${res.status})`)
    throw new Error(message)
  }
  const data = (await res.json()) as { page: Page }
  observePage(data.page)
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
  observePage(data.page)
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
/**
 * Lists living pages that `pageId` links to (outgoing ID-based relationships
 * from the maintained page_links index).
 */
export async function getOutgoingLinks(
  pageId: string,
  signal?: AbortSignal
): Promise<Array<{ id: string; title: string; snippet: string | null }>> {
  const res = await fetch(`${API_BASE}/pages/${encodeURIComponent(pageId)}/links`, { signal })
  if (!res.ok) {
    throw new Error(`Outgoing links request failed (${res.status})`)
  }
  const body = (await res.json()) as {
    links: Array<{ id: string; title: string; snippet: string | null }>
  }
  return body.links
}
