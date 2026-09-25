import { describe, expect, it } from 'bun:test'
import {
  buildPreviewCsp,
  buildPreviewDocument,
  escapeScriptContent,
  escapeStyleContent,
  generateChannelId,
  PreviewBuildError
} from '../src/web/features/html/preview-document.js'

const NONCE = 'AbCdEf123456='
const CHANNEL = 'a'.repeat(32)

function build(overrides: Partial<Parameters<typeof buildPreviewDocument>[0]> = {}): string {
  return buildPreviewDocument({
    normalizedHead: '',
    normalizedBody: '<p>body</p>',
    css: '',
    javascript: '',
    jsEnabled: true,
    nonce: NONCE,
    channelId: CHANNEL,
    ...overrides
  })
}

describe('preview document construction', () => {
  it('makes the document canvas transparent so the shell surface shows through', () => {
    // Without this the browser paints its own opaque base background inside
    // the iframe, which sits on top of the shell's canvas colour. The symptom
    // is a large light rectangle in the middle of a dark document area. The
    // computed background of the iframe element is correct either way, so this
    // can only be caught by inspecting the generated document.
    const doc = build()
    expect(doc).toContain('background: transparent')
  })

  it('paints the document canvas with the supplied surface colour', () => {
    // A transparent root canvas is not sufficient: the browser substitutes its
    // own opaque base background underneath it. The sandboxed document has no
    // same-origin access and cannot read the active theme, so the resolved
    // canvas colour is passed in and declared explicitly.
    const doc = build({ documentBackground: 'rgb(1, 2, 3)' })
    expect(doc).toContain('background: rgb(1, 2, 3)')
    expect(doc).not.toContain('background: transparent')
  })

  it('gives the document a default text colour for the active theme', () => {
    // The shell states the background, so it must state a matching default text
    // colour too. Without this a page that brings no CSS of its own inherits
    // the browser's black text and becomes unreadable on the dark canvas - the
    // surface fix would have moved the defect rather than removed it.
    const doc = build({ documentColor: 'rgb(4, 5, 6)' })
    expect(doc).toContain('color: rgb(4, 5, 6)')
  })

  it('rejects a text colour that is not a plain colour value', () => {
    const doc = build({ documentColor: 'red; } body { display: none' })
    expect(doc).not.toContain('display: none')
    expect([...doc.matchAll(/<style>/g)]).toHaveLength(1)
  })

  it('rejects a surface colour that is not a plain colour value', () => {
    // Allowlist, not escaping. The value is interpolated into a CSS
    // declaration, so anything that is not recognisably a colour is discarded
    // and the document falls back to transparent rather than being escaped and
    // hoped for.
    const doc = build({ documentBackground: 'red; } body { display: none' })
    expect(doc).toContain('background: transparent')
    expect(doc).not.toContain('display: none')
    expect([...doc.matchAll(/<style>/g)]).toHaveLength(1)
  })

  it('places the transparent-canvas reset before user CSS so a page can override it', () => {
    const doc = build({ css: 'body { background: rebeccapurple; }' })
    const resetIndex = doc.indexOf('background: transparent')
    const userCssIndex = doc.indexOf('rebeccapurple')
    expect(resetIndex).toBeGreaterThan(-1)
    expect(userCssIndex).toBeGreaterThan(resetIndex)
  })

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
    const doc = build({ javascript: 'var s = "</script>alert(1)";' })
    // Locate the JavaScript-pane script element (the second of two).
    const scriptElements = [...doc.matchAll(/<script nonce="[^"]+">/g)]
    expect(scriptElements.length).toBe(2)
    const jsPaneStart = scriptElements[1]?.index ?? -1
    const jsPaneEnd = doc.indexOf('</script>', jsPaneStart)
    const inner = doc.slice(jsPaneStart, jsPaneEnd)
    // The escaped sequence cannot terminate the script element early…
    expect(inner).toContain('<\\/script>')
    expect(inner).not.toContain('</script>')
    // …and string content keeps its meaning: "\/" === "/" in JS strings.
    expect(inner).toContain('var s = "<\\/script>alert(1)"')
  })

  it('escapes closing style sequences case-insensitively', () => {
    expect(escapeStyleContent('</style>')).toBe('<\\/style>')
    expect(escapeStyleContent('</STYLE>')).toBe('<\\/STYLE>')
    const css = 'a::after { content: "</style><script>alert(1)</script>"; }'
    const doc = build({ css })
    // Exactly two style elements: the shell's transparent-canvas reset and
    // the page's own CSS. A third would mean the injected closing sequence
    // split the page's block - which is what this test guards against.
    expect([...doc.matchAll(/<style>/g)]).toHaveLength(2)
    // The real closing tag appears only after the complete CSS rule. The page's
    // CSS is the last style element in the document, so its closing tag is the
    // last one - the shell's reset has a closing tag of its own ahead of it.
    const styleEnd = doc.lastIndexOf('</style>')
    expect(styleEnd).toBeGreaterThan(doc.indexOf('"; }'))
    // Both dangerous properties are prevented: the injected closing style
    // sequence is escaped, and the raw `</script>` text inside the style
    // block stays inert (a style element is parsed as raw text until its
    // own — single, real — closing tag, proven by the assertions above).
    //
    // Scoped to the page's own style block. The shell's reset sits earlier in
    // the head and closes with a legitimate, developer-authored `</style>`, so
    // scanning the whole head would flag a tag that is not an injection. The
    // property being guarded is narrower and stronger: inside the page's CSS,
    // a closing style sequence can only ever appear escaped.
    const pageStyleBlock = doc.slice(doc.lastIndexOf('<style>'), styleEnd)
    expect(pageStyleBlock).toContain('<\\/style>')
    expect(pageStyleBlock).not.toContain('</style>')
  })

  it('omits the JavaScript pane entirely when jsEnabled is false', () => {
    const doc = build({ javascript: 'mark("should-not-run")', jsEnabled: false })
    // Only the ever-present bootstrap script remains — the user JS pane is
    // gated off, so its code cannot execute even though it is stored.
    const scripts = [...doc.matchAll(/<script nonce="([^"]+)">/g)]
    expect(scripts.length).toBe(1)
    expect(doc).not.toContain('should-not-run')
    expect(doc).toContain('rtwiki-preview-ready')
  })

  it('includes the JavaScript pane when jsEnabled is true', () => {
    const doc = build({ javascript: 'mark("ran")', jsEnabled: true })
    const scripts = [...doc.matchAll(/<script nonce="([^"]+)">/g)]
    expect(scripts.length).toBe(2)
    expect(doc).toContain('mark("ran")')
  })

  it('omits empty CSS and JavaScript blocks entirely', () => {
    const doc = build({ css: '   ', javascript: '' })
    // The shell always emits its transparent-canvas reset, so a bare "no
    // <style> anywhere" assertion no longer describes the contract. What must
    // be absent is the page's own empty CSS block: the only style element
    // present is the reset.
    expect([...doc.matchAll(/<style>/g)]).toHaveLength(1)
    expect(doc).toContain('background: transparent')
    // Only the ever-present bootstrap script remains — no JS-pane script.
    const scripts = [...doc.matchAll(/<script nonce="([^"]+)">/g)]
    expect(scripts.length).toBe(1)
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
