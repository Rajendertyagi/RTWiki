import { beforeAll, describe, expect, it } from 'bun:test'
import { parseFragment, sharedDom } from './utils/dom-harness.js'

/**
 * N-column `:::columns` — the `:::column` child form.
 *
 * ## Why this file exists separately from the two-pane tests
 *
 * Two panes and N panes are one feature with two code paths, and they are easy
 * to confuse when they fail. The everyday case (`:::columns` + a `***`
 * separator) is covered in `markdown-columns.test.ts`; this file covers the
 * child form, and asserts the two-pane form *again* at the end, because the
 * regression that matters most is the one that breaks the form people actually
 * use.
 */

/**
 * Builds a `::::columns` block with `count` `:::column` children.
 *
 * The outer fence is **always** one longer than the inner, because that is a
 * requirement of the extension and not a style choice — measured, an equal-length
 * pair does not nest and the trailing fence leaks as a stray paragraph.
 */
function childSource(count: number, widths: Array<string | null> = []): string {
  const inner = ':'.repeat(3)
  const outer = ':'.repeat(4)
  const children = Array.from({ length: count }, (_, index) =>
    [
      `${inner}column${widths[index] === undefined ? '' : `{width=${widths[index]}}`}`,
      `C${index + 1}`,
      inner,
      ''
    ].join('\n')
  )
  return [`${outer}columns`, ...children, outer].join('\n')
}

let renderMarkdown: (source: string) => string
let columns: typeof import('../src/web/features/markdown/markdown-columns.js')

