import { describe, expect, it } from 'bun:test'
import type { Page } from '../src/shared/contracts/pages.js'
import { pagePreviewText } from '../src/web/util/page-preview-text.js'

function htmlPage(content: unknown): Page {
  return page('html', content)
}

function richPage(blocks: unknown): Page {
  return page('rich', blocks)
}

function page(pageType: string, content: unknown): Page {
  return {
    id: '0f0a7c1e-8d21-4c9a-b2e3-5f6a7b8c9d01',
    title: 'Card',
    pageType,
    content: JSON.stringify(content),
    parentId: null,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null
  } as unknown as Page
}

describe('dashboard card preview text (defect 12: raw svg leak)', () => {
  it('never surfaces encoded markup that decodes into tags', () => {
    const text = pagePreviewText(
      htmlPage({
        version: 2,
        html: '&lt;svg&gt;<p>visible</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    )
    expect(text).not.toContain('<svg')
    expect(text).not.toContain('svg>')
    expect(text).toContain('visible')
  })

  it('removes unclosed tag fragments', () => {
    const text = pagePreviewText(
      htmlPage({
        version: 2,
        html: '<svg <p>visible tail</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    )
    expect(text).not.toContain('svg')
    expect(text).toContain('visible tail')
  })

  it('strips well-formed markup as before', () => {
    const text = pagePreviewText(
      htmlPage({
        version: 2,
        html: '<style>.x{}</style><h2>Title</h2><p>Body copy</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    )
    expect(text).toBe('Title Body copy')
  })

  it('keeps legitimate comparison text intact', () => {
    const text = pagePreviewText(
      htmlPage({
        version: 2,
        html: '<p>1 &lt; 2 and a &amp; b</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    )
    expect(text).toContain('1 < 2')
    expect(text).toContain('a & b')
  })

  it('degrades malformed content to an empty string', () => {
    expect(pagePreviewText({ ...htmlPage({ version: 2 }), content: '{broken' })).toBe('')
  })
})

describe('image captions in rich page previews', () => {
  it('includes the caption so a captioned image is still findable', () => {
    const text = pagePreviewText(
      richPage([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Sales review' }]
        },
        {
          type: 'image',
          props: {
            url: '/api/attachments/6f0d2f7a-1111-4222-8333-444455556666',
            caption: 'Revenue by quarter, 2024',
            showPreview: true
          }
        }
      ])
    )
    expect(text).toContain('Sales review')
    expect(text).toContain('Revenue by quarter, 2024')
  })

  it('never surfaces the image URL or non-prose props', () => {
    const text = pagePreviewText(
      richPage([
        {
          type: 'image',
          props: { url: '/api/attachments/secret-id', caption: 'A chart', previewWidth: 320 }
        }
      ])
    )
    expect(text).not.toContain('/api/attachments/')
    expect(text).not.toContain('secret-id')
    expect(text).not.toContain('320')
    expect(text).toBe('A chart')
  })

  it('tolerates an image block with no caption at all', () => {
    const text = pagePreviewText(
      richPage([{ type: 'image', props: { url: '/api/attachments/x' } }])
    )
    expect(text).toBe('')
  })
})
