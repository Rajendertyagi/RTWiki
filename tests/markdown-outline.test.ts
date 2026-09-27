import { describe, expect, it } from 'bun:test'
import { extractMarkdownOutline } from '../src/web/features/markdown/markdown-outline.js'

describe('markdown outline', () => {
  it('lists ATX headings with their level and resolved text', () => {
    const outline = extractMarkdownOutline('# Title\n\nSome text.\n\n## Second\n\n### Third')
    expect(outline).toEqual([
      { blockId: '0', level: 1, text: 'Title' },
      { blockId: '1', level: 2, text: 'Second' },
      { blockId: '2', level: 3, text: 'Third' }
    ])
  })

  it('resolves inline markup so the entry reads what the preview shows', () => {
    // The source says "**Bold**"; the preview says "Bold". An outline that
    // displayed the raw source would look broken next to the rendered page.
    const outline = extractMarkdownOutline('## **Bold** and `code` and [text](https://example.com)')
    expect(outline[0].text).toBe('Bold and code and text')
  })

  it('agrees with the renderer about what is not a heading', () => {
    // A `#` line inside a fence is code, and a setext underline is a heading.
    // Both cases are exactly where a hand-written `^#{1,6}` scan goes wrong.
    const outline = extractMarkdownOutline(
      ['# Real', '', '```', '# Not a heading', '```', '', 'Setext', '======'].join('\n')
    )
    expect(outline.map((e) => e.text)).toEqual(['Real', 'Setext'])
  })

  it('ignores an indented code block', () => {
    expect(extractMarkdownOutline('    # indented code').length).toBe(0)
  })

  it('numbers entries by their position, which is how the preview is addressed', () => {
    // blockId is an index, so it must count every heading in order with no gaps.
    const outline = extractMarkdownOutline('# One\n## Two\n### Three\n#### Four')
    expect(outline.map((e) => e.blockId)).toEqual(['0', '1', '2', '3'])
  })

  it('degrades to an empty outline rather than throwing', () => {
    expect(extractMarkdownOutline('')).toEqual([])
    expect(extractMarkdownOutline('Just a paragraph, no headings.')).toEqual([])
    expect(extractMarkdownOutline('###')).toEqual([])
  })

  it('omits an empty heading without renumbering the ones after it', () => {
    // A bare `###` sits between two real headings. It is left out of the list,
    // but the later heading must keep its renderer index or clicking it would
    // scroll to the wrong element.
    const outline = extractMarkdownOutline('# One\n\n###\n\n## Two')
    expect(outline.map((e) => e.text)).toEqual(['One', 'Two'])
    expect(outline.map((e) => e.blockId)).toEqual(['0', '2'])
  })

  it('closes a trailing ATX marker', () => {
    expect(extractMarkdownOutline('## Closed ##')[0].text).toBe('Closed')
  })
})
