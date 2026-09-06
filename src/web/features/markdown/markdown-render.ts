import DOMPurify from 'dompurify'
import { marked } from 'marked'

// GitHub-Flavored Markdown: tables, task lists and strikethrough are part of
// GFM and enabled by `gfm: true`.
marked.setOptions({ gfm: true, breaks: false })

/**
 * Renders Markdown source to a sanitized HTML string for preview.
 *
 * Security: RTWiki forbids raw HTML execution inside Markdown. `marked` is
 * configured for GFM only; the produced HTML is then run through DOMPurify
 * with a strict allowlist. Scripts, inline event handlers, iframes, forms and
 * styles are stripped, while the formatting vocabulary (including GFM task-list
 * checkboxes, which require the `input` element) is preserved. The result is
 * safe to inject.
 */
export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled'],
    FORBID_TAGS: [
      'style',
      'iframe',
      'form',
      'object',
      'embed',
      'link',
      'meta',
      'script',
      'frame',
      'frameset',
      'textarea',
      'select',
      'button',
      'base',
      'noscript'
    ]
  })
}
