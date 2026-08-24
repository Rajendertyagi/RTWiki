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

/**
 * Reduces authored HTML to plain text for card previews.
 *
 * Two stripping passes bracket the entity decode: markup is removed first,
 * entities are decoded second, and anything that THEN looks like a tag is
 * removed again. Without the second pass, authored text such as
 * "&lt;svg&gt;" decodes into visible "<svg>" after stripping — the raw
 * "svg" leak reported on dashboard cards. The tag pattern also matches
 * unclosed fragments ("<svg" with no ">") so partial markup can never
 * surface as preview text either.
 */
function stripTags(html: string): string {
  const tagPattern = /<[/!a-zA-Z][^>]*>?/g
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(tagPattern, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(tagPattern, ' ')
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
