import { describe, expect, it } from 'bun:test'
import { UNSUPPORTED_BLOCK_MARKER } from '@rtwiki/shared/constants'
import {
  type BlockNoteDocument,
  containUnknownBlocks,
  isUnknownBlockPreserved,
  parseStoredDocument
} from '../src/web/features/rich-editor/document.js'
import { KNOWN_BLOCK_TYPES } from '../src/web/features/rich-editor/schema.js'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

function richPage(content: unknown): Parameters<typeof pagePreviewText>[0] {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Doc',
    pageType: 'rich',
    content: JSON.stringify(content),
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    version: 1
  } as never
}

describe('visual knowledge block schema', () => {
  it('knows the default blocks plus math, callout (and later diagram types)', () => {
    for (const type of [
      'paragraph',
      'heading',
      'quote',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'codeBlock',
      'table',
      'divider',
      'mathBlock',
      'callout'
    ]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true)
    }
  })

  it('keeps known blocks untouched during containment', () => {
    const doc: BlockNoteDocument = [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'hi', styles: {} }] },
      { id: 'b', type: 'mathBlock', content: 'x^2' }
    ]
    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    expect(out).toEqual(doc)
  })

  it('preserves unknown future blocks as readable JSON code blocks', () => {
    const foreign = { id: 'x', type: 'hologramBlock', props: { size: 3 }, content: [] }
    const doc: BlockNoteDocument = [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'keep', styles: {} }] },
      foreign
    ]
    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    expect(out.length).toBe(2)
    const preserved = out[1] as { type: string; content: string }
    expect(preserved.type).toBe('codeBlock')
    expect(isUnknownBlockPreserved(preserved.content)).toBe(true)
    // The original block JSON is recoverable from the preserved code block.
    expect(preserved.content).toContain('"hologramBlock"')
    expect(preserved.content).toContain('"size": 3')
  })

  it('legacy documents without any new blocks load byte-identically', () => {
    const legacy = [
      {
        id: 'a',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'T', styles: {} }]
      },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] }
    ]
    const parsed = parseStoredDocument(JSON.stringify(legacy))
    expect(parsed.status).toBe('ok')
    const contained = containUnknownBlocks(parsed.document ?? [], KNOWN_BLOCK_TYPES)
    expect(contained).toEqual(legacy)
  })
})

describe('search/preview extraction for visual knowledge blocks', () => {
  it('extracts readable callout text for the dashboard preview', () => {
    const text = pagePreviewText(
      richPage([
        {
          id: 'c1',
          type: 'callout',
          props: { variant: 'warning' },
          content: [{ type: 'text', text: 'Check the power supply', styles: {} }]
        }
      ])
    )
    expect(text).toContain('Check the power supply')
    expect(text).not.toContain('callout')
    expect(text).not.toContain('{')
  })

  it('never leaks serialized JSON or raw source into previews', () => {
    const text = pagePreviewText(
      richPage([
        { id: 'm', type: 'mathBlock', content: 'E=mc^2' },
        { id: 'd', type: 'diagram', content: 'graph TD\n A-->B' },
        { id: 'mm', type: 'mindMap', content: 'mindmap\n root((X))' },
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'text', text: 'visible prose', styles: {} }]
        }
      ])
    )
    expect(text).toContain('visible prose')
    expect(text).not.toContain('graph TD')
    expect(text).not.toContain('mindmap')
    expect(text).not.toContain('{')
  })
})

const FOREIGN_TYPE = 'hologramBlock'

/** The containment depth cap this test pins; a top-level block is depth 1. */
const CAP = 16

/** The code-block content a contained block must carry, marker stripped. */
function preservedContent(block: unknown): string {
  const content = (block as { content?: unknown } | null)?.content
  if (typeof content !== 'string' || !isUnknownBlockPreserved(content)) {
    throw new Error('expected a preservation code block')
  }
  return content
}

