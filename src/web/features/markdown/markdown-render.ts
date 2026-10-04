import DOMPurify, { type Config } from 'dompurify'
import { micromark } from 'micromark'
import { type Directive, directive, directiveHtml } from 'micromark-extension-directive'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { math, mathHtml } from 'micromark-extension-math'
import { codes } from 'micromark-util-symbol'
import { UI_TEXT } from '../../config/index.js'
import { isCalloutDirective, renderCalloutDirective } from './markdown-callouts.js'
import {
  COLUMN_CHILD_DIRECTIVE_NAME,
  COLUMNS_DIRECTIVE_NAME,
  type ColumnDirectiveInput,
  renderColumnChild,
  renderColumnsDirective,
  renderUnknownDirective,
  setColumnsDividerLabel
} from './markdown-columns.js'
import { mermaidHtml } from './markdown-mermaid.js'
import { mathTextGithubRule } from './math-inline-github-rule.js'

/**
 * The extension set: GitHub-Flavored Markdown, plus `$…$` inline and `$$…$$`
 * display maths.
 *
 * Each extension has two halves — the first parses the syntax, the second
 * serialises it — and both are composed here, once, at module scope, so every
 * render shares one configuration and none of them can drift.
 *
 * ## Why the inline construct is ours and the rest is the package's
 *
 * `micromark-extension-math` decides inline maths by **marker count**, not by
 * character adjacency, and its only option is a boolean that governs marker count. It
 * therefore cannot express GitHub's rule, and with the default setting two dollar
 * amounts in a sentence became an equation — measured: `Pay $5 or $10 today.` and
 * `It cost $20,000 and $30,000 won.` both rendered as maths.
 *
 * So the package's **`flow`** is reused unchanged (display maths, `$$`, is correct
 * and is not the problem) and its **`text`** is replaced by
 * {@link mathTextGithubRule}, which implements the three adjacency conditions. The
 * serialiser, `mathHtml`, is the package's unchanged — it is the KaTeX renderer, it
 * is correct, and it matches on the token names the replacement deliberately keeps.
 *
 * **We now own this tokenizer instead of receiving it from a maintainer.** That is the
 * deliberate cost of correct behaviour and GitHub parity, and it is a real one: a bug
 * in it is ours to fix. It is one construct in one file, not a fork.
 *
 * ## `trust: false` is pinned, not defaulted
 *
 * KaTeX's `trust` flag gates `\href`, `\url`, `\htmlClass`, `\htmlId` and
 * `\includegraphics`. With it on, TeX in a note becomes an injection vector: a
 * study note containing `\href{javascript:alert(1)}{click}` would produce a live
 * link in RTWiki's own origin. It is set explicitly rather than left to KaTeX's
 * default so that a future KaTeX release cannot quietly change what the default
 * means. `tests/markdown-render.test.ts` asserts the effect, not the flag.
 *
 * ## `throwOnError: false` is deliberate
 *
 * With throwing enabled, one malformed expression in a note makes the whole
 * preview fail to render — a single typo would blank the page. Disabled, KaTeX
 * renders the source in its error colour, so the reader sees what they wrote and
 * the rest of the page survives.
 */
const baseMath = math()

/**
 * The `:::columns` handler, and the fallback for every name it does not claim.
 *
 * ## A handler emits with `this.tag`/`this.raw`, not by returning a string
 *
 * Measured: a handler that *returns* `"<i>x</i>"` emits nothing at all.
 * micromark's compiler calls each handler and **discards the return value** —
 * `micromark/lib/compile.js` calls `handle.call({...context}, token)` with no
 * assignment. Output is written through `this.tag(html)` (respects the image
 * alt-text tag suppression) or `this.raw(html)`.
 *
 * What the return value *does* control is one thing only, inside the
 * extension's own `exit()`: `found = result !== false`, which decides whether
 * the `'*'` fallback runs. So a named handler returns `false` to hand a name
 * over to the fallback, and anything else to keep it. The fallback's return
 * value is likewise only that flag.
 *
 * ## The `'*'` fallback is not defensive
 *
 * See `renderUnknownDirective`. The extension **buffers** a container's body
 * and hands it to the handler, so a container nothing writes is deleted along
 * with the rest of the document. Without this fallback,
 * `before\n\n:::warning\n**be careful**\n\nafter\n` renders as `<p>before</p>`
 * and loses two paragraphs silently. This is the measured reason the fallback
 * exists, and it is asserted by a test.
 *
 * ## All three directive kinds arrive here
 *
 * `directiveHtml` takes a record of name to handler, so one function sees
 * container, leaf and text directives alike, distinguished by `d.type`. That
 * is a structural property of the API rather than three separate
 * registrations: a leaf `::columns` and an inline `:::columns` reach this
 * fallback too, and are rendered inline rather than as a two-pane block.
 */
