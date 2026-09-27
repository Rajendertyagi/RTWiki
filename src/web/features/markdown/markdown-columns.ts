/**
 * `:::columns` — N-pane layout with draggable dividers, for a Markdown page.
 *
 * ## The two forms, and why both exist
 *
 * A block is **two panes** when its body contains a top-level `<hr>`, and **N
 * panes** when its body contains `:::column` children. Two panes is the everyday
 * case; N is available with no cap.
 *
 * The N-child form was measured before it was designed. Nested directives are
 * compiled **inside out**: every `:::column` handler runs before its parent
 * `::::columns` handler, and each child's compiled HTML lands in the parent's
 * `content` string. So a child can render itself completely and the parent only
 * has to find the results. Measured: an outer `::::columns` with three
 * `:::column` children receives `<div …>…</div>` × 3 as its `content`.
 *
 * **No handoff, and that is deliberate.** Passing children through micromark's
 * compile-data store was tried and measured to be wrong: a `:::column` outside
 * any `::::columns` (an orphan) had its HTML pushed onto the store, never reach
 * the output buffer, and **vanish**. A layout feature that deletes a reader's
 * content when the fences are slightly wrong is the one failure this whole file
 * exists to prevent, so children self-render and the parent finds them.
 *
 * ## The syntax is `:::name{attr}` with no spaces, and that is not a choice
 *
 * micromark forbids a space before the name and before the attribute brace.
 * Measured: `::: columns` and `:::columns {left=40}` both render as a literal
 * paragraph containing the fences. Pandoc and Quarto **require** those spaces.
 * The two cannot be reconciled without forking the tokeniser, so RTWiki adopts
 * the spacing micromark accepts.
 *
 * The failure mode is a **visible literal paragraph**, never silent loss: the
 * reader sees their own text. That is what makes this trade acceptable.
 *
 * ## Nesting requires a strictly longer outer fence
 *
 * Measured across six fence-length pairs: the outer fence must be longer than
 * the inner, or the inner pair is not recognised and the trailing fence leaks as
 * a stray `<p>:::</p>` (3/3 and 4/4 leak; 4/3 and 5/4 are clean). Inherent to
 * the extension, and pinned by a test.
 *
 * ## Why the width grammar is one integer, and not a filter
 *
 * DOMPurify's `SAFE_FOR_XML` — on by default, and RTWiki never turns it off —
 * drops **any** attribute whose value matches `/((--!?|])>)|<\/(style|script|…)/i`,
 * and it runs *before* the allow-list, so `ADD_ATTR` and `ALLOWED_ATTR` cannot
 * rescue it. Measured: `data-left="a-->b"` loses the attribute entirely.
 *
 * Two measurements closed off the alternatives. `this.encode` does **not**
 * rescue it, because DOMPurify decodes entities before matching: `a--&gt;b` is
 * dropped just as `a-->b` is. And `style` attribute *contents* are not sanitised
 * at all — `style="width:expression(…)"` survives verbatim — so a free-form CSS
 * length is copied into a live `style` value protected by nothing downstream.
 *
 * So the grammar is **one whole number**, matched by {@link COLUMN_PERCENT_PATTERN}.
 * `-->` and `]>` are unreachable *by construction* rather than filtered for
 * afterwards, and the only string that reaches a `style` attribute is
 * `String(an integer this module produced)`. A value outside the grammar is
 * **surfaced**, never silently clamped.
 *
 * ## Where widths live, and why
 *
 * **On each child, not on the root.** A root-side list for N panes would need a
 * *second* grammar — a delimiter-separated list is a different parse, and a
 * free-form one reintroduces exactly the problem above. Per-child
 * `:::column{width=30}` reuses the *same* integer grammar per child, needs no
 * list parsing, and degrades naturally: a child with no `width` takes an equal
 * share of what the others leave.
 *
 * The root keeps `left` for the **two-pane** form, where it is the one number
 * that describes that form. It is ignored when children are present, because with
 * children present the children are what have widths.
 */

import { splitAtDivider, tagNameAt, topLevelSpans } from './markdown-columns-scanner.js'