/** The original block object, recovered from a preservation code block. */
function preservedJson(block: unknown): unknown {
  return JSON.parse(preservedContent(block).slice(UNSUPPORTED_BLOCK_MARKER.length + 1)) as unknown
}

function childrenOf(block: Record<string, unknown>): Record<string, unknown>[] {
  const children = block.children
  return Array.isArray(children) ? (children as Record<string, unknown>[]) : []
}

function cellContentOf(table: Record<string, unknown>, row: number, cell: number): unknown[] {
  const content = table.content as { rows: { cells: { content: unknown[] }[] }[] }
  return content.rows[row].cells[cell].content
}

function tableWithCellContent(cellContent: unknown[]): Record<string, unknown> {
  return {
    id: 't1',
    type: 'table',
    content: {
      type: 'tableContent',
      columnWidths: [undefined],
      headerRows: 1,
      rows: [
        {
          cells: [
            {
              type: 'tableCell',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: cellContent
            }
          ]
        }
      ]
    },
    children: []
  }
}

function listItem(
  id: string,
  text: string,
  children: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    id,
    type: 'bulletListItem',
    content: [{ type: 'text', text, styles: {} }],
    children
  }
}

describe('recursive containment of unknown blocks', () => {
  const foreign = {
    id: 'holo-1',
    type: FOREIGN_TYPE,
    props: { size: 3 },
    content: []
  }

  it('contains an unknown block nested in a list item children', () => {
    const doc: BlockNoteDocument = [listItem('l1', 'Top', [listItem('l2', 'Nested', [foreign])])]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)

    const outer = childrenOf(out[0])[0]
    const inner = childrenOf(outer)[0]
    expect(inner.type).toBe('codeBlock')
    expect(preservedJson(inner)).toEqual(foreign)
  })

  it('contains an unknown block nested in a table cell', () => {
    const text = { type: 'text', text: 'Cell one', styles: {} }
    const doc: BlockNoteDocument = [tableWithCellContent([text, foreign])]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    const cell = cellContentOf(out[0], 0, 0)

    expect(cell.length).toBe(2)
    expect(cell[0]).toBe(text)
    expect((cell[1] as Record<string, unknown>).type).toBe('codeBlock')
    expect(preservedJson(cell[1])).toEqual(foreign)
  })

  it('contains an unknown block three or more levels deep across both nesting sites', () => {
    const table = tableWithCellContent([foreign])
    const doc: BlockNoteDocument = [
      listItem('l1', 'One', [listItem('l2', 'Two', [listItem('l3', 'Three', [table])])])
    ]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    const tableOut = childrenOf(childrenOf(childrenOf(out[0])[0])[0])[0]
    const cell = cellContentOf(tableOut, 0, 0)

    expect(cell.length).toBe(1)
    expect((cell[0] as Record<string, unknown>).type).toBe('codeBlock')
    expect(preservedJson(cell[0])).toEqual(foreign)
  })

  it('still contains unknown blocks at the top level', () => {
    const doc: BlockNoteDocument = [foreign, listItem('l1', 'keep', [])]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)

    expect(out.length).toBe(2)
    expect(out[0].type).toBe('codeBlock')
    expect(preservedContent(out[0])).toContain(UNSUPPORTED_BLOCK_MARKER)
    expect(preservedJson(out[0])).toEqual(foreign)
    expect(out[1]).toBe(doc[1])
  })

  it('preserves order and length for mixed known and unknown siblings', () => {
    const first = { id: 'f1', type: FOREIGN_TYPE, content: [] }
    const second = { id: 'f2', type: FOREIGN_TYPE, content: [] }
    const paragraph = {
      id: 'p1',
      type: 'paragraph',
      content: [{ type: 'text', text: 'prose', styles: {} }]
    }
    const heading = { id: 'h1', type: 'heading', props: { level: 2 }, content: [] }
    const doc: BlockNoteDocument = [
      paragraph,
      first,
      heading,
      listItem('l1', 'Nested', [{ id: 'f3', type: FOREIGN_TYPE, content: [] }]),
      second
    ]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)

    expect(out.length).toBe(5)
    expect(out[0]).toBe(paragraph)
    expect(out[1].type).toBe('codeBlock')
    expect(out[2]).toBe(heading)
    expect(out[3].type).toBe('bulletListItem')
    expect(childrenOf(out[3])[0].type).toBe('codeBlock')
    expect(out[4].type).toBe('codeBlock')
    expect(preservedJson(out[1])).toEqual(first)
    expect(preservedJson(out[4])).toEqual(second)
  })

  it('round-trips a contained block verbatim, nested children included', () => {
    const nested = {
      id: 'holo-2',
      type: `${FOREIGN_TYPE}Inner`,
      props: { depth: 2 },
      content: []
    }
    const rich = {
      id: 'holo-1',
      type: FOREIGN_TYPE,
      props: { size: 3, palette: ['red', 'blue'] },
      content: [],
      children: [nested]
    }
    const doc: BlockNoteDocument = [listItem('l1', 'Top', [rich])]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    const inner = childrenOf(out[0])[0]

    expect(preservedJson(inner)).toEqual(rich)
    expect(preservedContent(inner)).toContain('"palette"')
  })

  it('leaves a known block unaltered, including its inline content', () => {
    const inline = { type: 'text', text: 'hi', styles: {} }
    const doc: BlockNoteDocument = [{ id: 'p1', type: 'paragraph', content: [inline] }]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)

    expect(out[0]).toBe(doc[0])
    expect((out[0].content as unknown[])[0]).toBe(inline)
    expect(out).toEqual(doc)
  })

  it('replaces the block at the depth cap, preserving its whole subtree as JSON', () => {
    const byDepth: Record<string, unknown>[] = [{ id: 'holo', type: FOREIGN_TYPE, content: [] }]
    let node = byDepth[0]
    for (let index = 0; index < CAP + 4; index += 1) {
      node = listItem(`wrap-${index}`, `layer ${index}`, [node])
      byDepth.push(node)
    }
    byDepth.reverse()

    const out = containUnknownBlocks([byDepth[0]], KNOWN_BLOCK_TYPES)

    let current = out[0]
    for (let depth = 1; depth < CAP; depth += 1) {
      expect(current.type).toBe('bulletListItem')
      current = childrenOf(current)[0]
    }
    // The known block sitting exactly at the cap is contained, not descended into.
    expect(current.type).toBe('codeBlock')
    expect(preservedJson(current)).toEqual(byDepth[CAP - 1])
  })

  it('terminates on a document nested far beyond the cap', () => {
    let deep: Record<string, unknown> = { id: 'holo', type: FOREIGN_TYPE, content: [] }
    for (let index = 0; index < 1000; index += 1) {
      deep = listItem(`w${index}`, '', [deep])
    }

    const out = containUnknownBlocks([deep], KNOWN_BLOCK_TYPES)

    let current = out[0]
    for (let depth = 1; depth < CAP; depth += 1) {
      expect(current.type).toBe('bulletListItem')
      current = childrenOf(current)[0]
    }
    expect(current.type).toBe('codeBlock')
  })

  it('never rewrites inline content inside a table cell', () => {
    const text = { type: 'text', text: 'Cell one', styles: {} }
    const math = { type: 'math', content: 'x^2', props: {} }
    const link = { type: 'link', href: 'https://example.com', content: [] }
    const doc: BlockNoteDocument = [tableWithCellContent([text, math, link])]

    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    const cell = cellContentOf(out[0], 0, 0)

    expect(cell[0]).toBe(text)
    expect(cell[1]).toBe(math)
    expect(cell[2]).toBe(link)
  })

  it('does not mutate the input document', () => {
    const doc: BlockNoteDocument = [
      listItem('l1', 'Top', [foreign]),
      tableWithCellContent([foreign])
    ]
    const snapshot = structuredClone(doc)

    containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)

    expect(doc).toEqual(snapshot)
  })
})
