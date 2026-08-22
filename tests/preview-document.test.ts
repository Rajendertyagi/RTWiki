import { describe, expect, it } from 'bun:test'
import {
  buildPreviewCsp,
  buildPreviewDocument,
  escapeScriptContent,
  escapeStyleContent,
  PreviewBuildError
} from '../src/web/features/html/preview-document.js'
import { generateChannelId } from '../src/web/features/html/preview-frame.js'

const NONCE = 'AbCdEf123456='
const CHANNEL = 'a'.repeat(32)

function build(overrides: Partial<Parameters<typeof buildPreviewDocument>[0]> = {}): string {
  return buildPreviewDocument({
    normalizedHead: '',
    normalizedBody: '<p>body</p>',
    css: '',
    javascript: '',
    nonce: NONCE,
    channelId: CHANNEL,
    ...overrides
  })
}

describe('preview document construction', () => {
  it('places the CSP meta before all user content', () => {
    const doc = build({
      normalizedHead: '<title>User Title</title>',
      normalizedBody: '<p>user content</p>',
      css: 'p { color: red; }',
      javascript: 'console.log(1)'
    })
    const cspIndex = doc.indexOf('http-equiv="Content-Security-Policy"')
    const firstUserContent = Math.min(
      doc.indexOf('<title>User Title</title>'),
      doc.indexOf('<p>user content</p>'),
      doc.indexOf('p { color: red; }'),
      doc.indexOf('console.log(1)')
    )
    expect(cspIndex).toBeGreaterThan(-1)
    expect(firstUserContent).toBeGreaterThan(cspIndex)
  })

  it('enforces the mandated directive set with the parent nonce', () => {
    const csp = buildPreviewCsp(NONCE)
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`)
    expect(csp).toContain("script-src-attr 'none'")
    expect(csp).toContain("style-src 'unsafe-inline'")
    expect(csp).toContain('img-src data:')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("font-src 'none'")
    expect(csp).toContain("media-src 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("worker-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("form-action 'none'")
    // Forbidden capabilities must never appear.
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain("'unsafe-inline' script-src")
    expect(csp).not.toContain("script-src 'unsafe-inline'")
    expect(csp).not.toContain('blob:')
  })

  it('stamps the nonce on both bootstrap and JavaScript-pane scripts', () => {
    const doc = build({ javascript: 'console.log(1)' })
    const matches = [...doc.matchAll(/<script nonce="([^"]+)">/g)]
    expect(matches.length).toBe(2)
    for (const match of matches) {
      expect(match[1]).toBe(NONCE)
    }
  })

  it('embeds the channel id only inside the bootstrap', () => {
    const doc = build()
    expect(doc).toContain(`var CHANNEL = '${CHANNEL}'`)
  })

  it('generates cryptographically random channel ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateChannelId()))
    expect(ids.size).toBe(50)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('escapes closing script sequences case-insensitively without changing code semantics', () => {
    expect(escapeScriptContent('</script>')).toBe('<\\/script>')
    expect(escapeScriptContent('</SCRIPT>')).toBe('<\\/SCRIPT>')
    expect(escapeScriptContent('</ScRiPt>')).toBe('<\\/ScRiPt>')
    // String content keeps its meaning: "\/" === "/" in JS strings.
    const doc = build({ javascript: 'var s = "</script>alert(1)<script>";' })
    // The escaped sequence cannot terminate the script element early.
    const scriptStart = doc.lastIndexOf('<script')
    const scriptEnd = doc.indexOf('</script>', scriptStart)
    const inner = doc.slice(scriptStart, scriptEnd)
    expect(inner).toContain('<\\/script>')
    expect(inner).not.toContain('</script>alert')
  })

  it('escapes closing style sequences case-insensitively', () => {
    expect(escapeStyleContent('</style>')).toBe('<\\/style>')
    expect(escapeStyleContent('</STYLE>')).toBe('<\\/STYLE>')
    const doc = build({ css: 'a::after { content: "</style><script>alert(1)</script>"; }' })
    const styleEnd = doc.indexOf('</style>')
    const headSection = doc.slice(0, styleEnd)
    expect(headSection).toContain('<\\/STYLE>'.replace('STYLE', 'style'))
    expect(doc.indexOf('<script>alert(1)', 0)).toBe(-1)
  })

  it('omits empty CSS and JavaScript blocks entirely', () => {
    const doc = build({ css: '   ', javascript: '' })
    expect(doc).not.toContain('<style>')
    expect(doc).not.toContain('<script nonce')
    // Bootstrap is always present.
    expect(doc).toContain('rtwiki-preview-ready')
  })

  it('rejects invalid nonces and channel ids', () => {
    expect(() => build({ nonce: '<script>' })).toThrow(PreviewBuildError)
    expect(() => build({ channelId: 'short' })).toThrow(PreviewBuildError)
    expect(() => build({ channelId: 'ZZZZ' })).toThrow(PreviewBuildError)
  })

  it('never introduces eval or Function constructors of its own', () => {
    const doc = build({
      normalizedBody: '<p>x</p>',
      css: 'p{}',
      javascript: 'document.body.textContent = "ok"'
    })
    // The builder's own markup/bootstrap must not contain dynamic-eval
    // constructs; user JS passes through verbatim (escaped only).
    expect(doc).not.toContain('eval(')
    expect(doc).not.toContain('new Function')
    expect(doc).not.toContain('setTimeout(eval')
  })
})
