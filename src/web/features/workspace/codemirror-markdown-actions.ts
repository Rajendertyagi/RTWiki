/**
 * Markdown source transforms: turn a selection into replacement lines.
 *
 * ## Why these are pure functions
 *
 * Every action is "take this selection, return these replacement lines". That is a
 * pure string transform with no editor state and no DOM, so it can be tested
 * exhaustively without a browser — and the adapter in `codemirror-capabilities.ts`
 * is then a thin mapping from a capability to one of these plus a dispatch.
 *
 * The first attempt put all of this inside a React component that also read the
 * caret and rendered buttons. That made the transforms untestable in isolation and
 * put editor state in the view layer, which is how three of its buttons ended up
 * returning their handler instead of calling it.
 *
 * ## The line-prefix problem
 *
 * Wrapping a selection is easy. The hard part is that most Markdown block markers
 * (`#`, `>`, `-`) apply to a **whole line**, so a selection spanning parts of several
 * lines needs each line prefixed, and a selection covering only some of one line
 * cannot be made a block at all without splitting it.
 *
 * {@link applyBlockPrefix} therefore expects whole lines, and the adapter refuses a
 * partial-line selection for a block action rather than silently doing something the
 * reader did not ask for — it reports the control unavailable instead.
 */

/** The text a toolbar action replaced, so it can be restored. */
export interface EditRange {
  /** First line, 1-based, inclusive. */
  readonly fromLine: number
  /** Last line, 1-based, inclusive. */
  readonly toLine: number
  /** The text those lines held before the edit. */
  readonly text: string
}

/** A selection expressed in whole lines. */
export interface LineSelection {
  readonly fromLine: number
  readonly toLine: number
  /** 0-based column of the selection start on `fromLine`. */
  readonly fromColumn: number
  /**
   * 0-based column of the selection end on `toLine`.
   *
   * Measured against the **end of that line's text**, not its start. A selection
   * that runs to the end of a line is covering that whole line, and treating the
   * end column as anything but "at or past the end" would reject it — which is
   * what made every block control inert: selecting a whole line puts the caret at
   * the last character, not at column 0 of the next line.
   */
  readonly toColumn: number
  /** Length of `toLine`'s text, so the end column can be compared against it. */
  readonly toLineLength: number
}

/**
 * Whether the selection covers whole lines.
 *
 * A block action (`#`, `>`, `-`, a fence) can only apply cleanly when it does. A
 * selection that starts mid-line or ends mid-line would either lose the text before
 * or after the marker, or silently reflow the paragraph — so the toolbar disables
 * block buttons instead.
 *
 * The end test is `>=` the line's length rather than `=== 0`, and that is the whole
 * point of the change: measured against a select-all on a one-line document, the
 * previous `=== 0` test reported `5 === 0` for `Title` and disabled every block
 * control, so heading, list, quote and table silently did nothing while the inline
 * marks worked. The unit tests passed because they built selections by hand that
 * happened to end at column 0.
 */
export function isWholeLineSelection(selection: LineSelection): boolean {
  return selection.fromColumn === 0 && selection.toColumn >= selection.toLineLength
}

/** Strips an existing block prefix so a toggle cannot stack markers. */
function withoutBlockPrefix(line: string): string {
  return line.replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)?/, (_m, indent: string) => indent)
}

/**
 * Adds or removes a block prefix across whole lines.
 *
 * **Toggle semantics:** if every selected line already carries `marker`, the action
 * removes it; otherwise it applies it to all of them. That is what a reader expects
 * from a toolbar button pressed twice, and it is what makes the button's pressed state
 * meaningful.
 */
export function applyBlockPrefix(
  lines: readonly string[],
  marker: string,
  active: boolean
): readonly string[] {
  return lines.map((line) => {
    if (active) return withoutBlockPrefix(line)
    // Indented lines (list continuation, fenced code) keep their indentation.
    const indent = /^\s*/.exec(line)?.[0] ?? ''
    const rest = line.slice(indent.length)
    // Never prefix a line that is already a fence or inside one; a `#` inside a code
    // block is content, not a heading.
    if (rest.startsWith('```') || rest.startsWith('~~~')) return line
    return `${indent}${marker}${rest}`
  })
}

