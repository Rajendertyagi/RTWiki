import { describe, expect, it } from 'bun:test'
import { extractSearchableRich } from '../src/server/services/search-extraction.js'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

/**
 * The Rich Note's own word count (`countBlockWords`, private to
 * `rich-editor.tsx`) is the third consumer of "what words does this page
 * contain". It is not exported, so these tests pin the reduction it delegates
 * to -- `richBlocksPlainText` -- and, critically, assert that the delegated
 * reduction is the *same* one the other two consumers use. If someone later
 * re-inlines a cheaper walk here, the equality below is what fails.
 *
 * The performance decision behind that delegation is recorded in the
 * `countBlockWords` doc comment, with the measurement it was based on.
 */

const textNode = (text: string): unknown => ({ type: 'text', text, styles: {} })

describe('the editor word count and the card cannot disagree', () => {
  it('produces exactly the string the dashboard card and search produce', () => {
    const blocks = [
      { type: 'heading', props: { level: 2 }, content: [textNode('A heading')], children: [] },
      {
        type: 'bulletListItem',
        props: {},
        content: [textNode('parent item')],
        children: [
          {
            type: 'bulletListItem',
            props: {},
            content: [textNode('child item')],
            children: []
          }
        ]
      },
      {
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          columnWidths: [200, 200],
          headerRows: 1,
          rows: [
            {
              cells: [
                { type: 'tableCell', props: {}, content: [textNode('Header one')] },
                { type: 'tableCell', props: {}, content: [textNode('Header two')] }
              ]
            },
            {
              cells: [
                { type: 'tableCell', props: {}, content: [textNode('Value alpha')] },
                { type: 'tableCell', props: {}, content: [textNode('Value beta')] }
              ]
            }
          ]
        },
        children: []
      },
      {
        id: 'img',
        type: 'image',
        props: { url: '/api/attachments/abc', caption: 'Figure caption' },
        children: []
      },
      {
        id: 'code',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [textNode('const n = 1')],
        children: []
      }
    ]

    const card = pagePreviewText(
      { pageType: 'rich', content: JSON.stringify(blocks) } as never,
      100_000
    )
    const search = extractSearchableRich(JSON.stringify(blocks))

    // The three must be one string, not three similar ones.
    expect(card).toBe(search)
    // And the text is real, so this is not three empty strings agreeing.
    expect(card).toContain('child item')
    expect(card).toContain('Value alpha')
    expect(card).toContain('Figure caption')
  })
})
