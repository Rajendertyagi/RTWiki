import { describe, expect, it } from 'bun:test'
import { sharedDom } from './utils/dom-harness.js'

sharedDom()
const { renderMarkdown } = await import('../src/web/features/markdown/markdown-render.js')
const { CALLOUT_VARIANTS, calloutVariantFor, isCalloutDirective } = await import(
  '../src/web/features/markdown/markdown-callouts.js'
)

describe('callouts: syntax', () => {
  it('renders :::note as a callout panel', () => {
    const html = renderMarkdown(':::note\nContent goes here.\n:::')
    expect(html).toContain('class="rt-callout rt-callout--note"')
    expect(html).toContain('Content goes here.')
    expect(html).toContain('role="note"')
  })

  it('lifts a bold-only first line into the title', () => {
    const html = renderMarkdown(':::note\n**Derivation**\n\nStep 1.\n:::')
    expect(html).toContain('rt-callout__title')
    expect(html).toContain('Derivation')
    // The title must not remain duplicated in the body.
    const body = html.replace(/<p class="rt-callout__title">[^<]*<\/p>/, '')
    expect(body).not.toContain('<strong>Derivation</strong>')
  })

  it('defaults the title to the variant name when none is given', () => {
    const html = renderMarkdown(':::tip\nJust so you know.\n:::')
    expect(html).toContain('rt-callout--tip')
    expect(html).toContain('>Tip</p>')
  })

  it('keeps the body when the first paragraph is bold AND has more text', () => {
    const html = renderMarkdown(':::note\n**Step 1** then more\n:::')
    // Not a title: the paragraph is not entirely bold, so nothing is peeled.
    expect(html).toContain('<strong>Step 1</strong> then more')
    expect(html).not.toContain('rt-callout__title">Step 1</p>')
  })

  it('keeps the body when the first line is italic, not bold', () => {
    const html = renderMarkdown(':::note\n*Emphasis* only\n:::')
    expect(html).toContain('<em>Emphasis</em>')
  })
})

describe('callouts: variants', () => {
  it('supports every variant in the registry', () => {
    for (const variant of CALLOUT_VARIANTS) {
      const html = renderMarkdown(`:::${variant.id}\nBody.\n:::`)
      expect(`${variant.id}: ${html}`).toContain(`rt-callout--${variant.id}`)
    }
  })

  it('accepts the registry aliases, so :::success is a tip', () => {
    expect(calloutVariantFor('success')).toBe('tip')
    expect(renderMarkdown(':::success\nWell done.\n:::')).toContain('rt-callout--tip')
    expect(renderMarkdown(':::error\nBad.\n:::')).toContain('rt-callout--danger')
    expect(renderMarkdown(':::caution\nCareful.\n:::')).toContain('rt-callout--warning')
  })

  it('is case-insensitive on the directive name', () => {
    expect(calloutVariantFor('NOTE')).toBe('note')
    expect(isCalloutDirective('Warning')).toBe(true)
    expect(renderMarkdown(':::WARNING\nCareful.\n:::')).toContain('rt-callout--warning')
  })

  it('does not claim a name that is not a callout', () => {
    expect(isCalloutDirective('columns')).toBe(false)
    expect(isCalloutDirective('column')).toBe(false)
    expect(isCalloutDirective('mermaid')).toBe(false)
    expect(calloutVariantFor('columns')).toBeUndefined()
  })

  it('still renders :::columns as columns, not as a callout', () => {
    const html = renderMarkdown('::::columns\n:::column\nLeft.\n:::\n:::column\nRight.\n:::\n::::')
    expect(html).toContain('rt-cols')
    expect(html).not.toContain('rt-callout')
  })
})

describe('callouts: safety and integrity', () => {
  it('escapes a title, so markup in a title is never an element', () => {
    const html = renderMarkdown(':::note\n**<img src=x onerror=alert(1)>**\n:::')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('renders the body Markdown rather than escaping it', () => {
    const html = renderMarkdown(':::note\n**bold** and `code`\n:::')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
  })

  it('does not lose content in an unknown directive (the measured fallback reason)', () => {
    const html = renderMarkdown('before\n\n:::warningish\n**be careful**\n\nafter\n')
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('leaves raw HTML escaped inside a callout, as everywhere else', () => {
    const html = renderMarkdown(':::note\n<details>x</details>\n:::')
    expect(html).not.toContain('<details>')
    expect(html).toContain('&lt;details')
  })

  it('renders a callout containing a fenced code block', () => {
    const html = renderMarkdown(':::note\n```js\nconst a = 1\n```\n:::')
    expect(html).toContain('rt-callout')
    expect(html).toContain('language-js')
  })
})
