import { beforeAll, describe, expect, it } from 'bun:test'
import { parseFragment, sharedDom } from './utils/dom-harness.js'

/**
 * `:::columns` — the two-pane layout, its width grammar, and the two
 * content-loss paths the extension makes possible.
 *
 * ## Why the DOM is installed before the module under test is imported
 *
 * Identical to `markdown-render.test.ts`: `markdown-render.ts` creates its
 * DOMPurify instance at import time, bound to the ambient `window`. Bun has no
 * DOM, so without this the sanitiser would run without a document and every
 * assertion about what reaches the output would be asserting against a no-op.
 *
 * The DOM is the shared one and is never closed; see `utils/dom-harness.ts` for
 * why a per-file JSDOM breaks every file that follows it in the same run.
 */
let renderMarkdown: (source: string) => string
let columns: typeof import('../src/web/features/markdown/markdown-columns.js')

beforeAll(async () => {
  sharedDom()
  ;({ renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js'))
  columns = await import('../src/web/features/markdown/markdown-columns.js')
})

/** Parses rendered output so assertions are about structure, not substrings. */
function parse(html: string): Document {
  return parseFragment(html)
}

/**
 * Selectors for the emitted structure.
 *
 * The `data-side` values are part of the emitted contract, so they are written
 * out here as literals rather than composed from imported constants: a change to
 * one is a change worth a failing test, not a silent one.
 */
const PANE_SELECTOR = '.rt-cols__pane'
const LEFT_PANE_SELECTOR = `${PANE_SELECTOR}[data-side="left"]`
const RIGHT_PANE_SELECTOR = `${PANE_SELECTOR}[data-side="right"]`

/** The left pane of the first rendered column block. */
function leftPane(html: string): Element | null {
  return parse(html).querySelector(LEFT_PANE_SELECTOR)
}

/** The right pane of the first rendered column block. */
function rightPane(html: string): Element | null {
  return parse(html).querySelector(RIGHT_PANE_SELECTOR)
}

/** Every pane of the first rendered column block, in document order. */
function allPanes(html: string): Element[] {
  return [...parse(html).querySelectorAll(PANE_SELECTOR)]
}

/**
 * The source form used throughout: the panes are separated by a `***` thematic
 * break.
 *
 * `***` rather than `---` because a `---` on the line directly after paragraph
 * text is a **setext heading** in CommonMark, not a thematic break. Measured:
 * `Left text\n---\nRight text` compiles to `<h2>Left text</h2>` with **no `<hr>`
 * at all**, so the divider would silently vanish and both panes would land in
 * the left one. `***` and `___` are never setext underlines, and a blank line
 * before `---` also works. This is a property of the Markdown grammar, not of
 * this feature, and it is why the marker is not `---`.
 */
const DIVIDER_SOURCE = '***'

/** Builds a `:::columns` source with the two panes joined by a divider. */
function columnSource(options: string, left: string, right: string): string {
  return [`:::columns${options}`, left, '', DIVIDER_SOURCE, '', right, ':::'].join('\n')
}

describe(':::columns renders two panes with the authored widths', () => {
  it('produces the two-pane structure at the validated width', () => {
    const doc = parse(renderMarkdown(columnSource('{left=40}', 'Left text', 'Right text')))
    const root = doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)
    expect(root, 'a column root must exist').not.toBeNull()
    expect(root?.getAttribute('data-left')).toBe('40')

    const left = doc.querySelector(LEFT_PANE_SELECTOR)
    const right = doc.querySelector(RIGHT_PANE_SELECTOR)
    expect(left?.textContent).toContain('Left text')
    expect(right?.textContent).toContain('Right text')
    // The split is real: neither pane holds the other's text.
    expect(left?.textContent).not.toContain('Right text')
    expect(right?.textContent).not.toContain('Left text')
    // And the width is applied to the left pane, with the right taking the rest.
    // Both grow by their own share, so the rendered ratio really is 40:60 — see
    // the `renderRow` note for what happens when the last pane is left at `1 1 0%`.
    expect(left?.getAttribute('style')).toBe('flex: 40 1 0%')
    expect(right?.getAttribute('style')).toBe('flex: 60 1 0%')
  })

  it('emits a focusable separator with slider semantics between the panes', () => {
    // The WAI pattern for a resizable boundary: a focusable separator with
    // slider semantics. There is no semantic element for a draggable vertical
    // divider, so the role is the contract.
    const doc = parse(renderMarkdown(columnSource('{left=40}', 'L', 'R')))
    const divider = doc.querySelector(columns.COLUMNS_DIVIDER_SELECTOR)
    expect(divider?.getAttribute('role')).toBe('separator')
    expect(divider?.getAttribute('aria-orientation')).toBe('vertical')
    expect(divider?.getAttribute('tabindex')).toBe('0')
    expect(divider?.getAttribute('aria-valuenow')).toBe('40')
    // The bounds are the grammar's, so the announced range cannot be one the
    // drag cannot reach.
    expect(divider?.getAttribute('aria-valuemin')).toBe('1')
    expect(divider?.getAttribute('aria-valuemax')).toBe('99')
    // An accessible name is required on an interactive element.
    expect(divider?.getAttribute('aria-label')).toBeTruthy()
  })

  it('treats an absent width as the default, and does not call it an error', () => {
    // Absent is not invalid. A reader who writes `:::columns` with no options
    // wants a layout, and there is nothing to correct.
    const doc = parse(renderMarkdown(columnSource('', 'L', 'R')))
    const root = doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)
    expect(root?.getAttribute('data-left')).toBe('50')
    expect(root?.hasAttribute(columns.COLUMNS_REJECTED_ATTR)).toBe(false)
    expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)).toBeNull()
  })

  it('uses a `[...]` caption as the divider label when one is given', () => {
    const doc = parse(renderMarkdown(columnSource('[Formulae]{left=50}', 'L', 'R')))
    const divider = doc.querySelector(columns.COLUMNS_DIVIDER_SELECTOR)
    expect(divider?.getAttribute('aria-label')).toBe('Formulae')
  })
})

