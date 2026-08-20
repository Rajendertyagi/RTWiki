import type {
  Page,
  CreatePageRequest,
  UpdatePageRequest
} from '@rtwiki/shared/contracts/pages'

const API_BASE = '/api'

interface ApiError {
  error: string
}

export interface PagesResult {
  pages: Page[]
  total: number
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

export async function createPage(
  request: CreatePageRequest,
  signal?: AbortSignal
): Promise<Page> {
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
