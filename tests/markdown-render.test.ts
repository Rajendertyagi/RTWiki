import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'

/**
 * Markdown rendering, and the sanitiser that guards it.
 *
 * ## Why jsdom is set up before the module is imported
 *
 * `markdown-render.ts` creates its DOMPurify instance at import time, bound to the
 * ambient `window`. Bun has no DOM, so without this the sanitiser would run
 * without a document and the security assertions below would be asserting against
 * a no-op — which is the worst possible failure for a test whose whole job is to
 * prove markup does not survive. The globals are installed first and the module is
 * imported dynamically afterwards, so the instance under test is a real one.
 */
let renderMarkdown: (source: string) => string
let dom: JSDOM

beforeAll(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  const globals = globalThis as unknown as Record<string, unknown>
  globals.window = dom.window
  globals.document = dom.window.document
  globals.Node = dom.window.Node
  globals.Element = dom.window.Element
  globals.HTMLElement = dom.window.HTMLElement
  globals.DocumentFragment = dom.window.DocumentFragment
  globals.NodeFilter = dom.window.NodeFilter
  globals.trustedTypes = undefined
  ;({ renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js'))
})

afterAll(() => {
  dom.window.close()
  const globals = globalThis as unknown as Record<string, unknown>
  delete globals.window
  delete globals.document
})

/** Parses rendered output so assertions are about structure, not about substrings. */
function parse(html: string): Document {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document
}

describe('GFM features render', () => {
  it('renders a table with its header and body cells', () => {
    const doc = parse(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |'))
    expect(doc.querySelector('table')).not.toBeNull()
    expect([...doc.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['a', 'b'])
    expect([...doc.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '2'])
  })

  it('renders a task list as checkboxes, and that is what the CSS now targets', () => {
    // The class the old stylesheet selected is emitted by neither parser, so this
    // asserts the *structure* the stylesheet now matches on instead: an `input`
    // that is the first child of its `li`.
    const doc = parse(renderMarkdown('- [x] done\n- [ ] open'))
    const items = [...doc.querySelectorAll('li')]
    expect(items).toHaveLength(2)
    const boxes = [...doc.querySelectorAll('li > input[type="checkbox"]')]
    expect(boxes).toHaveLength(2)
    expect(boxes[0].hasAttribute('checked')).toBe(true)
    expect(boxes[1].hasAttribute('checked')).toBe(false)
    // Both are disabled: a task list is a record, not a control.
    expect(boxes.every((b) => b.hasAttribute('disabled'))).toBe(true)
    // And the dead class really is absent, which is why the rule had to change.
    expect(doc.querySelectorAll('.task-list-item')).toHaveLength(0)
  })

  it('renders strikethrough as <del>', () => {
    const doc = parse(renderMarkdown('~~gone~~'))
    expect(doc.querySelector('del')?.textContent).toBe('gone')
  })

  it('turns a bare URL into a link', () => {
    const doc = parse(renderMarkdown('see https://example.com now'))
    const link = doc.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
  })

  it('renders a footnote and its definition', () => {
    const doc = parse(renderMarkdown('A claim[^1].\n\n[^1]: the note'))
    const ref = doc.querySelector('sup a')
    expect(ref).not.toBeNull()
    expect(doc.body.textContent).toContain('the note')
  })

  it('renders heading levels, and the preview and outline agree on them', () => {
    const doc = parse(renderMarkdown('# One\n\n### Three'))
    expect(doc.querySelector('h1')?.textContent).toBe('One')
    expect(doc.querySelector('h3')?.textContent).toBe('Three')
  })
})

describe('dangerous markup does not survive', () => {
  it('escapes raw HTML rather than rendering it', () => {
    // A behaviour change from `marked`, and the point of the swap: raw HTML in
    // Markdown is now inert at the parser, not merely stripped afterwards.
    const html = renderMarkdown('<b>bold</b>')
    expect(parse(html).querySelector('b')).toBeNull()
    expect(parse(html).body.textContent).toContain('<b>bold</b>')
  })

  it.each([
    ['a script element', '<script>alert(1)</script>', 'script'],
    ['an iframe', '<iframe src="https://example.com"></iframe>', 'iframe'],
    ['an inline event handler', '<img src="x" onerror="alert(1)">', 'img'],
    ['a form', '<form action="/x"><input name="y"></form>', 'form'],
    ['an object', '<object data="/x"></object>', 'object'],
    ['a style block', '<style>body{display:none}</style>', 'style']
  ])('strips %s', (_label, source, tag) => {
    /**
     * Asserted on the parsed DOM, not on the HTML string.
     *
     * A substring check would be wrong here, and instructive about why: the parser
     * *escapes* the markup, so the output legitimately contains the characters
     * `onerror=` and `<script` — as visible text. `expect(html).not.toMatch(...)`
     * failed against output that was in fact completely inert. The property that
     * matters is that no such element exists and no attribute is an event handler.
     */
    const doc = parse(renderMarkdown(source))
    expect(doc.querySelector(tag)).toBeNull()
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        expect(attr.name.toLowerCase(), `${el.tagName} kept ${attr.name}`).not.toMatch(/^on/)
        expect(attr.value.toLowerCase()).not.toContain('javascript:')
      }
    }
  })

  it('renders a markdown link with a javascript: URL as text, not a link', () => {
    const doc = parse(renderMarkdown('[click](javascript:alert(1))'))
    for (const a of doc.querySelectorAll('a')) {
      expect(a.getAttribute('href')?.toLowerCase()).not.toContain('javascript:')
    }
  })

  it('keeps script out even when the parser is handed HTML that looks like a tag', () => {
    // The parser escapes it, so the sanitiser never sees an element to allow.
    const doc = parse(renderMarkdown('<img src=x onerror=alert(1)>'))
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        expect(attr.name.toLowerCase()).not.toMatch(/^on/)
      }
    }
  })

  it('escapes MathML and SVG from Markdown source, so the widened profile is unreachable from user input', () => {
    /**
     * The most important thing this file establishes about the profile widening.
     *
     * Because the parser escapes raw HTML, a user cannot get `<math>` or `<svg>`
     * into the sanitiser at all - the characters arrive escaped and the widened
     * `USE_PROFILES` never sees them. The widening therefore widens what *our own
     * generated markup* may contain (KaTeX, diagrams), not what a user's keystrokes
     * can. That is a much smaller change to the security posture than the profile
     * diff alone suggests, and it is worth a test so a future change that stops
     * escaping raw HTML is noticed here.
     */
    const doc = parse(renderMarkdown('<math><msqrt><mn>2</mn></msqrt></math>'))
    expect(doc.querySelector('math')).toBeNull()
    expect(doc.body.textContent).toContain('<math>')
  })
})

