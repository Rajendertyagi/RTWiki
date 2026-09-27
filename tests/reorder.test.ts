import { describe, expect, it } from 'bun:test'
import { reorderByIds } from '../src/web/util/reorder.js'

interface Item {
  id: string
  label: string
}

const idOf = (item: Item): string => item.id

const ABC: Item[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' }
]

describe('reorderByIds', () => {
  it('applies a new order', () => {
    expect(reorderByIds(ABC, ['c', 'a', 'b'], idOf).map(idOf)).toEqual(['c', 'a', 'b'])
  })

  it('returns the same array when nothing moved, so React can skip the render', () => {
    // Re-rendering a workspace means re-rendering every diagram in it.
    expect(reorderByIds(ABC, ['a', 'b', 'c'], idOf)).toBe(ABC)
  })

  it('returns a new array when only the order changed', () => {
    // Length alone must not be used to decide this: same items, new order.
    const result = reorderByIds(ABC, ['b', 'a', 'c'], idOf)
    expect(result).not.toBe(ABC)
    expect(result.map(idOf)).toEqual(['b', 'a', 'c'])
  })

  it('appends what the caller left out instead of dropping it', () => {
    // The failure this prevents is silent data loss, so it is the important case:
    // a partial or stale list must never discard an item.
    expect(reorderByIds(ABC, ['c'], idOf).map(idOf)).toEqual(['c', 'a', 'b'])
    expect(reorderByIds(ABC, [], idOf).map(idOf)).toEqual(['a', 'b', 'c'])
  })

  it('never clones an item when an id is listed twice', () => {
    const result = reorderByIds(ABC, ['a', 'a', 'b', 'c'], idOf)
    expect(result.map(idOf)).toEqual(['a', 'b', 'c'])
    expect(result).toHaveLength(3)
  })

  it('ignores an id that is not present', () => {
    expect(reorderByIds(ABC, ['b', 'ghost', 'a', 'c'], idOf).map(idOf)).toEqual(['b', 'a', 'c'])
  })

  it('handles an empty list and a single item', () => {
    expect(reorderByIds([], [], idOf)).toEqual([])
    const one: Item[] = [{ id: 'only', label: 'Only' }]
    expect(reorderByIds(one, ['only'], idOf)).toBe(one)
    expect(reorderByIds(one, [], idOf).map(idOf)).toEqual(['only'])
  })
})