/** The directive name for a row of panes. */
export const COLUMNS_DIRECTIVE_NAME = 'columns'
/** The directive name for one child of a row. */
export const COLUMN_CHILD_DIRECTIVE_NAME = 'column'

/**
 * The width grammar: one to three digits, nothing else.
 *
 * The digit-count bound keeps the value short enough to range-check without a
 * length guard, and the all-digits requirement is what makes every other
 * character — including `-->` and `]>` — unreachable. See the module note.
 */
export const COLUMN_PERCENT_PATTERN = /^\d{1,3}$/

/**
 * Bounds of an authored width, and the same bounds every drag uses.
 *
 * Symmetric, and neither end is 0 or 100: a pane at 0% or 100% is not a layout,
 * and a range the drag cannot reach would let a reader get somewhere the author
 * could not. With several panes the *sum* is what matters, and these bounds are
 * what make "a row of five can never leave a pane unusably narrow" expressible.
 */
export const COLUMN_MIN_PERCENT = 1
export const COLUMN_MAX_PERCENT = 99

/**
 * The share each undeclared child gets before the remainder is distributed.
 *
 * A weight, not a percent: it is a claim on the leftover, and the leftover is
 * what the declared widths did not use.
 */
export const COLUMN_DEFAULT_WEIGHT = 1

/**
 * Class names and selectors for the emitted structure.
 *
 * These are **global** names, not CSS-module names: the HTML is produced as a
 * string by `renderMarkdown` and injected wholesale, so the stylesheet is
 * written against `:global(...)` selectors in `markdown-columns.module.css`.
 * The names are declared once here and the stylesheet repeats them literally;
 * that repetition is inherent to emitting raw HTML with a CSS modules build.
 */
export const COLUMNS_ROOT_CLASS = 'rt-cols'
export const COLUMNS_PANE_CLASS = 'rt-cols__pane'
export const COLUMNS_DIVIDER_CLASS = 'rt-cols__divider'
export const COLUMNS_NOTICE_CLASS = 'rt-cols__notice'
export const COLUMNS_UNKNOWN_CLASS = 'rt-unknown-directive'
export const COLUMNS_UNKNOWN_NAME_CLASS = 'rt-unknown-directive__name'

/** `data-side` values. A pane's side is positional, so a middle pane says so. */
export const COLUMN_SIDE_LEFT = 'left'
export const COLUMN_SIDE_MIDDLE = 'middle'
export const COLUMN_SIDE_RIGHT = 'right'

/** Selectors the vanilla wiring uses. Declared with the class names above. */
export const COLUMNS_ROOT_SELECTOR = `.${COLUMNS_ROOT_CLASS}`
export const COLUMNS_DIVIDER_SELECTOR = `.${COLUMNS_DIVIDER_CLASS}`
export const COLUMNS_PANE_SELECTOR = `.${COLUMNS_PANE_CLASS}`

/** The body had no separator, so the block is a single pane. Inspectable. */
export const COLUMNS_UNSPLIT_ATTR = 'data-unsplit'
/** The panes came from `:::column` children rather than a separator. */
export const COLUMNS_NESTED_ATTR = 'data-nested'
/** An authored width was present and rejected. */
export const COLUMNS_REJECTED_ATTR = 'data-width-rejected'
/** How many panes, so the wiring never has to assume two. */
export const COLUMNS_COUNT_ATTR = 'data-count'

/** `data-testid` on each draggable divider, so a browser spec can find them. */
export const COLUMNS_DIVIDER_TEST_ID = 'rt-cols-divider'

/**
 * Accessible name for a two-pane row's single divider.
 *
 * Held here rather than imported so this module stays a pure `string -> string`
 * transform; the composition root injects the dictionary's value at startup. See
 * {@link setColumnsDividerLabel}.
 */
let twoPaneDividerLabel = 'Resize columns'

/**
 * Injects the dictionary's label.
 *
 * Called once from `markdown-render.ts`, the composition root. A user-facing
 * string belongs in `UI_TEXT` ([DEVELOPMENT_STANDARDS](../../docs/DEVELOPMENT_STANDARDS.md)
 * §5.2), and this is how that module stays out of a pure module's import graph.
 */
