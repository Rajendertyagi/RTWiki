import { describe, expect, test } from 'bun:test'
import { moveInTabs, type OpenTab, reorderInTabs } from '../src/web/features/tabs/tabs-model.js'

function tabs(...ids: string[]): OpenTab[] {
  return ids.map((id) => ({ pageId: id, title: id.toUpperCase(), pageType: 'rich' as const }))
}

const ids = (list: OpenTab[]): string[] => list.map((tab) => tab.pageId)

describe('moveInTabs', () => {
  test('moves a tab forwards, shifting the ones it passes', () => {
    expect(ids(moveInTabs(tabs('a', 'b', 'c', 'd'), 0, 2))).toEqual(['b', 'c', 'a', 'd'])
  })

  test('moves a tab backwards, shifting the ones it passes', () => {
    expect(ids(moveInTabs(tabs('a', 'b', 'c', 'd'), 3, 1))).toEqual(['a', 'd', 'b', 'c'])
  })

  test('moving to the last position puts it at the end', () => {
    expect(ids(moveInTabs(tabs('a', 'b', 'c'), 0, 2))).toEqual(['b', 'c', 'a'])
  })

  test('moving to the first position puts it at the front', () => {
    expect(ids(moveInTabs(tabs('a', 'b', 'c'), 2, 0))).toEqual(['c', 'a', 'b'])
  })

  test('a no-op returns the same array reference so React can skip the render', () => {
    const original = tabs('a', 'b', 'c')
    expect(moveInTabs(original, 1, 1)).toBe(original)
  })

  test('out-of-range indices are ignored rather than throwing', () => {
    // Indices come from measured pointer positions and from key repeat, so a
    // stale one must not be able to corrupt the order.
    const original = tabs('a', 'b', 'c')
    for (const [from, to] of [
      [-1, 0],
      [0, -1],
      [3, 0],
      [0, 3],
      [99, 99]
    ] as const) {
      expect(moveInTabs(original, from, to)).toBe(original)
    }
  })

  test('does not mutate the input', () => {
    const original = tabs('a', 'b', 'c')
    moveInTabs(original, 0, 2)
    expect(ids(original)).toEqual(['a', 'b', 'c'])
  })

  test('a single tab cannot be moved', () => {
    const single = tabs('a')
    expect(moveInTabs(single, 0, 0)).toBe(single)
  })

  test('an empty list is safe', () => {
    const empty: OpenTab[] = []
    expect(moveInTabs(empty, 0, 0)).toBe(empty)
  })
})

describe('reorderInTabs', () => {
  test('applies a wholly new order', () => {
    expect(ids(reorderInTabs(tabs('a', 'b', 'c', 'd'), ['b', 'c', 'd', 'a']))).toEqual([
      'b',
      'c',
      'd',
      'a'
    ])
  })

  test('a partial list keeps the omitted tabs, in their existing order', () => {
    // A drag that reports only the visible subset must never silently discard
    // an open tab.
    expect(ids(reorderInTabs(tabs('a', 'b', 'c', 'd'), ['d', 'a']))).toEqual(['d', 'a', 'b', 'c'])
  })

  test('unknown ids are ignored', () => {
    expect(ids(reorderInTabs(tabs('a', 'b'), ['zzz', 'b', 'a']))).toEqual(['b', 'a'])
  })

  test('a duplicated id does not clone the tab', () => {
    const result = reorderInTabs(tabs('a', 'b', 'c'), ['a', 'a', 'b', 'c'])
    expect(ids(result)).toEqual(['a', 'b', 'c'])
  })

  test('an empty list leaves the order untouched', () => {
    expect(ids(reorderInTabs(tabs('a', 'b'), []))).toEqual(['a', 'b'])
  })

  test('an already-correct order returns the same reference', () => {
    const original = tabs('a', 'b', 'c')
    expect(reorderInTabs(original, ['a', 'b', 'c'])).toBe(original)
  })

  test('does not mutate the input', () => {
    const original = tabs('a', 'b', 'c')
    reorderInTabs(original, ['c', 'b', 'a'])
    expect(ids(original)).toEqual(['a', 'b', 'c'])
  })
})
