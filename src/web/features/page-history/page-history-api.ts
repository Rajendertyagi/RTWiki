import type { RecoveryActor, RevisionCaptureKind } from '@rtwiki/shared/schemas/recovery'

/**
 * One revision as returned by `GET /api/pages/:id/revisions`.
 *
 * The field names mirror `RevisionSnapshot` in the page repository, which is
 * what the route serialises directly. Only the fields the panel displays are
 * described here; the snapshot payloads are intentionally left as opaque
 * strings because the panel never interprets them.
 */
export interface PageRevision {
  id: string
  pageId: string
  version: number
  title: string
  content: string
  pageType: string
  parentId: string | null
  position: number
  searchContent: string | null
  childrenSnapshot: string | null
  linksSnapshot: string | null
  captureKind: RevisionCaptureKind
  actor: RecoveryActor
  capturedAt: string
  createdAt: string
}

export type FetchRevisionsResult =
  | { ok: true; revisions: PageRevision[] }
  | { ok: false; status: number }

export type RestoreRevisionResult =
  | { ok: true }
  | { ok: false; status: number; code: string | null }

/**
 * Reads the machine-readable code beside the human message. A malformed or
 * non-JSON error body is not an excuse to guess: the caller still gets the
 * status and a null code, and falls back to the generic failure sentence.
 */
async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}

export async function fetchPageRevisions(pageId: string): Promise<FetchRevisionsResult> {
  try {
    const res = await fetch(`/api/pages/${encodeURIComponent(pageId)}/revisions`)
    if (!res.ok) return { ok: false, status: res.status }
    const data = (await res.json()) as { revisions: PageRevision[] }
    return { ok: true, revisions: data.revisions }
  } catch {
    return { ok: false, status: 0 }
  }
}

export async function restorePageRevision(
  pageId: string,
  revisionId: string
): Promise<RestoreRevisionResult> {
  try {
    const res = await fetch(
      `/api/pages/${encodeURIComponent(pageId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: 'POST' }
    )
    if (!res.ok) return { ok: false, status: res.status, code: await readErrorCode(res) }
    return { ok: true }
  } catch {
    return { ok: false, status: 0, code: null }
  }
}
