import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { PageType } from '@rtwiki/shared/contracts/pages'

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

  return chunks
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_EXTRACTION_MAX_CHARS)
}

/**
 * Resolves the text written into `search_index.content` for a page write.
 *
 * - Rich pages: the stored BlockNote JSON string is indexed verbatim —
 *   Rich Note search behavior is deliberately unchanged.
 * - HTML pages: readable text extracted from the authored HTML source.
 *   Stored content that predates canonical validation (or is otherwise
 *   malformed) indexes as empty rather than leaking JSON punctuation into
 *   search results; the title remains searchable either way.
 */
export function extractSearchableContent(pageType: PageType, storedContent: string): string {
  if (pageType !== 'html') {
    return storedContent
  }
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