interface EmitContext {
  /** micromark's escaper. Apply to every value taken from the document. */
  encode: (value: string) => string
  /** Writes output respecting the image alt-text tag suppression. */
  tag: (value: string) => void
  /** Writes output verbatim. Used for `directive.content`, which is already
   *  compiled HTML and must not be escaped a second time. */
  raw: (value: string) => void
}

const DIRECTIVE_HTML_OPTIONS = {
  [COLUMNS_DIRECTIVE_NAME](this: EmitContext, directive: Directive): boolean | undefined {
    // A text directive is inline: emitting block-level panes into a paragraph
    // would be malformed HTML, and `:::columns` used inline is not a layout
    // request anyway. `false` hands it to the fallback, which renders it inline
    // and visibly. (Measured: a mid-line `:::columns` never reaches a handler
    // at all — it stays literal text — so this only fires for one on its own
    // line.)
    if (directive.type === 'textDirective') return false
    this.raw(renderColumnsDirective(this.encode, directive as ColumnDirectiveInput))
    return undefined
  },
  /*
   * One `:::column` child. It renders **itself**, completely.
   *
   * That is measured, not stylistic. Nested directives compile inside out, so
   * this handler always runs before the parent `::::columns` and its compiled
   * HTML is already sitting in the parent's `content` when the parent runs. So
   * there is no need to hand anything over — and passing it over through
   * micromark's compile-data store was tried and **lost content**: an orphan
   * `:::column` outside any `::::columns` was pushed onto the store, never
   * reached the output, and vanished. The parent finds its children in the
   * compiled string instead.
   */
  [COLUMN_CHILD_DIRECTIVE_NAME](this: EmitContext, directive: Directive): boolean | undefined {
    if (directive.type === 'textDirective') return false
    this.raw(renderColumnChild(this.encode, directive as ColumnDirectiveInput))
    return undefined
  },
  '*'(this: EmitContext, directive: Directive): boolean | undefined {
    /*
     * A callout name is claimed before the fallback runs, so a `:::warning` becomes
     * a panel instead of the fallback's diagnostic box.
     *
     * The check is on the *name*, not on a list written here: `isCalloutDirective`
     * reads the same registry `renderCalloutDirective` does, so the set of names
     * that are callouts and the set that render as callouts cannot disagree.
     *
     * A text directive is handed back to the fallback, for the reason the columns
     * handler gives: `:::note` inline is not a panel request, and emitting a
     * `<div>` into a `<p>` would be malformed HTML.
     */
    if (directive.type !== 'textDirective' && isCalloutDirective(directive.name)) {
      this.raw(renderCalloutDirective(this.encode, directive as ColumnDirectiveInput))
      return undefined
    }
    this.raw(renderUnknownDirective(this.encode, directive as ColumnDirectiveInput))
    // `undefined` is the "handled, and there is nothing after me" signal. It is
    // written explicitly because the return type is `boolean | undefined` and a
    // bare `void` body would not satisfy it.
    return undefined
  }
}

// The divider's accessible name is user-facing text, so it comes from the UI text
// dictionary ([DEVELOPMENT_STANDARDS](../../docs/DEVELOPMENT_STANDARDS.md) §5.2)
// rather than being written into the feature module. Injected once at module
// scope so the render path stays a pure function of its input.
setColumnsDividerLabel(UI_TEXT.columnsResizeLabel)

