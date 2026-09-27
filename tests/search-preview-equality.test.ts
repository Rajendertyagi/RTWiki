import { describe, expect, it } from 'bun:test'
import {
  extractSearchableRich,
  SEARCH_EXTRACTION_MAX_CHARS,
  SEARCH_MAX_BLOCK_DEPTH
} from '../src/server/services/search-extraction.js'
import { UNSUPPORTED_BLOCK_MARKER } from '../src/shared/constants/index.js'
import { PREVIEW_MAX_BLOCK_DEPTH, pagePreviewText } from '../src/web/util/page-preview-text.js'

/**
 * Three places decide what text a page contains, and this file is about two of
 * them agreeing.
 *
 * `extractSearchableRich` (server) writes `search_index.content`.
 * `pagePreviewText` (client) writes the dashboard card excerpt. They answer the
 * same question -- "what words does this page contain?" -- and a user sees
 * both: a card on the dashboard, and a hit in the search box. When they
 * disagree, the page contradicts itself.
 *
 * Three divergences were found and measured. All are now reconciled:
 *
 * 1. A table's text lives at `content.rows[].cells[].content`, which is an
 *    object, not an array. The preview only descended into `content` when it
 *    was an array, so a page whose only content is a table rendered an
 *    **empty dashboard card** while being perfectly searchable.
 * 2. Image captions: the preview indexed `props.caption`, search did not. A
 *    page whose only prose is captions was visible on a card and unfindable.
 * 3. Stored `codeBlock`/`mathBlock` use the `PlainContent` array form, but
 *    search's `collectOwnBlockText` only accepted `typeof content === 'string'`.
 *    Search returned '' where the preview returned the text. The pre-existing
 *    test only covered the partial string form, which is why it was never
 *    caught.
 *
 * The equality assertions below are the point: a table of block types, walked
 * by both, must produce byte-identical output. That way a future divergence
 * fails a test instead of reaching a user's dashboard.
 */

/**
 * `richPage` takes the content as a STRING, so a caller can hand over a body it
 * built by repetition. `JSON.stringify` is itself recursive and overflows on a
 * pathologically deep document before the code under test ever runs, so a test
 * that stringified one would fail in its own harness rather than at the walker.
 */
