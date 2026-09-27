import { describe, expect, it } from 'bun:test'
import {
  extractSearchableRich,
  SEARCH_EXTRACTION_MAX_CHARS,
  SEARCH_MAX_BLOCK_DEPTH
} from '../src/server/services/search-extraction.js'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

/**
 * Regression coverage for the defect where `collectBlockText` read only
 * top-level blocks. Text inside `children` — a sub-list, a table nested in a
 * list item — was unfindable by search while the dashboard preview showed it,
 * because the preview's `textFromBlocks` (src/web/util/page-preview-text.ts:30-52)
 * always descended.
 *
 * Every shape below is the one `editor.document` actually produces, which is
 * what `rich-editor.tsx:421` serialises into the stored page content: blocks
 * carry `id`, `type`, `props`, `content` and `children`, and a table cell is
 * `{ type: 'tableCell', props, content: InlineContent[] }`
 * (@blocknote/core 0.54 `TableCell`).
 */

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

interface TestBlock {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: unknown[]
}

function textNode(text: string): unknown {
  return { type: 'text', text, styles: {} }
}

function listItem(text: string, children: TestBlock[] = []): TestBlock {
  return { type: 'bulletListItem', props: {}, content: [textNode(text)], children }
}

function tableCell(text: string): unknown {
  return {
    type: 'tableCell',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: [textNode(text)]
  }
}

function table(rows: string[][]): TestBlock {
  return {
    type: 'table',
    props: { textColor: 'default' },
    content: {
      type: 'tableContent',
      columnWidths: rows.map(() => 200),
      headerRows: 1,
      rows: rows.map((cells) => ({ cells: cells.map(tableCell) }))
    },
    children: []
  }
}

/**
 * `wrapperLevels` wrapping list items around a leaf carrying `leafText`. The
 * leaf sits at traversal depth `wrapperLevels`, because a top-level block is
 * depth 0.
 */
function nestListItems(wrapperLevels: number, leafText: string): TestBlock[] {
  let node: TestBlock = {
    id: 'leaf',
    type: 'bulletListItem',
    props: {},
    content: [textNode(leafText)],
    children: []
  }
  for (let level = wrapperLevels - 1; level >= 0; level--) {
    node = {
      id: `item-${level}`,
      type: 'bulletListItem',
      props: {},
      content: [textNode(`level ${level} marker`)],
      children: [node]
    }
  }
  return [node]
}

/**
 * The same shape as a string, built by repetition.
 *
 * `JSON.stringify` is itself recursive and overflows well before the extractor
 * would, so a test that used it would fail in the harness rather than at the
 * code under test. `JSON.parse` — the parse `extractSearchableRich` actually
 * performs — accepts these depths (measured to 100,000), so the string is handed
 * over as stored content and the extraction is genuinely exercised.
 */
function deeplyNestedListJson(wrapperLevels: number, leafText: string): string {
  const open = '{"type":"bulletListItem","props":{},"content":[],"children":['
  const close = ']}'
  const outer =
    '{"type":"bulletListItem","props":{},"content":[{"type":"text","text":"OUTER PROSE","styles":{}}],"children":['
  const leaf = `{"type":"bulletListItem","props":{},"content":[{"type":"text","text":"${leafText}","styles":{}}],"children":[]}`
  return `[${outer}${open.repeat(wrapperLevels - 1)}${leaf}${close.repeat(wrapperLevels)}]`
}

function deeplyNestedInlineJson(linkLevels: number, leafText: string): string {
  // One link per level: content_k = [ { type: 'link', content: content_k-1 } ].
  const link = '{"type":"link","href":"https://example.com","content":['
  const close = ']}'
  const leaf = `{"type":"text","text":"${leafText}","styles":{}}`
  const head = '{"type":"text","text":"INLINE OUTER","styles":{}}'
  return `[{"type":"paragraph","props":{},"content":[${head},${link.repeat(linkLevels)}${leaf}${close.repeat(linkLevels)}],"children":[]}]`
}