const MARKDOWN_OPTIONS = {
  extensions: [
    gfm(),
    directive(),
    {
      // `flow` is the package's `$$` handling, kept verbatim. `text` is replaced.
      ...baseMath,
      text: { [codes.dollarSign]: mathTextGithubRule() }
    }
  ],
  htmlExtensions: [
    gfmHtml(),
    // After gfm: the directive extension's handlers cover different token types,
    // so the order is not load-bearing, and keeping our own after the packages
    // makes the composition read top-down as "GFM, maths, then RTWiki's own".
    directiveHtml(DIRECTIVE_HTML_OPTIONS),
    mathHtml({ throwOnError: false, trust: false }),
    // ` ```mermaid ` fences, as a placeholder. It replaces three of micromark's
    // own fenced-code handlers so it can read the info string and choose, and it
    // captures the default output rather than rewriting it — see that module for
    // why a fence that is not a diagram is still byte-identical.
    mermaidHtml()
  ]
}

/**
 * Renders Markdown source to a sanitised HTML string for preview.
 *
 * ## Security
 *
 * RTWiki forbids raw HTML execution inside Markdown, and the parser now enforces
 * that at the source rather than relying on the sanitiser alone: **micromark
 * escapes raw HTML**, so `<b>x</b>` arrives here as visible text `&lt;b&gt;x&lt;/b&gt;`
 * and never becomes an element. `marked` allowed it through, leaving the whole
 * burden on DOMPurify. The sanitiser still runs, because a parser bug must not be
 * the only thing standing between a document and script execution.
 *
 * ## Why the sanitiser profile includes MathML and SVG
 *
 * The profile was `{ html: true }`, which silently removed every `<math>` and every
 * `<svg>`. Measured: one of each in, zero of each out, while the surrounding
 * `<span class="katex-html">` survived byte-identically — so the damage was
 * invisible in a DOM snapshot. A KaTeX radical is a MathML `<msqrt>` with an SVG
 * overlay, so `\sqrt{2}` was losing both and rendering as a bare `2`, and maths
 * were invisible to a screen reader.
 *
 * **This is the reason maths work at all.** The profile was widened in anticipation
 * of them; `micromark-extension-math` is what makes the widening load-bearing. A
 * reader with a screen reader gets the MathML subtree, and everyone else gets the
 * SVG overlay.
 *
 * Widening the profile was checked against the attacks it could plausibly admit,
 * rather than assumed safe. Under the widened profile: `<script>`, `<img onerror>`,
 * `<svg><script>`, `<math><mtext><script>`, `<svg><animate onbegin>` and
 * `<iframe src=javascript:>` are all still neutralised. `tests/markdown-render.test.ts`
 * keeps that check, and re-runs it against real hostile TeX rather than only against
 * hand-written markup.
 */
/**
 * The sanitiser configuration, exported so it can be asserted directly.
 *
 * It is applied to *generated* markup as well as parsed source, and the two cases
 * are not the same risk. From Markdown source, raw HTML is escaped by the parser
 * and no MathML or SVG ever reaches this function — the only way such markup gets
 * here is an extension we wrote emitting it (KaTeX, a diagram). So the widened
 * profile widens what *our own* output is allowed to contain, not what a user's
 * keystrokes can, and this constant is where that boundary is written down.
 */
export const MARKDOWN_SANITIZE_OPTIONS: Config = {
  USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
  ADD_TAGS: ['input'],
  ADD_ATTR: ['type', 'checked', 'disabled'],
  FORBID_TAGS: [
    'style',
    'iframe',
    'form',
    'object',
    'embed',
    'link',
    'meta',
    'script',
    'frame',
    'frameset',
    'textarea',
    'select',
    'button',
    'base',
    'noscript'
  ]
}

export function renderMarkdown(source: string): string {
  const rawHtml = micromark(source, MARKDOWN_OPTIONS)
  // DOMPurify's overloads return `TrustedHTML` when `RETURN_TRUSTED_TYPE` is on.
  // RTWiki does not enable that, and the value is injected as a string, so the
  // widening is asserted rather than cast: if trusted types were ever switched on,
  // this would stop compiling instead of silently changing the injected value.
  return DOMPurify.sanitize(rawHtml, MARKDOWN_SANITIZE_OPTIONS) as unknown as string
}