/**
 * The delimiter a token needs.
 *
 * `*` and `~` are doubled (`**`, `~~`) but `` ` `` and `$` are **not** — `` ``x`` `` is
 * not inline code, it is an empty code span followed by stray backticks. So the
 * caller states the full delimiter rather than a token this function doubles.
 *
 * That was a real bug caught by a test: passing `` ` `` produced ```` ``x`` ````, and
 * passing `*` for italic could not be distinguished from bold.
 */
export function wrapInline(text: string, delimiter: string): string {
  if (
    text.startsWith(delimiter) &&
    text.endsWith(delimiter) &&
    text.length >= delimiter.length * 2
  ) {
    return text.slice(delimiter.length, -delimiter.length)
  }
  return `${delimiter}${text}${delimiter}`
}

/**
 * Wraps each selected line's content, for a token that is per-line in Markdown.
 *
 * Bold and italic both span lines in CommonMark, so {@link wrapInline} is correct for
 * them. This exists for the cases where it is not, and is deliberately conservative:
 * `~~` and `` ` `` behave per-line in practice because a fenced span across a blank
 * line is not emphasis at all.
 */
export function wrapInlinePerLine(text: string, delimiter: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : wrapInline(line, delimiter)))
    .join('\n')
}

/** Turns selected lines into a fenced code block, or unfences an existing one. */
export function toggleCodeFence(lines: readonly string[], language = ''): readonly string[] {
  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  const isFenced =
    nonEmpty.length >= 2 &&
    (nonEmpty[0] as string).trimStart().startsWith('```') &&
    (nonEmpty[nonEmpty.length - 1] as string).trimStart().startsWith('```')
  if (isFenced) {
    // Drop the opening and closing fences, keep the body, and de-indent one level so
    // the content does not stay nested inside what is now a list item.
    const body = lines.slice(1, -1).map((line) => line.replace(/^ {1,4}/, ''))
    return body
  }
  const body = lines.map((line) => line.replace(/^ {1,4}/, ''))
  return [`\`\`\`${language}`, ...body, '```']
}

/** Inserts a GFM table with the given headers, at the caret. */
export function buildTable(headers: readonly string[]): readonly string[] {
  const head = `| ${headers.join(' | ')} |`
  const rule = `| ${headers.map(() => '---').join(' | ')} |`
  const row = `| ${headers.map(() => ' ').join(' | ')} |`
  return [head, rule, row]
}

/**
 * Inserts a callout, using the directive RTWiki's own parser understands.
 *
 * The syntax is measured, not assumed: `:::note` opens a container directive and
 * `:::note Some Title` does **not** — a label after the name makes micromark parse
 * the block as inline text. So the title rides as a bold first line.
 */
export function buildCallout(kind: string, title: string, body = ''): readonly string[] {
  return ['', `:::${kind}`, `**${title}**`, ...(body.length > 0 ? ['', body] : []), ':::', '']
}

/**
 * Inserts an inline-math span.
 *
 * `$` is the marker `markdown-render.ts` documents, and `mathTextGithubRule` decides
 * inline maths by character adjacency — so a space after the opening `$` is what
 * keeps `$$` (display) from being mistaken for two empty inlines.
 */
export function buildInlineMath(): string {
  return '$x^2$'
}

/**
 * The markdown link for a selection, or a placeholder when nothing is selected.
 *
 * A selection becomes `[text](url)`; an empty selection becomes `[](url)` with the
 * caret able to land in either half, which is the only way to insert a link without
 * knowing its target in advance.
 */
export function buildLink(text: string, url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0) return text.length === 0 ? '[]()' : `[${text}]()`
  return text.length === 0 ? `[](${trimmed})` : `[${text}](${trimmed})`
}
