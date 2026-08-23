import { describe, expect, it } from 'bun:test'
import {
  closeInTabs,
  findTab,
  type OpenTab,
  openInTabs,
  removeFromTabs,
  renameInTabs
} from '../src/web/features/tabs/tabs-model.js'

const UNTITLED = 'Untitled'

function tab(id: string, title = id): OpenTab {
  return { pageId: id, title, pageType: 'rich' }
}

describe('openInTabs', () => {
  it('appends a new tab for a page that is not open', () => {
    const tabs = openInTabs([tab('a')], { id: 'b', title: 'B', pageType: 'rich' }, UNTITLED)
    expect(tabs.map((t) => t.pageId)).toEqual(['a', 'b'])
  })

  it('does not duplicate an already-open page', () => {
    const before = [tab('a'), tab('b')]
    const after = openInTabs(before, { id: 'a', title: 'A2', pageType: 'rich' }, UNTITLED)
    expect(after).toBe(before)
  })

  it('uses the untitled label for blank titles', () => {
    const tabs = openInTabs([], { id: 'n', title: '', pageType: 'html' }, UNTITLED)
    expect(tabs[0].title).toBe(UNTITLED)
    expect(tabs[0].pageType).toBe('html')
  })
})

describe('closeInTabs', () => {
  const three = [tab('a'), tab('b'), tab('c')]

  it('closes a background tab and keeps the active one', () => {
    const result = closeInTabs(three, 'a', 'c')
    expect(result.tabs.map((t) => t.pageId)).toEqual(['b', 'c'])
    expect(result.activatePageId).toBe('c')
  })

  it('activates the right neighbour when closing the active tab', () => {
    const result = closeInTabs(three, 'b', 'b')
    expect(result.tabs.map((t) => t.pageId)).toEqual(['a', 'c'])
    expect(result.activatePageId).toBe('c')
  })

  it('falls back to the left neighbour when the active tab is last', () => {
    const result = closeInTabs(three, 'c', 'c')
    expect(result.activatePageId).toBe('b')
  })

  it('returns null activation when the final tab closes', () => {
    const result = closeInTabs([tab('only')], 'only', 'only')
    expect(result.tabs).toEqual([])
    expect(result.activatePageId).toBeNull()
  })

  it('is a no-op for an unknown tab', () => {
    const result = closeInTabs(three, 'zzz', 'b')
    expect(result.tabs).toEqual(three)
    expect(result.activatePageId).toBe('b')
  })
})

describe('rename and remove', () => {
  it('renames the matching tab and applies the untitled label to blanks', () => {
    const tabs = renameInTabs([tab('a', 'Old'), tab('b')], 'a', '', UNTITLED)
    expect(tabs[0].title).toBe(UNTITLED)
    expect(tabs[1].title).toBe('b')
  })

  it('removes deleted pages from the strip', () => {
    const tabs = removeFromTabs([tab('a'), tab('b'), tab('c')], new Set(['a', 'c']))
    expect(tabs.map((t) => t.pageId)).toEqual(['b'])
  })
})

describe('findTab', () => {
  it('finds by id', () => {
    expect(findTab([tab('x')], 'x')?.title).toBe('x')
    expect(findTab([tab('x')], 'y')).toBeUndefined()
  })
})