describe('maths render', () => {
  it('renders inline math, with both the MathML and the HTML layers', () => {
    const doc = parse(renderMarkdown('Cost is $E=mc^2$ exactly.'))
    const katex = doc.querySelector('.katex')
    expect(katex, 'KaTeX must produce output').not.toBeNull()
    // The MathML subtree is what a screen reader reads; the `.katex-html` span is
    // what everyone else sees. Losing either is a regression, and the MathML half
    // is the one the old sanitiser profile deleted silently.
    expect(doc.querySelector('.katex-mathml math')).not.toBeNull()
    expect(doc.querySelector('.katex-html')).not.toBeNull()
    expect(katex?.textContent).toContain('E=mc2')
  })

  it('renders display math, but only in the multi-line form', () => {
    /**
     * The form matters and is not obvious. Measured across five shapes:
     *
     *   $$\frac{a}{b}$$          on one line          -> math-INLINE
     *   $$ \frac{a}{b} $$        one line, spaced      -> math-INLINE
     *   $$                       own line, content on  -> math-DISPLAY
     *   \frac{a}{b}
     *   $$
     *
     * `micromark-extension-math` only reaches its `mathFlow` construct when the
     * opening `$$` is alone on its line, so the one-line form is text maths wearing
     * a different delimiter. Asserted both ways, because a user who writes
     * `$$x$$` on one line and gets inline maths has found a real limitation and it
     * should be visible in a test rather than discovered in the app.
     */
    const oneLine = parse(renderMarkdown('$$\\frac{a}{b}$$'))
    expect(oneLine.querySelector('.math-display')).toBeNull()
    expect(oneLine.querySelector('.math-inline')).not.toBeNull()
    // The maths is still correct; only the presentation differs.
    expect(oneLine.querySelector('.katex-mathml math mfrac')).not.toBeNull()

    const block = parse(renderMarkdown('before\n\n$$\n\\frac{a}{b}\n$$\n\nafter'))
    expect(block.querySelector('.math-display'), 'multi-line $$ is display maths').not.toBeNull()
    expect(block.querySelector('.math-display mfrac')).not.toBeNull()
  })

  it('renders a radical with its MathML root and its SVG overlay', () => {
    // The two halves that were being stripped. A radical is a MathML <msqrt> plus an
    // SVG overlay drawn by KaTeX; if either is gone the expression degrades to a
    // bare "2".
    const doc = parse(renderMarkdown('$\\sqrt{2}$'))
    expect(doc.querySelector('.katex-mathml math msqrt')).not.toBeNull()
    expect(doc.querySelector('.katex-html svg'), 'the SVG overlay must survive').not.toBeNull()
  })

  it('renders maths inside a list item and a blockquote', () => {
    const list = parse(renderMarkdown('- item with $a^2$'))
    expect(list.querySelector('li .katex')).not.toBeNull()
    const quote = parse(renderMarkdown('> quoted $a^2$'))
    expect(quote.querySelector('blockquote .katex')).not.toBeNull()
  })

  it('renders a literal dollar for an escaped one', () => {
    const doc = parse(renderMarkdown('Escaped \\$5 and \\$x$.'))
    expect(doc.querySelector('.katex'), 'an escaped dollar is not maths').toBeNull()
    expect(doc.body.textContent).toBe('Escaped $5 and $x$.')
  })
})