describe('an unclaimed :::name is surfaced, and the paragraph after it survives', () => {
  /**
   * The test that matters most in this file.
   *
   * `micromark-extension-directive`'s serialiser **buffers** a container's body
   * and hands it to the handler as `directive.content`; it is never written to
   * the output. So an unhandled container directive is not unstyled, it is
   * *deleted* — and because an unclosed fence swallows the rest of the
   * document, "the rest of the document" is deleted with it.
   *
   * Measured, with the extension installed and a `columns` handler but no `'*'`
   * fallback: `before\n\n:::warning\n**be careful**\n\nafter\n` renders as
   * `<p>before</p>` and nothing else. Two paragraphs gone, no error anywhere.
   */
  const UNCLOSED = 'before\n\n:::warning\n**be careful**\n\nafter\n'

  it('keeps the content that follows an unclosed unknown directive', () => {
    const doc = parse(renderMarkdown(UNCLOSED))
    expect(doc.body.textContent, 'nothing may be lost').toContain('be careful')
    expect(doc.body.textContent, 'the paragraph after must survive').toContain('after')
  })

  it('shows the unknown name, so the reader can see what RTWiki did not recognise', () => {
    const doc = parse(renderMarkdown(UNCLOSED))
    const unknown = doc.querySelector(`.${columns.COLUMNS_UNKNOWN_CLASS}`)
    expect(unknown, 'an unknown directive must be visible, not silent').not.toBeNull()
    expect(unknown?.textContent).toContain('warning')
    // The author's own content is inside it, rendered as Markdown.
    expect(unknown?.querySelector('strong')?.textContent).toBe('be careful')
  })

  it('keeps the surrounding document intact around a *closed* unknown directive', () => {
    const doc = parse(renderMarkdown('before\n\n:::warning\nbe careful\n:::\n\nafter\n'))
    expect(doc.body.textContent).toContain('before')
    expect(doc.body.textContent).toContain('be careful')
    expect(doc.body.textContent).toContain('after')
    expect(doc.querySelector(`.${columns.COLUMNS_UNKNOWN_CLASS}`)).not.toBeNull()
  })

  it('surfaces a leaf ::name rather than swallowing it', () => {
    // A leaf is a different directive kind with no body, so it reaches the same
    // fallback. Rendered inline, because a leaf cannot hold block content.
    const doc = parse(renderMarkdown('before\n\n::note\n\nafter\n'))
    const unknown = doc.querySelector(`.${columns.COLUMNS_UNKNOWN_CLASS}`)
    expect(unknown, 'a leaf must not vanish').not.toBeNull()
    expect(unknown?.textContent).toContain('note')
    // Inline form: a `<span>`, not a `<div>` that would break the paragraph.
    expect(unknown?.tagName).toBe('SPAN')
    expect(doc.body.textContent).toContain('after')
  })

  it('surfaces an inline :::name used as a text directive, and does not emit panes', () => {
    // `:::columns` inline is not a layout request. It is handed to the fallback
    // so it renders as visible text, rather than putting two block-level panes
    // inside a paragraph.
    const doc = parse(renderMarkdown('Value :::columns here today.'))
    expect(doc.querySelector(columns.COLUMNS_ROOT_SELECTOR), 'no panes inline').toBeNull()
    expect(doc.body.textContent).toContain(':::columns')
  })
})