beforeAll(async () => {
  sharedDom()
  ;({ renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js'))
  columns = await import('../src/web/features/markdown/markdown-columns.js')
})

function parse(html: string): Document {
  return parseFragment(html)
}

/** Every pane of the **first** row, in document order. */
function panesOf(html: string): Element[] {
  const doc = parse(html)
  const root = doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)
  return [...(root ?? doc).querySelectorAll(columns.COLUMNS_PANE_SELECTOR)]
}

/** Every pane of the first row, with surrounding whitespace trimmed. */
function paneTexts(html: string): string[] {
  return panesOf(html).map((pane) => (pane.textContent ?? '').trim())
}

/** Every divider of the first row, in document order. */
function dividersOf(html: string): Element[] {
  return [...parse(html).querySelectorAll(columns.COLUMNS_DIVIDER_SELECTOR)]
}

/**
 * The grow factor each pane carries, as a string.
 *
 * Read from the `style` attribute rather than from `element.style`: the value is
 * a **custom property** (`--rt-cols-pane-flex`), and the `flex` shorthand that
 * consumes it belongs to `markdown-columns.css`, not to the markup.
 */
function flexOf(html: string): string[] {
  return panesOf(html).map((pane) => pane.getAttribute('style') ?? '')
}

/** The declared share of each pane, as an integer. */
function sharesOf(html: string): number[] {
  return panesOf(html).map((pane) => Number(pane.getAttribute('data-width')))
}

describe('N children render N panes with N-1 dividers', () => {
  it.each([2, 3, 4, 5, 8])('renders %i children as %i panes', (count) => {
    const html = renderMarkdown(childSource(count))
    const doc = parse(html)
    expect(panesOf(html)).toHaveLength(count)
    expect(dividersOf(html), 'a row of N has N-1 dividers').toHaveLength(count - 1)
    expect(
      doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)?.getAttribute(columns.COLUMNS_COUNT_ATTR)
    ).toBe(String(count))
    // Every child's content is present, in order, and in its own pane.
    expect(paneTexts(html)).toEqual(Array.from({ length: count }, (_, index) => `C${index + 1}`))
  })

  it('has no cap: 20 children render 20 panes', () => {
    // The owner asked for this to be available without having to ask twice, so
    // "available" is asserted rather than assumed.
    const html = renderMarkdown(childSource(20))
    expect(panesOf(html)).toHaveLength(20)
    expect(dividersOf(html)).toHaveLength(19)
  })

  it('divides the row equally when no child declares a width', () => {
    const shares = sharesOf(renderMarkdown(childSource(3)))
    // 100 across three panes cannot be exact, and the remainder goes to the last
    // so the earlier boundaries are exactly what was asked for.
    expect(shares).toEqual([34, 33, 33])
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('grows every pane by its own share, including the last', () => {
    /**
     * The sizing model, and the bug that shaped it.
     *
     * Grow factors are ratios. Leaving the last pane at `flex: 1 1 0%` while the
     * others grow by their shares renders an authored 40% as 40/41 — about 98% of
     * the row. Every pane carries its own share, so the ratios are the
     * percentages.
     */
    const html = renderMarkdown(childSource(2, ['40', '60']))
    expect(flexOf(html)).toEqual(['--rt-cols-pane-flex: 40', '--rt-cols-pane-flex: 60'])
  })

  it('carries the equal share as a property, not as a flex shorthand, when undeclared', () => {
    /**
     * The equal-share case, on the new arrangement.
     *
     * Every pane emits the property whether or not a width was declared, so
     * `markdown-columns.css` always has a number to read and its `, 1` fallback
     * is a backstop rather than the normal path. Asserted on the `N`-child form
     * because that is where a share is *computed* rather than authored.
     */
    const panes = panesOf(renderMarkdown(childSource(3)))
    expect(panes.map((pane) => pane.getAttribute('style'))).toEqual([
      '--rt-cols-pane-flex: 34',
      '--rt-cols-pane-flex: 33',
      '--rt-cols-pane-flex: 33'
    ])
    // And no pane smuggles a shorthand past it, which would make the rule dead.
    // Matched on the declaration *name*: the property emitted here is
    // `--rt-cols-pane-flex`, so a bare `flex:` substring test would match its own
    // name and pass for the wrong reason.
    for (const pane of panes) {
      const style = pane.getAttribute('style') ?? ''
      expect(/(?:^|;)\s*flex(?:-grow|-shrink|-basis)?\s*:/.test(style)).toBe(false)
    }
  })

  it('splits the prose between panes, so a heading cannot end up in the wrong one', () => {
    const html = renderMarkdown(
      [
        '::::columns',
        ':::column',
        '# First',
        '',
        'Text in the first pane.',
        ':::',
        '',
        ':::column',
        '# Second',
        '',
        'Text in the second pane.',
        ':::',
        '::::'
      ].join('\n')
    )
    const [first, second] = panesOf(html)
    expect(first?.textContent).toContain('Text in the first pane.')
    expect(first?.textContent).not.toContain('Text in the second pane.')
    expect(second?.textContent).toContain('Text in the second pane.')
    expect(second?.textContent).not.toContain('Text in the first pane.')
    // And the headings rendered, rather than being escaped by the parser.
    expect(first?.querySelector('h1')?.textContent).toBe('First')
  })
})

describe('a width belongs to its child, not to the row', () => {
  it('honours a width on each child', () => {
    const shares = sharesOf(renderMarkdown(childSource(3, ['20', '30', '50'])))
    expect(shares).toEqual([20, 30, 50])
  })

  it('gives an undeclared child an equal share of what is left', () => {
    // 60 declared, 40 left across two children: 20 each. The declared pane keeps
    // exactly what the author wrote, and only the leftover is shared.
    const shares = sharesOf(renderMarkdown(childSource(3, ['60', null, null])))
    expect(shares).toEqual([60, 20, 20])
  })

  it('ignores a root `left` when children carry the widths', () => {
    // The root's `left` describes the two-pane form. With children present the
    // children are what have widths, and `left` is not a second thing to read.
    const withRoot = renderMarkdown(
      [
        '::::columns{left=90}',
        ':::column{width=25}',
        'A',
        ':::',
        '',
        ':::column',
        'B',
        ':::',
        '::::'
      ].join('\n')
    )
    expect(sharesOf(withRoot)).toEqual([25, 75])
  })

  it.each([
    ['a mermaid arrow', 'a-->b'],
    ['a bare closer', 'a]>b'],
    ['a style close', 'a</style>b'],
    ['a css length', '40%'],
    ['a length pair', '60 40'],
    ['a signed number', '+40'],
    ['zero', '0'],
    ['a hundred', '100'],
    ['four digits', '1000'],
    ['empty', '']
  ])('surfaces a rejected child width (%s) rather than accepting it', (_label, value) => {
    const html = renderMarkdown(
      [
        '::::columns',
        `:::column{width="${value}"}`,
        'A',
        ':::',
        '',
        ':::column',
        'B',
        ':::',
        '::::'
      ].join('\n')
    )
    const doc = parse(html)
    // Rejected: an equal share, and the mistake is reported where it happened.
    expect(sharesOf(html)).toEqual([50, 50])
    expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)).not.toBeNull()
    expect(
      doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)?.getAttribute(columns.COLUMNS_REJECTED_ATTR)
    ).toBe('true')
    // The content is intact on both sides: a rejected width costs layout, not
    // content.
    expect(panesOf(html)[0]?.textContent).toContain('A')
    expect(panesOf(html)[1]?.textContent).toContain('B')
  })

  it('never lets a rejected child width reach an emitted attribute', () => {
    // The property the grammar exists to guarantee, asserted on the DOM: the
    // hostile text may appear as *text* in the notice, never in an attribute.
    for (const value of ['a-->b', 'a]>b', 'a</style>b', 'expression(alert(1))']) {
      const doc = parse(
        renderMarkdown(
          [
            '::::columns',
            `:::column{width="${value}"}`,
            'A',
            ':::',
            '',
            ':::column',
            'B',
            ':::',
            '::::'
          ].join('\n')
        )
      )
      for (const element of doc.querySelectorAll('*')) {
        for (const attr of [...element.attributes]) {
          expect(attr.value, `${element.tagName}[${attr.name}]`).not.toContain('-->')
          expect(attr.value, `${element.tagName}[${attr.name}]`).not.toContain(']>')
          expect(attr.value, `${element.tagName}[${attr.name}]`).not.toContain('expression')
        }
      }
    }
  })
})