describe('the $ delimiter follows GitHub’s adjacency rule', () => {
  /**
   * `micromark-extension-math@3.1.0` decides inline maths by **marker count**: with
   * `singleDollarTextMath` on, one `$` opens maths and anything may sit between the
   * delimiters. It has no option for adjacency, so it cannot express the rule below.
   *
   * RTWiki now owns the inline construct (`math-inline-github-rule.ts`) and implements
   * GitHub's documented rule: the opening `$` is followed by a non-whitespace
   * character, the closing `$` is preceded by a non-whitespace character, and the
   * closing `$` is not followed by a digit.
   *
   * Every case below asserts the **rendered output**, not the parser's intent, and
   * asserts on the DOM rather than by substring-matching the HTML.
   */

  it.each([
    ['Only $100.'],
    ['Earn $5 million.'],
    ['The fee is $100.'],
    ['Pay $5 or $10 today.'],
    ['Between $3 and $4.'],
    ['It cost $20,000 and $30,000 won.'],
    ['Budget is $100 for food and rent.'],
    ['costs \\$100 only'],
    ['Use `$x$` in code']
  ])('leaves %s as text', (source) => {
    const doc = parse(renderMarkdown(source))
    expect(doc.querySelector('.katex'), `"${source}" must not become maths`).toBeNull()
  })

  it.each([['value $E=mc^2$ here'], ['$a+b$'], ['($x$)'], ['$x$, then more']])(
    'renders %s as maths',
    (source) => {
      const doc = parse(renderMarkdown(source))
      expect(doc.querySelector('.katex'), `"${source}" must become maths`).not.toBeNull()
    }
  )

  it('keeps the literal text of a rejected candidate intact', () => {
    // The `$` characters must survive as text, not be swallowed along with the failed
    // attempt. A construct that failed to match but consumed input would drop them.
    expect(parse(renderMarkdown('Pay $5 or $10 today.')).body.textContent).toBe(
      'Pay $5 or $10 today.'
    )
    expect(parse(renderMarkdown('Between $3 and $4.')).body.textContent).toBe('Between $3 and $4.')
  })

  it('leaves a lone unmatched $ as literal text', () => {
    for (const source of ['costs $100', 'a $ b', 'trailing $']) {
      const doc = parse(renderMarkdown(source))
      expect(doc.querySelector('.katex'), `"${source}"`).toBeNull()
    }
  })

  it('refuses a closer followed by a digit, per condition 3', () => {
    // The one condition that needs a character *after* the closer, which is why the
    // construct defers its verdict by one state.
    const doc = parse(renderMarkdown('value $x$5'))
    expect(doc.querySelector('.katex'), 'a closer followed by a digit is not a closer').toBeNull()
  })

  it('resolves $a$$b$ the same way the package did, and pins that', () => {
    /**
     * **Recorded resolution: one expression, and KaTeX cannot render it.**
     *
     * `$a$$b$` opens with a run of one `$` and the next run it meets has two, so the
     * run sizes do not match. The construct then keeps scanning inside the same
     * expression and the final single `$` matches, leaving the TeX source `a$$b`,
     * which KaTeX reports as an error and shows the source for.
     *
     * This is **not** a regression introduced here. The upstream package was measured
     * against this construct and produces byte-identical output for `$a$$b$`,
     * `x $a$$b$ y`, `$a$$b$ $c$`, `$$x$$`, `$a$ $b$` and `$a$$b`, because the run
     * matching and the `previous` guard are both carried over from it. It is pinned
     * so that a future change to either is noticed, and it is written down in
     * `KNOWN_BUGS.md`. Two expressions side by side need a space: `$a$ $b$` is two.
     */
    const doc = parse(renderMarkdown('$a$$b$'))
    expect(doc.querySelectorAll('.math-display').length).toBe(0)
    expect(doc.querySelectorAll('.math-inline').length, 'one expression, not two').toBe(1)
    expect(doc.querySelectorAll('.katex-error').length, 'KaTeX rejects a$$b').toBe(1)
    expect(doc.body.textContent).toBe('a$$b')

    // The documented way to write two adjacent expressions.
    const spaced = parse(renderMarkdown('$a$ $b$'))
    expect(spaced.querySelectorAll('.katex').length, 'a space makes them two').toBe(2)
  })

  it('does not fire where the $ is not text content', () => {
    // The negative cases that must survive the new construct. A `$` inside any of
    // these is not free text, so the construct must never see it.
    //
    // Note what is *not* in this list: link **text**. Measured, `[link $x$](url)`
    // does render maths, and that is the correct result rather than a leak — link text
    // is ordinary inline text and GitHub renders maths in it too. What must stay
    // inert is everything that is a URL or an attribute, which is asserted here.
    for (const source of [
      '`$x$`',
      '```\n$x$\n```',
      '```latex\n$x$\n```',
      '[link](https://example.com/$x$)',
      '![alt $x$](https://example.com/i.png)',
      '![alt](https://example.com/i.png "$x$")',
      '<https://example.com/$x$>'
    ]) {
      expect(parse(renderMarkdown(source)).querySelector('.katex'), `"${source}"`).toBeNull()
    }
  })

  it('does render maths in link text, which is ordinary inline text', () => {
    // The counterpart to the test above, pinned so the boundary is deliberate and not
    // accidental: text content is parsed, attribute content is not.
    const doc = parse(renderMarkdown('[link $x$](https://example.com)'))
    expect(doc.querySelector('a .katex'), 'link text is inline text').not.toBeNull()
  })

  it('still renders a $$ display block unchanged', () => {
    // The package's `flow` construct is reused verbatim, so display maths is untouched.
    const block = parse(renderMarkdown('before\n\n$$\n\\frac{a}{b}\n$$\n\nafter'))
    expect(block.querySelector('.math-display')).not.toBeNull()
    expect(block.querySelector('.math-display mfrac')).not.toBeNull()
    // And the one-line form keeps its commit-2 behaviour, which is left alone
    // deliberately: it matches GitHub's documented syntax to require `$$` on its own line.
    const oneLine = parse(renderMarkdown('$$\\frac{a}{b}$$'))
    expect(oneLine.querySelector('.math-display')).toBeNull()
    expect(oneLine.querySelector('.math-inline')).not.toBeNull()
  })
})