describe('the width grammar rejects rather than filters', () => {
  /**
   * The grammar is `/^\d{1,3}$/` plus a 1–99 range check, and this is why.
   *
   * DOMPurify's `SAFE_FOR_XML` — on by default, never disabled here — drops any
   * attribute whose value matches `/((--!?|])>)|<\/(style|script|…)/i`, and it
   * runs *before* the allow-list, so `ADD_ATTR`/`ALLOWED_ATTR` cannot rescue it.
   * Measured: `data-left="a-->b"` loses the attribute entirely.
   *
   * `this.encode` does not save it either, because DOMPurify decodes entities
   * before matching: `a--&gt;b` is dropped just as `a-->b` is. So the only
   * reliable answer is to make those sequences unreachable at the grammar.
   */
  it.each([
    ['a mermaid arrow', 'a-->b'],
    ['a bare closer', 'a]>b'],
    ['a comment opener', 'a<!--b'],
    ['a style close', 'a</style>b'],
    ['a css length', '40%'],
    ['a length pair', '60 40'],
    ['a signed number', '+40'],
    ['a padded number', ' 40 '],
    ['four digits', '1000'],
    ['zero', '0'],
    ['a hundred', '100'],
    ['empty', '']
  ])('rejects %s, and says so', (_label, value) => {
    const html = renderMarkdown(columnSource(`{left="${value}"}`, 'L', 'R'))
    const doc = parse(html)
    const root = doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)
    // Rejected: the default is used, and the root says the authored value was
    // not accepted. Silently accepting or silently clamping would both hide
    // the typo that caused it.
    expect(root?.getAttribute('data-left')).toBe('50')
    expect(root?.hasAttribute(columns.COLUMNS_REJECTED_ATTR), `${value} must be rejected`).toBe(
      true
    )
    // The content is still rendered, both halves.
    expect(leftPane(html)?.textContent).toContain('L')
    expect(rightPane(html)?.textContent).toContain('R')
  })

  it.each(['1', '50', '99'])('accepts the valid width %s without a notice', (value) => {
    const html = renderMarkdown(columnSource(`{left=${value}}`, 'L', 'R'))
    const doc = parse(html)
    expect(doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)?.getAttribute('data-left')).toBe(value)
    expect(doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)).toBeNull()
  })

  it('never lets a rejected value reach an emitted attribute', () => {
    // The property the grammar exists to guarantee, asserted on the DOM: no
    // attribute anywhere in the rendered block may carry the hostile text.
    for (const value of ['a-->b', 'a]>b', 'a</style>b', 'expression(alert(1))']) {
      const html = renderMarkdown(columnSource(`{left="${value}"}`, 'L', 'R'))
      const doc = parse(html)
      for (const element of doc.querySelectorAll('*')) {
        for (const attr of [...element.attributes]) {
          expect(attr.value, `${attr.name} carried the rejected value`).not.toContain('-->')
          expect(attr.value, `${attr.name} carried the rejected value`).not.toContain(']>')
          expect(attr.value, `${attr.name} carried the rejected value`).not.toContain('style')
        }
      }
    }
  })

  it('quotes the rejected value as text, escaped, never as markup', () => {
    // The notice echoes the author's own value, which is the whole point of it.
    // It is therefore encoded, and asserted here as text rather than as markup.
    const doc = parse(renderMarkdown(columnSource('{left="<b>x</b>"}', 'L', 'R')))
    // The class constants are bare class names, so a selector needs its dot.
    const notice = doc.querySelector(`.${columns.COLUMNS_NOTICE_CLASS}`)
    const text = notice?.textContent
    expect(typeof text).toBe('string')
    expect(text as string).toContain('<b>x</b>')
    // The parser escapes raw HTML, so it is text and never an element. Asserted
    // on the notice itself rather than the whole document, because `notice` is
    // an Element and `toBeNull` on it would not compare.
    expect(notice?.querySelector('b')).toBeNull()
    expect(doc.querySelector('.rt-cols b')).toBeNull()
  })
})

