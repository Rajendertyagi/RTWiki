import DOMPurify, { type Config } from 'dompurify'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { math, mathHtml } from 'micromark-extension-math'
import { codes } from 'micromark-util-symbol'
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

const MARKDOWN_OPTIONS = {
  extensions: [
    gfm(),
    {
      // `flow` is the package's `$$` handling, kept verbatim. `text` is replaced.
      ...baseMath,
      text: { [codes.dollarSign]: mathTextGithubRule() }
    }
  ],
  htmlExtensions: [gfmHtml(), mathHtml({ throwOnError: false, trust: false })]
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