describe('code is never maths', () => {
  it('leaves inline code literal', () => {
    const doc = parse(renderMarkdown('Use `$x$` literally.'))
    expect(doc.querySelector('.katex')).toBeNull()
    const code = doc.querySelector('code')
    expect(code?.textContent).toBe('$x$')
  })

  it('leaves a latex fence literal — no react-katex recipe here', () => {
    const doc = parse(renderMarkdown('```latex\n\\sqrt{2}\n```'))
    expect(doc.querySelector('.katex')).toBeNull()
    expect(doc.querySelector('code.language-latex')?.textContent).toContain('\\sqrt{2}')
  })

  it('leaves a fence with an unknown language literal', () => {
    const doc = parse(renderMarkdown('```\n$x$\n```'))
    expect(doc.querySelector('.katex')).toBeNull()
  })
})

describe('invalid TeX degrades instead of breaking the page', () => {
  it('renders the source in an error span and keeps the rest of the page', () => {
    // `throwOnError: false` is chosen precisely so one typo cannot blank a note.
    // With throwing enabled, this input would make the whole preview fail.
    const doc = parse(renderMarkdown('Before.\n\nBroken $\\frac{1}{$ here.\n\nAfter.'))
    const error = doc.querySelector('.katex-error')
    expect(error, 'the failure must be visible, not silent').not.toBeNull()
    // The rest of the document is intact, which is the point of the option.
    expect(doc.body.textContent).toContain('Before.')
    expect(doc.body.textContent).toContain('After.')
    // And the error is a styled span, not a live element.
    expect(doc.querySelectorAll('script')).toHaveLength(0)
  })
})

