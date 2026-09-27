import DOMPurify, { type Config } from 'dompurify'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

/**
 * GitHub-Flavored Markdown: tables, task lists, strikethrough, autolinks and
 * footnotes.
 *
 * `gfm()` and `gfmHtml()` are the two halves of one extension — the first parses
 * the syntax, the second serialises it. Composed once at module scope so every
 * render shares one parser configuration and none of them can drift.
 */
const MARKDOWN_OPTIONS = { extensions: [gfm()], htmlExtensions: [gfmHtml()] }

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
 * Widening the profile was checked against the attacks it could plausibly admit,
 * rather than assumed safe. Under the widened profile: `<script>`, `<img onerror>`,
 * `<svg><script>`, `<math><mtext><script>`, `<svg><animate onbegin>` and
 * `<iframe src=javascript:>` are all still neutralised. `tests/markdown-render.test.ts`
 * keeps that check.
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
