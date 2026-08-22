import { describe, expect, it } from 'bun:test'
import {
  createEmptyHtmlContent,
  HtmlContentSchema,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_JAVASCRIPT_BYTES,
  normalizeHtmlContent,
  parseHtmlContent,
  serializeHtmlContent
} from '../src/shared/schemas/html-content.js'

function v1Content(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { version: 1, html: '', css: '', javascript: '', ...overrides }
}

function v2Content(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    version: 2,
    html: '',
    css: '',
    javascript: '',
    jsEnabled: false,
    ...overrides
  }
}

describe('canonical HTML-page content schema', () => {
  it('accepts the canonical empty v2 document', () => {
    expect(HtmlContentSchema.safeParse(v2Content()).success).toBe(true)
  })

  it('accepts a fully populated v2 document with either toggle state', () => {
    expect(
      HtmlContentSchema.safeParse(
        v2Content({
          html: '<p>Hello</p>',
          css: 'p { color: red; }',
          javascript: 'console.log(1)',
          jsEnabled: true
        })
      ).success
    ).toBe(true)
    expect(HtmlContentSchema.safeParse(v2Content({ jsEnabled: false })).success).toBe(true)
  })

  it('accepts legacy v1 documents (schema-v1 compatibility)', () => {
    expect(HtmlContentSchema.safeParse(v1Content()).success).toBe(true)
    expect(
      HtmlContentSchema.safeParse(v1Content({ html: '<b>old</b>', css: 'b{}' })).success
    ).toBe(true)
  })

  it('rejects a wrong version in either shape', () => {
    expect(HtmlContentSchema.safeParse(v1Content({ version: 3 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v2Content({ version: 0 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v2Content({ version: '2' })).success).toBe(false)
  })

  it('rejects a missing version', () => {
    const { version: _version, ...withoutVersion } = v2Content()
    expect(HtmlContentSchema.safeParse(withoutVersion).success).toBe(false)
  })

  it('requires jsEnabled on v2 documents', () => {
    const { jsEnabled: _jsEnabled, ...withoutFlag } = v2Content()
    expect(HtmlContentSchema.safeParse(withoutFlag).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v2Content({ jsEnabled: 'yes' })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v2Content({ jsEnabled: null })).success).toBe(false)
  })

  it('rejects non-string fields in either shape', () => {
    expect(HtmlContentSchema.safeParse(v2Content({ html: 123 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v1Content({ css: null })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v2Content({ javascript: {} })).success).toBe(false)
  })

  it('rejects missing fields', () => {
    const { css: _css, ...withoutCss } = v2Content()
    expect(HtmlContentSchema.safeParse(withoutCss).success).toBe(false)
  })

  it('rejects unknown keys instead of stripping them in either shape', () => {
    expect(HtmlContentSchema.safeParse(v2Content({ unexpected: 'x' })).success).toBe(false)
    // A v2 field smuggled into a v1 document is an unknown key there.
    expect(HtmlContentSchema.safeParse(v1Content({ jsEnabled: true })).success).toBe(false)
  })

  it('rejects a BlockNote document array (rich format is not HTML content)', () => {
    expect(HtmlContentSchema.safeParse([{ type: 'paragraph' }]).success).toBe(false)
  })

  it('enforces the HTML byte limit at the exact boundary in both shapes', () => {
    const atLimit = 'a'.repeat(MAX_HTML_BYTES)
    expect(HtmlContentSchema.safeParse(v2Content({ html: atLimit })).success).toBe(true)
    expect(HtmlContentSchema.safeParse(v1Content({ html: atLimit })).success).toBe(true)

    const overLimit = `${atLimit}a`
    expect(HtmlContentSchema.safeParse(v2Content({ html: overLimit })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(v1Content({ html: overLimit })).success).toBe(false)
  })

  it('enforces the CSS byte limit at the exact boundary', () => {
    expect(HtmlContentSchema.safeParse(v2Content({ css: 'a'.repeat(MAX_CSS_BYTES) })).success).toBe(
      true
    )
    expect(
      HtmlContentSchema.safeParse(v2Content({ css: ` ${'a'.repeat(MAX_CSS_BYTES)}` })).success
    ).toBe(false)
  })

  it('enforces the JavaScript byte limit at the exact boundary', () => {
    expect(
      HtmlContentSchema.safeParse(htmlContentWithJs('a'.repeat(MAX_JAVASCRIPT_BYTES))).success
    ).toBe(true)
    expect(
      HtmlContentSchema.safeParse(htmlContentWithJs(` ${'a'.repeat(MAX_JAVASCRIPT_BYTES)}`)).success
    ).toBe(false)
  })

  function htmlContentWithJs(js: string): Record<string, unknown> {
    return v2Content({ javascript: js })
  }

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // Each U+1F600 emoji encodes as 4 UTF-8 bytes but is 2 UTF-16 code units.
    // MAX_HTML_BYTES / 4 emojis = exactly the byte limit; a JS .length check
    // would wrongly see only half the limit and accept double.
    const emojisAtByteLimit = '\u{1F600}'.repeat(MAX_HTML_BYTES / 4)
    expect(HtmlContentSchema.safeParse(v2Content({ html: emojisAtByteLimit })).success).toBe(true)

    const oneEmojiOver = `${emojisAtByteLimit}\u{1F600}`
    expect(HtmlContentSchema.safeParse(v2Content({ html: oneEmojiOver })).success).toBe(false)
  })
})

describe('HTML-page content normalization (v1 → v2)', () => {
  it('normalizes legacy v1 documents to v2 with JavaScript disabled', () => {
    const normalized = normalizeHtmlContent({
      version: 1,
      html: '<b>legacy</b>',
      css: 'b{}',
      javascript: 'console.log(9)'
    })
    expect(normalized).toEqual({
      version: 2,
      html: '<b>legacy</b>',
      css: 'b{}',
      javascript: 'console.log(9)',
      jsEnabled: false
    })
  })

  it('passes v2 documents through untouched', () => {
    const v2 = {
      version: 2 as const,
      html: '<i>x</i>',
      css: '',
      javascript: 'y()',
      jsEnabled: true
    }
    expect(normalizeHtmlContent(v2)).toBe(v2)
  })
})

describe('HTML-page content serialization helpers', () => {
  it('creates the canonical empty document as v2 with JavaScript disabled', () => {
    expect(createEmptyHtmlContent()).toEqual({
      version: 2,
      html: '',
      css: '',
      javascript: '',
      jsEnabled: false
    })
  })

  it('round-trips an empty v2 document', () => {
    const parsed = parseHtmlContent(serializeHtmlContent(createEmptyHtmlContent()))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.content).toEqual(createEmptyHtmlContent())
    }
  })

  it('round-trips a populated v2 document without altering strings', () => {
    const content = {
      version: 2 as const,
      html: '<div onclick="x()"><script>bad()</script></div>',
      css: '</style><script>alert(1)</script>',
      javascript: '</script><script>alert(2)</script>',
      jsEnabled: true
    }
    const parsed = parseHtmlContent(serializeHtmlContent(content))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      // Serialization must be lossless — escaping hostile sequences is the
      // preview builder's job, never the storage layer's.
      expect(parsed.content).toEqual(content)
    }
  })

  it('serializes a toggled flag without disturbing sibling fields', () => {
    const base = createEmptyHtmlContent()
    const enabled = { ...base, jsEnabled: true }
    expect(serializeHtmlContent(enabled)).toContain('"jsEnabled":true')
    const parsed = parseHtmlContent(serializeHtmlContent(enabled))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.content).toEqual(enabled)
    }
  })

  it('parses stored v1 JSON and reports its original version', () => {
    const parsed = parseHtmlContent('{"version":1,"html":"<u>o</u>","css":"","javascript":""}')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.content.version).toBe(1)
      expect(normalizeHtmlContent(parsed.content).jsEnabled).toBe(false)
    }
  })

  it('rejects non-JSON content with a clear error', () => {
    const parsed = parseHtmlContent('<p>not json</p>')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('canonical JSON')
    }
  })

  it('surfaces the first validation issue as the error message', () => {
    const parsed = parseHtmlContent(JSON.stringify(v2Content({ version: 99 })))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(typeof parsed.error).toBe('string')
      expect(parsed.error.length).toBeGreaterThan(0)
    }
  })
})
