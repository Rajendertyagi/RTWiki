import { beforeAll, describe, expect, it } from 'bun:test'
import { micromark } from 'micromark'
import { parseFragment, sharedDom } from './utils/dom-harness.js'

/**
 * ` ```mermaid ` fences in Markdown notes — the parser half.
 *
 * Phase A recognises the fence and emits a placeholder. Hydration is a separate
 * change: `mermaid.render()` is asynchronous and micromark's compiler is
 * synchronous, so nothing here renders, configures Mermaid, or imports the
 * editor's renderer. A second Mermaid configuration is the thing this file most
 * needs to prevent, so there is a test for it.
 *
 * ## Why the DOM is installed before the module is imported
 *
 * `markdown-render.ts` creates its DOMPurify instance at import time, bound to the
 * ambient `window`. Without a DOM the sanitiser would be a no-op and every
 * security assertion below would pass while proving nothing — the worst possible
 * failure for a test whose job is to prove markup does not survive. The globals go
 * in first, the module is imported dynamically after. See `dom-harness.ts` for why
 * that DOM is shared and never closed.
 */
let renderMarkdown: (source: string) => string

beforeAll(async () => {
  sharedDom()
  ;({ renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js'))
})

function parse(html: string): Document {
  return parseFragment(html)
}

describe('mermaid fence placeholder', () => {
  it('carries the diagram source as element text', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```')
    expect(html).toContain('rt-mermaid')
    // The arrow must survive. This is the whole transport constraint: see below.
    expect(html).toContain('graph TD; A--&gt;B;')
  })

  it('puts nothing but text inside the source element', () => {
    // `textContent` alone is too weak: a nested `<pre><code>` left over from the
    // fence markup still yields the right `textContent`, so a byte-exact text
    // assertion passes while the DOM is wrong. This was found by breaking
    // `diagramSource` so it stopped stripping the opening fence tag — the text
    // assertions stayed green and 21 others did not notice either.
    const doc = parse(renderMarkdown('```mermaid\ngraph TD; A-->B;\n```'))
    const pre = doc.querySelector('.rt-mermaid-source')
    expect(pre).not.toBeNull()
    expect(pre?.children.length, 'the source element has element children').toBe(0)
    expect(pre?.innerHTML, 'the source element holds markup, not just text').toBe(
      'graph TD; A--&gt;B;'
    )
  })

  it('round-trips the source byte-exact through the sanitiser', () => {
    // Every one of these is a case that has already destroyed a diagram through
    // one channel or another. The quotes and braces are here because a naive
    // implementation reassembles the source from attributes and mangles them.
    const sources = [
      'graph TD; A-->B;',
      'graph TD; A-->|yes| B;',
      'sequenceDiagram\n  A->>B: ends with --> arrow',
      'graph TD; A["quoted"]-->B{"braced"};',
      'graph LR; A-->B; %% "double quoted"',
      'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]'
    ]
    for (const source of sources) {
      const doc = parse(renderMarkdown(['```mermaid', source, '```'].join('\n')))
      const pre = doc.querySelector('.rt-mermaid-source')
      expect(pre, `no source element for: ${source}`).not.toBeNull()
      // textContent, not innerHTML: the value must come back as typed.
      expect(pre?.textContent, `source altered for: ${source}`).toBe(source)
    }
  })

  it('never carries the source in an attribute', () => {
    // DOMPurify's SAFE_FOR_XML strips any attribute value containing `-->`, and it
    // runs before the allow-list, so ADD_ATTR cannot rescue it. Entities do not
    // help either: DOMPurify decodes before matching, so `a--&gt;b` dies the same
    // way. An attribute would therefore lose the diagram with no error.
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```')
    for (const el of Array.from(parse(html).querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value, `attribute ${attr.name} holds the source`).not.toContain('-->')
        expect(attr.value, `attribute ${attr.name} holds an encoded arrow`).not.toContain('--&gt;')
      }
    }
  })

  it('is not configured or rendered here — hydration is a later phase', async () => {
    // A second Mermaid configuration is the specific risk of this feature. The
    // editor's renderer is the single source of truth for securityLevel and
    // htmlLabels, so the parser half must not import it.
    //
    // Asserted on **imports and values**, not on raw substrings. A substring
    // check matches this file's own prose - an earlier version of this test
    // failed on the words `mermaid.render()` and `securityLevel` appearing in a
    // comment explaining that neither is used here, which is the least useful
    // possible failure.
    const source = await Bun.file('src/web/features/markdown/markdown-mermaid.ts').text()
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')

    expect(code).not.toMatch(/from\s+'[^']*mermaid-render/)
    expect(code).not.toMatch(/\bsecurityLevel\b/)
    expect(code).not.toMatch(/\bMERMAID_CONFIG\b/)
    // No configuration object, and no call into mermaid itself.
    expect(code).not.toMatch(/mermaid\s*\.\s*(render|initialize|parse)\s*\(/)
  })
})