/** How many times `needle` appears in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('rich search text: unchanged extraction for top-level blocks', () => {
  it('still extracts a top-level paragraph exactly, inline order preserved', () => {
    const doc = [
      {
        type: 'paragraph',
        content: [textNode('Top level prose '), textNode('joined inline.'), { type: 'text' }]
      }
    ]
    expect(extractSearchableRich(JSON.stringify(doc))).toBe('Top level prose joined inline.')
  })

  it('still extracts a top-level table through the real tableCell shape', () => {
    const doc = [
      table([
        ['Header A', 'Header B'],
        ['Cell one', 'Cell two']
      ])
    ]
    // Pre-existing behaviour, asserted so the recursion change cannot quietly
    // alter it: a table at the top level was already indexed.
    expect(extractSearchableRich(JSON.stringify(doc))).toBe('Header A Header B Cell one Cell two')
  })

  it('still skips a preservation-marker code block nested as a child block', () => {
    const doc = [
      listItem('Parent item', [
        {
          type: 'codeBlock',
          props: { language: 'json' },
          content: '[unsupported block preserved below]\n{"type":"futureBlock"}',
          children: []
        }
      ])
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('Parent item')
    expect(text).not.toContain('futureBlock')
  })

  it('still skips diagram, mind-map and formula source at every depth', () => {
    const doc = [
      {
        type: 'bulletListItem',
        props: {},
        content: [textNode('Visible parent')],
        children: [
          { type: 'diagram', content: 'graph TD\n A-->B', children: [] },
          { type: 'mindMap', content: 'mindmap\n root((X))', children: [] },
          { type: 'mathBlock', content: 'E=mc^2', children: [] },
          { type: 'hologramBlock', content: [textNode('future prose')], children: [] }
        ]
      }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('Visible parent')
    expect(text).not.toContain('graph TD')
    expect(text).not.toContain('mindmap')
    expect(text).not.toContain('mc^2')
    expect(text).not.toContain('future prose')
  })
})

describe('rich search text: nested blocks are now extracted', () => {
  it('extracts text inside a list item', () => {
    const doc = [
      listItem('Parent item', [
        listItem('Sub list item text'),
        { type: 'paragraph', props: {}, content: [textNode('Paragraph inside a list item')] }
      ])
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('Parent item')
    expect(text).toContain('Sub list item text')
    expect(text).toContain('Paragraph inside a list item')
  })

  it('extracts text inside a table cell when the table is nested', () => {
    const doc = [
      listItem('Budget summary', [
        table([
          ['Region', 'Spend'],
          ['North', '4100']
        ])
      ])
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('Budget summary')
    expect(text).toContain('Region')
    expect(text).toContain('Spend')
    expect(text).toContain('North')
    expect(text).toContain('4100')
  })

  it('extracts a table cell that carries a link inline node', () => {
    const doc: TestBlock[] = [
      {
        type: 'table',
        props: { textColor: 'default' },
        content: {
          type: 'tableContent',
          columnWidths: [200],
          rows: [
            {
              cells: [
                {
                  type: 'tableCell',
                  props: {
                    textColor: 'default',
                    backgroundColor: 'default',
                    textAlignment: 'left'
                  },
                  content: [
                    {
                      type: 'link',
                      href: 'https://example.com/spec',
                      content: [textNode('the specification')]
                    }
                  ]
                }
              ]
            }
          ]
        },
        children: []
      }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('the specification')
    expect(text).not.toContain('example.com')
  })

  it('extracts text nested several levels deep', () => {
    const doc = [
      listItem('level one', [
        listItem('level two', [listItem('level three', [listItem('level four marker')])])
      ])
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('level one level two level three level four marker')
  })

  it('walks mixed nested and top-level content into the union, each piece once', () => {
    const doc = [
      { type: 'heading', props: { level: 2 }, content: [textNode('Mixed heading')], children: [] },
      listItem('Top level item', [
        listItem('Nested item', [table([['Cell alpha'], ['Cell beta']])])
      ]),
      {
        type: 'callout',
        props: { variant: 'warning' },
        content: [textNode('Nested callout text')],
        children: [{ type: 'paragraph', props: {}, content: [textNode('Under the callout')] }]
      },
      { type: 'paragraph', props: {}, content: [textNode('Trailing paragraph')], children: [] }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe(
      'Mixed heading Top level item Nested item Cell alpha Cell beta ' +
        'Nested callout text Under the callout Trailing paragraph'
    )
    // Union, not a concatenation of two walks over the same subtree.
    for (const piece of [
      'Mixed heading',
      'Top level item',
      'Nested item',
      'Cell alpha',
      'Cell beta',
      'Nested callout text',
      'Under the callout',
      'Trailing paragraph'
    ]) {
      expect(occurrences(text, piece)).toBe(1)
    }
  })
})

describe('rich search text and dashboard previews agree', () => {
  it('extracts the same text as pagePreviewText for the same document', () => {
    const doc = [
      {
        type: 'heading',
        props: { level: 1 },
        content: [textNode('Agreement heading')],
        children: []
      },
      { type: 'paragraph', props: {}, content: [textNode('Opening paragraph.')], children: [] },
      listItem('First bullet', [
        listItem('Second bullet', [listItem('Third bullet')]),
        {
          type: 'paragraph',
          props: {},
          content: [textNode('Paragraph under a bullet')],
          children: []
        }
      ]),
      {
        type: 'numberedListItem',
        props: {},
        content: [textNode('Numbered item')],
        children: [listItem('Numbered child')]
      },
      {
        type: 'checkListItem',
        props: { checked: false },
        content: [textNode('Checkbox item')],
        children: []
      },
      {
        type: 'callout',
        props: { variant: 'info' },
        content: [textNode('Callout text')],
        children: []
      },
      {
        type: 'quote',
        props: {},
        content: [
          textNode('Quoted '),
          { type: 'link', href: 'https://example.com', content: [textNode('link text')] }
        ],
        children: []
      },
      { type: 'divider', children: [] },
      { type: 'image', props: { url: '/api/attachments/x' }, children: [] }
    ]
    // `pagePreviewText` slices to 120 characters for a card; the cap passed
    // here removes that display-only truncation so the two *extractions* are
    // what is compared.
    expect(extractSearchableRich(JSON.stringify(doc))).toBe(
      pagePreviewText(richPage(doc), SEARCH_EXTRACTION_MAX_CHARS)
    )
  })

  it('still agrees on a document with no nesting at all', () => {
    const doc = [
      { type: 'paragraph', props: {}, content: [textNode('Flat prose only.')], children: [] },
      { type: 'paragraph', props: {}, content: [textNode('Second flat block.')], children: [] }
    ]
    expect(extractSearchableRich(JSON.stringify(doc))).toBe(
      pagePreviewText(richPage(doc), SEARCH_EXTRACTION_MAX_CHARS)
    )
  })
})

describe('rich search text: empty input and the depth guard', () => {
  it('yields empty text for empty and text-free blocks', () => {
    const doc = [
      { type: 'paragraph' },
      { type: 'paragraph', props: {}, content: [] },
      { type: 'bulletListItem', props: {}, content: [], children: [] },
      { type: 'divider', children: [] },
      { type: 'heading', props: { level: 1 }, children: [] },
      { type: 'table', content: {}, children: [] },
      { type: 'table', content: { type: 'tableContent', rows: [] }, children: [] },
      { type: 'paragraph', props: {}, content: [textNode('')], children: [] },
      { type: 'paragraph', props: {}, content: [{ type: 'text' }], children: [] }
    ]
    expect(extractSearchableRich(JSON.stringify(doc))).toBe('')
  })

  it('still returns empty text for malformed or non-block content', () => {
    expect(extractSearchableRich('not json at all')).toBe('')
    expect(extractSearchableRich('{"blocks":"nope"}')).toBe('')
    expect(extractSearchableRich('[null, 7, "str", [{"no":"type"}]]')).toBe('')
  })

  it('reads a document nested exactly up to the depth cap', () => {
    // A leaf at depth `wrapperLevels` is read while `wrapperLevels` is within
    // the cap, so the deepest admitted leaf sits at SEARCH_MAX_BLOCK_DEPTH.
    const doc = nestListItems(SEARCH_MAX_BLOCK_DEPTH, 'AT THE CAP')
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('AT THE CAP')
  })

  it('keeps what it already read and stops past the depth cap', () => {
    const doc = nestListItems(SEARCH_MAX_BLOCK_DEPTH + 1, 'PAST THE CAP')
    const text = extractSearchableRich(JSON.stringify(doc))
    // The wrappers within the cap are indexed; the leaf one level beyond it is
    // not, and nothing already collected is discarded.
    expect(text).toContain('level 0 marker')
    expect(text).toContain(`level ${SEARCH_MAX_BLOCK_DEPTH} marker`)
    expect(text).not.toContain('PAST THE CAP')
  })

  it('does not exhaust the stack on a pathologically deep document', () => {
    // JSON cannot express a cycle, so unbounded nesting arrives as depth.
    // `JSON.parse` accepts 100,000 levels (measured); the recursive walk does
    // not, so with the cap raised the same document throws
    // `RangeError: Maximum call stack size exceeded` out of this function —
    // which `page-service.ts` calls on every page write. The cap is what makes
    // the walk total. The outermost block is still read, so this asserts the
    // walk ran, hit the cap, kept what it had and returned.
    const text = extractSearchableRich(deeplyNestedListJson(100_000, 'UNREACHABLE'))
    expect(text).toBe('OUTER PROSE')
  })

  it('does not exhaust the stack on deeply nested inline content', () => {
    const text = extractSearchableRich(deeplyNestedInlineJson(100_000, 'INLINE CORE'))
    expect(text).toBe('INLINE OUTER')
  })
})

/**
 * Deliberate, measured divergences between the two implementations. They are
 * NOT recursion, so this task does not change them; they are pinned here so
 * that reconciling either one has to be a conscious decision with its own
 * test, rather than a side effect of an unrelated edit.
 *
 * 1. `page-preview-text.ts:28,36-43` indexes `props.caption`; search does not.
 *    A page whose only prose is image captions is visible on a card and
 *    unfindable by search.
 * 2. `page-preview-text.ts:44-46` descends into `content` only when it is an
 *    array, so a table (whose content is the `tableContent` object) and a
 *    `codeBlock`/`mathBlock` written in their stored `PlainContent` array form
 *    are invisible to the preview, while search indexes table cells. Search
 *    deliberately withholds formula/diagram/mind-map source
 *    (search-extraction.ts, `collectOwnBlockText`).
 */
describe('rich search text: known divergences from the preview, reported not reconciled', () => {
  it('does not index an image caption, which the preview does', () => {
    const doc = [
      {
        id: 'i1',
        type: 'image',
        props: { url: '/api/attachments/x', caption: 'Revenue by quarter, 2024' },
        children: []
      }
    ]
    expect(extractSearchableRich(JSON.stringify(doc))).toBe('')
  })

  it('does not index code or formula held in the stored PlainContent array form', () => {
    const doc = [
      {
        id: 'c1',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [textNode('const real = 1')],
        children: []
      },
      { id: 'm1', type: 'mathBlock', props: {}, content: [textNode('E=mc^2')], children: [] }
    ]
    expect(extractSearchableRich(JSON.stringify(doc))).toBe('')
  })
})
