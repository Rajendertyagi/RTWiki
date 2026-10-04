/**
 * Fills the plain `<pre><code class="language-js">` blocks the Markdown parser
 * emitted with Shiki-highlighted HTML.
 *
 * ## Why this is a post-processing pass and not part of the parser
 *
 * micromark's compiler is synchronous and Shiki is not — creating a highlighter
 * parses TextMate grammars, and `codeToHtml` is async. So the parser can only
 * ever emit a fence's *text*, and something has to replace it afterwards.
 *
 * **This is not a workaround invented for Shiki; it is the pattern this codebase
 * already uses.** `markdown-mermaid.ts` emits a `<div class="rt-mermaid">`
 * placeholder and `markdown-mermaid-hydrate.ts` fills it in, for exactly the same
 * reason: `mermaid.render()` is async and micromark is not. Following the
 * established shape rather than inventing a second one is the point — a future
 * agent changing diagram behaviour should find the highlighting pass beside it and
 * recognise the pattern.
 *
 * The alternative — making `renderMarkdown` async and awaiting Shiki inside it —
 * was rejected deliberately. It would force every caller to become async, and
 * `markdown-workspace.tsx:162` computes the preview in a `useMemo` that must
 * return a string; a suspense boundary or a two-state render would be needed for
 * a purely decorative improvement, and the preview would flash unhighlighted code
 * on every keystroke either way.
 *
 * ## No parser change at all
 *
 * micromark already emits `<pre><code class="language-js">` and it already keeps
 * the fence's exact text as the element's text content. That is everything needed,
 * so `markdown-render.ts` is untouched. A fence with no language produces no class
 * and is skipped here, which is why an unlabelled fence renders as plain code
 * exactly as it always did.
 *
 * ## Ownership of the DOM
 *
 * The preview is one `dangerouslySetInnerHTML` element whose children are replaced
 * from scratch on every edit. This module therefore:
 *
 *   - never asks React to own anything inside it,
 *   - marks the elements it has processed, so a re-scan is a no-op rather than an
 *     infinite highlight-highlight loop against its own mutations,
 *   - and writes into the element in place, so a node replaced mid-render simply
 *     loses the write (`isConnected` check) instead of corrupting the new document.
 *
 * `markdown-mermaid-hydrate.ts` records that the framework replaced the preview's
 * children ~50 ms after the first scan, with no React dependency changed. That is
 * why the `isConnected` guard is load-bearing and not defensive.
 */
import type { CodeColorScheme } from '../code/code-registry.js'
import { resolveCodeLanguage } from '../code/code-registry.js'
import { highlightToTokens } from '../code/shiki-service.js'

/** Marks a `<code>` element this module has already dealt with. */
const PROCESSED_ATTRIBUTE = 'data-rt-code-state'

/** The state values. `plain` is a completed outcome, not a failure. */
type CodeState = 'pending' | 'done' | 'plain' | 'failed'

/**
 * Selects the code elements worth highlighting.
 *
 * `pre > code` because a `<pre>`'s `<code>` is where micromark puts the fence's
 * text. The `language-*` filter is applied in the scan rather than here, so a fence
 * with no language is skipped without its state ever being marked.
 */
const CODE_SELECTOR = 'pre > code[class*="language-"]'

export interface CodeHighlightOptions {
  /** Which theme to highlight with. */
  readonly colorScheme: CodeColorScheme
  /**
   * Injected for tests.
   *
   * The Mermaid equivalent does the same, and for the same stated reason: the
   * highlight engine is a parameter rather than an import, so the unit tests drive
   * the whole state machine with no module mocking and a second engine cannot be
   * introduced here by accident.
   */
  readonly highlight?: typeof highlightToTokens
}

/** Detaches the highlight pass. Returns void; safe to call more than once. */
export function detach(): void {
  // No module-level state to clear: every attachment owns its own state and is
  // fully released by the observer disconnect. This exists so the call site reads
  // symmetrically with `attachCodeHighlighting` and so a future module-level cache
  // has an obvious home.
}

/**
 * Starts highlighting the code blocks inside `container`.
 *
 * Scans immediately and then on every mutation, for the reason recorded above:
 * the framework's first write and this module's first scan race, and the observer
 * is what makes "the second write is picked up too" true rather than likely.
 *
 * @returns a teardown function.
 */
export function attachCodeHighlighting(
  container: HTMLElement,
  options: CodeHighlightOptions
): () => void {
  const { colorScheme, highlight = highlightToTokens } = options

  /** Set by the teardown, so a late resolution writes nothing at all. */
  let stopped = false

  /**
   * Highlight one block.
   *
   * Every failure path ends in a marked element rather than a thrown error: a
   * document must not fail to render because one fence could not be coloured.
   */
  const hydrate = async (element: HTMLElement): Promise<void> => {
    const info = fenceInfoOf(element)
    if (!resolveCodeLanguage(info)) return

    element.setAttribute(PROCESSED_ATTRIBUTE, 'pending')

    let state: CodeState = 'plain'
    try {
      const outcome = await highlight(element.textContent ?? '', info, colorScheme)
      // The framework may have replaced the whole preview while this awaited.
      // Measured: ~50 ms for Mermaid. Writing now would highlight a detached node
      // and leave the visible document unhighlighted with no second attempt.
      if (stopped || !element.isConnected) return
      state = outcome.kind === 'highlighted' ? 'done' : 'plain'
      if (outcome.kind === 'highlighted') {
        // `innerHTML` with Shiki's own escaped output. Safe because Shiki escapes
        // the code, and because the visible document was already produced through
        // the sanitiser — this replaces markup the parser generated, it does not
        // admit new user input into the page.
        element.innerHTML = outcome.html
        // Shiki wraps in its own `<pre>`; the element we hold is the inner
        // `<code>`, so the outer `<pre>` is kept and the language class preserved
        // for the stylesheet's own rules.
      }
    } catch {
      state = 'failed'
    }

    if (stopped || !element.isConnected) return
    element.setAttribute(PROCESSED_ATTRIBUTE, state)
  }

  const scan = (): void => {
    for (const element of container.querySelectorAll<HTMLElement>(CODE_SELECTOR)) {
      if (element.hasAttribute(PROCESSED_ATTRIBUTE)) continue
      void hydrate(element)
    }
  }

  scan()

  // `childList` only: this module mutates `innerHTML` of a *descendant*, and
  // subtree would fire on its own writes, re-scanning for each block highlighted.
  // childList on the container is exactly "the framework replaced the preview".
  const observer = new MutationObserver(scan)
  observer.observe(container, { childList: true })

  return () => {
    stopped = true
    observer.disconnect()
  }
}

/**
 * The fence info for a `<code class="language-js">`, recovered from its class.
 *
 * `language-` is micromark's own output format, so this is a parse of the
 * document's existing markup rather than a second convention.
 */
function fenceInfoOf(element: HTMLElement): string {
  for (const className of element.classList) {
    if (className.startsWith('language-')) return className.slice('language-'.length)
  }
  return ''
}
