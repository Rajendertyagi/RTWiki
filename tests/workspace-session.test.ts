import { describe, expect, it } from 'bun:test'
import type { Page } from '../src/shared/contracts/pages.js'
import {
  parseWorkspaceSession,
  resolveRestorableWorkspace,
  serializeWorkspaceSession,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSessionState
} from '../src/web/features/workspace/workspace-session.js'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const ID_C = '33333333-3333-4333-8333-333333333333'

function page(id: string, pageType: 'rich' | 'html'): Page {
  return {
    id,
    title: `Page ${id.slice(0, 4)}`,
    pageType,
    content: '',
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null
  } as unknown as Page
}

function validState(): WorkspaceSessionState {
  return {
    version: WORKSPACE_SESSION_VERSION,
    openPageIds: [ID_A, ID_B],
    activePageId: ID_B,
    sourceField: 'preview',
    expandedTreeIds: [ID_A]
  }
}

describe('workspace session model', () => {
  it('round-trips a valid state', () => {
    const parsed = parseWorkspaceSession(serializeWorkspaceSession(validState()))
    expect(parsed).toEqual(validState())
  })

  it('returns null for absent or malformed payloads', () => {
    expect(parseWorkspaceSession(null)).toBeNull()
    expect(parseWorkspaceSession('')).toBeNull()
    expect(parseWorkspaceSession('{broken')).toBeNull()
    expect(parseWorkspaceSession('42')).toBeNull()
  })

  it('rejects foreign versions and unknown fields cannot leak in', () => {
    const foreign = JSON.stringify({ ...validState(), version: 99 })
    expect(parseWorkspaceSession(foreign)).toBeNull()

    // Extra fields are simply ignored by the parser (it reads known keys),
    // but their values must never appear in the parsed result.
    const extra = JSON.stringify({ ...validState(), pageTitle: 'SECRET', dom: '<svg>' })
    const parsed = parseWorkspaceSession(extra)
    expect(parsed).toEqual(validState())
    expect(JSON.stringify(parsed)).not.toContain('SECRET')
  })

  it('filters non-UUID ids and clamps oversized lists', () => {
    const raw = JSON.stringify({
      ...validState(),
      openPageIds: ['not-a-uuid', ID_A, '../etc/passwd', ID_B],
      expandedTreeIds: Array.from({ length: 500 }, () => ID_C)
    })
    const parsed = parseWorkspaceSession(raw)
    expect(parsed?.openPageIds).toEqual([ID_A, ID_B])
    expect(parsed?.expandedTreeIds.length).toBeLessThanOrEqual(200)
  })

  it('resolve drops missing pages and preserves saved tab order', () => {
    const session = { ...validState(), openPageIds: [ID_C, ID_A, ID_B], activePageId: ID_A }
    const resolved = resolveRestorableWorkspace(session, [page(ID_A, 'rich'), page(ID_B, 'html')])
    expect(resolved?.tabs.map((t) => t.pageId)).toEqual([ID_A, ID_B])
    expect(resolved?.activePageId).toBe(ID_A)
  })

  it('resolve restores the HTML source view only for html pages', () => {
    const htmlSession = { ...validState(), activePageId: ID_B, sourceField: 'css' as const }
    const resolvedHtml = resolveRestorableWorkspace(htmlSession, [
      page(ID_A, 'rich'),
      page(ID_B, 'html')
    ])
    expect(resolvedHtml?.htmlSource).toEqual({ pageId: ID_B, field: 'css' })

    const richSession = { ...validState(), activePageId: ID_A, sourceField: 'javascript' as const }
    const resolvedRich = resolveRestorableWorkspace(richSession, [
      page(ID_A, 'rich'),
      page(ID_B, 'html')
    ])
    expect(resolvedRich?.htmlSource).toBeNull()
  })

  it('falls back to the first surviving tab when the active page vanished', () => {
    const session = { ...validState(), activePageId: ID_C }
    const resolved = resolveRestorableWorkspace(session, [page(ID_A, 'rich'), page(ID_B, 'rich')])
    expect(resolved?.activePageId).toBe(ID_A)
  })

  it('returns null when nothing valid remains (Home fallback)', () => {
    expect(resolveRestorableWorkspace(validState(), [])).toBeNull()
    expect(
      resolveRestorableWorkspace({ ...validState(), openPageIds: [] }, [page(ID_A, 'rich')])
    ).toBeNull()
  })

  it('deduplicates repeated ids while rebuilding tabs', () => {
    const session = { ...validState(), openPageIds: [ID_A, ID_A, ID_B] }
    const resolved = resolveRestorableWorkspace(session, [page(ID_A, 'rich'), page(ID_B, 'html')])
    expect(resolved?.tabs.length).toBe(2)
  })
})
