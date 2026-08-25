import { describe, expect, it } from 'bun:test'
import {
  extractSearchableContent,
  extractSearchableHtml,
  extractSearchableRich,
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
  it('extracts readable text from a rich page (no raw JSON indexed)', () => {
    const richJson = '[{"type":"paragraph","content":[{"type":"text","text":"rich words"}]}]'
    const text = extractSearchableContent('rich', richJson)
    expect(text).toBe('rich words')
    expect(text).not.toContain('"type"')
    expect(text).not.toContain('content')
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

describe('rich-page searchable text extraction', () => {
  it('collects paragraph, heading, list and callout text', () => {
    const doc = [
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Title Here' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body paragraph text' }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'List item one' }] },
      {
        type: 'callout',
        props: { variant: 'warning' },
        content: [{ type: 'text', text: 'Callout warning text' }]
      }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('Title Here')
    expect(text).toContain('Body paragraph text')
    expect(text).toContain('List item one')
    expect(text).toContain('Callout warning text')
  })

  it('extracts link inline text recursively', () => {
    const doc = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          {
            type: 'link',
            content: [{ type: 'text', text: 'the documentation' }],
            href: 'https://example.com'
          },
          { type: 'text', text: ' for details' }
        ]
      }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('See the documentation for details')
  })

  it('extracts table cell text', () => {
    const doc = [
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [['Header A'], ['Header B']] }, { cells: [['Cell one'], ['Cell two']] }]
        }
      }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('Header A')
    expect(text).toContain('Header B')
    expect(text).toContain('Cell one')
    expect(text).toContain('Cell two')
  })

  it('never indexes formula, diagram or mind map source', () => {
    const doc = [
      { type: 'mathBlock', content: 'E = mc^2' },
      { type: 'diagram', content: 'graph TD; A-->B' },
      { type: 'mindMap', content: 'mindmap\n root' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Visible prose only' }] }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('Visible prose only')
    expect(text).not.toContain('mc^2')
    expect(text).not.toContain('graph TD')
    expect(text).not.toContain('mindmap')
  })

  it('never indexes the unsupported-block preservation marker', () => {
    const doc = [
      {
        type: 'codeBlock',
        props: { language: 'json' },
        content: '[unsupported block preserved below]\n{"type":"futureBlock"}'
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Real text' }] }
    ]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('Real text')
    expect(text).not.toContain('unsupported block preserved')
    expect(text).not.toContain('futureBlock')
  })

  it('indexes ordinary code block text', () => {
    const doc = [{ type: 'codeBlock', props: { language: 'ts' }, content: 'const x = 1' }]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toContain('const x = 1')
  })

  it('never exposes JSON punctuation or internal props', () => {
    const doc = [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain sentence' }] }]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text).toBe('Plain sentence')
    expect(text).not.toContain('{')
    expect(text).not.toContain('"type"')
    expect(text).not.toContain('content')
  })

  it('caps extracted text at the centralized limit', () => {
    const doc = [{ type: 'paragraph', content: [{ type: 'text', text: 'word '.repeat(50_000) }] }]
    const text = extractSearchableRich(JSON.stringify(doc))
    expect(text.length).toBe(SEARCH_EXTRACTION_MAX_CHARS)
  })

  it('returns empty string for malformed rich content', () => {
    expect(extractSearchableRich('not json at all')).toBe('')
    expect(extractSearchableRich('{"blocks":"nope"}')).toBe('')
  })
})
