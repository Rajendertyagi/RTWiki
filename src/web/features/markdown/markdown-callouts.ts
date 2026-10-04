/**
 * Markdown callouts: `:::note` … `:::` rendered as a styled panel.
 *
 * ## Why the directive system, and not new syntax
 *
 * The audit found the parser half already exists and works — `micromark-extension-directive`
 * is configured at `markdown-render.ts:155` and `:::columns` proves the container
 * path. So this file adds **one handler and no parser extension**, which is the
 * requirement in §15: prove the existing pipeline cannot already do it before
 * adding a plugin. It already can.
 *
 * ## Why the title is a bold first line and not `:::note Title`
 *
 * **Measured, not assumed.** Every form was rendered through the real pipeline:
 *
 * ```text
 *   :::note                     -> a directive
 *   ::::note                    -> a directive
 *   :::note Derivation          -> PLAIN TEXT, escaped, no directive
 *   ::::note Derivation         -> PLAIN TEXT, escaped, no directive
 * ```
 *
 * A label after the directive name makes micromark parse the whole block as inline
 * text. So a titled callout cannot be written `:::note Title` without changing the
 * name grammar, and §7 of the task says not to force the grammar for titles unless
 * there is a real architectural benefit. There is none here: `**Title**` on the
 * first line is Markdown-native, works today, and reads the same to a human.
 *
 * The title is therefore *detected*, not declared: a body whose first block is a
 * paragraph containing nothing but a `<strong>` becomes the title. That is a
 * structural rule, so a note starting with `**bold**` inline mid-sentence is not
 * mistaken for a title.
 *
 * ## One handler for every variant
 *
 * `:::note`, `:::info`, `:::tip`, `:::warning`, `:::danger`, `:::success` all reach
 * this one function and the variant name is looked up in {@link CALLOUT_VARIANTS}.
 * Styling is **not** decided here — this module emits `class="rt-callout
 * rt-callout--note"` and the stylesheet resolves it against the same Mantine
 * tokens the Rich Editor's `callout.module.css` already uses. Adding a variant is
 * one registry entry, not a new handler and not new CSS.
 */
import type { ColumnDirectiveInput } from './markdown-columns.js'

/** A callout variant: which directive names map to it, and its accent token name. */
export interface CalloutVariant {
  /** Canonical name, used in the emitted class. */
  readonly id: string
  /**
   * Directive names that select this variant.
   *
   * Several per variant on purpose: `:::info` and `:::note` are the same intent to
   * a reader, and refusing one of them would be a papercut for no benefit.
   */
  readonly directiveNames: readonly string[]
}

/**
 * The variants the Markdown surface supports.
 *
 * **Deliberately the Rich Editor's set**, not GitHub's. `callout.module.css`
 * already defines `info`, `note`, `tip`, `warning` and `danger` using Mantine
 * tokens, so reusing those names is what makes a Markdown callout and a Rich Note
 * callout look like the same feature. GitHub's alerts use `caution`/`important`,
 * which RTWiki has no visual language for; adding them here would create a second,
 * differently-named palette.
 *
 * `success` is accepted as an alias of `tip`, not as a sixth palette entry.
 */
export const CALLOUT_VARIANTS: readonly CalloutVariant[] = [
  { id: 'note', directiveNames: ['note'] },
  { id: 'info', directiveNames: ['info'] },
  { id: 'tip', directiveNames: ['tip', 'success'] },
  { id: 'warning', directiveNames: ['warning', 'caution', 'important'] },
  { id: 'danger', directiveNames: ['danger', 'error'] }
]

/** Directive name → canonical variant id. Built from the registry, never by hand. */
const VARIANT_BY_DIRECTIVE: ReadonlyMap<string, string> = new Map(
  CALLOUT_VARIANTS.flatMap((v) => v.directiveNames.map((name) => [name, v.id] as const))
)

/** The variant a directive name selects, or `undefined` if it is not a callout. */
export function calloutVariantFor(directiveName: string): string | undefined {
  return VARIANT_BY_DIRECTIVE.get(directiveName.toLowerCase())
}

/** Every directive name the callout layer claims. Used by the handler to decide. */
export function isCalloutDirective(directiveName: string): boolean {
  return VARIANT_BY_DIRECTIVE.has(directiveName.toLowerCase())
}

/** The class the stylesheet matches on. Stable: the CSS and the tests both name it. */
export const CALLOUT_CLASS = 'rt-callout'
export const CALLOUT_TITLE_CLASS = 'rt-callout__title'

/**
 * Renders one callout container directive.
 *
 * @param encode micromark's escaper. Applied to the variant name and the title.
 * @param directive The parsed directive.
 *
 * ## Why it takes `directive.content` whole
 *
 * The body is already compiled HTML by the time a handler runs — micromark's
 * compiler hands over finished markup for a container's children. So it is written
 * with `raw`, never escaped. Escaping it here would turn the note's own Markdown
 * into visible tag text, which is the exact failure this work set out to fix.
 */
export function renderCalloutDirective(
  encode: (value: string) => string,
  directive: ColumnDirectiveInput
): string {
  const name = directive.name ?? ''
  const variant = calloutVariantFor(name) ?? 'note'

  const { title, body } = splitLeadingBoldTitle(directive.content ?? '')

  const heading = title
    ? `<p class="${CALLOUT_TITLE_CLASS}">${encode(title)}</p>`
    : `<p class="${CALLOUT_TITLE_CLASS}">${encode(titleCase(variant))}</p>`

  return (
    `<div class="${CALLOUT_CLASS} ${CALLOUT_CLASS}--${encode(variant)}" role="note">` +
    heading +
    body +
    `</div>`
  )
}

/**
 * Peels a `**Title**`-only first paragraph off the body.
 *
 * Structural, and deliberately narrow: the opening tag must be `<p>`, the closing
 * `</p>` must be that paragraph's own, and between them there must be exactly one
 * `<strong>` wrapping the whole content. A paragraph like `**Step 1** then more`
 * has text after the `</strong>` and is therefore body, not title — which is what
 * keeps a note whose first line happens to be bold from losing that line.
 */
function splitLeadingBoldTitle(content: string): { title: string | null; body: string } {
  const match = /^<p>(<strong>([\s\S]*?)<\/strong>)<\/p>([\s\S]*)$/.exec(content.trim())
  if (!match) return { title: null, body: content }
  const inner = match[2] ?? ''
  // Nothing outside the <strong>, so the whole paragraph is the title.
  if (inner.includes('<') || inner.trim().length === 0) {
    return { title: null, body: content }
  }
  return { title: decodeEntities(inner.trim()), body: match[3] ?? '' }
}

/** `warning` → `Warning`. Used only for the untitled default label. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Reverses the four entities micromark's escaper produces.
 *
 * A title is text a human typed, and the compile step escaped it; leaving it
 * escaped would render `Derivation &amp; Proof` on screen. Anything else is left
 * alone rather than decoded — this is a display helper, not a second parser.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}