describe('mermaid fences do not damage the rest of the document', () => {
  /**
   * The single most dangerous failure mode in this feature.
   *
   * `enter.codeFenced` must call `this.buffer()` and `exit.codeFenced` must call
   * `this.resume()`. Push without pop and the buffer stack desynchronises: nothing
   * throws, and everything after the fence is silently dropped. The user sees a
   * document that lost its tail with no error anywhere.
   */
  it('keeps every paragraph around and after a mermaid fence', () => {
    const doc = [
      '# Before heading',
      '',
      'Before paragraph.',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      'After paragraph one.',
      '',
      '## After heading',
      '',
      '- list item',
      '',
      '```mermaid',
      'graph LR; X-->Y;',
      '```',
      '',
      'Final paragraph.'
    ].join('\n')
    const html = renderMarkdown(doc)
    for (const text of [
      'Before heading',
      'Before paragraph.',
      'After paragraph one.',
      'After heading',
      'list item',
      'Final paragraph.'
    ]) {
      expect(html, `lost: ${text}`).toContain(text)
    }
  })

  it('keeps the document when the mermaid fence is never closed', () => {
    // An unclosed fence is a half-open buffer, which is exactly the state the
    // pairing rule exists to survive.
    const html = renderMarkdown(['```mermaid', 'graph TD; A-->B;', '', 'Tail survives.'].join('\n'))
    expect(html).toContain('Tail survives.')
  })

  it('keeps both sides of a mermaid fence inside a :::columns container', () => {
    const html = renderMarkdown(
      [
        ':::columns',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        '',
        '***',
        '',
        'right side text',
        ':::'
      ].join('\n')
    )
    expect(html).toContain('rt-cols')
    expect(html).toContain('right side text')
    expect(html).toContain('rt-mermaid')
  })
})

