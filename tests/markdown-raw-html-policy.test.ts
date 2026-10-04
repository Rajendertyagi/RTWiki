import { describe, expect, it } from 'bun:test'
import { sharedDom } from './utils/dom-harness.js'

sharedDom()
const { renderMarkdown, MARKDOWN_SANITIZE_OPTIONS } = await import(
  '../src/web/features/markdown/markdown-render.js'
)

/**
 * Proves the raw-HTML policy is unchanged by this work.
 *
 * §13 of the task forbids weakening it, and the additions here — callouts, a
 * content stylesheet, a highlighting pass — all touch the render path or the
 * preview DOM. Each test below is the *measured* behaviour from before this work,
 * asserted so a regression fails loudly rather than silently widening what a note
 * may contain.
 */
describe('raw HTML stays escaped and inert', () => {
  it('escapes an inline tag rather than making an element', () => {
    const html = renderMarkdown('a <b>x</b> c')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('escapes a script tag and never emits one', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script')
  })

  it('escapes an event-handler attribute', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toMatch(/<img[^>]*onerror/)
  })

  it('does not emit a details element, which micromark escapes', () => {
    const html = renderMarkdown('<details><summary>s</summary>body</details>')
    expect(html).not.toContain('<details')
    expect(html).toContain('&lt;details')
  })

  it('keeps style attributes out, as micromark escapes them first', () => {
    const html = renderMarkdown('<span style="color:red">r</span>')
    expect(html).not.toMatch(/<span[^>]*style=/)
  })

  it('still sanitises, and keeps its forbidding tags', () => {
    // The parser escaping raw HTML is the first line of defence; the sanitiser is
    // the second, and a parser bug must not be the only thing standing between a
    // document and script execution.
    for (const tag of MARKDOWN_SANITIZE_OPTIONS.FORBID_TAGS ?? []) {
      expect(tag).toBeTruthy()
    }
    expect(MARKDOWN_SANITIZE_OPTIONS.FORBID_TAGS).toContain('script')
    expect(MARKDOWN_SANITIZE_OPTIONS.FORBID_TAGS).toContain('style')
    expect(MARKDOWN_SANITIZE_OPTIONS.FORBID_TAGS).toContain('iframe')
  })

  it('still allows the MathML and SVG the maths and diagrams need', () => {
    const html = renderMarkdown('$$\n\\sqrt{2}\n$$')
    // A KaTeX radical is a MathML `msqrt` with an SVG overlay; losing either makes
    // `\sqrt{2}` render as a bare `2`.
    expect(html).toContain('<math')
    expect(html).toContain('msqrt')
  })

  it('does not let a callout become a script injection point', () => {
    const html = renderMarkdown(':::note\n<script>alert(1)</script>\n:::')
    expect(html).toContain('rt-callout')
    expect(html).not.toContain('<script')
  })

  it('does not let a callout title become an element', () => {
    const html = renderMarkdown(':::note\n**<img src=x onerror=alert(1)>**\n:::')
    expect(html).not.toContain('<img')
  })

  it('does not let a code fence become executable markup', () => {
    const html = renderMarkdown('```html\n<script>alert(1)</script>\n```')
    expect(html).not.toContain('<script>')
  })

  it('emits no MDX, so a note cannot execute as a component', () => {
    // The text `Foo` survives as **escaped literal text**, which is correct — a
    // reader typing `<Foo bar={1} />` should see what they typed. What matters is
    // that no element was made from it.
    const html = renderMarkdown('<Foo bar={1} />')
    expect(html).toContain('&lt;Foo')
    expect(html).not.toContain('<Foo')
  })
})
