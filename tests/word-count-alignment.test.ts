import { describe, expect, it } from 'bun:test'
import { extractSearchableRich } from '../src/server/services/search-extraction.js'
import { UNSUPPORTED_BLOCK_MARKER } from '../src/shared/constants/index.js'
import {
  PREVIEW_MAX_BLOCK_DEPTH,
  pagePreviewText,
  richBlocksPlainText
} from '../src/web/util/page-preview-text.js'

/**
 * The word count that runs on every keystroke (`countBlockWords` in
 * `rich-editor.tsx`) was the third convention: it read only top-level blocks'
 * inline content, so a word typed in a sub-list or a table cell counted there but
 * not in the status bar for the same page.
 *
 * It now calls `richBlocksPlainText`, the same reduction the dashboard card and
 * the status bar use. What matters is not the arithmetic — it is that all three
 * consumers now answer the same question the same way, so the status bar cannot
 * contradict the card.
 *
 * `countBlockWords` itself is module-private inside a React component and is not
 * exported, so these tests pin the exported reduction it delegates to, plus the
 * agreement with the other two consumers. `tests/rich-editor-word-count.test.ts`
 * covers the count arithmetic through the real component path.
 */

const textNode = (text: string): unknown => ({ type: 'text', text, styles: {} })

function table(rows: string[][]): unknown {
  return {
    type: 'table',
    props: { textColor: 'default' },
    content: {
      type: 'tableContent',
      columnWidths: rows.map(() => 200),
      headerRows: 1,
      rows: rows.map((cells) => ({
        cells: cells.map((text) => ({
          type: 'tableCell',
          props: { textColor: 'default' },
          content: [textNode(text)]
        }))
      }))
    },
    children: []
  }
}

const wordsIn = (blocks: unknown): number => {
  const text = richBlocksPlainText(blocks)
  if (text.length === 0) return 0
  const matches = text.match(/\S+/g)
  return matches ? matches.length : 0
}

describe('the word count now counts what the card and the status bar count', () => {
  it('counts text nested inside a sub-list, which the old walk missed', () => {
    // The old walk read top-level inline content only, so the three nested words
    // were invisible to it while the status bar counted them.
    const blocks = [
      {
        type: 'bulletListItem',
        props: {},
        content: [textNode('top one')],
        children: [
          {
            type: 'bulletListItem',
            props: {},
            content: [textNode('nested alpha beta')],
            children: []
          }
        ]
      }
    ]
    expect(wordsIn(blocks)).toBe(5)
    expect(richBlocksPlainText(blocks)).toBe('top one nested alpha beta')
  })

  it('counts table cell text, which the old walk missed entirely', () => {
    const blocks = [
      table([
        ['Header A', 'Header B'],
        ['Cell one', 'Cell two']
      ])
    ]
    // "Header A", "Header B", "Cell one", "Cell two" — two words each.
    expect(wordsIn(blocks)).toBe(8)
  })

  it('counts an image caption, and never the URL', () => {
    const blocks = [
      {
        id: 'i1',
        type: 'image',
        props: { url: '/api/attachments/abc', caption: 'Revenue by quarter' },
        children: []
      }
    ]
    expect(wordsIn(blocks)).toBe(3)
    expect(richBlocksPlainText(blocks)).not.toContain('attachments')
  })

  it('withholds formula source, matching the other two consumers', () => {
    const blocks = [
      { type: 'paragraph', props: {}, content: [textNode('Visible prose.')], children: [] },
      { id: 'm1', type: 'mathBlock', props: {}, content: 'E=mc^2', children: [] }
    ]
    expect(wordsIn(blocks)).toBe(2)
    expect(richBlocksPlainText(blocks)).toBe('Visible prose.')
  })

  it('withholds a preservation-marker payload', () => {
    const blocks = [
      { type: 'paragraph', props: {}, content: [textNode('Real prose.')], children: [] },
      {
        id: 'u1',
        type: 'codeBlock',
        props: { language: 'json' },
        content: [textNode(`${UNSUPPORTED_BLOCK_MARKER}\n{"type":"futureBlock"}`)],
        children: []
      }
    ]
    expect(wordsIn(blocks)).toBe(2)
    expect(richBlocksPlainText(blocks)).toBe('Real prose.')
  })

  it('returns zero rather than throwing for empty or malformed input', () => {
    expect(wordsIn([])).toBe(0)
    expect(wordsIn([{ type: 'paragraph' }])).toBe(0)
    expect(wordsIn([null, 7, 'str', [{ no: 'type' }]])).toBe(0)
    expect(richBlocksPlainText('not an array')).toBe('')
    expect(richBlocksPlainText(undefined)).toBe('')
  })

  it('honours the same depth guard as the other two consumers', () => {
    // A genuinely nested chain: each level is the single child of the one above,
    // so the leaf sits at depth `levels - 1`. Sibling children would all be at
    // the same depth and the cap would never be reached.
    const build = (levels: number, leaf: string): unknown[] => {
      let node: unknown = {
        type: 'bulletListItem',
        props: {},
        content: [textNode(leaf)],
        children: []
      }
      for (let level = levels - 1; level >= 0; level--) {
        node = {
          type: 'bulletListItem',
          props: {},
          content: [textNode(level === 0 ? 'OUTER PROSE' : '')],
          children: [node]
        }
      }
      return [node]
    }
    const atCap = richBlocksPlainText(build(PREVIEW_MAX_BLOCK_DEPTH, 'AT THE CAP'))
    expect(atCap).toContain('AT THE CAP')
    const pastCap = richBlocksPlainText(build(PREVIEW_MAX_BLOCK_DEPTH + 1, 'PAST THE CAP'))
    expect(pastCap).toContain('OUTER PROSE')
    expect(pastCap).not.toContain('PAST THE CAP')
  })

  it('produces the same text as search and the card for one document', () => {
    const blocks = [
      { type: 'heading', props: { level: 1 }, content: [textNode('Heading')], children: [] },
      {
        type: 'bulletListItem',
        props: {},
        content: [textNode('parent')],
        children: [
          { type: 'bulletListItem', props: {}, content: [textNode('child')], children: [] }
        ]
      },
      table([['A', 'B']]),
      { id: 'i1', type: 'image', props: { url: '/u', caption: 'a caption' }, children: [] },
      { id: 'cb', type: 'codeBlock', props: {}, content: [textNode('const x = 1')], children: [] }
    ]
    const text = richBlocksPlainText(blocks)
    expect(text).toBe(extractSearchableRich(JSON.stringify(blocks)))
    expect(text).toBe(
      pagePreviewText({ pageType: 'rich', content: JSON.stringify(blocks) } as never, 100_000)
    )
  })
})