describe('untouched fences are byte-identical to what micromark emits without this extension', () => {
  /**
   * The extension's contract is narrow: it must not change a single byte of what
   * micromark emits for a fence that is not a diagram.
   *
   * ## Why the comparison is `micromark` against `micromark + this extension`
   *
   * An earlier version of this file compared `renderMarkdown()` against a bare
   * `micromark()`, and reported a CRLF parity failure that was **not** this
   * feature's. `renderMarkdown` ends in `DOMPurify.sanitize`, and the HTML parser
   * normalises `\r\n` to `\n` — so *every* CRLF document has always lost its line
   * endings, with or without mermaid, and a bare paragraph with no fence at all
   * does it too. Comparing against the full pipeline measures the sanitiser;
   * comparing at the serialiser layer measures the thing that actually changed.
   *
   * Both facts are asserted below so a future reader does not rediscover them.
   */
  const cases: Array<[string, string]> = [
    ['plain js', '```js\nconst a = 1\n```'],
    ['no language', '```\nplain\n```'],
    ['ts with filename and line highlights', '```ts [app.ts] {1,3}\nconst a = 1\n```'],
    ['empty fence', '```js\n```'],
    ['unclosed fence', '```js\nconst a = 1'],
    ['an arrow inside a js fence', '```js\n// a --> b\n```'],
    ['a nested fence', '````md\n```js\nx\n```\n````'],
    ['crlf line endings', '```js\r\nconst a = 1\r\n```'],
    ['a lone CR', '```js\rconst a = 1\r```'],
    ['inside a blockquote', '> ```js\n> const a = 1\n> ```'],
    ['inside a list', '- ```js\n  const a = 1\n  ```'],
    ['inside a list, two items', '- ```js\n  a\n  ```\n- ```js\n  b\n  ```'],
    ['html-looking content', '```html\n<script>alert(1)</script>\n```'],
    ['closing fence longer than the opener', '````js\n```\n````'],
    ['mermaid spelled with capitals is NOT mermaid', '```Mermaid\ngraph TD; A-->B;\n```'],
    ['a language merely containing mermaid', '```mermaidish\ngraph TD; A-->B;\n```'],
    ['an indented fence', '  ```js\n  const a = 1\n  ```'],
    ['a fence with trailing spaces on the info', '```js  \nconst a = 1\n```'],
    ['a fence with no info and no content', '````\n````'],
    ['maths inside a fence', '```js\nconst a = $1 + 1\n```']
  ]

  let mermaidExtension: unknown

  beforeAll(async () => {
    const mod = await import('../src/web/features/markdown/markdown-mermaid.js')
    // Two mistakes are possible here and both make this block silently vacuous,
    // which is worse than having no parity test at all, because a vacuous one
    // reads as coverage:
    //
    //  1. **Call** the factory. `mermaidHtml` itself is not an extension.
    //  2. Put it in **`htmlExtensions`**, not `extensions`. It returns compiler
    //     handlers, and micromark ignores handlers in the wrong bucket.
    //
    // Both were made here, and the file reported 35 pass while the module was
    // deliberately broken. The guard test below exists because of that.
    mermaidExtension = mod.mermaidHtml()
  })

  const withExtension = (source: string) =>
    micromark(source, { htmlExtensions: [mermaidExtension] as never })

  it('actually applies the extension, rather than comparing stock to stock', () => {
    // The guard for the guard. If this fails, every parity case below compares
    // stock micromark to stock micromark and proves nothing.
    expect(withExtension('```mermaid\ngraph TD; A-->B;\n```')).toContain('rt-mermaid')
  })

  for (const [label, source] of cases) {
    it(`leaves ${label} byte-identical`, () => {
      expect(withExtension(source), `parity broken for ${label}`).toBe(micromark(source))
    })
  }

  it('preserves CRLF in a fence, where the bare pipeline does not', () => {
    // Both halves of the note above, asserted. The extension keeps `\r\n`; the
    // sanitiser does not. If this test ever fails, the extension changed
    // something it has no business changing.
    expect(withExtension('```js\r\nconst a = 1\r\n```')).toContain('\r\n')
    // Pre-existing pipeline behaviour, recorded so it is not mistaken for a
    // regression later. The HTML parser normalises line endings in text nodes.
    expect(renderMarkdown('```js\r\nconst a = 1\r\n```')).not.toContain('\r\n')
    expect(renderMarkdown('plain\r\nparagraph')).not.toContain('\r\n')
  })
})

describe('a mermaid fence body cannot introduce live markup', () => {
  const attacks: Array<[string, string]> = [
    ['closing the wrapper', 'graph TD;\n</div><script>alert(1)</script>'],
    ['attribute breakout', 'graph TD;\n"><img src=x onerror=alert(1)>'],
    ['a javascript: link target', 'graph TD;\nclick A "javascript:alert(1)"'],
    ['a style attribute', 'graph TD;\nfoo bar="x"'],
    ['an iframe', 'graph TD;\n<iframe src="javascript:alert(1)"></iframe>'],
    ['an svg with a load handler', 'graph TD;\n<svg onload=alert(1)>']
  ]

  for (const [label, body] of attacks) {
    it(`neutralises ${label}`, () => {
      const doc = parse(renderMarkdown(['```mermaid', body, '```'].join('\n')))
      // The wrapper must still be there, or the test is passing because the
      // render produced nothing at all.
      expect(doc.querySelector('.rt-mermaid'), 'the wrapper disappeared entirely').not.toBeNull()
      expect(doc.querySelector('script'), 'a script element survived').toBeNull()
      expect(doc.querySelector('iframe'), 'an iframe survived').toBeNull()
      expect(doc.querySelector('img'), 'an img survived').toBeNull()
      expect(doc.querySelector('svg'), 'an svg survived').toBeNull()
      for (const el of Array.from(doc.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase().startsWith('on'), `handler ${attr.name} survived`).toBe(
            false
          )
          expect(/javascript:/i.test(attr.value), `javascript: URI in ${attr.name}`).toBe(false)
        }
      }
    })
  }

  it('keeps the attack text visible as source rather than discarding it', () => {
    // Neutralising by deletion would lose the user's content, which the import
    // contract forbids. The text must survive as text.
    const body = '</div><script>alert(1)</script>'
    const doc = parse(renderMarkdown(['```mermaid', body, '```'].join('\n')))
    const pre = doc.querySelector('.rt-mermaid-source')
    expect(pre?.textContent).toContain('alert(1)')
  })
})