function richPage(content: string): Parameters<typeof pagePreviewText>[0] {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Doc',
    pageType: 'rich',
    content,
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

/** The real stored cell shape (@blocknote/core 0.54 `TableCell`). */
function tableCell(text: string): unknown {
  return {
    type: 'tableCell',
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
    content: [textNode(text)]
  }
}

/** A table block, exactly as `editor.document` serialises it. */
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

/** Both consumers, with the card's 120-char display cap lifted. */
function bothWays(doc: unknown): { search: string; preview: string } {
  const stored = JSON.stringify(doc)
  return {
    search: extractSearchableRich(stored),
    preview: pagePreviewText(richPage(stored), SEARCH_EXTRACTION_MAX_CHARS)
  }
}

describe('a table-only page is not an empty card', () => {
  it('shows the table text on the card', () => {
    // The reported bug: this page rendered an empty card while search found it
    // perfectly. The card is the user-visible half; it was the broken one.
    const { preview } = bothWays([
      table([
        ['Header A', 'Header B'],
        ['Cell one', 'Cell two']
      ])
    ])
    expect(preview).toBe('Header A Header B Cell one Cell two')
    expect(preview.length).toBeGreaterThan(0)
  })

  it('still matches search for the same table', () => {
    expect(
      bothWays([
        table([
          ['Header A', 'Header B'],
          ['Cell one', 'Cell two']
        ])
      ])
    ).toEqual({
      search: 'Header A Header B Cell one Cell two',
      preview: 'Header A Header B Cell one Cell two'
    })
  })

  it('reads a table cell that holds a link, without surfacing the URL', () => {
    const doc = [
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
                  props: { textColor: 'default' },
                  content: [
                    {
                      type: 'link',
                      href: 'https://example.com/spec',
                      content: [textNode('the spec')]
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
    const { search, preview } = bothWays(doc)
    expect(preview).toBe('the spec')
    expect(search).toBe('the spec')
    expect(preview).not.toContain('example.com')
  })
})

describe('a flat document produces byte-identical output, before and after', () => {
  /**
   * The no-regression floor. These strings are what the preview produced before
   * the table fix, captured from the then-current implementation, and they must
   * not move: the table change must not alter how any other block type reads.
   */
  const cases: Array<[string, unknown, string]> = [
    [
      'paragraph inline order preserved',
      [
        {
          type: 'paragraph',
          props: {},
          content: [textNode('Top level prose '), textNode('joined inline.'), { type: 'text' }],
          children: []
        }
      ],
      'Top level prose joined inline.'
    ],
    [
      'image caption still indexed, URL still excluded',
      [
        {
          id: 'i1',
          type: 'image',
          props: { url: '/api/attachments/x', caption: 'Revenue by quarter, 2024' },
          children: []
        }
      ],
      'Revenue by quarter, 2024'
    ],
    [
      'divider contributes nothing',
      [
        { type: 'paragraph', props: {}, content: [textNode('Either side.')], children: [] },
        { type: 'divider', children: [] },
        { type: 'paragraph', props: {}, content: [textNode('Other side.')], children: [] }
      ],
      'Either side. Other side.'
    ],
    [
      'code block in the plain string form',
      [{ type: 'codeBlock', props: { language: 'ts' }, content: 'const real = 1', children: [] }],
      'const real = 1'
    ]
  ]

  it.each(cases)('%s', (_name, doc, expected) => {
    const { preview } = bothWays(doc)
    expect(preview).toBe(expected)
    // And the two consumers agree, so search indexing this cannot drift either.
    expect(bothWays(doc).search).toBe(expected)
  })
})

describe('search and the dashboard preview produce exactly equal strings', () => {
  /**
   * One document exercising every block type the two consumers must agree on.
   * Nested and flat shapes are both present, so the equality is not an artefact
   * of nesting.
   */
  const kitchenSink: TestBlock[] = [
    {
      id: 'h1',
      type: 'heading',
      props: { level: 1 },
      content: [textNode('Notes heading')],
      children: []
    },
    {
      id: 'p1',
      type: 'paragraph',
      props: {},
      content: [textNode('Intro paragraph.')],
      children: []
    },
    listItem('Bullet one', [
      listItem('Bullet two nested', [
        {
          id: 'p2',
          type: 'paragraph',
          props: {},
          content: [textNode('Paragraph under a bullet')],
          children: []
        }
      ])
    ]),
    {
      id: 'n1',
      type: 'numberedListItem',
      props: {},
      content: [textNode('Numbered item')],
      children: [listItem('Child of the numbered item')]
    },
    {
      id: 'c1',
      type: 'checkListItem',
      props: { checked: false },
      content: [textNode('Checkbox item')],
      children: []
    },
    {
      id: 'co1',
      type: 'callout',
      props: { variant: 'warning' },
      content: [textNode('Callout body.')],
      children: [
        {
          id: 'p3',
          type: 'paragraph',
          props: {},
          content: [textNode('Under the callout')],
          children: []
        }
      ]
    },
    {
      id: 'q1',
      type: 'quote',
      props: {},
      content: [
        textNode('Quoted '),
        { type: 'link', href: 'https://example.com', content: [textNode('link text')] }
      ],
      children: []
    },
    table([
      ['Column A', 'Column B'],
      ['Cell one', 'Cell two']
    ]),
    listItem('Table under a bullet', [table([['Nested cell alpha'], ['Nested cell beta']])]),
    {
      id: 'i1',
      type: 'image',
      props: { url: '/api/attachments/x', caption: 'Figure 1. The chart.' },
      children: []
    },
    {
      id: 'cb1',
      type: 'codeBlock',
      props: { language: 'ts' },
      content: [textNode('const stored = true')],
      children: []
    },
    {
      id: 'cb2',
      type: 'codeBlock',
      props: { language: 'ts' },
      content: 'const partial = true',
      children: []
    },
    { id: 'd1', type: 'divider', children: [] },
    {
      id: 'p4',
      type: 'paragraph',
      props: {},
      content: [textNode('Closing paragraph.')],
      children: []
    }
  ]

  it('agree on a document exercising every block type', () => {
    const { search, preview } = bothWays(kitchenSink)
    expect(search).toBe(preview)
    // And the shared string is the real text, not two empty strings.
    expect(search.length).toBeGreaterThan(0)
  })

  it('agree on a flat document, so equality is not an artefact of nesting', () => {
    const flat: TestBlock[] = [
      { type: 'paragraph', props: {}, content: [textNode('Flat prose only.')], children: [] },
      { type: 'paragraph', props: {}, content: [textNode('Second flat block.')], children: [] },
      { id: 'i2', type: 'image', props: { url: '/u', caption: 'A flat caption' }, children: [] },
      {
        id: 'cb3',
        type: 'codeBlock',
        props: {},
        content: [textNode('const flat = 1')],
        children: []
      },
      { type: 'divider', children: [] }
    ]
    expect(bothWays(flat).search).toBe(bothWays(flat).preview)
  })

  it('agree that a formula block contributes no prose on either side', () => {
    // LaTeX is not readable prose. Both consumers withhold it, and they must
    // withhold it for the same reason -- visible output, not source.
    const doc = [
      { type: 'paragraph', props: {}, content: [textNode('Visible prose.')], children: [] },
      { id: 'm1', type: 'mathBlock', props: {}, content: 'E=mc^2', children: [] }
    ]
    const { search, preview } = bothWays(doc)
    expect(search).toBe(preview)
    expect(search).not.toContain('mc^2')
  })

  it('agree that a preservation-marker payload is never indexed or shown', () => {
    // `containUnknownBlocks()` rewrites an unknown block into a codeBlock whose
    // first line is the marker. That is preservation data, not prose: it must
    // never reach a search result or a dashboard card.
    const doc = [
      { type: 'paragraph', props: {}, content: [textNode('Real prose.')], children: [] },
      {
        id: 'u1',
        type: 'codeBlock',
        props: { language: 'json' },
        content: `${UNSUPPORTED_BLOCK_MARKER}\n{"type":"futureBlock"}`,
        children: []
      }
    ]
    const { search, preview } = bothWays(doc)
    expect(search).toBe(preview)
    expect(search).toBe('Real prose.')
  })
})

describe('the stored PlainContent array form is read by both', () => {
  it('indexes a code block stored as an inline array, not a bare string', () => {
    // The stored form for a codeBlock is `PlainContent[]`. Search's
    // `collectOwnBlockText` only accepted `typeof content === 'string'`, so a
    // real stored code block was unfindable. The pre-existing test only used the
    // partial string form, which is why this was never caught.
    const doc = [
      {
        id: 'cb',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [textNode('const real = 1')],
        children: []
      }
    ]
    const { search, preview } = bothWays(doc)
    expect(search).toBe('const real = 1')
    expect(preview).toBe('const real = 1')
  })

  it('indexes an image caption, which search previously ignored', () => {
    // A page whose only prose is captions was visible on a card and unfindable.
    const doc = [
      {
        id: 'i1',
        type: 'image',
        props: { url: '/u', caption: 'Revenue by quarter, 2024' },
        children: []
      }
    ]
    const { search, preview } = bothWays(doc)
    expect(search).toBe('Revenue by quarter, 2024')
    expect(preview).toBe('Revenue by quarter, 2024')
  })
})

describe('the preview depth guard has defined behaviour', () => {
  /**
   * The preview is handed a page body that arrived over the network, and rich
   * content is not validated server-side, so the walk needs the same class of
   * cap the server walk uses. `PREVIEW_MAX_BLOCK_DEPTH` is RTWiki's own constant
   * -- the client cannot import the server module -- but it is deliberately the
   * same value and the same defined behaviour: read to the cap, keep everything
   * already collected, stop, never throw.
   */
  const deeplyNestedListJson = (levels: number, leafText: string): string => {
    const open = '{"type":"bulletListItem","props":{},"content":[],"children":['
    const close = ']}'
    const outer =
      '{"type":"bulletListItem","props":{},"content":[{"type":"text","text":"OUTER PROSE","styles":{}}],"children":['
    const leaf = `{"type":"bulletListItem","props":{},"content":[{"type":"text","text":"${leafText}","styles":{}}],"children":[]}`
    return `[${outer}${open.repeat(levels - 1)}${leaf}${close.repeat(levels)}]`
  }

  it('reads a leaf exactly at the cap and drops one past it', () => {
    expect(PREVIEW_MAX_BLOCK_DEPTH).toBe(SEARCH_MAX_BLOCK_DEPTH)

    const atCap = pagePreviewText(
      richPage(deeplyNestedListJson(PREVIEW_MAX_BLOCK_DEPTH, 'AT THE CAP')),
      100_000
    )
    expect(atCap).toContain('AT THE CAP')

    // Past the cap: the wrappers already read are kept, and only the leaf beyond
    // the cap is dropped. Degrading to partial text is the defined behaviour.
    const pastCap = pagePreviewText(
      richPage(deeplyNestedListJson(PREVIEW_MAX_BLOCK_DEPTH + 1, 'PAST THE CAP')),
      100_000
    )
    expect(pastCap).toContain('OUTER PROSE')
    expect(pastCap).not.toContain('PAST THE CAP')
  })

  it('does not exhaust the stack on a pathologically deep document', () => {
    // The preview is handed a body from the network, so this is the same threat
    // the server-side cap exists for: unbounded nesting arriving as depth. The
    // string is built by repetition because `JSON.stringify` would overflow in
    // the harness first; `JSON.parse` accepts 100,000 levels (measured), and that
    // is the parse the code under test performs.
    expect(pagePreviewText(richPage(deeplyNestedListJson(100_000, 'UNREACHABLE')), 100_000)).toBe(
      'OUTER PROSE'
    )
  })

  it('degrades malformed and text-free content to empty, never throws', () => {
    for (const doc of [
      [{ type: 'paragraph' }],
      [{ type: 'table', content: {}, children: [] }],
      [{ type: 'table', content: { rows: [] }, children: [] }],
      [{ type: 'table', content: { rows: [{}] }, children: [] }],
      [{ type: 'table', content: { rows: [{ cells: 'nope' }] }, children: [] }],
      [{ type: 'table', content: { rows: [{ cells: [null, 7] }] }, children: [] }],
      [null, 7, 'str', [{ no: 'type' }]]
    ]) {
      expect(pagePreviewText(richPage(JSON.stringify(doc)), 100_000)).toBe('')
    }
  })
})