describe('each divider names the boundary it moves', () => {
  it('keeps the plain label for a two-pane row', () => {
    // The everyday case is announced exactly as it was before N panes existed.
    const html = renderMarkdown([':::columns', 'A', '', '***', '', 'B', ':::'].join('\n'))
    expect(dividersOf(html)[0]?.getAttribute('aria-label')).toBe('Resize columns')
  })

  it('uses the row caption as the label when a two-pane row has one', () => {
    const html = renderMarkdown([':::columns[Formulae]', 'A', '', '***', '', 'B', ':::'].join('\n'))
    expect(dividersOf(html)[0]?.getAttribute('aria-label')).toBe('Formulae')
  })

  it('numbers the boundaries for three or more panes, because a row caption cannot', () => {
    const dividers = dividersOf(renderMarkdown(childSource(4)))
    expect(dividers).toHaveLength(3)
    // A screen reader must be able to say *which* boundary it is on, and where
    // that boundary sits relative to the others.
    expect(dividers.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Resize columns: boundary 1 of 3, between column 1 and column 2',
      'Resize columns: boundary 2 of 3, between column 2 and column 3',
      'Resize columns: boundary 3 of 3, between column 3 and column 4'
    ])
  })

  it('announces the width of the pane each boundary resizes', () => {
    const dividers = dividersOf(renderMarkdown(childSource(3, ['20', '30', '50'])))
    // `aria-valuenow` is the *left* pane's width, because that is the value a
    // drag on that boundary changes.
    expect(dividers.map((d) => d.getAttribute('aria-valuenow'))).toEqual(['20', '30'])
  })

  it('carries the slider bounds and a focus target on every divider', () => {
    for (const divider of dividersOf(renderMarkdown(childSource(5)))) {
      expect(divider.getAttribute('role')).toBe('separator')
      expect(divider.getAttribute('aria-orientation')).toBe('vertical')
      expect(divider.getAttribute('aria-valuemin')).toBe('1')
      expect(divider.getAttribute('aria-valuemax')).toBe('99')
      expect(divider.getAttribute('tabindex')).toBe('0')
      // A stable test hook on every one, not just the first.
      expect(divider.getAttribute('data-testid')).toBe(columns.COLUMNS_DIVIDER_TEST_ID)
    }
  })
})

