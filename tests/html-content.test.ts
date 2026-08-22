import { describe, expect, it } from 'bun:test'
import {
  createEmptyHtmlContent,
  HtmlContentSchema,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_JAVASCRIPT_BYTES,
  parseHtmlContent,
  serializeHtmlContent
} from '../src/shared/schemas/html-content.js'

function htmlContent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return { version: 1, html: '', css: '', javascript: '', ...overrides }
}

describe('canonical HTML-page content schema', () => {
  it('accepts the canonical empty document', () => {
    const result = HtmlContentSchema.safeParse(htmlContent())
    expect(result.success).toBe(true)
  })

  it('accepts a fully populated document', () => {
    const result = HtmlContentSchema.safeParse(
      htmlContent({ html: '<p>Hello</p>', css: 'p { color: red; }', javascript: 'console.log(1)' })
    )
    expect(result.success).toBe(true)
  })

  it('rejects a wrong version', () => {
    expect(HtmlContentSchema.safeParse(htmlContent({ version: 2 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(htmlContent({ version: 0 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(htmlContent({ version: '1' })).success).toBe(false)
  })

  it('rejects a missing version', () => {
    const { version: _version, ...withoutVersion } = htmlContent()
    expect(HtmlContentSchema.safeParse(withoutVersion).success).toBe(false)
  })

  it('rejects non-string fields', () => {
    expect(HtmlContentSchema.safeParse(htmlContent({ html: 123 })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(htmlContent({ css: null })).success).toBe(false)
    expect(HtmlContentSchema.safeParse(htmlContent({ javascript: {} })).success).toBe(false)
  })

  it('rejects missing fields', () => {
    const { css: _css, ...withoutCss } = htmlContent()
    expect(HtmlContentSchema.safeParse(withoutCss).success).toBe(false)
  })

  it('rejects unknown keys instead of stripping them', () => {
    const result = HtmlContentSchema.safeParse(htmlContent({ unexpected: 'x' }))
    expect(result.success).toBe(false)
  })

  it('rejects a BlockNote document array (rich format is not HTML content)', () => {
    expect(HtmlContentSchema.safeParse([{ type: 'paragraph' }]).success).toBe(false)
  })

  it('enforces the HTML byte limit at the exact boundary', () => {
    const atLimit = 'a'.repeat(MAX_HTML_BYTES)
    expect(HtmlContentSchema.safeParse(htmlContent({ html: atLimit })).success).toBe(true)

    const overLimit = `${atLimit}a`
    expect(HtmlContentSchema.safeParse(htmlContent({ html: overLimit })).success).toBe(false)
  })

  it('enforces the CSS byte limit at the exact boundary', () => {
    expect(
      HtmlContentSchema.safeParse(htmlContent({ css: 'a'.repeat(MAX_CSS_BYTES) })).success
    ).toBe(true)
    expect(
      HtmlContentSchema.safeParse(htmlContent({ css: ` ${'a'.repeat(MAX_CSS_BYTES)}` })).success
    ).toBe(false)
  })

  it('enforces the JavaScript byte limit at the exact boundary', () => {
    expect(
      HtmlContentSchema.safeParse(htmlContent({ javascript: 'a'.repeat(MAX_JAVASCRIPT_BYTES) }))
        .success
    ).toBe(true)
    expect(
      HtmlContentSchema.safeParse(
        htmlContent({ javascript: ` ${'a'.repeat(MAX_JAVASCRIPT_BYTES)}` })
      ).success
    ).toBe(false)
  })

  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    // Each U+1F600 emoji encodes as 4 UTF-8 bytes but is 2 UTF-16 code units.
    // MAX_HTML_BYTES / 4 emojis = exactly the byte limit; a JS .length check
    // would wrongly see only half the limit and accept double.
    const emojisAtByteLimit = '\u{1F600}'.repeat(MAX_HTML_BYTES / 4)
    expect(HtmlContentSchema.safeParse(htmlContent({ html: emojisAtByteLimit })).success).toBe(true)

    const oneEmojiOver = `${emojisAtByteLimit}\u{1F600}`
    expect(HtmlContentSchema.safeParse(htmlContent({ html: oneEmojiOver })).success).toBe(false)
  })
})

describe('HTML-page content serialization helpers', () => {
  it('round-trips an empty document', () => {
    const parsed = parseHtmlContent(serializeHtmlContent(createEmptyHtmlContent()))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.content).toEqual(createEmptyHtmlContent())
    }
  })

  it('round-trips a populated document without altering strings', () => {
    const content = {
      version: 1 as const,
      html: '<div onclick="x()"><script>bad()</script></div>',
      css: '</style><script>alert(1)</script>',
      javascript: '</script><script>alert(2)</script>'
    }
    const parsed = parseHtmlContent(serializeHtmlContent(content))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      // Serialization must be lossless — escaping hostile sequences is the
      // preview builder's job, never the storage layer's.
      expect(parsed.content).toEqual(content)
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
    const parsed = parseHtmlContent(JSON.stringify(htmlContent({ version: 99 })))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(typeof parsed.error).toBe('string')
      expect(parsed.error.length).toBeGreaterThan(0)
    }
  })
})