export function setColumnsDividerLabel(label: string): void {
  twoPaneDividerLabel = label
}

/** One resolved pane. */
export interface ColumnPane {
  /** The pane's compiled HTML, notices included. */
  content: string
  /**
   * The pane's share of the row as a percent. Always an integer this module
   * produced — never a value taken from the document unvalidated.
   */
  percent: number
  /** `data-side` for this pane. */
  side: string
}

/** The outcome of reading one width. */
interface ReadWidth {
  /** The authored percent, or `null` when absent or rejected. */
  percent: number | null
  rejected: boolean
}

/**
 * Reads a width against the grammar.
 *
 * An **absent** width is not an error: the child takes an equal share. A
 * **present but invalid** width is reported, because the author asked for a
 * specific width and did not get it, and using a different one silently would
 * hide the typo that caused it.
 */
function readWidth(raw: string | undefined): ReadWidth {
  if (raw === undefined) return { percent: null, rejected: false }
  if (!COLUMN_PERCENT_PATTERN.test(raw)) return { percent: null, rejected: true }
  const percent = Number(raw)
  if (percent < COLUMN_MIN_PERCENT || percent > COLUMN_MAX_PERCENT) {
    return { percent: null, rejected: true }
  }
  return { percent, rejected: false }
}

/**
 * Divides 100 across the panes, honouring the widths that were declared.
 *
 * ## Why the remainder goes to the last pane
 *
 * The shares must come to exactly 100, or the row's boundaries would drift from
 * what the author wrote. Giving the leftover to the **last** pane makes every
 * boundary *before* it exactly what was asked for, so a reader dragging boundary
 * 2 of 4 sees the width they authored rather than one quietly rounded.
 *
 * `flex-grow` normalises the shares for layout, so a row whose shares do not sum
 * to 100 still fills the width — the sum matters for the *announced* values, not
 * for the geometry.
 */
function distributeShares(declared: Array<ReadWidth>): number[] {
  const count = declared.length
  if (count === 0) return []
  const last = count - 1
  // The last pane absorbs the remainder, so it is never "declared".
  const fixed = declared.map((width, index) => (index === last ? null : width.percent))
  const used = fixed.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const open = fixed.filter((value) => value === null).length
  const free = Math.max(100 - used, open * COLUMN_MIN_PERCENT)
  const share = open > 0 ? Math.floor(free / open) : 0
  let leftover = open > 0 ? free - share * open : 0
  return fixed.map((value) => {
    if (value !== null) return value
    // Hand out the rounding remainder one point at a time, last pane first.
    if (leftover > 0) {
      leftover -= 1
      return share + 1
    }
    return share
  })
}

/** Escapes a value for an HTML **attribute**. Refuses anything non-integral. */
function attributePercent(percent: number): string {
  // A guard, not a validation: every producer of this value parsed it from
  // `COLUMN_PERCENT_PATTERN` or computed it from integers this module owns.
  // Asserted rather than trusted, because this is the one place a
  // document-controlled string would become a live `style` value.
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return '50'
  return String(percent)
}

/** The parts of a directive this module needs. Keeps micromark out of it. */
export interface ColumnDirectiveInput {
  name: string
  /** The `[...]` caption, when the author gave one. */
  label?: string | undefined
  attributes?: Record<string, string> | undefined
  /** The compiled HTML of the container body. Undefined for a leaf. */
  content?: string | undefined
  /**
   * Which of the three directive kinds this is. Only a container has a body,
   * and a text directive is inline, so the kind changes what may be emitted.
   */
  type: 'containerDirective' | 'leafDirective' | 'textDirective'
}

/**
 * Renders one `:::column` child: a pane element carrying its width, and nothing
 * else.
 *
 * The pane is complete and self-contained so an **orphan** child — one written
 * outside any `::::columns` — still renders its content. Measured: that is
 * exactly the case a compile-data handoff broke.
 *
 * The width is emitted as a `data-width` **integer** and the flex style is
 * `flex: 1 1 0%`, deliberately uniform. A parent that finds N of these sets
 * each pane's real width from the collected shares; an orphan falls back to the
 * equal `1 1 0%` it was given, which is the correct reading of "no width asked
 * for".
 */
