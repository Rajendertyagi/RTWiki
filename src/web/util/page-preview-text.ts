import { UNSUPPORTED_BLOCK_MARKER } from '@rtwiki/shared/constants'
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
  content?: unknown
  children?: unknown
}

/**
 * Prop names that are authored prose and so belong in the plain-text reduction.
 *
 * A caption is the author's own description of a picture, and excluding it would
 * make a page whose only words are in captions unfindable. Anything else in
 * `props` is a URL or a style value and must stay out.
 */
const PROSE_PROP_NAMES = ['caption'] as const

/**
 * Block types whose `content` is machine source rather than readable prose.
 *
 * LaTeX, Mermaid and mind-map source are not something a reader sees, and
 * surfacing them on a dashboard card would be both ugly and misleading. The
 * server-side search extractor withholds the same types for the same reason
 * (`collectOwnBlockText` in `search-extraction.ts`), and the two must agree.
 */
const SOURCE_ONLY_BLOCK_TYPES = new Set(['mathBlock', 'diagram', 'mindMap', 'hologramBlock'])

/**
 * True when a block's `content` is a preserved unknown block rather than prose.
 *
 * `containUnknownBlocks()` rewrites an unknown block into a `codeBlock` whose
 * text begins with the marker. That text is the preservation mechanism, not
 * something an author wrote, so it must never reach a search result or a
 * dashboard card. Both shapes are checked: the bare string, and the inline array
 * a stored codeBlock actually uses, where the marker and the JSON arrive as
 * separate nodes and a naive `content.startsWith` on the array would miss it.
 */
function isPreservationPayload(content: unknown): boolean {
  if (typeof content === 'string') return content.startsWith(UNSUPPORTED_BLOCK_MARKER)
  if (!Array.isArray(content)) return false
  const joined: string[] = []
  appendInlineText(content, joined, 0)
  return joined.join(' ').startsWith(UNSUPPORTED_BLOCK_MARKER)
}

/**
 * Depth cap for the walk, matching the server-side cap.
 *
 * A page body arrives over the network and rich content is not validated
 * server-side, so nesting is untrusted input: a corrupt or hand-edited document
 * nested without bound would otherwise exhaust the stack while the dashboard is
 * merely rendering a card. The value is deliberately equal to
 * `SEARCH_MAX_BLOCK_DEPTH`, and the client cannot import that constant from the
 * server module, so the equality is asserted by a test rather than assumed.
 *
 * Defined behaviour once the cap is reached: nothing deeper is read, and
 * everything already collected is kept. Degrading to partial text is the point;
 * throwing while drawing a card is not.
 */
export const PREVIEW_MAX_BLOCK_DEPTH = 64 as const

/** True once `depth` has passed {@link PREVIEW_MAX_BLOCK_DEPTH}. */
function beyondDepthCap(depth: number): boolean {
  return depth > PREVIEW_MAX_BLOCK_DEPTH
}

/**
 * Appends a table's own text, which lives in `content.rows[].cells[]` rather
 * than in a `children` array.
 *
 * This is the bug behind the empty card. A table block's `content` is the
 * `tableContent` **object**, not an array, so a walk that descends into
 * `content` only when it is an array never sees a single cell. A page whose
 * only content is a table therefore rendered as an empty card while being
 * perfectly searchable — the page contradicting itself.
 *
 * Three cell shapes are read because BlockNote 0.54 produces the first and also
 * accepts the other two on insert: `{ type: 'tableCell', props, content }`, a
 * bare `InlineContent[]`, and a bare string.
 */
function appendTableText(content: unknown, out: string[], depth: number): void {
  const rows = (content as { rows?: unknown } | undefined)?.rows
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    const cells = (row as { cells?: unknown } | undefined)?.cells
    if (!Array.isArray(cells)) continue
    for (const cell of cells) {
      if (typeof cell === 'string') {
        if (cell.length > 0) out.push(cell)
      } else if (Array.isArray(cell)) {
        appendInlineText(cell, out, depth + 1)
      } else if (cell && typeof cell === 'object') {
        const inner = (cell as { content?: unknown }).content
        if (Array.isArray(inner)) appendInlineText(inner, out, depth + 1)
        else if (typeof inner === 'string' && inner.length > 0) out.push(inner)
      }
    }
  }
}

/**
 * Appends readable text from an inline-content array.
 *
 * Inline arrays hold plain strings and styled/link node objects; a link node
 * nests its own `content`, so the walk descends. Only `text` is read, never
 * `href`, so a URL can never reach a card.
 */
