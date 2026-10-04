import { describe, expect, it } from 'bun:test'
import {
  __resetHighlighterForTests,
  getHighlighter,
  highlightToTokens,
  type PlainReason
} from '../src/web/features/code/shiki-service.js'

/**
 * The single engine is module-global by design, so these tests share it rather
 * than paying for twelve builds. `getHighlighter()` is called once per assertion
 * and the underlying promise is cached, so the cost is one engine per suite.
 */
describe('shiki service', () => {
  it('builds one highlighter and returns the same instance', async () => {
    __resetHighlighterForTests()
    const [a, b] = await Promise.all([getHighlighter(), getHighlighter()])
    expect(a).toBeDefined()
    expect(b).toBe(a)
  })

  it('highlights JavaScript with token markup, not just a language class', async () => {
    const out = await highlightToTokens('const a = 1', 'js', 'light')
    expect(out.kind).toBe('highlighted')
    if (out.kind !== 'highlighted') return
    // Real Shiki output carries inline-colour spans. A bare <pre><code> is the
    // unhighlighted shape and would mean the theme was not applied.
    expect(out.html).toContain('<pre')
    expect(out.html).toContain('style="color:')
    expect(out.html).toContain('const')
  })

  it('highlights every language the task required', async () => {
    const cases: Array<[string, string]> = [
      ['javascript', 'const a = 1'],
      ['typescript', 'const a: number = 1'],
      ['python', 'def f():\n    return 1'],
      ['json', '{"a": 1}'],
      ['bash', 'echo hi']
    ]
    for (const [info, code] of cases) {
      const out = await highlightToTokens(code, info, 'light')
      expect(`${info} -> ${out.kind}`).toBe(`${info} -> highlighted`)
    }
  })

  it('resolves aliases to the same output as the canonical name', async () => {
    const code = 'const a = 1'
    const viaAlias = await highlightToTokens(code, 'js', 'light')
    const viaId = await highlightToTokens(code, 'javascript', 'light')
    expect(viaAlias.kind).toBe('highlighted')
    expect(viaId.kind).toBe('highlighted')
    if (viaAlias.kind !== 'highlighted' || viaId.kind !== 'highlighted') return
    expect(viaAlias.html).toBe(viaId.html)
  })

  it('produces different colours for light and dark', async () => {
    const code = 'const a = 1'
    const light = await highlightToTokens(code, 'js', 'light')
    const dark = await highlightToTokens(code, 'js', 'dark')
    expect(light.kind).toBe('highlighted')
    expect(dark.kind).toBe('highlighted')
    if (light.kind !== 'highlighted' || dark.kind !== 'highlighted') return
    expect(light.html).not.toBe(dark.html)
  })

  it('falls back to plain for an unknown language, and says why', async () => {
    const out = await highlightToTokens('fn main() {}', 'rust', 'light')
    expect(out.kind).toBe('plain')
    if (out.kind !== 'plain') return
    expect(out.reason).toBe('unknown_language' as PlainReason)
  })

  it('falls back to plain for no language at all', async () => {
    for (const info of [null, undefined, '', '   ']) {
      const out = await highlightToTokens('plain text', info, 'light')
      expect(out.kind).toBe('plain')
      if (out.kind !== 'plain') continue
      expect(out.reason).toBe('no_language' as PlainReason)
    }
  })

  it('escapes HTML in the source, so code cannot inject markup', async () => {
    const out = await highlightToTokens('<script>alert(1)</script>', 'html', 'light')
    if (out.kind !== 'highlighted') throw new Error('expected html to be highlighted')
    expect(out.html).not.toContain('<script>')
    // Shiki escapes `<` as the numeric entity `&#x3C;`, not `&lt;`. Both are safe;
    // the assertion is that no unescaped tag survives, not that one spelling is
    // used. Measured output: `<span style="color:#24292E">&#x3C;</span>`.
    expect(out.html).toMatch(/&#x3C;|&lt;/)
  })

  it('never throws, whatever it is handed', async () => {
    const hostile: Array<[string, string]> = [
      ['js', ''],
      ['js', '\u0000\u0001binary'],
      ['json', '{ not json at all'],
      ['python', 'def (((('],
      ['bash', '<<<$(unclosed']
    ]
    for (const [info, code] of hostile) {
      const out = await highlightToTokens(code, info, 'light')
      expect(typeof out.kind).toBe('string')
    }
  })
})

describe('shiki service: on-demand loading', () => {
  it('loads a grammar only when a block in that language appears', async () => {
    // The laziness claim, asserted rather than asserted-in-a-comment. A service that
    // built its highlighter with every registry language up front would fetch all
    // twelve grammars for a note containing one JavaScript block — measured at 456 KB
    // of grammar chunks and 1237 ms before the first block could be highlighted.
    __resetHighlighterForTests()
    await highlightToTokens('const a = 1', 'js', 'light')

    const loaded = (await getHighlighter()).getLoadedLanguages()
    // `loadLanguage` registers the grammar's own name **and its aliases**, so a
    // JavaScript block registers both. That is Shiki's behaviour and it is why the
    // assertion is "JavaScript is loaded and the other ten are not" rather than an
    // exact list.
    expect(loaded).toContain('javascript')
    for (const absent of ['python', 'typescript', 'json', 'bash', 'yaml', 'sql', 'java']) {
      expect(loaded, `${absent} must not load for a JavaScript-only note`).not.toContain(absent)
    }
  })

  it('adds a second language only when that language is used', async () => {
    await highlightToTokens('def f():\n    pass', 'py', 'light')
    const loaded = (await getHighlighter()).getLoadedLanguages()
    expect(loaded).toContain('javascript')
    expect(loaded).toContain('python')
    // Still not the other ten.
    for (const absent of ['typescript', 'json', 'bash', 'yaml', 'sql', 'java']) {
      expect(loaded, `${absent} must not have loaded`).not.toContain(absent)
    }
  })

  it('loads only the theme the page is using', async () => {
    // Runs before the dark-theme case in declaration order, and the file's first
    // describe block resets the engine, so only the light theme is present here.
    // The dark case below then adds the second one.
    __resetHighlighterForTests()
    await highlightToTokens('const a = 1', 'js', 'light')
    const themes = (await getHighlighter()).getLoadedThemes()
    expect(themes).toContain('github-light')
    expect(themes, 'the dark theme must not load for a light page').not.toContain('github-dark')
  })

  it('adds the dark theme on demand when the scheme changes', async () => {
    __resetHighlighterForTests()
    await highlightToTokens('const a = 1', 'js', 'light')
    const out = await highlightToTokens('const a = 1', 'js', 'dark')
    expect(out.kind).toBe('highlighted')
    const themes = (await getHighlighter()).getLoadedThemes()
    expect(themes).toContain('github-dark')
  })
})