describe('the child form never loses content', () => {
  it('renders an orphan :::column, which a handoff design deleted', () => {
    /**
     * The measured failure that ruled out the compile-data design.
     *
     * A `:::column` outside any `::::columns` is not a syntax error — it is a
     * reader who got the fences slightly wrong. Its content must still appear.
     */
    const doc = parse(renderMarkdown(':::column\nOrphan content\n:::\n\nafter paragraph'))
    expect(doc.body.textContent).toContain('Orphan content')
    expect(doc.body.textContent).toContain('after paragraph')
  })

  it('renders a child with no content as an empty pane, not a missing one', () => {
    const html = renderMarkdown(
      ['::::columns', ':::column', ':::', '', ':::column', 'B', ':::', '::::'].join('\n')
    )
    expect(panesOf(html)).toHaveLength(2)
    expect(paneTexts(html)).toEqual(['', 'B'])
  })

  it('renders a row whose body is prose as a single-pane row, not as children', () => {
    // Prose is not a `:::column` child, and must not be mistaken for one.
    const html = renderMarkdown(
      ['::::columns', 'Just prose.', '', 'More prose.', '::::'].join('\n')
    )
    expect(panesOf(html)).toHaveLength(2)
    expect(dividersOf(html)).toHaveLength(1)
    expect(parse(html).body.textContent).toContain('Just prose.')
    expect(parse(html).body.textContent).toContain('More prose.')
  })

  it('keeps two sibling rows independent', () => {
    const doc = parse(renderMarkdown(`${childSource(2)}\n\nprose between\n\n${childSource(3)}`))
    expect(doc.querySelectorAll(columns.COLUMNS_ROOT_SELECTOR)).toHaveLength(2)
    expect(doc.body.textContent).toContain('prose between')
    // The second row's children did not leak into the first.
    const roots = [...doc.querySelectorAll(columns.COLUMNS_ROOT_SELECTOR)]
    const firstRow = [...(roots[0] as Element).querySelectorAll(columns.COLUMNS_PANE_SELECTOR)]
    expect(firstRow.map((p) => (p.textContent ?? '').trim())).toEqual(['C1', 'C2'])
  })

  it('still renders maths and tables inside a child', () => {
    const html = renderMarkdown(
      [
        '::::columns',
        ':::column',
        '| a | b |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        'Cost is $E=mc^2$ exactly.',
        ':::',
        '',
        ':::column',
        'B',
        ':::',
        '::::'
      ].join('\n')
    )
    const first = panesOf(html)[0]
    expect(first?.querySelector('table td')?.textContent).toBe('1')
    expect(first?.querySelector('.katex'), 'maths must render inside a child').not.toBeNull()
  })

  it('leaves an unknown directive in the same row visible and intact', () => {
    const html = renderMarkdown(
      [
        '::::columns',
        ':::column',
        'A',
        ':::',
        '',
        ':::warning',
        'be careful',
        ':::',
        '',
        ':::column',
        'B',
        ':::',
        '::::'
      ].join('\n')
    )
    const doc = parse(html)
    // The unclaimed directive inside a pane is surfaced, not deleted — the same
    // property that protects a top-level one.
    expect(doc.body.textContent).toContain('be careful')
    expect(doc.querySelector(`.${columns.COLUMNS_UNKNOWN_CLASS}`)).not.toBeNull()
    // And the sibling child is untouched.
    expect(paneTexts(html)).toEqual(['A', 'B'])
  })
})

