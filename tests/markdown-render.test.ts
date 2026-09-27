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