export function renderColumnChild(
  encode: (value: string) => string,
  directive: ColumnDirectiveInput
): string {
  const width = readWidth(directive.attributes?.width)
  const notice = width.rejected
    ? `<p class="${COLUMNS_NOTICE_CLASS}">${encode(
        `width="${directive.attributes?.width ?? ''}" is not a whole number from ` +
          `${COLUMN_MIN_PERCENT} to ${COLUMN_MAX_PERCENT}. Using an equal share.`
      )}</p>`
    : ''
  const labelAttr = directive.label ? ` data-label="${encode(directive.label)}"` : ''
  const rejectedAttr = width.rejected ? ` data-rejected="true"` : ''
  return (
    `<div class="${COLUMNS_PANE_CLASS}" data-side="${COLUMN_SIDE_MIDDLE}" ` +
    `data-width="${width.percent === null ? '' : attributePercent(width.percent)}"` +
    `${rejectedAttr}${labelAttr} style="flex: 1 1 0%">${notice}${directive.content ?? ''}</div>`
  )
}

/**
 * A child pane found among a parent's compiled children, and what was read off
 * it.
 */
interface FoundChild {
  /** The child's **inner** HTML, with the child's own wrapper removed. */
  inner: string
  width: ReadWidth
}

/** What a parent found among its compiled children. */
interface CollectedChildren {
  panes: ColumnPane[]
  /** True when a child's authored width was present and rejected. */
  rejected: boolean
  /**
   * Body content that appeared **before** the first child.
   *
   * This is not padding. A `:::columns` body is not required to be nothing but
   * children: a lead-in paragraph, a stray `***`, or an unclaimed directive can
   * sit among them. Measured, the first draft of the child path **discarded all
   * of it** — an unknown `:::warning` between two children lost its body and the
   * text after it, silently.
   */
  before: string
  /**
   * Body content that is **not** a pane, from the first pane onwards.
   *
   * Content before the first child stays where the author put it. Anything else
   * that is not a child has no place inside a flex row — it would have to be
   * claimed as a column, which would silently change the pane count — so it is
   * emitted after the row, in order. Its position relative to the panes is not
   * preserved, and that is the deliberate cost of not deleting it.
   */
  after: string
}

/**
 * The panes a parent row found among its own compiled children.
 *
 * Each child is **unwrapped**: the parent re-emits the pane element itself, with
 * the width it computed. That is what stops a child being counted twice — the
 * child's own element is complete (so an orphan still renders) and the parent's
 * replaces it rather than nesting inside it.
 *
 * The width is read back from the `data-width` the child wrote, because there is
 * no channel between the two handlers, only the compiled output.
 */
