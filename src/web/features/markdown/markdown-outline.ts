import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString as mdastToString } from 'mdast-util-to-string'
import type { DocumentOutlineEntry } from '../rich-editor/document.js'

/**
 * Heading outline for a Markdown page.
 *
 * ## Why the outline is built from the same parser the preview uses
 *
 * The outline and the rendered preview must agree about *which lines are
 * headings*, or clicking an entry scrolls to the wrong place. A hand-written
 * `^#{1,6}` scan disagrees with the renderer in at least three ways: `# text`
 * inside a fenced code block is code, not a heading; a setext heading underlined
 * with `===` is a heading but has no leading `#`; and an indented line is a code
 * block. Parsing the source with the same micromark grammar the preview uses makes
 * that agreement structural rather than something to re-test whenever Markdown
 * rules shift.
 *
 * ## Why the mdast, and not the rendered HTML
 *
 * `mdast-util-from-markdown` yields the document as a tree, so a heading's text is
 * available without re-rendering it. `marked.lexer` gave the **raw source** of the
 * heading — `"Sub *head*"` — which then had to be run back through an inline
 * renderer and stripped of tags to recover `"Sub head"`. The mdast already holds
 * the resolved value, so that round trip is gone rather than merely relocated.
 *
 * ## Why navigation is by index
 *
 * Each entry's `blockId` is the heading's position in parse order, so the Nth entry
 * is the Nth heading element in the preview. Matching on heading *text* instead
 * would break on any heading containing inline markup, because `## **Bold**` reads
 * as `**Bold**` in the source and `Bold` once rendered.
 */

/** The heading elements the preview can contain, in the order the parser emits them. */
export const MARKDOWN_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/** The mdast node types that contain blocks, and so can hold a heading. */
const CONTAINER_NODE_TYPES = new Set([
  'root',
  'blockquote',
  'listItem',
  'footnoteSection',
  'containerDirective',
  'leafDirective'
])

/**
 * Derives a heading outline from Markdown source. Pure and total: empty source,
 * source with no headings, and a document whose headings are all inside code
 * fences all yield an empty outline rather than throwing.
 */
export function extractMarkdownOutline(source: string): DocumentOutlineEntry[] {
  if (!source) return []
  const tree = fromMarkdown(source)
  const headings: Array<{ depth: number; text: string }> = []
  collectHeadings(tree, headings)

  const entries: DocumentOutlineEntry[] = []
  headings.forEach((heading, index) => {
    const text = heading.text.trim()
    // A bare `###` is a real heading with nothing in it. It is left out of the
    // outline because an entry reading "Untitled" is noise, but `index` still
    // counts it: numbering follows the renderer's heading order, so skipping an
    // entry must not renumber the ones after it or navigation would drift.
    if (text.length === 0) return
    entries.push({
      // The index is the contract with the preview's heading order.
      blockId: String(index),
      level: heading.depth,
      text
    })
  })
  return entries
}

/**
 * Collects headings in document order, including any nested inside a blockquote
 * or a list item.
 *
 * The recursion visits containers rather than searching for headings at any depth,
 * because the index this produces is the contract with the preview's heading
 * order. A heading inside a list item is still rendered as an `<h2>` in the
 * preview, so it must be counted; a heading inside a *fenced code block* is not in
 * the tree at all, which is the case a regex gets wrong.
 */
function collectHeadings(
  node: { type: string; depth?: number; children?: unknown[] },
  into: Array<{ depth: number; text: string }>
): void {
  if (node.type === 'heading') {
    into.push({
      depth: node.depth ?? 1,
      // `mdastToString` resolves nested inline nodes - emphasis, inline code, a
      // link's label - so `## **Bold** and \`code\`` reads as the reader sees it.
      // A hand-rolled `child.value` walk silently drops every inline node that
      // holds its text in a deeper child, which is most of them.
      text: mdastToString(node as Parameters<typeof mdastToString>[0])
    })
    return
  }
  if (!CONTAINER_NODE_TYPES.has(node.type) && !Array.isArray(node.children)) return
  for (const child of (node.children ?? []) as Array<{ type: string; children?: unknown[] }>) {
    collectHeadings(child, into)
  }
}
