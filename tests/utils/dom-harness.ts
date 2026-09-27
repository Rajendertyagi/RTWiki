import { JSDOM } from 'jsdom'

/**
 * One jsdom for the whole test process, for the test files that need a DOM.
 *
 * ## Why this exists rather than each file making its own
 *
 * `markdown-render.ts` creates its DOMPurify instance **at import time**, bound
 * to whatever `window` is ambient when the module is first evaluated. ESM caches
 * a module for the life of the process, so that binding is made exactly once —
 * by whichever test file happens to import it first — and it keeps pointing at
 * that file's `window` for every other file too.
 *
 * Two files each doing `new JSDOM()` in `beforeAll` and `dom.window.close()` in
 * `afterAll` therefore collide: the first file's `afterAll` closes the window the
 * cached module (and therefore the second file) is still using, and the second
 * file's assertions all start returning empty. Measured, with
 * `markdown-render.test.ts` and `markdown-columns.test.ts` in one run: 26
 * failures, every one of them a null or empty result from a sanitiser whose
 * document had been closed underneath it.
 *
 * The fix is not to be careful about ordering. It is **one** DOM, created once,
 * never closed while the process lives.
 *
 * ## Why it is not closed at all
 *
 * Closing it would invalidate the DOMPurify instance the cached module holds, for
 * every later file. A test process that exits in a few seconds does not need the
 * memory back, and a closed window is a much worse failure mode than an
 * uncollected one.
 */
let instance: JSDOM | null = null

/** The shared DOM, created on first use. */
export function sharedDom(): JSDOM {
  if (instance === null) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
    const globals = globalThis as unknown as Record<string, unknown>
    globals.window = dom.window
    globals.document = dom.window.document
    globals.Node = dom.window.Node
    globals.Element = dom.window.Element
    globals.HTMLElement = dom.window.HTMLElement
    globals.DocumentFragment = dom.window.DocumentFragment
    globals.NodeFilter = dom.window.NodeFilter
    globals.MutationObserver = dom.window.MutationObserver
    // DOMPurify is disabled in the test environment, so a `trustedTypes` global
    // would make it hand back a TrustedHTML and change the value under test.
    globals.trustedTypes = undefined
    instance = dom
  }
  return instance
}

/** The shared window. Short, because nearly every caller wants this. */
export function sharedWindow(): Window {
  return sharedDom().window as unknown as Window
}

/**
 * Parses a fragment of HTML into a fresh document, for asserting on structure
 * rather than on an HTML string.
 *
 * Uses a **separate** JSDOM from the shared one on purpose: the assertions read
 * the parsed tree, and a parse in a throwaway document cannot disturb the
 * ambient `document` the sanitiser is bound to.
 */
export function parseFragment(html: string): Document {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document
}