describe('nesting requires a strictly longer outer fence, and the leak is pinned', () => {
  /**
   * Measured across eight fence-length pairs. The rule is not "the outer fence
   * should be longer"; it is that an **equal-length** pair does not nest, and
   * the trailing fence leaks as a stray paragraph.
   */
  it('closes cleanly when the outer fence is strictly longer', () => {
    const html = renderMarkdown(
      ['::::columns{left=30}', ':::columns{left=60}', 'X', ':::', '', '***', '', 'Y', '::::'].join(
        '\n'
      )
    )
    const doc = parse(html)
    // A `::::columns` nested inside a `::::columns` has already rendered itself,
    // dividers and all, so exactly **one** row exists. Two would mean the outer
    // had wrapped a complete inner block in a second row — which is what the
    // first draft of the generalisation did, measured.
    expect(doc.querySelectorAll(columns.COLUMNS_ROOT_SELECTOR)).toHaveLength(1)
    // Its two panes and its one divider survive.
    expect(allPanes(html)).toHaveLength(2)
    expect(doc.querySelectorAll(columns.COLUMNS_DIVIDER_SELECTOR)).toHaveLength(1)
    expect(doc.body.textContent).toContain('X')
    expect(doc.body.textContent).toContain('Y')
    // And no fence leaked into the output.
    expect(doc.body.textContent, 'a stray fence is content corruption').not.toContain(':::')
  })

  it('leaks a stray fence for an equal-length pair, and the leak is visible', () => {
    /**
     * **Pinned, not endorsed.**
     *
     * An equal-length pair is not nested by the extension, so the trailing
     * fence is parsed as a paragraph. Measured across fence lengths: a 3/3 pair
     * leaks `<p>:::</p>` and a 4/4 pair leaks `<p>::::</p>` — the leak is the
     * trailing fence verbatim, at whatever length was used.
     *
     * Asserted because it is real user-visible behaviour, and a reader who hits
     * it needs it written down rather than discovered.
     */
    for (const [fence, expected] of [
      [':::', '<p>:::</p>'],
      ['::::', '<p>::::</p>'],
      [':::::', '<p>:::::</p>']
    ]) {
      const html = renderMarkdown(`${fence}columns\n${fence}inner\n${fence}\n${fence}`)
      expect(html, `equal-length ${fence.length} fence`).toContain(expected)
    }
  })

  it('shows the leaked fence to the reader rather than hiding it', () => {
    // Whatever the extension does, RTWiki must not silently swallow it. The
    // text is in the document, so a reader can see and fix the source.
    const doc = parse(renderMarkdown('::::columns\n::::inner\n::::\n::::'))
    expect(doc.body.textContent).toContain(':::')
  })
})