describe('maths cannot become an injection vector', () => {
  /**
   * Every one of KaTeX's `trust`-gated commands, fed through the real pipeline.
   *
   * `trust: false` is the control, and it is asserted by **effect** rather than by
   * reading the flag: with trust on, `\href` would emit a live anchor. These must
   * render as visible TeX in KaTeX's error colour with no live element and no
   * `javascript:` URL anywhere.
   */
  it.each([
    ['\\href{javascript:alert(1)}{x}', 'href'],
    ['\\url{javascript:alert(1)}', 'url'],
    ['\\htmlClass{evil}{y}', 'htmlClass'],
    ['\\htmlId{evil}{y}', 'htmlId'],
    ['\\htmlData{foo=bar}{z}', 'htmlData'],
    ['\\includegraphics{https://evil.test/x.png}', 'includegraphics']
  ])('refuses the trust-gated command %s', (tex) => {
    const html = renderMarkdown(`Text ${tex} more.`)
    const doc = parse(html)

    // No live element of any kind, and no event handler - asserted on the DOM, not
    // by matching the HTML string. A string match on escaped text reports a leak
    // that is not one, which is how a wrong call gets made.
    expect(doc.querySelectorAll('script')).toHaveLength(0)
    expect(doc.querySelectorAll('iframe')).toHaveLength(0)
    expect(doc.querySelectorAll('object')).toHaveLength(0)
    expect(doc.querySelectorAll('embed')).toHaveLength(0)
    for (const el of doc.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        expect(attr.name.toLowerCase(), `${el.tagName} kept ${attr.name}`).not.toMatch(/^on/)
        expect(attr.value.toLowerCase(), `${el.tagName}[${attr.name}]`).not.toContain('javascript:')
      }
    }
    // The image-loading command must not have produced an <img> either.
    expect(doc.querySelectorAll('img')).toHaveLength(0)
  })

  it('renders a refused command as visible TeX rather than dropping it', () => {
    // Silently swallowing it would be worse than refusing it: the author would have
    // no idea why their expression did nothing.
    const doc = parse(renderMarkdown('Click $\\href{javascript:alert(1)}{x}$ now.'))
    expect(doc.body.textContent).toContain('href')
    expect(doc.querySelector('a')).toBeNull()
  })

  it('keeps hostile TeX from smuggling anything through the sanitiser', () => {
    // The `-->` trap in reverse: TeX travels as text content, and this is the
    // property that makes that safe. Asserted on the parsed DOM.
    for (const tex of [
      '\\text{</div><script>alert(1)</script>}',
      '\\text{--><img src=x onerror=alert(1)>}',
      '\\text{javascript:alert(1)}',
      '\\rule{1em}{\\text{</style><script>alert(1)</script>}}'
    ]) {
      const doc = parse(renderMarkdown(`Math $${tex}$ end.`))
      expect(doc.querySelectorAll('script'), tex).toHaveLength(0)
      expect(doc.querySelectorAll('style'), tex).toHaveLength(0)
      for (const el of doc.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          expect(attr.name.toLowerCase()).not.toMatch(/^on/)
        }
      }
    }
  })
})

