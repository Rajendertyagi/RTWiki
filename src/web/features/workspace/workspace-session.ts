import type { Page } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from '../../config/index.js'
import type { OpenTab } from '../tabs/tabs-model.js'

/**
 * Browser-refresh workspace restoration (session metadata only).
 *
 * Persisted payload: open page IDs (ordered), the active page ID, the active
 * HTML view (preview/html/css/javascript) and expanded tree row IDs. Note
 * CONTENT is never stored here — pending edits rely on normal autosave, and
 * everything else is re-read from the server on load.
 *
 * sessionStorage satisfies normal browser refresh: it survives reloads and
 * dies with the tab, so a reopened RTWiki starts clean at Home by design.
 */

export const WORKSPACE_SESSION_KEY = 'rtwiki.workspace.session'
export const WORKSPACE_SESSION_VERSION = 1

/** Bounded shape: a workspace cannot reasonably hold more rows than this. */
const MAX_OPEN_PAGE_IDS = 50
const MAX_EXPANDED_IDS = 200

export type WorkspaceSourceField = 'preview' | 'html' | 'css' | 'javascript'

export interface WorkspaceSessionState {
  version: typeof WORKSPACE_SESSION_VERSION
  openPageIds: string[]
  activePageId: string | null
  /** Active view for an HTML page; ignored for Rich Notes. */
  sourceField: WorkspaceSourceField
  expandedTreeIds: string[]
}

/** Minimal storage surface so tests can run without a browser. */
export interface WorkspaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/**
 * Parses and validates a stored session payload. Returns null for absent,
 * malformed, foreign-version or over-bounds data — restoration always fails
 * safe toward Home.
 */
export function parseWorkspaceSession(raw: string | null): WorkspaceSessionState | null {
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (json === null || typeof json !== 'object') return null
  const candidate = json as Record<string, unknown>
  if (candidate.version !== WORKSPACE_SESSION_VERSION) return null

  const openPageIds = Array.isArray(candidate.openPageIds)
    ? candidate.openPageIds.filter(isUuid).slice(0, MAX_OPEN_PAGE_IDS)
    : []
  const expandedTreeIds = Array.isArray(candidate.expandedTreeIds)
    ? candidate.expandedTreeIds.filter(isUuid).slice(0, MAX_EXPANDED_IDS)
    : []

  const activePageId =
    candidate.activePageId === null || candidate.activePageId === undefined
      ? null
      : isUuid(candidate.activePageId)
        ? candidate.activePageId
        : null

  const sourceField = (['preview', 'html', 'css', 'javascript'] as const).includes(
    candidate.sourceField as WorkspaceSourceField
  )
    ? (candidate.sourceField as WorkspaceSourceField)
    : 'preview'

  return {
    version: WORKSPACE_SESSION_VERSION,
    openPageIds,
    activePageId,
    sourceField,
    expandedTreeIds
  }
}

export function serializeWorkspaceSession(state: WorkspaceSessionState): string {
  return JSON.stringify({
    ...state,
    version: WORKSPACE_SESSION_VERSION,
    openPageIds: state.openPageIds.slice(0, MAX_OPEN_PAGE_IDS),
    expandedTreeIds: state.expandedTreeIds.slice(0, MAX_EXPANDED_IDS)
  })
}

/** Reads the session from storage; every failure degrades to null. */
export function loadWorkspaceSession(storage: WorkspaceStorage): WorkspaceSessionState | null {
  try {
    return parseWorkspaceSession(storage.getItem(WORKSPACE_SESSION_KEY))
  } catch {
    return null
  }
}

/** Writes the session to storage; storage failures are swallowed. */
export function saveWorkspaceSession(
  storage: WorkspaceStorage,
  state: WorkspaceSessionState
): void {
  try {
    storage.setItem(WORKSPACE_SESSION_KEY, serializeWorkspaceSession(state))
  } catch {
    // Persistence is best-effort metadata; never disturb editing.
  }
}

export interface RestorableWorkspace {
  tabs: OpenTab[]
  activePageId: string | null
  /** Source view to reopen; null when the active page is not an HTML page. */
  htmlSource: { pageId: string; field: 'html' | 'css' | 'javascript' } | null
  expandedTreeIds: string[]
}

/**
 * Resolves a stored session against freshly loaded pages: drops deleted or
 * missing IDs, rebuilds deduplicated tabs in their saved order, restores the
 * active page plus its HTML source/preview mode, and falls back safely when
 * nothing valid remains.
 */
export function resolveRestorableWorkspace(
  session: WorkspaceSessionState,
  pages: Page[]
): RestorableWorkspace | null {
  if (session.openPageIds.length === 0) return null
  const byId = new Map(pages.map((page) => [page.id, page]))

  const seen = new Set<string>()
  const tabs: OpenTab[] = []
  for (const id of session.openPageIds) {
    if (seen.has(id)) continue
    const page = byId.get(id)
    if (!page) continue
    seen.add(id)
    tabs.push({
      pageId: page.id,
      title: page.title || UI_TEXT.untitledPage,
      pageType: page.pageType
    })
  }
  if (tabs.length === 0) return null

  const activePageId =
    session.activePageId !== null && tabs.some((tab) => tab.pageId === session.activePageId)
      ? session.activePageId
      : tabs[0].pageId

  const activePage = byId.get(activePageId)
  const htmlSource =
    activePage && activePage.pageType === 'html' && session.sourceField !== 'preview'
      ? { pageId: activePage.id, field: session.sourceField }
      : null

  const expandedTreeIds = session.expandedTreeIds.filter((id) => byId.has(id))

  return { tabs, activePageId, htmlSource, expandedTreeIds }
}
