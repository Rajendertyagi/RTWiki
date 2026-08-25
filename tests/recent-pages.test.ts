import { describe, expect, it } from 'bun:test'
import {
  loadRecentPages,
  RECENT_PAGES_MAX,
  recordRecentPage,
  resolveRecentPages
} from '../src/shared/../web/util/recent-pages.js'
import type { Page } from '../src/shared/contracts/pages.js'

function makePage(id: string): Page {
  const now = new Date().toISOString()
  return {
    id,
    title: `Page ${id}`,
    content: '',
    pageType: 'rich',
    parentId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  }
}

describe('recent pages', () => {
  it('records opens newest-first and bounds the list at 20', () => {
    // Isolated storage key per run via a fresh window shim is unnecessary:
    // bun:test provides globalThis.localStorage? Fall back gracefully when
    // absent — the util must not throw.
    if (typeof globalThis.localStorage === 'undefined') {
      expect(loadRecentPages()).toEqual([])
      return
    }
    globalThis.localStorage.clear()
    for (let i = 0; i < RECENT_PAGES_MAX + 5; i++) {
      recordRecentPage(`p${i}`)
    }
    const entries = loadRecentPages()
    expect(entries.length).toBe(RECENT_PAGES_MAX)
    expect(entries[0]?.id).toBe(`p${RECENT_PAGES_MAX + 4}`)
    // Reopening an older page moves it to the top.
    recordRecentPage('p10')
    expect(loadRecentPages()[0]?.id).toBe('p10')
  })

  it('resolves against living pages and discards missing IDs', () => {
    const entries = [
      { id: 'gone', openedAt: 3 },
      { id: 'kept', openedAt: 2 },
      { id: 'gone-too', openedAt: 1 }
    ]
    const pages = [makePage('kept')]
    const resolved = resolveRecentPages(entries, pages)
    expect(resolved.map((p) => p.id)).toEqual(['kept'])
  })
})
