import { marked } from 'marked'
import type { DocumentOutlineEntry } from '../rich-editor/document.js'

/**
 * Heading outline for a Markdown page.
 *
 * ## Why the outline is built from `marked.lexer` and not from a regex
 *
 * The outline and the rendered preview must agree about *which lines are
 * headings*, or clicking an entry scrolls to the wrong place. A hand-written
 * `^#{1,6}` scan disagrees with the renderer in at least three ways: `# text`
 * inside a fenced code block is code, not a heading; a setext heading underlined
 * with `===` is a heading but has no leading `#`; and an indented line is a code
 * block. The lexer is the same code that produces the preview, so agreement is
 * structural rather than something to be re-tested whenever Markdown rules shift.
 *
 * ## Why navigation is by index
 *
 * Each entry's `blockId` is the heading's position in that same lexer output, so
 * the Nth entry is the Nth heading element in the preview. Matching on heading
 * *text* instead would break on any heading containing inline markup, because
 * `## **Bold**` reads as "**Bold**" in the source and "Bold" once rendered.
 */

/** The heading elements the preview can contain, in the order the lexer emits them. */
export const MARKDOWN_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/**
 * Derives a heading outline from Markdown source. Pure and total: empty source,
 * source with no headings, and a document whose headings are all inside code
 * fences all yield an empty outline rather than throwing.
 */
export function extractMarkdownOutline(source: string): DocumentOutlineEntry[] {
  if (!source) return []
  const headings = marked.lexer(source).filter((token) => token.type === 'heading')
  const entries: DocumentOutlineEntry[] = []
  headings.forEach((token, index) => {
    // Narrowed by the filter above; the cast is the cost of `marked`'s token union.
    const heading = token as Extract<typeof token, { type: 'heading' }>
    const text = headingText(heading.text)
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
 * The heading's text as the reader will see it, with inline markup resolved.
 *
 * The heading is run through the same inline renderer the preview uses, so
 * `**Bold**` becomes `Bold`. The tags are then removed and the common entities
 * decoded.
 *
 * The result is display-only: it is rendered as a React text child, so it is
 * escaped, and it is never injected as HTML. That is why a simple tag removal is
 * sufficient here, where the same technique on untrusted content would not be.
 */
function headingText(inlineSource: string): string {
  const html = marked.parseInline(inlineSource) as string
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