function collectChildPanes(content: string): CollectedChildren | null {
  const spans = topLevelSpans(content)
  if (spans === null) return null
  const found: FoundChild[] = []
  /** The spans that became panes, in order. */
  const paneSpans: Array<[number, number]> = []
  for (const [start, end] of spans) {
    if (tagNameAt(content, start) !== 'div') continue
    const element = content.slice(start, end)
    // Only a `:::column` child is a pane. A `:::columns` whose body is prose, or
    // a nested `:::columns` that already rendered itself, is not.
    if (!element.startsWith(`<div class="${COLUMNS_PANE_CLASS}"`)) continue
    const openTagEnd = element.indexOf('>')
    const openTag = openTagEnd === -1 ? element : element.slice(0, openTagEnd)
    // The child's closing tag is the last one in its element; everything between
    // the open tag and it is the child's content.
    const closeTagStart = element.lastIndexOf('</')
    const inner = closeTagStart > openTagEnd ? element.slice(openTagEnd + 1, closeTagStart) : ''
    const raw = /data-width="([^"]*)"/.exec(openTag)?.[1]
    // A child that declared nothing carries `data-width=""`. That is an equal
    // share, **not** an error, so it must not go through `readWidth` — an empty
    // string is not a whole number, and measured in a browser that marked a row
    // of two valid widths and one undeclared as `data-width-rejected="true"`.
    // A non-empty value is an integer the child already validated; re-reading it
    // only keeps the range check in one place.
    const declared = raw === undefined || raw === ''
    const recheck = declared ? null : readWidth(raw)
    found.push({
      inner,
      // A child that reported its own rejection is trusted for that flag, because
      // the rejected value is not in the string — it is in the child's notice,
      // as text.
      width: {
        percent: recheck?.percent ?? null,
        rejected: openTag.includes(' data-rejected="true"') || (recheck?.rejected ?? false)
      }
    })
    paneSpans.push([start, end])
  }
  if (found.length === 0) return null
  const shares = distributeShares(found.map((child) => child.width))
  const count = found.length
  const first = (paneSpans[0] as [number, number])[0]
  return {
    rejected: found.some((child) => child.width.rejected),
    before: content.slice(0, first),
    // Everything from the first pane to the end of the body, minus the panes
    // themselves. Splicing the panes out of the body and keeping the remainder
    // is what makes "nothing is discarded" a property of the code rather than of
    // the cases somebody happened to think of.
    after: withoutSpans(content, paneSpans, first),
    panes: found.map((child, index) => ({
      content: child.inner,
      percent: shares[index] ?? COLUMN_DEFAULT_WEIGHT,
      side: count === 2 ? (index === 0 ? COLUMN_SIDE_LEFT : COLUMN_SIDE_RIGHT) : COLUMN_SIDE_MIDDLE
    }))
  }
}

/**
 * `content` from `from` to its end, with the given spans removed and everything
 * else kept in order.
 *
 * Deliberately does **not** put the interleaved content back where it was: a
 * flex row has no slot for it, and inventing one would change the pane count
 * without telling anyone. It is returned in reading order for the caller to
 * place after the row.
 */
function withoutSpans(content: string, spans: Array<[number, number]>, from: number): string {
  let out = ''
  let cursor = from
  for (const [start, end] of spans) {
    if (start < from) continue
    if (start > cursor) out += content.slice(cursor, start)
    cursor = end
  }
  out += content.slice(cursor)
  return out
}

/**
 * True when the body is a `:::columns` nested inside another one.
 *
 * A nested row has already rendered itself, dividers and all, and it is a
 * complete block. Re-wrapping it in a second row would nest two rows inside each
 * other, so it is recognised and left alone.
 */
function containsNestedRow(content: string): boolean {
  const spans = topLevelSpans(content)
  if (spans === null) return false
  return spans.some(([start]) => content.startsWith(`<div class="${COLUMNS_ROOT_CLASS}"`, start))
}

/**
 * A pass-through "encoder" for values this module produced itself.
 *
 * Used only for divider labels built from integers. The alternative — threading
 * micromark's `this.encode` down into the row renderer — would mean a parameter
 * that is genuinely never needed, and the mistake it invites (using it on a
 * value that *was* document-supplied) is the mistake that would matter.
 */
const identityEncode = (value: string): string => value

/** One divider, and the aria values describing the boundary it moves. */
export interface DividerSpec {
  /** Zero-based index among the row's dividers. */
  index: number
  /** The width of the pane to the left; dragging changes this. */
  leftPercent: number
  /** The accessible name, saying which boundary this is. */
  label: string
}

/**
 * Describes every divider in a row of `count` panes — `count - 1` of them.
 *
 * `aria-valuenow` is the **left** pane's width, because that is the value a
 * drag changes. A screen reader announcing "boundary 2 of 4, 30" is stating the
 * width of the pane the reader is about to resize, which is the thing they can
 * act on.
 *
 * A two-pane row keeps the plain label it always had, so the everyday case is
 * announced exactly as it was before N panes existed.
 */