describe('the no-space syntax is what micromark accepts', () => {
  it.each([
    ['::: columns', '::: columns\nleft\n:::'],
    [':::columns {left=40}', ':::columns {left=40}\nleft\n:::']
  ])('renders %s as literal text, not a directive', (label, source) => {
    /**
     * micromark forbids a space before the name and before the attribute brace.
     * Pandoc and Quarto **require** those spaces, so the two cannot be
     * reconciled without forking the tokeniser. RTWiki adopts micromark's form.
     *
     * The failure mode is the property that makes this acceptable: a **visible
     * literal paragraph** containing the reader's own text, never silent loss.
     */
    const doc = parse(renderMarkdown(source))
    expect(doc.querySelector(columns.COLUMNS_ROOT_SELECTOR), label).toBeNull()
    expect(doc.querySelector('p')?.textContent, `${label} must be visible`).toContain(':::')
    expect(doc.body.textContent).toContain('left')
  })
})

describe('splitAtDivider splits at a top-level boundary and never throws', () => {
  it('splits at a top-level <hr> and round-trips the input exactly', () => {
    const content = '<p>left</p>\n<hr />\n<p>right</p>\n'
    const split = columns.splitAtDivider(content)
    expect(split.found).toBe(true)
    expect(split.left).toBe('<p>left</p>\n')
    expect(split.right).toBe('\n<p>right</p>\n')
    expect(split.marker).toBe('<hr />')
    // The round trip: left + marker + right is byte-identical to the input, so
    // the splitter loses nothing it did not choose to split at.
    expect(`${split.left}${split.marker}${split.right}`).toBe(content)
  })

  it('splits at the FIRST top-level <hr>, keeping the rest on the right', () => {
    const split = columns.splitAtDivider('<p>a</p>\n<hr />\n<p>b</p>\n<hr />\n<p>c</p>')
    expect(split.found).toBe(true)
    expect(split.left).toBe('<p>a</p>\n')
    expect(split.right).toContain('<p>b</p>')
    expect(split.right).toContain('<p>c</p>')
  })

  it('splits on a top-level <hr> even when nested <hr>s come first', () => {
    // The reason a regex cannot do this job: an <hr> inside a list item or a
    // blockquote is a horizontal rule *within a document*, not between panes.
    // The nested one must be skipped; the top-level one is the boundary.
    for (const [label, nested, content] of [
      [
        'in a blockquote',
        '<blockquote>\n<p>q</p>\n<hr />\n</blockquote>',
        '<blockquote>\n<p>q</p>\n<hr />\n</blockquote>\n<hr />\n<p>after</p>'
      ],
      [
        'in a table cell',
        '<table>\n<tbody>\n<tr><td>cell<hr /></td></tr>\n</tbody>\n</table>',
        '<table>\n<tbody>\n<tr><td>cell<hr /></td></tr>\n</tbody>\n</table>\n<hr />\n<p>after</p>'
      ],
      [
        'inside a list item',
        '<ul>\n<li>a\n\n<hr />\n\nb</li>\n</ul>',
        '<ul>\n<li>a\n\n<hr />\n\nb</li>\n</ul>\n<hr />\n<p>after</p>'
      ]
    ]) {
      const split = columns.splitAtDivider(content)
      expect(split.found, label).toBe(true)
      // The nested rule stayed in the left pane rather than being mistaken for
      // the boundary: it is still inside the element that opened before it.
      expect(split.left, label).toContain(nested)
      // And the split happened at the top-level rule, after the nested element
      // was closed — so the right pane is the content after it.
      expect(split.right, label).toBe('\n<p>after</p>')
      // The round trip holds: nothing was dropped to find the boundary.
      expect(`${split.left}${split.marker}${split.right}`).toBe(content)
    }
  })

  it('does not split on an <hr> that is only ever nested', () => {
    // No top-level <hr> at all, so there is no boundary to find and the content
    // is returned whole — never a split at the wrong depth.
    for (const content of [
      '<blockquote>\n<p>q</p>\n<hr />\n</blockquote>\n<p>after</p>',
      '<table>\n<tbody>\n<tr><td>cell<hr /></td></tr>\n</tbody>\n</table>\n<p>after</p>'
    ]) {
      const split = columns.splitAtDivider(content)
      expect(split.found, content.slice(0, 30)).toBe(false)
      expect(split.left).toBe(content)
    }
  })

  it.each([
    ['an unclosed tag', '<p>text'],
    ['a stray closing tag', '</p><hr />'],
    ['an unterminated comment', '<p>a</p>\n<!-- oops\n<hr />'],
    ['a truncated tag', '<p>a</p>\n< hr /'],
    ['an angle bracket in text', '2 < 3 and 4 > 1\n<hr />']
  ])('returns the content unsplit for %s', (_label, content) => {
    // Assigned outside any closure so control-flow analysis keeps the type: a
    // `let` written only inside an arrow function is narrowed to `never`
    // afterwards, which would make these assertions untypeable.
    const split = columns.splitAtDivider(content)
    // Whatever the input, the whole content is preserved in the left pane and
    // the right pane is empty. Content is never dropped by a failed split.
    expect(split.left).toBe(content)
    expect(split.right).toBe('')
    expect(split.found).toBe(false)
  })

  it('does not throw on any of the malformed inputs above', () => {
    /**
     * The bounded-failure contract, asserted as its own case.
     *
     * A splitter that threw would take down the whole preview for one malformed
     * note, so this is worth a separate assertion rather than being inferred
     * from the values: the function must return for every input, including ones
     * that are not well-formed HTML at all.
     */
    for (const content of [
      '',
      '<',
      '<<<',
      '<p',
      '<p>',
      '</p>',
      '<p><p></p>',
      '<!--',
      '<!-- unterminated',
      '<?php echo 1; ?>',
      '<!DOCTYPE html>',
      '<![CDATA[x]]>',
      'plain text',
      '2 < 3',
      '<a href=">',
      '<a href="x" >'
    ]) {
      expect(() => columns.splitAtDivider(content), JSON.stringify(content)).not.toThrow()
    }
  })

  it('returns unsplit for empty content and for content with no divider', () => {
    for (const content of ['', '<p>only one pane</p>\n', 'text with no markup']) {
      const split = columns.splitAtDivider(content)
      expect(split.found, JSON.stringify(content)).toBe(false)
      expect(split.left).toBe(content)
      expect(split.right).toBe('')
    }
  })

  it('renders a block with no divider as one pane and an empty right, not an error', () => {
    // The bounded failure mode, end to end through the real render path.
    const html = renderMarkdown(':::columns{left=40}\nonly one side\n:::')
    const doc = parse(html)
    expect(doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)).not.toBeNull()
    expect(leftPane(html)?.textContent).toContain('only one side')
    expect(rightPane(html)?.textContent?.trim()).toBe('')
  })

  it('does not treat a > inside an attribute value as the end of a tag', () => {
    // micromark escapes `>` in attribute values on the way out, so this is
    // defence in depth rather than a case that occurs today — but a splitter
    // that trusted `>` would put a `title="a` fragment into a pane.
    const content = '<p title="a > b">x</p>\n<hr />\n<p>y</p>'
    const split = columns.splitAtDivider(content)
    expect(split.found).toBe(true)
    expect(split.left).toBe('<p title="a > b">x</p>\n')
    expect(`${split.left}${split.marker}${split.right}`).toBe(content)
  })
})

