/**
 * A top-level element scanner for a fragment of compiled HTML.
 *
 * ## Why this exists
 *
 * A container directive hands its handler **one** compiled HTML string, not a
 * tree (`directive.content`). Anything that needs to know where one block ends
 * and the next begins — the two-pane `<hr>` split, or finding the panes a
 * `:::column` child rendered inside its parent — has to find that boundary in
 * the string.
 *
 * A regular expression cannot do it. An `<hr>` inside a list item, a blockquote
 * or a table cell is a horizontal rule *within a document*, not between two
 * things, and no pattern over the flat string can tell those apart. Tag depth
 * is the only thing that distinguishes them.
 *
 * ## The contract, and why it is shaped this way
 *
 * `topLevelSpans` returns the `[start, end)` offsets of every **top-level**
 * element, or `null` if the fragment is not confidently parseable. `null` is
 * load-bearing: it is how the caller learns that no boundary in this string can
 * be trusted, so it can decline to act rather than guess. The ambiguity cases
 * are all of them real: an unterminated comment, a tag that never closes, and
 * a closing tag with nothing open.
 *
 * It never throws. A throw here would propagate out of a Markdown render and
 * blank a note; the failure is always reported as `null` instead.
 */

/** Elements that never have a closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

/** A tag recognised while scanning. */
interface ScannedTag {
  /** Lower-cased element name. */
  name: string
  closing: boolean
  selfClosing: boolean
  /** Index just past the closing `>`. */
  end: number
}

/**
 * Reads the tag starting at `start`, or `null` if it is not a well-formed tag.
 *
 * Quoted attribute values are tracked, so a `>` inside `title="a > b"` does not
 * end the tag early. micromark escapes `>` in attribute values on the way out,
 * so this is defence in depth rather than a case that occurs today.
 */
function readTag(html: string, start: number): ScannedTag | null {
  let index = start + 1
  const limit = html.length
  let closing = false
  if (html[index] === '/') {
    closing = true
    index += 1
  }
  const nameStart = index
  while (index < limit) {
    const character = html[index]
    if (character === undefined || /[\s/>]/.test(character)) break
    index += 1
  }
  if (index === nameStart) return null
  const name = html.slice(nameStart, index).toLowerCase()
  let quote: string | null = null
  while (index < limit) {
    const character = html[index] as string
    if (quote !== null) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return {
        name,
        closing,
        selfClosing: html
          .slice(start + 1, index)
          .trimEnd()
          .endsWith('/'),
        end: index + 1
      }
    }
    index += 1
  }
  // Ran off the end without finding a `>`.
  return null
}

/**
 * The `[start, end)` offsets of every top-level element in `html`, or `null`
 * when the fragment cannot be parsed with confidence.
 *
 * Whitespace and text between elements are not included, so the spans are the
 * elements themselves and the caller can interleave its own markup between
 * them. `[]` means "nothing that is an element", which is a normal result for
 * plain text — distinct from `null`, which means "do not trust this".
 */
export function topLevelSpans(html: string): Array<[number, number]> | null {
  const spans: Array<[number, number]> = []
  let depth = 0
  let start = -1
  let index = 0
  while (index < html.length) {
    const open = html.indexOf('<', index)
    if (open === -1) break
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4)
      // An unterminated comment means the rest of the fragment is ambiguous.
      if (close === -1) return null
      index = close + 3
      continue
    }
    const tag = readTag(html, open)
    if (tag === null) return null
    index = tag.end
    if (tag.closing) {
      depth -= 1
      // A closing tag with nothing open: this is not the well-formed output of
      // a Markdown compiler, so no boundary in it can be trusted.
      if (depth < 0) return null
      if (depth === 0 && start !== -1) {
        spans.push([start, tag.end])
        start = -1
      }
      continue
    }
    // A void or self-closing element is a complete top-level element on its own,
    // so it needs no depth. Without this an `<hr />` would open a span that never
    // closes and the whole fragment would read as unparseable.
    if (tag.selfClosing || VOID_ELEMENTS.has(tag.name)) {
      if (depth === 0) spans.push([open, tag.end])
      continue
    }
    if (depth === 0) start = open
    depth += 1
  }
  // Still inside an element, or an element that started and never closed.
  if (depth !== 0 || start !== -1) return null
  return spans
}

/** The element name at `offset`, lower-cased, or `null` if it is not a tag. */
export function tagNameAt(html: string, offset: number): string | null {
  const tag = readTag(html, offset)
  return tag === null || tag.closing ? null : tag.name
}

/** The result of {@link splitAtDivider}. */
export interface ColumnSplit {
  /** Content before the divider, or the whole content when there was none. */
  left: string
  /** Content after the divider. Empty when there was no divider. */
  right: string
  /** The divider element as it appeared, for an exact round-trip assertion. */
  marker: string
  /** False whenever the content could not be split confidently. */
  found: boolean
}

/**
 * Splits a container directive's compiled HTML at its first top-level `<hr>`.
 *
 * ## Why a scanner and not a regex
 *
 * A container directive hands its handler **one** compiled HTML string
 * (`directive.content`), not a tree. To get two panes out of it, the boundary
 * between them has to be found in the string, and the only boundary that is
 * unambiguous is a *top-level element boundary*. A `<hr>` was chosen as the
 * marker because it cannot be paragraph text, survives the sanitiser, and means
 * "divider" to a reader — which is what it is. A regex cannot tell an `<hr>` at
 * depth 0 from one inside a list item or a table cell, and that difference is
 * the whole problem.
 *
 * ## Failure behaviour, and why it is bounded
 *
 * **On any parse ambiguity the content is returned unsplit** — all of it in the
 * left pane, the right pane empty — and `found` is `false`. It never throws. A
 * splitter that threw would take the whole preview down for one malformed note;
 * a splitter that guessed would silently put a heading in the wrong pane. Losing
 * the split is visible, cheap, and recoverable by the author.
 *
 * Ambiguity means: an unterminated comment, a tag that never closes, a stray
 * closing tag, or an `<hr>` that is not at depth 0.
 */
export function splitAtDivider(html: string): ColumnSplit {
  const unsplit: ColumnSplit = { left: html, right: '', marker: '', found: false }
  const spans = topLevelSpans(html)
  if (spans === null) return unsplit
  for (const [start, end] of spans) {
    if (tagNameAt(html, start) !== 'hr') continue
    return {
      left: html.slice(0, start),
      right: html.slice(end),
      marker: html.slice(start, end),
      found: true
    }
  }
  return unsplit
}