export function describeDividers(
  encode: (value: string) => string,
  count: number,
  leftPercents: number[],
  /** The author's `[...]` caption on the row, which names its single divider. */
  label?: string | null
): DividerSpec[] {
  if (count < 2) return []
  const total = count - 1
  return Array.from({ length: total }, (_, index) => ({
    index,
    leftPercent: leftPercents[index] ?? COLUMN_DEFAULT_WEIGHT,
    // A two-pane row has one boundary, so the author's caption names it and
    // there is nothing to disambiguate. With more panes a caption on the whole
    // row cannot say *which* boundary, so each divider names its own position.
    label:
      total === 1
        ? (label ?? twoPaneDividerLabel)
        : encode(
            `Resize columns: boundary ${index + 1} of ${total}, between column ${index + 1} and column ${index + 2}`
          )
  }))
}

/** Renders the divider element for one boundary. */
export function renderDivider(spec: DividerSpec): string {
  return (
    `<div class="${COLUMNS_DIVIDER_CLASS}" role="separator" aria-orientation="vertical" ` +
    `aria-label="${spec.label}" aria-valuenow="${attributePercent(spec.leftPercent)}" ` +
    `aria-valuemin="${COLUMN_MIN_PERCENT}" aria-valuemax="${COLUMN_MAX_PERCENT}" tabindex="0" ` +
    `data-index="${spec.index}" data-testid="${COLUMNS_DIVIDER_TEST_ID}"></div>`
  )
}

/**
 * Renders a whole row: `count` panes with `count - 1` dividers spliced between
 * them.
 *
 * ## Every pane grows by **its own share**, including the last
 *
 * That is the whole sizing model, and it is easy to get wrong. The two-pane form
 * shipped first as `flex: 0 0 40%` on the left and `flex: 1 1 0%` on the right,
 * which is a *fixed* 40% basis. Replacing that with a uniform `flex: <share> 1
 * 0%` while leaving the last pane at `1 1 0%` was measured to render the
 * authored 40% as **40/41 — about 98% of the row.** Grow factors are ratios, so
 * the last pane has to carry its own share for the sum to be meaningful.
 *
 * With that fixed, the shares need not sum to 100 for the geometry to be right:
 * flexbox normalises them. The sum is kept at 100 anyway so the *announced*
 * values mean what they say.
 *
 * The splicing matters just as much. Appending the dividers would put them all
 * after the last pane, which is not a divider between anything.
 */
function renderRow(panes: ColumnPane[], extraAttrs: string, label?: string | null): string {
  const count = panes.length
  const leftPercents = panes.slice(0, Math.max(count - 1, 0)).map((pane) => pane.percent)
  const dividers = describeDividers(identityEncode, count, leftPercents, label).map(renderDivider)
  let body = ''
  for (const [index, pane] of panes.entries()) {
    body +=
      `<div class="${COLUMNS_PANE_CLASS}" data-side="${pane.side}" ` +
      `data-width="${attributePercent(pane.percent)}" data-index="${index}" ` +
      `style="flex: ${attributePercent(pane.percent)} 1 0%">${pane.content}</div>`
    if (dividers[index] !== undefined) body += dividers[index] as string
  }
  return (
    `<div class="${COLUMNS_ROOT_CLASS}" ${COLUMNS_COUNT_ATTR}="${count}"${extraAttrs}>` +
    `${body}</div>`
  )
}

/**
 * Renders a `:::columns` block, choosing the two-pane or N-pane form.
 *
 * The two-pane form is **unchanged** from what shipped first: a top-level `<hr>`
 * splits the body, `left` sets the width, and the right pane takes the rest. The
 * N-child form is preferred when children are present, and the two never
 * conflict because a body either has pane children or it does not.
 */
