import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sharedDom } from './utils/dom-harness.js'

sharedDom()
const { renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const FEATURE_DIR = resolve(HERE, '..', 'src', 'web', 'features', 'markdown')
const STYLESHEET = readFileSync(join(FEATURE_DIR, 'markdown-content.css'), 'utf8')
const WORKSPACE = readFileSync(join(FEATURE_DIR, 'markdown-workspace.tsx'), 'utf8')

/** The stylesheet with comments removed — comments are prose, not selectors. */
const SELECTORS = STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * The stylesheet claims to cover a long list of elements. These assertions read the
 * CSS rather than the browser, which proves the rules are *shipped*; the visual
 * tests in `tests/browser/markdown-appearance.pwspec.ts` prove they *look right*.
 * Neither substitutes for the other, and §19 is explicit that CSS correctness must
 * not be assumed from source inspection — hence both.
 *
 * Each `selectorFragment` is a literal substring, so a compound selector passes as
 * written. See the note on {@link hasRuleFor} for why it is not a regex and not
 * boundary-anchored.
 */
function hasRuleFor(selectorFragment: string): boolean {
  // Plain substring containment, deliberately **not** a regex.
  //
  // Two earlier attempts were wrong. One wrapped the fragment in a boundary
  // assertion that only matched at a selector's start, so every selector sharing a
  // line with another one (`h5,` and `h6` written together) reported missing. The
  // next treated the fragment as a pattern, which broke on the functional
  // pseudo-classes the stylesheet actually uses: `:not(pre) > code` as a regex
  // means "`:not` followed by a group", so it cannot match its own literal text.
  //
  // Substring containment is sufficient **because comments are stripped above**,
  // which is what would otherwise let a commented-out rule satisfy the assertion —
  // the mirror-image false pass the comment stripping exists to prevent.
  return SELECTORS.includes(selectorFragment)
}

describe('the content stylesheet is shipped and bare-imported', () => {
  it('is imported by the module that renders the preview', () => {
    expect(WORKSPACE).toContain("import './markdown-content.css'")
  })

  it('scopes its rules to the attribute the preview element actually carries', () => {
    // The regression this exists for. The stylesheet was originally scoped under
    // `.previewPane` — a class in a CSS module, emitted hashed as
    // `._previewPane_1ndoc_42`, so the global selector matched **nothing**. All 11.94 KB
    // shipped and every rule was dead; only a computed-style assertion in a browser
    // found it (`Expected: not "0px none"` on an h2).
    //
    // So the stylesheet must name the attribute, and the element must carry it.
    // Against the comment-stripped text: the file's own header explains at length
    // why `.previewPane` cannot be used, so a raw-text check would match the
    // **explanation** and fail on a correct stylesheet.
    expect(SELECTORS).not.toMatch(/\.previewPane\b/)
    expect(WORKSPACE, 'the preview element must carry the scope attribute').toContain(
      'data-rt-markdown-preview'
    )
  })

  it('is a plain .css, not a CSS module', () => {
    // Measured with this repo's Vite: a bare `import './x.module.css'` emits no CSS
    // at all, silently. The preview's content is injected HTML with no owner, so a
    // module would also need `:global()` on every rule for no benefit.
    //
    // Asserted against the file with comments stripped, because the file's own
    // header explains at length why `:global()` must not be used — so a raw-text
    // check would match the **prohibition** and fail on a correct stylesheet. The
    // concern is a `:global()` in a *selector*, and a comment is not a selector.
    expect(STYLESHEET.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain(':global(')
  })
})

describe('the stylesheet covers every element the renderer emits', () => {
  const cases: Array<[string, string]> = [
    ['headings h1', '[data-rt-markdown-preview] h1 {'],
    ['headings h2', '[data-rt-markdown-preview] h2 {'],
    ['headings h3', '[data-rt-markdown-preview] h3 {'],
    ['headings h4', '[data-rt-markdown-preview] h4 {'],
    ['headings h5/h6', '[data-rt-markdown-preview] h5,'],
    ['paragraphs', '[data-rt-markdown-preview] p {'],
    ['links', '[data-rt-markdown-preview] a {'],
    ['inline code', '[data-rt-markdown-preview] :not(pre) > code {'],
    ['unordered lists', '[data-rt-markdown-preview] :is(ul, ol) {'],
    ['list items', '[data-rt-markdown-preview] li {'],
    ['task lists', '[data-rt-markdown-preview] input[type="checkbox"] {'],
    ['tables', '[data-rt-markdown-preview] table {'],
    ['table header cells', '[data-rt-markdown-preview] thead th {'],
    ['table body cells', '[data-rt-markdown-preview] :is(th, td) {'],
    ['table zebra striping', 'tbody tr:nth-child(even) {'],
    ['blockquotes', '[data-rt-markdown-preview] blockquote {'],
    ['horizontal rules', '[data-rt-markdown-preview] hr {'],
    ['images', '[data-rt-markdown-preview] img {'],
    ['code blocks', '[data-rt-markdown-preview] pre {'],
    ['footnotes', 'sup > a[data-footnote-ref] {'],
    ['footnote section', '[data-rt-markdown-preview] :is(section.footnotes, .footnotes) {'],
    ['footnote back-reference', ') a[data-footnote-backref] {'],
    ['callouts', '[data-rt-markdown-preview] .rt-callout {'],
    ['callout title', '[data-rt-markdown-preview] .rt-callout__title {'],
    ['callout note variant', '[data-rt-markdown-preview] .rt-callout--note {'],
    ['callout info variant', '[data-rt-markdown-preview] .rt-callout--info {'],
    ['callout tip variant', '[data-rt-markdown-preview] .rt-callout--tip {'],
    ['callout warning variant', '[data-rt-markdown-preview] .rt-callout--warning {'],
    ['callout danger variant', '[data-rt-markdown-preview] .rt-callout--danger {'],
    ['inline maths', '[data-rt-markdown-preview] .katex {'],
    ['display maths', '[data-rt-markdown-preview] .katex-display {'],
    ['mark', '[data-rt-markdown-preview] mark {'],
    ['kbd', '[data-rt-markdown-preview] kbd {'],
    ['subscript', '[data-rt-markdown-preview] sub,'],
    ['superscript', '[data-rt-markdown-preview] sup {'],
    ['strikethrough', '[data-rt-markdown-preview] del {']
  ]

  it.each(cases)('styles %s', (_name, selector) => {
    expect(hasRuleFor(selector), `no rule shipped for ${selector}`).toBe(true)
  })

  /*
   * The mutation check.
   *
   * Every fragment above includes its opening brace, which is what makes it a
   * selector rather than a mention. A substring check without it is satisfied by any
   * mention at all — and each callout variant name occurs **twice** in the
   * stylesheet (the box rule and its `__title` rule), so deleting the box rule
   * entirely still left the name present and the test passed. Measured: 42 pass with
   * `.rt-callout--danger`'s box rule deleted. These fragments now name the whole
   * selector plus `{`, so a deleted rule fails.
   */
  it('does not pass on a mention where a selector is required', () => {
    expect(hasRuleFor('.rt-callout--danger')).toBe(true)
    // The same name, but not as a rule head - this is what a bare mention matches.
    expect(hasRuleFor('.rt-callout--danger .rt-callout__title')).toBe(true)
    // A variant that does not exist must not be findable at all.
    expect(hasRuleFor('.rt-callout--chartreuse')).toBe(false)
  })
})

describe('the stylesheet uses no hardcoded colours', () => {
  it('derives every colour from a Mantine token', () => {
    // `AGENTS.md` §8: use Mantine theme tokens for visual values. A hex literal in
    // this file would not adapt to the light/dark schemes the app already has.
    const hex = SELECTORS.match(/#[0-9a-fA-F]{3,8}\b/g)
    expect(hex, `hardcoded colours found: ${hex?.join(', ')}`).toBeNull()
  })

  it('paints from tokens or color-mix, nothing else', () => {
    const colourValues = SELECTORS.match(
      /:\s*(#[0-9a-fA-F]{3,8}|rgb|hsl|color-mix|var\([^)]*\))\s*[;}]/g
    )
    expect(colourValues).not.toBeNull()
    for (const value of colourValues ?? []) {
      expect(value).toMatch(/color-mix|var\(/)
    }
  })
})

describe('the stylesheet and the renderer agree on class names', () => {
  const emitted = new Set<string>()

  it('collects the callout classes the renderer actually emits', () => {
    for (const name of ['note', 'info', 'tip', 'warning', 'danger']) {
      const html = renderMarkdown(`:::${name}\nBody.\n:::nope\n:::`.replace(':::nope\n:::', ':::'))
      for (const match of html.matchAll(/class="(rt-callout[^"]*)"/g)) {
        for (const cls of (match[1] as string).split(/\s+/)) emitted.add(cls)
      }
    }
    expect(emitted.size).toBeGreaterThan(0)
  })

  it('has a stylesheet rule for every class the renderer emits', () => {
    // The check that catches a renamed class: markup that renders unstyled with no
    // failing test anywhere else.
    expect([...emitted].sort()).toEqual([
      'rt-callout',
      'rt-callout--danger',
      'rt-callout--info',
      'rt-callout--note',
      'rt-callout--tip',
      'rt-callout--warning',
      'rt-callout__title'
    ])
    // `rt-callout` itself and the bare title class are checked as whole selectors;
    // the variant classes are checked in `has a box rule for each callout variant`
    // below, which needs a stronger check than a substring (each variant name also
    // appears in a `__title` rule).
    expect(hasRuleFor('[data-rt-markdown-preview] .rt-callout {')).toBe(true)
    expect(hasRuleFor('[data-rt-markdown-preview] .rt-callout__title {')).toBe(true)
  })

  it('has a box rule for each callout variant, not only a title rule', () => {
    // Each variant name appears twice in the stylesheet. Asserting only that the
    // name is present lets the *box* rule be deleted while the `__title` rule
    // satisfies the check — measured: 42/42 passing with `.rt-callout--danger`'s box
    // rule removed. So this asks for the box selector specifically.
    for (const variant of ['note', 'info', 'tip', 'warning', 'danger']) {
      expect(
        hasRuleFor(`[data-rt-markdown-preview] .rt-callout--${variant} {`),
        `no box rule shipped for .rt-callout--${variant}`
      ).toBe(true)
    }
  })
})