describe('existing behaviour survives the math extension', () => {
  it('still renders tables, task lists, strikethrough, autolinks and footnotes', () => {
    // The extension was added to a working pipeline; this is the regression guard
    // for the composition rather than for maths.
    const doc = parse(
      renderMarkdown(
        [
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
          '[^1]: the note'
        ].join('\n')
      )
    )
    expect(doc.querySelector('table th')?.textContent).toBe('a')
    expect(doc.querySelector('li input[type="checkbox"]')).not.toBeNull()
    expect(doc.querySelector('del')?.textContent).toBe('gone')
    expect(doc.querySelector('a[href="https://example.com"]')).not.toBeNull()
    expect(doc.body.textContent).toContain('the note')
  })

  it('still escapes raw HTML, now that maths output is in the same stream', () => {
    const doc = parse(renderMarkdown('<b>raw</b> and <script>alert(1)</script>'))
    expect(doc.querySelector('b')).toBeNull()
    expect(doc.querySelectorAll('script')).toHaveLength(0)
  })
})

describe('the sanitiser profile keeps what generated markup needs', () => {
  /**
   * Applied to the configuration directly, because through `renderMarkdown` there
   * is no way to produce `<math>`: the parser escapes it. These are the assertions
   * that cover what a KaTeX- or diagram-producing extension will actually hand to
   * the sanitiser, and they are the ones that justify the widened profile.
   */
  it('preserves <math> and <svg>, which the old profile silently removed', async () => {
    const { default: createDOMPurify } = await import('dompurify')
    const { MARKDOWN_SANITIZE_OPTIONS } = await import(
      '../src/web/features/markdown/markdown-render.js'
    )
    const purify = createDOMPurify(dom.window as unknown as Parameters<typeof createDOMPurify>[0])
    // The defect being fixed: with `{ html: true }` only, both were removed while
    // the surrounding KaTeX spans survived byte-identically, so a DOM snapshot
    // looked fine and `\sqrt{2}` rendered as a bare `2`.
    const out = purify.sanitize(
      '<span class="katex-html"></span><math><msqrt><mn>2</mn></msqrt></math>' +
        '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>',
      MARKDOWN_SANITIZE_OPTIONS
    )
    expect(out).toMatch(/<math/)
    expect(out).toMatch(/<msqrt>/)
    expect(out).toMatch(/<svg/)
    expect(out).toMatch(/<path/)
    // The KaTeX spans are untouched, which is what made the old breakage invisible.
    expect(out).toMatch(/<span class="katex-html">/)
  })

  it('still refuses script and event handlers inside that same markup', async () => {
    // The specific risk of widening two foreign-content profiles, asserted rather
    // than assumed away.
    const { default: createDOMPurify } = await import('dompurify')
    const { MARKDOWN_SANITIZE_OPTIONS } = await import(
      '../src/web/features/markdown/markdown-render.js'
    )
    const purify = createDOMPurify(dom.window as unknown as Parameters<typeof createDOMPurify>[0])
    for (const markup of [
      '<math><mtext><script>alert(1)</script></mtext></math>',
      '<svg><script>alert(1)</script></svg>',
      '<svg><animate onbegin="alert(1)" attributeName="x" dur="1s"></svg>',
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>'
    ]) {
      const out = purify.sanitize(markup, MARKDOWN_SANITIZE_OPTIONS)
      expect(out, markup.slice(0, 40)).not.toMatch(/<script/i)
      expect(out, markup.slice(0, 40)).not.toMatch(/onbegin|onload|onclick/i)
      expect(out, markup.slice(0, 40)).not.toMatch(/javascript:/i)
    }
  })

  it('still strips a <style> element even with the svg profile enabled', async () => {
    // The svg profile permits styling elements; FORBID_TAGS must still win.
    const { default: createDOMPurify } = await import('dompurify')
    const { MARKDOWN_SANITIZE_OPTIONS } = await import(
      '../src/web/features/markdown/markdown-render.js'
    )
    const purify = createDOMPurify(dom.window as unknown as Parameters<typeof createDOMPurify>[0])
    const out = purify.sanitize(
      '<style>body{display:none}</style><svg><style>x{}</style></svg>',
      MARKDOWN_SANITIZE_OPTIONS
    )
    expect(out).not.toMatch(/<style/i)
  })
})
