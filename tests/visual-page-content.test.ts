import { describe, expect, it } from 'bun:test'
import {
  createStarterVisualContent,
  MAX_VISUAL_PAGE_BLOCKS,
  parseVisualPageContent,
  serializeVisualPageBlocks
} from '../src/shared/schemas/visual-page-content.js'

/** A minimal, valid 1x1 PNG header block is irrelevant here; sources are opaque. */

describe('visual page content', () => {
  it('reads a v1 single-source page as a one-block page', () => {
    // The whole reason there is no data migration: an existing page keeps
    // working, it simply reads as a page with a single diagram on it.
    const stored = JSON.stringify({ version: 1, type: 'diagram', source: 'graph TD\n A-->B' })
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.type).toBe('diagram')
    expect(parsed.value.blocks).toHaveLength(1)
    expect(parsed.value.blocks[0].source).toBe('graph TD\n A-->B')
    expect(parsed.value.blocks[0].id).toBe('main')
  })

  it('reads a v2 page as its ordered blocks', () => {
    const stored = serializeVisualPageBlocks('diagram', [
      { id: 'a', source: 'mindmap\n root((One))' },
      { id: 'b', source: 'mindmap\n root((Two))' },
      { id: 'c', source: 'mindmap\n root((Three))' }
    ])
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // Order is the author's order, and it is what reordering rewrites.
    expect(parsed.value.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c'])
    expect(parsed.value.type).toBe('diagram')
  })

  // The Mind Map page is retired, but a stored page records its own type inside
  // its JSON, independently of the `pages.page_type` column that migration 010
  // rewrites. Rejecting that marker would make a migrated page's content
  // unreadable, so it is accepted and reported as the page type that replaced it.
  it('reads a retired mindmap page as a diagram, blocks and all', () => {
    const stored = JSON.stringify({
      version: 2,
      type: 'mindmap',
      blocks: [{ id: 'a', source: 'mindmap\n  root((One))' }]
    })
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.type).toBe('diagram')
    expect(parsed.value.blocks).toHaveLength(1)
    expect(parsed.value.blocks[0].source).toBe('mindmap\n  root((One))')
  })

  it('reads a retired v1 mindmap page too', () => {
    const stored = JSON.stringify({ version: 1, type: 'mindmap', source: 'mindmap\n  root((Old))' })
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.type).toBe('diagram')
    expect(parsed.value.blocks).toEqual([{ id: 'main', source: 'mindmap\n  root((Old))' }])
  })

  it('still rejects an unknown type marker', () => {
    const stored = JSON.stringify({
      version: 2,
      type: 'something-else',
      blocks: [{ id: 'a', source: 'x' }]
    })
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok).toBe(false)
  })

  it('writes v2 and round-trips', () => {
    const blocks = [{ id: 'x', source: 'graph TD\n A-->B' }]
    const stored = serializeVisualPageBlocks('diagram', blocks)
    expect(JSON.parse(stored).version).toBe(2)
    const parsed = parseVisualPageContent(stored)
    expect(parsed.ok && parsed.value.blocks).toEqual(blocks)
  })

  it('starts a new page with one block, already in v2', () => {
    const parsed = parseVisualPageContent(createStarterVisualContent())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.blocks).toHaveLength(1)
    expect(parsed.value.blocks[0].source.length).toBeGreaterThan(0)
  })

  it('refuses a page with no blocks rather than rendering nothing', () => {
    // An empty diagram page is indistinguishable from a broken one, so it is
    // rejected at the boundary instead of being saved.
    const stored = JSON.stringify({ version: 2, type: 'diagram', blocks: [] })
    expect(parseVisualPageContent(stored).ok).toBe(false)
  })

  it('refuses more blocks than the cap allows', () => {
    const tooMany = Array.from({ length: MAX_VISUAL_PAGE_BLOCKS + 1 }, (_, i) => ({
      id: `b${i}`,
      source: 'graph TD\n A-->B'
    }))
    const stored = JSON.stringify({ version: 2, type: 'diagram', blocks: tooMany })
    expect(parseVisualPageContent(stored).ok).toBe(false)
  })

  it('caps what it will serialise, so a caller cannot exceed the cap', () => {
    const tooMany = Array.from({ length: MAX_VISUAL_PAGE_BLOCKS + 5 }, (_, i) => ({
      id: `b${i}`,
      source: 'graph TD\n A-->B'
    }))
    const stored = serializeVisualPageBlocks('diagram', tooMany)
    expect(JSON.parse(stored).blocks).toHaveLength(MAX_VISUAL_PAGE_BLOCKS)
  })

  it('contains malformed content instead of throwing', () => {
    expect(parseVisualPageContent('').ok).toBe(false)
    expect(parseVisualPageContent('   ').ok).toBe(false)
    expect(parseVisualPageContent('{broken').ok).toBe(false)
    expect(parseVisualPageContent('null').ok).toBe(false)
    expect(parseVisualPageContent('[]').ok).toBe(false)
    expect(parseVisualPageContent(JSON.stringify({ version: 9, type: 'diagram' })).ok).toBe(false)
  })

  it('rejects a block with no id, which would be unkeyable', () => {
    const stored = JSON.stringify({
      version: 2,
      type: 'diagram',
      blocks: [{ source: 'graph TD\n A-->B' }]
    })
    expect(parseVisualPageContent(stored).ok).toBe(false)
  })
})
