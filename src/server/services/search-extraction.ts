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
 *   ordinary code (never the preservation-marker payload), at EVERY nesting
 *   level, not just the top one. Formula, Diagram
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

/**
 * Depth cap for the recursive block walk over stored page JSON.
 *
 * The walk follows `children` and a table's own `rows[].cells[]` structure,
 * and both come from stored page content, which is untrusted input as far as
 * this function is concerned. The walk is recursive, so a corrupt or
 * hand-edited document nested without bound would otherwise exhaust the stack
 * and take down the request that merely tried to index a page.
 *
 * Defined behaviour once the cap is reached: nothing deeper is read, and
 * everything already collected is kept and indexed. BlockNote nesting that a
 * person can actually produce is a handful of levels (a list inside a list
 * inside a list), so the cap is far beyond any real document; it exists so
 * that hostile input degrades to partial text rather than to an exception.
 */
export const SEARCH_MAX_BLOCK_DEPTH = 64 as const

/** True once `depth` has passed {@link SEARCH_MAX_BLOCK_DEPTH}. */
function beyondDepthCap(depth: number): boolean {
  return depth > SEARCH_MAX_BLOCK_DEPTH
}

/** Recursively collects readable text from an inline-content array. */
function collectInline(items: unknown, out: string[], depth: number): void {
  if (beyondDepthCap(depth)) return
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
      collectInline(item.content, out, depth + 1)
    }
  }
}

/** A single BlockNote block in its loosest shape (defensive parsing). */
interface RichBlock {
  type?: string
  content?: unknown
  children?: unknown
  props?: Record<string, unknown>
}

/**
 * Emits the readable text a block carries in its own `content`, applying the
 * per-type policy. Contributes nothing for formula/diagram/mindmap source,
 * unknown types, the preservation marker, or structurally empty blocks.
 *
 * This decides the policy for ONE level only; descending into nested blocks is
 * {@link collectBlockText}'s job, so the policy is applied identically at
 * every depth.
 */
function collectOwnBlockText(block: RichBlock, out: string[], depth: number): void {
  const type = block.type
  if (typeof type !== 'string') return

  // Authored prose carried in props — currently an image's `caption`. Read for
  // every type, because a caption can hang off any block that accepts one, and
  // the dashboard preview already indexes it. Without this the same page is
  // visible on a card and unfindable.
  //
  // The preservation marker is checked FIRST, before any text is emitted, and it
  // returns outright: a codeBlock holding the marker is `containUnknownBlocks()`
  // output, and none of its payload is prose. Checking the joined text after the
  // fact let a payload through whenever the marker and the JSON arrived as
  // separate inline nodes, which is exactly how a stored codeBlock serialises.
  if (typeof block.content === 'string' && block.content.startsWith(UNSUPPORTED_BLOCK_MARKER)) {
    return
  }
  if (Array.isArray(block.content)) {
    const inline: string[] = []
    collectInline(block.content, inline, depth)
    if (inline.join(' ').startsWith(UNSUPPORTED_BLOCK_MARKER)) return
  }

  if (block.props) {
    for (const name of PROSE_PROP_NAMES) {
      const value = block.props[name]
      if (typeof value === 'string' && value.length > 0) out.push(value)
    }
  }

  switch (type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bulletListItem':
    case 'numberedListItem':
    case 'checkListItem':
    case 'callout':
      collectInline(block.content, out, depth)
      return
    case 'codeBlock': {
      // A stored codeBlock's `content` is `PlainContent[]`; the bare string is
      // the partial shape BlockNote also accepts on insert. Both are read, so a
      // real stored code block is findable. Only the string form was read
      // before, which is why the pre-existing test missed it -- it only ever
      // exercised the partial form.
      const inline: string[] = []
      if (typeof block.content === 'string') {
        if (block.content) inline.push(block.content)
      } else if (Array.isArray(block.content)) {
        collectInline(block.content, inline, depth)
      }
      const text = inline.join(' ')
      // Never index the unsupported-block preservation payload.
      if (text.startsWith(UNSUPPORTED_BLOCK_MARKER)) return
      if (text) out.push(text)
      return
    }
    case 'table': {
      // A table keeps its text in its OWN structure — `content.rows[].cells[]`
      // — not in a `children` array, so the cell walk below is the only way in.
      // The stored cell shape (@blocknote/core 0.54 `TableCell`) is
      // `{ type: 'tableCell', props, content: InlineContent[] }`; the plain
      // string and bare-inline-array forms are the partial/insert shapes
      // BlockNote also accepts, so all three are read.
      const rows = (block.content as { rows?: unknown[] } | undefined)?.rows
      if (!Array.isArray(rows)) return
      for (const row of rows) {
        const cells = (row as { cells?: unknown[] } | undefined)?.cells
        if (!Array.isArray(cells)) continue
        for (const cell of cells) {
          if (typeof cell === 'string') {
            out.push(cell)
          } else if (Array.isArray(cell)) {
            collectInline(cell, out, depth + 1)
          } else if (
            cell &&
            typeof cell === 'object' &&
            Array.isArray((cell as RichBlock).content)
          ) {
            collectInline((cell as RichBlock).content, out, depth + 1)
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
 * Prop names that are authored prose and therefore belong in the index.
 *
 * A caption is the author's own description of a picture. Excluding it made a
 * page whose only words are captions visible on its dashboard card and
 * unfindable by search — the same page disagreeing with itself, in the opposite
 * direction to the table defect. Only `caption` is read; every other prop is a
 * URL or a style value and must stay out of the index.
 */
const PROSE_PROP_NAMES = ['caption'] as const

/** Descends into a block's child blocks: sub-lists and any other nesting. */
function collectChildBlocks(children: unknown, out: string[], depth: number): void {
  if (!Array.isArray(children)) return
  for (const child of children as RichBlock[]) {
    if (child && typeof child === 'object') {
      collectBlockText(child, out, depth)
    }
  }
}

/**
 * Emits readable text for one block AND everything nested inside it.
 *
 * The traversal deliberately mirrors the dashboard preview's
 * `textFromBlocks` (`src/web/util/page-preview-text.ts:30-52`): a block
 * contributes its own readable text, and the walk then continues into
 * `children` and into a table's own cell structure. Before this, only
 * top-level blocks were read, so a word typed inside a sub-list was shown on
 * the dashboard card and could not be found by search — the same page
 * disagreeing with itself.
 *
 * The preview applies no per-type policy (it must not leak a URL, so it reads
 * a caption allowlist instead), which is why the per-type decision stays here
 * in `collectOwnBlockText` rather than being folded into one uniform walk.
 */
function collectBlockText(block: RichBlock, out: string[], depth: number): void {
  if (beyondDepthCap(depth)) return
  collectOwnBlockText(block, out, depth)
  collectChildBlocks(block.children, out, depth + 1)
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
      collectBlockText(block, chunks, 0)
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
  // Markdown pages: index the source text (readable markdown), never raw JSON.
  if (pageType === 'markdown') {
    try {
      const parsed: unknown = JSON.parse(storedContent)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'markdown' in parsed &&
        typeof (parsed as { markdown: unknown }).markdown === 'string'
      ) {
        return (parsed as { markdown: string }).markdown
      }
    } catch {
      // Malformed/legacy content falls through to the empty-string contract.
    }
    return ''
  }
  // Rich pages: parse BlockNote JSON into readable text (never raw JSON).
  return extractSearchableRich(storedContent)
}