describe('the setext trap is reported, not silently mis-rendered', () => {
  it('says no separator was found when --- was used tight under text', () => {
    /**
     * `Left text\n---\nRight text` compiles to `<h2>Left text</h2>` with no `<hr>`
     * at all, so the divider vanishes and both halves land in one pane.
     *
     * **The cause is not detectable.** Measured: that output is byte-for-byte the
     * same shape as a heading the author genuinely meant, so nothing in the
     * compiled HTML distinguishes them. The notice therefore states the fact and
     * names the form that works, rather than asserting a cause it cannot observe.
     */
    const doc = parse(renderMarkdown(':::columns{left=40}\nLeft text\n---\nRight text\n:::'))
    const notice = doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)
    expect(notice, 'the failure must be visible').not.toBeNull()
    expect(notice?.textContent).toContain('No column separator found')
    // And it names the working separator, so the reader is not left guessing.
    expect(notice?.textContent).toContain('***')
    // Nothing was lost either way.
    expect(doc.body.textContent).toContain('Left text')
    expect(doc.body.textContent).toContain('Right text')
  })

  it('says nothing when the separator is present, in either accepted form', () => {
    for (const source of [
      ':::columns\nA\n***\nB\n:::',
      ':::columns\nA\n___\nB\n:::',
      ':::columns\nA\n\n---\n\nB\n:::',
      ':::columns\nA\n\n***\n\nB\n:::'
    ]) {
      const doc = parse(renderMarkdown(source))
      expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`), source).toBeNull()
      expect(dividersOf(renderMarkdown(source)), source).toHaveLength(1)
    }
  })

  it('does not need a separator at all when the children are used', () => {
    // The N-child form has no separator to get wrong, which is a real advantage
    // of it over the two-pane form and the reason to reach for it above two
    // panes.
    const doc = parse(renderMarkdown(childSource(3)))
    expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)).toBeNull()
    expect(
      doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)?.hasAttribute(columns.COLUMNS_UNSPLIT_ATTR)
    ).toBe(false)
  })
})

describe('the two-pane form did not regress', () => {
  /**
   * Asserted again, deliberately, after the N-pane work.
   *
   * The two-pane form is what people actually write, and the generalisation
   * changed the sizing model underneath it. Every one of these was measured
   * before the change and re-measured after.
   */
  it('splits at *** with the authored left width and a 60/40 remainder', () => {
    const html = renderMarkdown(':::columns{left=40}\nLeft pane\n\n***\n\nRight pane\n:::')
    const doc = parse(html)
    expect(paneTexts(html)).toEqual(['Left pane', 'Right pane'])
    // The **explicit-percent** case on the new arrangement: the two-pane form
    // carries its authored `left` through as the property, and the remainder as
    // the other pane's.
    expect(flexOf(html)).toEqual(['--rt-cols-pane-flex: 40', '--rt-cols-pane-flex: 60'])
    expect(dividersOf(html)[0]?.getAttribute('aria-valuenow')).toBe('40')
    expect(
      doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)?.hasAttribute(columns.COLUMNS_NESTED_ATTR)
    ).toBe(false)
  })

  it('uses 50/50 when no left is given, and reports no error', () => {
    const html = renderMarkdown(':::columns\nA\n\n***\n\nB\n:::')
    expect(flexOf(html)).toEqual(['--rt-cols-pane-flex: 50', '--rt-cols-pane-flex: 50'])
    expect(parse(html).querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)).toBeNull()
  })

  it('surfaces a rejected left width, as it always did', () => {
    const html = renderMarkdown(':::columns{left="a-->b"}\nA\n\n***\n\nB\n:::')
    const doc = parse(html)
    expect(flexOf(html)).toEqual(['--rt-cols-pane-flex: 50', '--rt-cols-pane-flex: 50'])
    expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)?.textContent).toContain('a-->b')
  })

  it('gives the child form priority, and keeps the stray content it displaced', () => {
    // The two forms never conflict: a body either has pane children or it has a
    // separator. When a body somehow has both, the children define the row — and
    // the `***` and the `B` after them are **kept**, after the row, rather than
    // becoming a second pane or being dropped. Measured: the first draft of the
    // child path dropped them.
    const html = renderMarkdown(
      ['::::columns', ':::column', 'A', ':::', '', '***', '', 'B', '::::'].join('\n')
    )
    expect(panesOf(html)).toHaveLength(1)
    expect(dividersOf(html)).toHaveLength(0)
    const doc = parse(html)
    // Nothing was lost: the rule and the trailing paragraph are both present,
    // outside the row rather than inside a pane that never asked for them.
    expect(doc.querySelector('hr')).not.toBeNull()
    expect(doc.body.textContent).toContain('B')
    expect(
      panesOf(html)[0]?.querySelector('hr'),
      'the stray rule must not be claimed as a column'
    ).toBeNull()
  })
})
