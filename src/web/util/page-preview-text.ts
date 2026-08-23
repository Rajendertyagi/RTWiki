import type { Page } from '@rtwiki/shared/contracts/pages'

/**
 * Readable plain-text previews for dashboard cards.
 *
 * Rich Notes store canonical BlockNote JSON; HTML pages store the canonical
 * HTML-content JSON. Neither is user-readable raw, so both are reduced to
 * plain text here. Malformed stored content degrades to an empty string —
 * the caller renders the standard empty label.
 */

interface BlockLike {
  type?: string
  text?: string
  content?: BlockLike[]
  children?: BlockLike[]
}

function textFromBlocks(blocks: BlockLike[]): string {
  let out = ''
  for (const block of blocks) {
    if (typeof block.text === 'string') {
      out += `${block.text} `
    }
    if (Array.isArray(block.content)) {
      out += textFromBlocks(block.content)
    }
    if (Array.isArray(block.children)) {
      out += textFromBlocks(block.children)
    }
  }
  return out
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pagePreviewText(page: Page, maxChars = 120): string {
  const raw = page.content ?? ''
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    let text = ''
    if (page.pageType === 'rich' && Array.isArray(parsed)) {
      text = textFromBlocks(parsed as BlockLike[])
    } else if (page.pageType === 'html' && parsed && typeof parsed === 'object') {
      const html = (parsed as { html?: unknown }).html
      if (typeof html === 'string') text = stripTags(html)
    }
    text = text.replace(/\s+/g, ' ').trim()
    return text.slice(0, maxChars)
  } catch {
    return ''
  }
}