export function renderColumnsDirective(
  encode: (value: string) => string,
  directive: ColumnDirectiveInput
): string {
  const content = directive.content ?? ''

  // A row nested inside another row has already rendered itself, dividers and
  // all. Wrapping it again would nest two rows, so it is passed through whole.
  if (containsNestedRow(content)) return content

  // The N-child form, when the body is made of `:::column` children.
  const children = collectChildPanes(content)
  if (children && children.panes.length > 0) {
    // Anything in the body that is not a pane is kept, in reading order, around
    // the row. It has no place inside the layout, and dropping it would be the
    // one failure this file exists to prevent.
    return (
      children.before +
      renderRow(
        children.panes,
        ` data-left="${attributePercent(children.panes[0]?.percent ?? 50)}" ` +
          `${COLUMNS_NESTED_ATTR}="true"${
            children.rejected ? ` ${COLUMNS_REJECTED_ATTR}="true"` : ''
          }`
      ) +
      children.after
    )
  }

  // The two-pane form: a top-level `<hr>` is the separator.
  const width = readWidth(directive.attributes?.left)
  const split = splitAtDivider(content)
  const percent = width.percent ?? 50
  const notice = width.rejected
    ? `<p class="${COLUMNS_NOTICE_CLASS}">${encode(
        `left="${directive.attributes?.left ?? ''}" is not a whole number from ` +
          `${COLUMN_MIN_PERCENT} to ${COLUMN_MAX_PERCENT}. Using 50.`
      )}</p>`
    : ''
  // Measured: the setext trap (`---` tight under a paragraph) compiles to a
  // heading, and is **indistinguishable** from a heading the author meant. So
  // this notice states the fact — no separator was found — and names the form
  // that works, rather than guessing at a cause it cannot observe.
  const noSeparatorNotice =
    !split.found && topLevelSpans(content)?.length !== 0 && topLevelSpans(content) !== null
      ? `<p class="${COLUMNS_NOTICE_CLASS}">${encode(
          'No column separator found, so this is a single pane. Put *** on a line of its own between the panes; --- directly under text becomes a heading instead.'
        )}</p>`
      : ''
  const extra = `${split.found ? '' : ` ${COLUMNS_UNSPLIT_ATTR}="true"`}${
    width.rejected ? ` ${COLUMNS_REJECTED_ATTR}="true"` : ''
  }`
  const panes: ColumnPane[] = [
    { content: `${notice}${noSeparatorNotice}${split.left}`, percent, side: COLUMN_SIDE_LEFT },
    { content: split.right, percent: 100 - percent, side: COLUMN_SIDE_RIGHT }
  ]
  return renderRow(
    panes,
    ` data-left="${attributePercent(percent)}"${extra}`,
    directive.label ?? null
  )
}

/**
 * Renders a directive no handler claimed, with its name and its content
 * visible.
 *
 * ## This is the single most important function in the file
 *
 * `micromark-extension-directive`'s serialiser **buffers** a container's body:
 * `directiveContainerContent` opens a buffer, and the body is handed to the
 * handler as `directive.content` — it is never written to the output. So a
 * container directive that nothing writes is not merely unstyled, it is
 * *deleted*, together with everything after an unclosed fence, because the rest
 * of the document was inside its body.
 *
 * Measured, with `directiveHtml` installed and a `columns` handler but no
 * fallback: `before\n\n:::warning\n**be careful**\n\nafter\n` renders as
 * `<p>before</p>` and **nothing else**. The `**be careful**` paragraph and the
 * `after` paragraph are both gone, and no error is raised anywhere.
 *
 * Writing `directive.content` back out is what prevents that. A fallback is
 * therefore not defensive polish here; it is the only thing standing between a
 * typo'd directive name and silent content loss on an existing note.
 *
 * The kind decides the element: a container's content is block-level HTML and
 * needs a `<div>`, while a leaf and a text directive are inline and would be
 * malformed inside one.
 */
export function renderUnknownDirective(
  encode: (value: string) => string,
  directive: ColumnDirectiveInput
): string {
  const name = encode(directive.name)
  const type = directive.type
  if (type === 'containerDirective') {
    return (
      `<div class="${COLUMNS_UNKNOWN_CLASS}" data-directive="${name}">` +
      `<p class="${COLUMNS_UNKNOWN_NAME_CLASS}">:::${name}</p>` +
      `${directive.content ?? ''}</div>`
    )
  }
  return `<span class="${COLUMNS_UNKNOWN_CLASS}" data-directive="${name}">:::${name}</span>`
}

export { splitAtDivider, topLevelSpans }