describe('a column block cannot become an injection vector', () => {
  it('produces no script, no iframe, and no event handler', () => {
    for (const source of [
      columnSource('{left=40}', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>'),
      columnSource('{left="javascript:alert(1)"}', 'L', 'R'),
      columnSource('', '<iframe src="https://evil.test"></iframe>', 'R')
    ]) {
      const doc = parse(renderMarkdown(source))
      expect(doc.querySelectorAll('script')).toHaveLength(0)
      expect(doc.querySelectorAll('iframe')).toHaveLength(0)
      for (const element of doc.querySelectorAll('*')) {
        for (const attr of [...element.attributes]) {
          expect(attr.name.toLowerCase(), `${element.tagName} kept ${attr.name}`).not.toMatch(/^on/)
          expect(attr.value.toLowerCase()).not.toContain('javascript:')
        }
      }
    }
  })

  it('the only style value it emits is a flex shorthand on a validated integer', () => {
    /**
     * DOMPurify does not sanitise `style` attribute *contents* — measured:
     * `style="width:expression(…)"` survives verbatim. So the value here is not
     * protected by the sanitiser at all, and the only thing making it safe is
     * that `markdown-columns.ts` builds it from a number it parsed itself.
     *
     * The pattern is deliberately closed: `flex: <integer> 1 0%` and nothing
     * else. A `px`, `%`, `rem` or `expression` in that position fails here.
     */
    for (const source of [
      columnSource('{left="expression(alert(1))"}', 'L', 'R'),
      columnSource('{left="10px"}', 'L', 'R'),
      '::::columns\n:::column{width="expression(alert(1))"}\nL\n:::\n\n:::column\nR\n:::\n::::'
    ]) {
      for (const element of parse(renderMarkdown(source)).querySelectorAll('*')) {
        const style = element.getAttribute('style')
        if (style === null) continue
        expect(style, 'a style value from the document reached an element').toMatch(
          /^flex: \d+ 1 0%$/
        )
      }
    }
  })
})

describe('the directive extension leaves everything else alone', () => {
  /**
   * DEVELOPMENT_STANDARDS §15 requires an extension to leave every construct it
   * does not claim byte-identical to stock micromark. The directive extension is
   * the one that makes this hard, because merely *installing* `directiveHtml`
   * changes how `:::` is tokenised — so this asserts the real, measured
   * boundary rather than a claim that nothing changed.
   */
  it('renders GFM and maths exactly as before the directive extension', () => {
    const source = [
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '- [x] done',
      '',
      '~~gone~~',
      '',
      'https://example.com',
      '',
      'A note[^1].',
      '',
      '[^1]: the note',
      '',
      'Math $E=mc^2$ here'
    ].join('\n')
    const doc = parse(renderMarkdown(source))
    expect(doc.querySelector('table th')?.textContent).toBe('a')
    expect(doc.querySelector('li input[type="checkbox"]')).not.toBeNull()
    expect(doc.querySelector('del')?.textContent).toBe('gone')
    expect(doc.querySelector('a[href="https://example.com"]')).not.toBeNull()
    expect(doc.body.textContent).toContain('the note')
    expect(doc.querySelector('.katex'), 'maths must survive').not.toBeNull()
  })

  it('renders raw HTML inert, as the parser decision requires', () => {
    const doc = parse(renderMarkdown(columnSource('{left=50}', '<b>raw</b>', '<script>x</script>')))
    expect(doc.querySelector('b')).toBeNull()
    expect(doc.querySelectorAll('script')).toHaveLength(0)
  })

  it('a leaf :::columns renders panes with no content, rather than disappearing', () => {
    const doc = parse(renderMarkdown('::columns{left=30}'))
    expect(doc.querySelector(columns.COLUMNS_ROOT_SELECTOR)).not.toBeNull()
    expect(doc.querySelector(columns.COLUMNS_DIVIDER_SELECTOR)).not.toBeNull()
  })
})
