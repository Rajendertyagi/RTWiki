import { describe, expect, it } from 'bun:test'
import type { Page } from '@rtwiki/shared/contracts/pages'
import {
  buildForest,
  comparePages,
  forestToNodeData,
  parseSubfileKey,
  resolveDropMove,
  subfileKey
} from '../src/web/features/sidebar/wb-adapter.js'

function page(id: string, overrides: Partial<Page> = {}): Page {
  return {
    id,
    title: `Page ${id}`,
    pageType: 'rich',
    parentId: null,
    position: 0,
    content: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  } as Page
}

describe('subfile key identity', () => {
  it('round-trips and never collides with page UUID keys', () => {
    const pageId = '8f1c2b3a-1111-4222-8333-444455556666'
    for (const field of ['html', 'css', 'javascript'] as const) {
      const key = subfileKey(pageId, field)
      expect(parseSubfileKey(key)).toEqual({ pageId, field })
      // A subfile key must never LOOK like the page id (row identity).
      expect(key.startsWith(pageId)).toBe(false)
    }
  })

  it('rejects malformed keys', () => {
    const pageId = '8f1c2b3a-1111-4222-8333-444455556666'
    expect(parseSubfileKey(pageId)).toBeNull()
    expect(parseSubfileKey('subfile:bogus')).toBeNull()
    expect(parseSubfileKey(`${subfileKey(pageId, 'html')}:x`)).toBeNull()
    expect(parseSubfileKey(`subfile:${pageId}:`)).toBeNull()
  })
})

describe('comparePages ordering', () => {
  it('sorts by position, then title, then id', () => {
    const sorted = [
      page('b', { position: 1 }),
      page('a', { position: 1 }),
      page('z', { position: 0 }),
      page('a2', { position: 2 }),
      page('a1', { position: 2 })
    ].sort(comparePages)
    expect(sorted.map((p) => p.id)).toEqual(['z', 'a', 'b', 'a1', 'a2'])
  })
})

describe('buildForest', () => {
  it('nests children under parents in stable order', () => {
    const forest = buildForest([
      page('kid2', { parentId: 'p', position: 2 }),
      page('kid1', { parentId: 'p', position: 1 }),
      page('p', { position: 0 })
    ])
    expect(forest.length).toBe(1)
    expect(forest[0].page.id).toBe('p')
    expect(forest[0].children.map((n) => n.page.id)).toEqual(['kid1', 'kid2'])
  })

  it('promotes orphaned and cyclic pages to visible root rows', () => {
    const forest = buildForest([
      page('orphan', { parentId: 'missing-parent' }),
      page('c1', { parentId: 'c2' }),
      page('c2', { parentId: 'c1' })
    ])
    expect(forest.map((n) => n.page.id).sort()).toEqual(['c1', 'c2', 'orphan'])
  })
})

describe('forestToNodeData virtual group placement', () => {
  it('places the three subfiles first, real children after (Feature 2)', () => {
    const forest = buildForest([
      page('child1', { parentId: 'parent', position: 0 }),
      page('child2', { parentId: 'parent', position: 1 }),
      page('parent', { pageType: 'html', position: 0 })
    ])
    const data = forestToNodeData(forest, new Set(['parent']), 'Untitled')
    const parent = data.find((n) => n.key === 'parent')
    expect(parent?.children?.map((c) => c.key)).toEqual([
      subfileKey('parent', 'html'),
      subfileKey('parent', 'css'),
      subfileKey('parent', 'javascript'),
      'child1',
      'child2'
    ])
  })

  it('gives childless HTML pages the virtual group (always expandable)', () => {
    const forest = buildForest([page('solo', { pageType: 'html' })])
    const data = forestToNodeData(forest, new Set(['solo']), 'Untitled')
    expect(data[0].children?.map((c) => c.data.field)).toEqual(['html', 'css', 'javascript'])
    expect(data[0].children?.every((c) => c.data.kind === 'subfile')).toBe(true)
  })

  it('rich pages carry no virtual rows', () => {
    const forest = buildForest([page('rich1')])
    const data = forestToNodeData(forest, new Set(), 'Untitled')
    expect(data[0].children).toBeUndefined()
  })

  it('expansion flags and untitled labels are honoured', () => {
    const forest = buildForest([
      page('p', { position: 0 }),
      page('k', { parentId: 'p' }),
      page('u', { title: '', position: 1 })
    ])
    const data = forestToNodeData(forest, new Set(['p']), 'Untitled')
    const p = data.find((n) => n.key === 'p')
    expect(p?.expanded).toBe(true)
    expect(data.find((n) => n.key === 'u')?.title).toBe('Untitled')
  })
})

describe('resolveDropMove', () => {
  const pages = [
    page('a', { position: 0 }),
    page('b', { position: 1 }),
    page('c', { position: 2 }),
    page('parent', { position: 3 }),
    page('kid', { parentId: 'parent', position: 0 })
  ]
  const deps = { pages, isSelfOrDescendant: (): boolean => false }

  it('computes before/after indices after source removal', () => {
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'a', targetPageId: 'b', region: 'after' })
    ).toEqual({ pageId: 'a', newParentId: null, newPosition: 1 })
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'c', targetPageId: 'a', region: 'before' })
    ).toEqual({ pageId: 'c', newParentId: null, newPosition: 0 })
  })

  it('over appends at the end of the target parent', () => {
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'a', targetPageId: 'parent', region: 'over' })
    ).toEqual({ pageId: 'a', newParentId: 'parent', newPosition: null })
  })

  it('null target appends as the last root', () => {
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'kid', targetPageId: null, region: 'over' })
    ).toEqual({ pageId: 'kid', newParentId: null, newPosition: null })
  })

  it('rejects self and descendant targets', () => {
    const guarded = {
      pages,
      isSelfOrDescendant: (ancestor: string, candidate: string): boolean =>
        ancestor === candidate || (ancestor === 'parent' && candidate === 'kid')
    }
    expect(
      resolveDropMove({ ...guarded, sourcePageId: 'parent', targetPageId: 'kid', region: 'over' })
    ).toBeNull()
    expect(
      resolveDropMove({ ...guarded, sourcePageId: 'a', targetPageId: 'a', region: 'over' })
    ).toBeNull()
  })

  it('rejects unknown source or target pages', () => {
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'ghost', targetPageId: 'a', region: 'over' })
    ).toBeNull()
    expect(
      resolveDropMove({ ...deps, sourcePageId: 'a', targetPageId: 'ghost', region: 'over' })
    ).toBeNull()
  })

  it('moving into an HTML parent never lands inside the virtual group', () => {
    // The virtual group is not made of pages: an "over" drop on the HTML
    // parent appends after script.js by construction (append-at-end).
    const htmlPages = [
      page('h', { pageType: 'html' }),
      page('m', { position: 1 })
    ]
    const move = resolveDropMove({
      pages: htmlPages,
      isSelfOrDescendant: (): boolean => false,
      sourcePageId: 'm',
      targetPageId: 'h',
      region: 'over'
    })
    expect(move).toEqual({ pageId: 'm', newParentId: 'h', newPosition: null })
  })
})
