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
  /** Block props, e.g. an image's `caption`. */
  props?: { caption?: unknown }
  content?: BlockLike[]
  children?: BlockLike[]
}

/**
 * Prop names that are authored prose and so belong in the plain-text reduction.
 *
 * A caption is the author's own description of a picture, and excluding it would
 * make a page whose only words are in captions unfindable. Anything else in
 * `props` is a URL or a style value and must stay out.
 */
const PROSE_PROP_NAMES = ['caption'] as const

function textFromBlocks(blocks: BlockLike[]): string {
  let out = ''
  for (const block of blocks) {
    if (typeof block.text === 'string') {
      out += `${block.text} `
    }
    if (block.props) {
      for (const name of PROSE_PROP_NAMES) {
        const value = block.props[name]
        if (typeof value === 'string' && value.length > 0) {
          out += `${value} `
        }
      }
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

/**
 * Reduces authored Markdown to safe, readable plain text for card previews.
 *
 * Markdown pages store opaque page JSON ({ version, markdown }); we never
 * render that to HTML on the dashboard (no DOMPurify round-trip, no script
 * execution). Instead we strip the lightweight syntax — code fences, list and
 * heading markers, links/images, emphasis — and keep the prose so the card
 * shows a calm text excerpt, exactly like the other page types.
 */
function markdownToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/^\s*([-*_]){3,}\s*$/gm, ' ')
    .replace(/[#*_~`>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Full plain-text reduction of a page's authored content (no truncation).
 * Shared by the dashboard preview and the status bar's word/character counts.
 */
export function pagePlainText(page: Page): string {
  const raw = page.content ?? ''
  if (!raw) return ''
  // Dedicated Diagram / Mind Map pages: the stored Mermaid source is never
  // surfaced as prose — the readable type label is the summary.
  if (page.pageType === 'diagram' || page.pageType === 'mindmap') {
    return ''
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    let text = ''
    if (page.pageType === 'rich' && Array.isArray(parsed)) {
      text = textFromBlocks(parsed as BlockLike[])
    } else if (page.pageType === 'markdown') {
      const md = (parsed as { markdown?: unknown }).markdown
      if (typeof md === 'string') text = markdownToPlainText(md)
    } else if (page.pageType === 'html' && parsed && typeof parsed === 'object') {
      const html = (parsed as { html?: unknown }).html
      if (typeof html === 'string') text = stripTags(html)
    }
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

export function pagePreviewText(page: Page, maxChars = 120): string {
  // Dedicated Diagram / Mind Map pages: the stored Mermaid source is never
  // surfaced on cards — the readable type label is the summary.
  if (page.pageType === 'diagram' || page.pageType === 'mindmap') {
    return ''
  }
  return pagePlainText(page).slice(0, maxChars)
}
