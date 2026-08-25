import { UNSUPPORTED_BLOCK_MARKER } from '@rtwiki/shared/constants'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { type DefaultTreeAdapterTypes, parse } from 'parse5'

/**
 * Server-side search-text extraction for HTML pages.
 *
 * Parses the authored HTML with parse5 (WHATWG-compliant, maintained by the
 * Cheerio/rehype/Lit team) and collects only readable text. Regular
 * expressions are never used to parse HTML here.
 *
 * Excluded from the index: `script`, `style`, `template` subtrees, comments,
 * and all head metadata — the index must reflect what a reader sees, never
 * CSS/JS source or JSON punctuation.
 *
 * Entity decoding is inherent to parse5: text-node values arrive decoded,
 * so `&amp;` indexes as `&`.
 */

/**
 * Provisional centralized cap on extracted text per page. Study-note pages
 * stay far below this; the cap bounds search_index row size and keeps LIKE
 * scans fast even for pathological documents.
 */
export const SEARCH_EXTRACTION_MAX_CHARS = 100_000 as const

/** Elements whose entire subtree is invisible machinery, never readable text. */
const EXCLUDED_ELEMENTS = new Set(['script', 'style', 'template'])

function isElement(node: DefaultTreeAdapterTypes.Node): node is DefaultTreeAdapterTypes.Element {
  // parse5 convention: non-element nodes have nodeName values like
  // '#text', '#comment', '#documentType' — anything else is an element.
  return !node.nodeName.startsWith('#')
}

function collectText(node: DefaultTreeAdapterTypes.Node, out: string[]): void {
  if (!isElement(node)) {
    if (node.nodeName === '#text') {
      out.push((node as DefaultTreeAdapterTypes.TextNode).value)
    }
    // Comments and document-type nodes contribute nothing readable.
    return
  }

  if (EXCLUDED_ELEMENTS.has(node.tagName)) {
    return
  }

  for (const child of node.childNodes) {
    collectText(child, out)
  }
}

/**
 * Extracts readable text from an HTML source string. Accepts full documents
 * and fragments alike: parse5 wraps fragments in synthetic html/head/body
 * structure, and only body content is collected, so head metadata (including
 * `<title>`, which duplicates the separately-indexed page title) is never
 * double-counted.
 */
export function extractSearchableHtml(html: string): string {
  const document = parse(html)
  const chunks: string[] = []

  // Locate the real <body> element; fall back to the whole tree if absent.
  const htmlElement = document.childNodes.find(
    (node): node is DefaultTreeAdapterTypes.Element => isElement(node) && node.tagName === 'html'
  )
  const bodyElement = htmlElement?.childNodes.find(
    (node): node is DefaultTreeAdapterTypes.Element => isElement(node) && node.tagName === 'body'
  )

  const roots: DefaultTreeAdapterTypes.Node[] = bodyElement
    ? [...bodyElement.childNodes]
    : [...document.childNodes]
  for (const root of roots) {
    collectText(root, chunks)
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_EXTRACTION_MAX_CHARS)
}

/**
 * Resolves the text written into `search_index.content` for a page write.
 *
 * - HTML pages: readable text extracted from the authored HTML source.
 * - Rich pages: the canonical BlockNote JSON is parsed and only the visible
 *   readable text is indexed — paragraph/heading/list/callout/table text and
 *   ordinary code (never the preservation-marker payload). Formula, Diagram
 *   and Mind Map source are intentionally NOT indexed: their raw Mermaid/LaTeX
 *   is not readable prose and would pollute results, so only their visible
 *   rendered output (if any) is searchable. JSON punctuation, internal props
 *   and the unsupported-block marker are never indexed.
 * - Legacy/malformed content indexes as empty rather than leaking JSON into
 *   search results; the title remains searchable either way.
 */

/** Inline rich content item (text or styled/link node). */
interface RichInline {
  type?: string
  text?: string
  content?: RichInline[]
}

/** Recursively collects readable text from an inline-content array. */
function collectInline(items: unknown, out: string[]): void {
  if (!Array.isArray(items)) return
  for (const item of items as RichInline[]) {
    // Inline arrays may contain plain strings or styled/link node objects.
    if (typeof item === 'string') {
      out.push(item)
      continue
    }
    if (!item || typeof item !== 'object') continue
    if (typeof item.text === 'string') {
      out.push(item.text)
    }
    if (Array.isArray(item.content)) {
      collectInline(item.content, out)
    }
  }
}

/** A single BlockNote block in its loosest shape (defensive parsing). */
interface RichBlock {
  type?: string
  content?: unknown
  props?: Record<string, unknown>
}

/**
 * Emits readable text for one block, or '' when the block carries no readable
 * prose (formula/diagram/mindmap source, unknown types, the preservation
 * marker, or structurally empty blocks).
 */
function collectBlockText(block: RichBlock, out: string[]): void {
  const type = block.type
  if (typeof type !== 'string') return

  switch (type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem':
    case 'callout':
      collectInline(block.content, out)
      return
    case 'codeBlock': {
      const text = typeof block.content === 'string' ? block.content : ''
      // Never index the unsupported-block preservation payload.
      if (text.startsWith(UNSUPPORTED_BLOCK_MARKER)) return
      if (text) out.push(text)
      return
    }
    case 'table': {
      const rows = (block.content as { rows?: unknown[] } | undefined)?.rows
      if (!Array.isArray(rows)) return
      for (const row of rows) {
        const cells = (row as { cells?: unknown[] } | undefined)?.cells
        if (!Array.isArray(cells)) continue
        for (const cell of cells) {
          if (typeof cell === 'string') {
            out.push(cell)
          } else if (Array.isArray(cell)) {
            collectInline(cell, out)
          } else if (
            cell &&
            typeof cell === 'object' &&
            Array.isArray((cell as RichBlock).content)
          ) {
            collectInline((cell as RichBlock).content, out)
          }
        }
      }
      return
    }
    // mathBlock / diagram / mindMap and any unknown type: skip source.
    default:
      return
  }
}

/**
 * Parses a canonical BlockNote document (array of blocks, or an object whose
 * `blocks` array holds them) and returns readable text only. Total on
 * malformed input: returns '' so a corrupt page never crashes indexing.
 */
export function extractSearchableRich(storedContent: string): string {
  let data: unknown
  try {
    data = JSON.parse(storedContent)
  } catch {
    return ''
  }
  const blocks: unknown = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { blocks?: unknown }).blocks)
      ? (data as { blocks: unknown }).blocks
      : null
  if (!Array.isArray(blocks)) return ''

  const chunks: string[] = []
  for (const block of blocks as RichBlock[]) {
    if (block && typeof block === 'object') {
      collectBlockText(block, chunks)
    }
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_EXTRACTION_MAX_CHARS)
}

export function extractSearchableContent(pageType: PageType, storedContent: string): string {
  // Dedicated Diagram / Mind Map pages: the Mermaid source is deliberately
  // NOT indexed (same readable-text policy as embedded diagram blocks) —
  // only the page title remains searchable.
  if (pageType === 'diagram' || pageType === 'mindmap') {
    return ''
  }
  if (pageType === 'html') {
    try {
      const parsed: unknown = JSON.parse(storedContent)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'html' in parsed &&
        typeof (parsed as { html: unknown }).html === 'string'
      ) {
        return extractSearchableHtml((parsed as { html: string }).html)
      }
    } catch {
      // Malformed/legacy content falls through to the empty-string contract.
    }
    return ''
  }
  // Rich pages: parse BlockNote JSON into readable text (never raw JSON).
  return extractSearchableRich(storedContent)
}
