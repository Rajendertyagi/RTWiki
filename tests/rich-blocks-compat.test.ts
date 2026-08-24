import { describe, expect, it } from 'bun:test'
import {
  type BlockNoteDocument,
  containUnknownBlocks,
  isUnknownBlockPreserved,
  parseStoredDocument
} from '../src/web/features/rich-editor/document.js'
import { KNOWN_BLOCK_TYPES } from '../src/web/features/rich-editor/schema.js'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

function richPage(content: unknown): Parameters<typeof pagePreviewText>[0] {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Doc',
    pageType: 'rich',
    content: JSON.stringify(content),
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    version: 1
  } as never
}

describe('visual knowledge block schema', () => {
  it('knows the default blocks plus math, callout (and later diagram types)', () => {
    for (const type of [
      'paragraph',
      'heading',
      'quote',
      'bulletListItem',
      'numberedListItem',
      'checkListItem',
      'codeBlock',
      'table',
      'divider',
      'mathBlock',
      'callout'
    ]) {
      expect(KNOWN_BLOCK_TYPES.has(type)).toBe(true)
    }
  })

  it('keeps known blocks untouched during containment', () => {
    const doc: BlockNoteDocument = [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'hi', styles: {} }] },
      { id: 'b', type: 'mathBlock', content: 'x^2' }
    ]
    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    expect(out).toEqual(doc)
  })

  it('preserves unknown future blocks as readable JSON code blocks', () => {
    const foreign = { id: 'x', type: 'hologramBlock', props: { size: 3 }, content: [] }
    const doc: BlockNoteDocument = [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'keep', styles: {} }] },
      foreign
    ]
    const out = containUnknownBlocks(doc, KNOWN_BLOCK_TYPES)
    expect(out.length).toBe(2)
    const preserved = out[1] as { type: string; content: string }
    expect(preserved.type).toBe('codeBlock')
    expect(isUnknownBlockPreserved(preserved.content)).toBe(true)
    // The original block JSON is recoverable from the preserved code block.
    expect(preserved.content).toContain('"hologramBlock"')
    expect(preserved.content).toContain('"size": 3')
  })

  it('legacy documents without any new blocks load byte-identically', () => {
    const legacy = [
      {
        id: 'a',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'T', styles: {} }]
      },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] }
    ]
    const parsed = parseStoredDocument(JSON.stringify(legacy))
    expect(parsed.status).toBe('ok')
    const contained = containUnknownBlocks(parsed.document ?? [], KNOWN_BLOCK_TYPES)
    expect(contained).toEqual(legacy)
  })
})

describe('search/preview extraction for visual knowledge blocks', () => {
  it('extracts readable callout text for the dashboard preview', () => {
    const text = pagePreviewText(
      richPage([
        {
          id: 'c1',
          type: 'callout',
          props: { variant: 'warning' },
          content: [{ type: 'text', text: 'Check the power supply', styles: {} }]
        }
      ])
    )
    expect(text).toContain('Check the power supply')
    expect(text).not.toContain('callout')
    expect(text).not.toContain('{')
  })

  it('never leaks serialized JSON or raw source into previews', () => {
    const text = pagePreviewText(
      richPage([
        { id: 'm', type: 'mathBlock', content: 'E=mc^2' },
        { id: 'd', type: 'diagram', content: 'graph TD\n A-->B' },
        { id: 'mm', type: 'mindMap', content: 'mindmap\n root((X))' },
        {
          id: 'p',
          type: 'paragraph',
          content: [{ type: 'text', text: 'visible prose', styles: {} }]
        }
      ])
    )
    expect(text).toContain('visible prose')
    expect(text).not.toContain('graph TD')
    expect(text).not.toContain('mindmap')
    expect(text).not.toContain('{')
  })
})
