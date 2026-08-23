import { describe, expect, it } from 'bun:test'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

function page(pageType: 'rich' | 'html', content: string): Page {
  return {
    id: 'p1',
    title: 'T',
    pageType,
    content,
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    version: 1
  } as Page
}

describe('pagePreviewText', () => {
  it('extracts readable text from BlockNote JSON', () => {
    const doc = JSON.stringify([
      { type: 'heading', content: [{ type: 'text', text: 'Title here' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Body words' }]
      }
    ])
    expect(pagePreviewText(page('rich', doc))).toBe('Title here Body words')
  })

  it('never returns raw JSON for rich pages', () => {
    const doc = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }])
    const preview = pagePreviewText(page('rich', doc))
    expect(preview.startsWith('{')).toBe(false)
    expect(preview).not.toContain('"type"')
  })

  it('strips tags from HTML-page content', () => {
    const doc = JSON.stringify({
      version: 2,
      html: '<h1>Hi</h1><p>Plain &amp; simple</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    expect(pagePreviewText(page('html', doc))).toBe('Hi Plain & simple')
  })

  it('never exposes script contents or raw JSON for HTML pages', () => {
    const doc = JSON.stringify({
      version: 2,
      html: '<p>ok</p><script>alert(1)</script>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    const preview = pagePreviewText(page('html', doc))
    expect(preview).toBe('ok')
    expect(preview).not.toContain('version')
  })

  it('returns empty for malformed stored content', () => {
    expect(pagePreviewText(page('rich', '{not json'))).toBe('')
  })
})
