import { describe, expect, it } from 'bun:test'
import {
  extractSearchableContent,
  extractSearchableHtml,
  SEARCH_EXTRACTION_MAX_CHARS
} from '../src/server/services/search-extraction.js'

describe('HTML search-text extraction', () => {
  it('indexes visible text from simple markup', () => {
    expect(extractSearchableHtml('<p>Hello World</p>')).toBe('Hello World')
  })

  it('excludes markup tags from the indexed text', () => {
    const text = extractSearchableHtml('<div class="x"><b>Bold</b> and <i>italic</i></div>')
    expect(text).toBe('Bold and italic')
    expect(text).not.toContain('<')
    expect(text).not.toContain('div')
    expect(text).not.toContain('class')
  })

  it('excludes script elements and their contents', () => {
    const text = extractSearchableHtml(
      '<p>Visible</p><script>var secretToken = "scriptonly";</script>'
    )
    expect(text).toBe('Visible')
    expect(text).not.toContain('secretToken')
    expect(text).not.toContain('scriptonly')
  })

  it('excludes style elements and their contents', () => {
    const text = extractSearchableHtml(
      '<style>.hiddenStyleProbe { color: red; }</style><p>Visible</p>'
    )
    expect(text).toBe('Visible')
    expect(text).not.toContain('hiddenStyleProbe')
  })

  it('excludes comments', () => {
    const text = extractSearchableHtml('<!-- commentOnlyMarker --><p>Visible</p>')
    expect(text).toBe('Visible')
    expect(text).not.toContain('commentOnlyMarker')
  })

  it('excludes template subtrees', () => {
    const text = extractSearchableHtml(
      '<template><span>templateOnlyMarker</span></template><p>Visible</p>'
    )
    expect(text).toBe('Visible')
    expect(text).not.toContain('templateOnlyMarker')
  })

  it('decodes HTML entities in extracted text', () => {
    const text = extractSearchableHtml('<p>Tom &amp; Jerry &lt;3 &#65;&#66;</p>')
    expect(text).toBe('Tom & Jerry <3 AB')
  })

  it('handles complete documents without nesting or head duplication', () => {
    const text = extractSearchableHtml(
      '<!DOCTYPE html><html><head><title>Doc Title</title><meta charset="utf-8"></head>' +
        '<body><h1>Body Heading</h1><p>Body text</p></body></html>'
    )
    // Head metadata (including <title>) is excluded: the page title is
    // indexed separately, so body content is the only contribution.
    expect(text).toBe('Body Heading Body text')
    expect(text).not.toContain('Doc Title')
  })

  it('collapses whitespace across tags', () => {
    const text = extractSearchableHtml('<p>Alpha</p>\n<p>Beta</p>\t\t<p>Gamma</p>')
    expect(text).toBe('Alpha Beta Gamma')
  })

  it('never throws on malformed HTML', () => {
    const text = extractSearchableHtml('<p>unclosed <div>messy <b>nesting')
    expect(typeof text).toBe('string')
    expect(text).toContain('unclosed')
    expect(text).toContain('messy')
    expect(text).toContain('nesting')
  })

  it('caps extracted text at the centralized limit', () => {
    const huge = `<p>${'word '.repeat(50_000)}</p>`
    const text = extractSearchableHtml(huge)
    expect(text.length).toBe(SEARCH_EXTRACTION_MAX_CHARS)
  })
})

describe('searchable-content resolution per page type', () => {
  it('returns rich-page stored content verbatim (behavior unchanged)', () => {
    const richJson = '[{"type":"paragraph","content":[{"type":"text","text":"rich words"}]}]'
    expect(extractSearchableContent('rich', richJson)).toBe(richJson)
  })

  it('extracts readable text from canonical html-page content', () => {
    const canonical = JSON.stringify({
      version: 1,
      html: '<p>quantum entanglement</p><style>.x{}</style>',
      css: 'p { color: blue; }',
      javascript: 'console.log("jsOnly")'
    })
    const text = extractSearchableContent('html', canonical)
    expect(text).toBe('quantum entanglement')
    expect(text).not.toContain('color')
    expect(text).not.toContain('jsOnly')
  })

  it('indexes legacy/malformed html content as empty rather than JSON punctuation', () => {
    expect(extractSearchableContent('html', '<p>pre-canonical garbage</p>')).toBe('')
    expect(extractSearchableContent('html', 'not json at all')).toBe('')
    expect(extractSearchableContent('html', '{"version":1,"css":"only"}')).toBe('')
  })
})