function appendInlineText(items: unknown, out: string[], depth: number): void {
  if (beyondDepthCap(depth)) return
  if (!Array.isArray(items)) return
  for (const item of items as unknown[]) {
    // An inline array may hold a bare string or a styled/link node object.
    if (typeof item === 'string') {
      if (item.length > 0) out.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    const node: { text?: unknown; content?: unknown } = item
    if (typeof node.text === 'string' && node.text.length > 0) out.push(node.text)
    if (Array.isArray(node.content)) appendInlineText(node.content, out, depth + 1)
  }
}

/**
 * Reduces one BlockNote document to readable plain text.
 *
 * The traversal deliberately mirrors the server-side search extractor
 * (`collectBlockText` in `src/server/services/search-extraction.ts`): a block
 * contributes its own readable text, then the walk continues into `children` and
 * into a table's own cell structure. The two answer the same question — "what
 * words does this page contain?" — and a user sees both results, on a dashboard
 * card and in a search hit, so a divergence shows up as a page disagreeing with
 * itself.
 *
 * `tests/search-preview-equality.test.ts` walks one document covering every block
 * type through both and asserts the strings are equal, so this cannot drift from
 * search again without a red test.
 */
function textFromBlocks(blocks: unknown[], out: string[], depth: number): void {
  if (beyondDepthCap(depth)) return
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const node = block as BlockLike

    // The preservation marker is checked FIRST and returns outright, exactly as
    // the server-side walk does. A codeBlock carrying it is
    // `containUnknownBlocks()` output and none of its payload is prose: a card
    // showing `[unsupported block preserved below] {"type":"futureBlock"}` would
    // put the preservation mechanism on the dashboard. The check has to precede
    // any emission, and it has to cover the inline-array form, because that is
    // how a stored codeBlock actually serialises -- marker and JSON as separate
    // inline nodes.
    if (isPreservationPayload(node.content)) continue

    if (typeof node.text === 'string' && node.text.length > 0) {
      out.push(node.text)
    }
    if (node.props) {
      for (const name of PROSE_PROP_NAMES) {
        const value = node.props[name]
        if (typeof value === 'string' && value.length > 0) out.push(value)
      }
    }
    // Source-only blocks (LaTeX, Mermaid, mind-map) are skipped entirely: their
    // `content` is machine source, not prose a reader sees. Their `children` may
    // still hold real blocks, so the walk continues below.
    if (!(typeof node.type === 'string' && SOURCE_ONLY_BLOCK_TYPES.has(node.type))) {
      if (Array.isArray(node.content)) {
        // The SAME depth the server walk passes, not depth + 1. Its
        // `collectInline(block.content, out, depth)` reads a block's own inline
        // content at the block's own depth, and the two caps must land on the
        // same document or the same page is readable by one consumer and not the
        // other.
        appendInlineText(node.content, out, depth)
      } else if (typeof node.content === 'string') {
        // The bare-string partial shape a codeBlock is also stored in.
        if (node.content.length > 0) out.push(node.content)
      } else if (node.content && typeof node.content === 'object') {
        // A table's own `rows[].cells[]` structure. The server walk passes
        // depth + 1 here, and so does this.
        appendTableText(node.content, out, depth + 1)
      }
    }
    if (Array.isArray(node.children)) {
      textFromBlocks(node.children, out, depth + 1)
    }
  }
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
 * Reduces a parsed BlockNote block array to plain text.
 *
 * Exported so the Rich Note's live word count can use the *same* reduction as the
 * dashboard card and the status bar, rather than a third walk of its own. Those
 * two had been counting different numbers for the same document, which is the
 * same class of defect as search disagreeing with the preview: one page, two
 * truths, both visible to the user.
 *
 * Takes the already-parsed blocks, not a JSON string, because the editor holds
 * live objects and this runs on every keystroke — re-parsing a string here would
 * be wasted work.
 */
export function richBlocksPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const chunks: string[] = []
  textFromBlocks(blocks, chunks, 0)
  return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Full plain-text reduction of a page's authored content (no truncation).
 * Shared by the dashboard preview and the status bar's word/character counts.
 */
export function pagePlainText(page: Page): string {
  const raw = page.content ?? ''
  if (!raw) return ''
  // Dedicated Diagram pages: the stored Mermaid source is never surfaced as
  // prose — the readable type label is the summary.
  if (page.pageType === 'diagram') {
    return ''
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    let text = ''
    if (page.pageType === 'rich' && Array.isArray(parsed)) {
      text = richBlocksPlainText(parsed)
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
  // Dedicated Diagram pages: the stored Mermaid source is never surfaced on
  // cards — the readable type label is the summary.
  if (page.pageType === 'diagram') {
    return ''
  }
  return pagePlainText(page).slice(0, maxChars)
}
