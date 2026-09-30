import { UI_TEXT } from '../../config/index.js'
import type { MermaidRenderResult, MermaidTheme } from '../rich-editor/blocks/mermaid-render.js'
import { MERMAID_CLASS, MERMAID_SOURCE_CLASS } from './markdown-mermaid.js'

/**
 * Fills the ` ```mermaid ` placeholders the Markdown parser emitted with actual
 * diagrams.
 *
 * ## The two halves, and why the split exists at all
 *
 * `markdown-mermaid.ts` is synchronous - micromark's compiler is - and
 * `mermaid.render()` is not. So the parser half can only emit a **placeholder**
 * carrying the source as element text, and something has to fill it in
 * afterwards. This is that something.
 *
 * The single Mermaid configuration stays
 * `rich-editor/blocks/mermaid-render.ts`. This module **adds no Mermaid option**:
 * it is handed a `render` function and calls it. A second `initialize()` here
 * would let a Markdown note and a Rich Note disagree about `securityLevel`, and
 * that disagreement is a security boundary rather than a detail - which is why
 * `tests/markdown-mermaid.test.ts` asserts the parser half imports no Mermaid
 * configuration at all. The renderer is a **parameter**, not an import, so the
 * unit tests drive the whole state machine with no module mocking, and a second
 * configuration cannot be introduced here by accident.
 *
 * ## Why this is not a React island
 *
 * The preview is one `dangerouslySetInnerHTML` element whose `innerHTML` is
 * replaced from scratch whenever the rendered Markdown changes. A React root
 * inside it would mount and unmount continuously, and `createRoot` appears
 * exactly once in this app - there is no island infrastructure to hang one on.
 * The established precedent for "attach behaviour after injection" is the
 * divider wiring in `markdown-columns-divider.ts` and the Rich Note's broken-link
 * effect (`rich-editor.tsx:453-511`): a container the framework does not replace,
 * and a `MutationObserver` on it.
 *
 * ## The replacement, and why the observer is not optional
 *
 * **Measured, in a browser, on the built app**, with the module instrumented to
 * log what each scan found:
 *
 * ```text
 * 1105ms  the framework writes the preview's children (the placeholder is there)
 * 1115ms  this module's FIRST scan runs, and finds 1 placeholder
 * 1164ms  the framework writes the preview's children AGAIN - new nodes
 * ```
 *
 * So the first scan is **not** too early to find the content; it finds it, and
 * starts a render. The replacement lands about **50 ms** later, mints new nodes,
 * and the diagram that render is drawing into goes with the old one. The
 * `markdown-columns-divider.ts` note records the same shape at 17 ms for its
 * case, and the same conclusion.
 *
 * Three properties of that write are what make it dangerous, and none of them
 * produces an error:
 *
 * 1. No React dependency changes, so an effect keyed on the rendered HTML does
 *    not re-run. The new HTML is not even required to differ.
 * 2. The container the wiring is attached to is untouched - only its children
 *    are replaced - so every delegated listener keeps firing and keeps doing
 *    nothing.
 * 3. The replacement is invisible to a snapshot. Nothing throws; a reader simply
 *    has no diagram.
 *
 * Proof that it is not theoretical: with the observer below commented out, every
 * test in `tests/browser/markdown-mermaid.pwspec.ts` fails, not only the one
 * about re-rendering - the first render lands in a node that is discarded before
 * anyone can see it.
 *
 * A `MutationObserver` on `childList` is the one signal guaranteed to arrive. It
 * is **not** observed with `subtree`, because this module writes into the
 * placeholders it hydrates: a subtree observer would see its own SVG insertion
 * and re-enter. The container's own child list changes only when the framework
 * replaces the preview, which is exactly the event wanted.
 *
 * ## What a render is allowed to do to the DOM
 *
 * The `<pre>` holding the source is the reader's content and is **never removed**,
 * at any point, including after a successful render. It is hidden with the
 * `hidden` attribute, which keeps it in the tree: a successful render replaces
 * the reader's *view* of it, an error reveals it again, and a reader who selects
 * the page and copies it still gets the diagram source back. So a slow render
 * shows the source rather than a hole in the layout, and a failed one shows the
 * source and a message rather than a blank box.
 */

/** Selector for the placeholder the parser emitted. Built from the shared class. */
const PLACEHOLDER_SELECTOR = `.${MERMAID_CLASS}`

/** Selector for the element whose text is the diagram source. */
const SOURCE_SELECTOR = `.${MERMAID_SOURCE_CLASS}`

/** Class on the element carrying the render-error message. */
export const MERMAID_ERROR_CLASS = 'rt-mermaid__error'

/** `data-` attribute on the placeholder carrying its render state. */
export const MERMAID_STATE_ATTRIBUTE = 'data-rt-state'

/** No render has produced SVG yet. The source is showing. */
export const MERMAID_STATE_PENDING = 'pending'

/** The SVG landed. The source is hidden, not removed. */
export const MERMAID_STATE_RENDERED = 'rendered'

/** Mermaid could not parse or draw it. The source stays visible. */
export const MERMAID_STATE_ERROR = 'error'

/** `blockType` for a Markdown fence: it is a diagram, never a mind map. */
const BLOCK_TYPE = 'diagram' as const

/**
 * The renderer this module drives, as a **parameter**.
 *
 * `renderMermaidSvg` satisfies this shape: its `blockType` is a wider union and
 * its `signal` is optional, and a function accepting a wider parameter type is
 * assignable to one accepting a narrower one. That is what lets the workspace
 * pass `renderMermaidSvg` itself - no wrapper, no second configuration, and no
 * import of Mermaid from the Markdown feature at all.
 */
export type MermaidDiagramRender = (
  source: string,
  options: {
    theme: MermaidTheme
    blockId: string
    blockType: 'diagram'
    signal: AbortSignal
  }
) => Promise<MermaidRenderResult>

/**
 * The render identity for the fence at `index` on `pageId`.
 *
 * `renderMermaidSvg` derives the SVG's own element id from this string through
 * `mermaidRenderId`, so two fences sharing one id would put two diagrams' node
 * sets under the same `id` in one document.
 *
 * ## Why a position, and why the page is in it too
 *
 * - **`index`** - the fence's position among the placeholders in the preview. Two
 *   fences on one page are at different positions, so they cannot collide.
 *   Asserted in `tests/markdown-mermaid-hydrate.test.ts`, which puts two fences
 *   in one preview and reads the ids the renderer was actually given.
 * - **`pageId`** - two pages are told apart even at the same position, so the
 *   identity is a property of the page rather than of how many fences happen to
 *   precede this one.
 *
 * A **counter** would also be collision-free and is worse: it resets on a
 * re-render, so the same fence would change identity every keystroke. A position
 * is derived from the document, so it is stable for as long as the fences are.
 *
 * This is the id a **whole preview** assigns. {@link assignRenderId} adds the one
 * case a position alone cannot cover, so the no-collision property holds by
 * construction rather than by an argument about how React writes HTML.
 */
export function mermaidBlockId(pageId: string, index: number): string {
  return `${pageId}/mermaid/${index}`
}

export interface MermaidHydrationOptions {
  /** The page being previewed. Part of every fence's render identity. */
  pageId: string
  /** The colour scheme the reader is in, passed straight to the renderer. */
  theme: MermaidTheme
  /** The one renderer. `renderMermaidSvg`, from the Rich editor. */
  render: MermaidDiagramRender
}

/**
 * The message for a failed render, by code.
 *
 * Both codes get the same words, exactly as the editor's Diagram block does
 * (`mermaid-block-view.tsx`, `ERROR_MESSAGES`) - not because the failure is
 * undiagnosable, but because the two are the same to a reader and the difference
 * is not actionable: either way the fix is in the source, which is on screen.
 * Every string comes from the shared dictionary (`src/web/config/index.ts`).
 */
const RENDER_ERROR_MESSAGES: Record<'parse_error' | 'render_error', string> = {
  parse_error: UI_TEXT.diagramErrorTitle,
  render_error: UI_TEXT.diagramErrorTitle
}

/** A render this attachment started and has not yet seen resolve. */
interface LiveRender {
  /** The generation this render was started with. Only the newest may write. */
  generation: number
  controller: AbortController
}

/**
 * Hydrates every ` ```mermaid ` placeholder inside `container`, and keeps
 * hydrating the ones that replace them. Returns a teardown.
 *
 * @param container The preview element whose `innerHTML` holds the rendered
 * Markdown. It is queried and observed, never replaced, so this wiring outlives
 * every re-render of its contents.
 */
export function attachMermaidDiagrams(
  container: HTMLElement,
  options: MermaidHydrationOptions
): () => void {
  const { pageId, theme, render } = options

  /**
   * Placeholders this attachment has given a render identity, mapped to it.
   *
   * A `Map`, rebuilt-pruned on every scan rather than cached, for the reason
   * `markdown-columns-divider.ts` gives: a snapshot of nodes that the framework
   * has since replaced is the stale state being avoided here. Membership is
   * keyed by the element, so a node that is new is simply not in it.
   */
  const identities = new Map<HTMLElement, string>()

  /** The identities currently claimed by a placeholder that is still connected. */
  const claimed = new Set<string>()

  /** Renders still in flight, so a superseded one can be abandoned. */
  const live = new Map<HTMLElement, LiveRender>()

  /** Monotonic across this attachment, so "newest wins" is decidable. */
  let generation = 0

  /** Set by the teardown, so a late resolution writes nothing at all. */
  let stopped = false

  /**
   * The render identity for `element`, assigned once and then kept.
   *
   * A position is enough for every fence a whole-`innerHTML` replacement
   * produces, because that scan numbers every placeholder present. The one case
   * it is not enough for is a **partial** addition - a node arriving while the
   * others stay - where the newcomer can land on an index a still-connected
   * placeholder already holds. Two diagrams sharing a render id would put two
   * node sets under one `id` in one document, so the newcomer is stepped to the
   * next free index instead of being trusted to the position alone.
   *
   * The step costs a comparison per new placeholder and makes "two fences on one
   * page cannot collide" true by construction.
   */
  const assignRenderId = (element: HTMLElement, index: number): string => {
    const existing = identities.get(element)
    if (existing !== undefined) return existing
    let offset = index
    let candidate = mermaidBlockId(pageId, offset)
    while (claimed.has(candidate)) {
      offset += 1
      candidate = mermaidBlockId(pageId, offset)
    }
    claimed.add(candidate)
    identities.set(element, candidate)
    return candidate
  }

  const hydrate = (element: HTMLElement, index: number): void => {
    // Already has an identity, so a render was started for it. Re-rendering on
    // every scan would restart an in-flight render on every mutation - including
    // this module's own - and nothing would ever finish.
    if (identities.has(element)) return

    const source = element.querySelector<HTMLElement>(SOURCE_SELECTOR)
    const blockId = assignRenderId(element, index)

    // Any previous attempt on this element is superseded by this one.
    live.get(element)?.controller.abort()

    const current: LiveRender = { generation: ++generation, controller: new AbortController() }
    live.set(element, current)

    element.setAttribute(MERMAID_STATE_ATTRIBUTE, MERMAID_STATE_PENDING)
    // Reset to the pre-render state: the source visible, nothing injected beside
    // it. On a first pass there is nothing to remove; on a re-render of the same
    // node - a theme change re-attaches - it is what stops a second SVG landing
    // under the first. Only the source is spared. It is the content.
    if (source !== null) {
      for (const child of Array.from(element.children)) {
        if (child !== source) child.remove()
      }
      source.hidden = false
    }

    // The parser always emits a source element, so `null` here is a placeholder
    // this module did not write. It is rendered anyway, with the empty source:
    // Mermaid will refuse it, and the reader gets the message rather than a
    // placeholder stuck in `pending` with nothing to act on and no explanation.
    void render(source?.textContent ?? '', {
      theme,
      blockId,
      blockType: BLOCK_TYPE,
      signal: current.controller.signal
    }).then((result: MermaidRenderResult) => {
      // Four ways this render can have stopped mattering, each a real event
      // rather than a defensive branch: the teardown ran, a newer render took
      // over for this element, a replacement detached it, or the renderer
      // reported a cancellation rather than throwing.
      if (stopped) return
      if (live.get(element)?.generation !== current.generation) return
      if (!container.contains(element)) return
      live.delete(element)

      if (result.ok) {
        showDiagram(element, source, result.svg)
        return
      }
      // A cancelled render was superseded or unmounted. It is **not** a failure:
      // it must not blank a diagram that is on its way, and must not raise an
      // error. Exactly the editor block's treatment of the same code.
      if (result.code === 'cancelled' || result.code === 'empty_source') return
      showRenderError(element, source, result.code)
    })
  }

  /**
   * Re-scans the container, hydrating placeholders it has not seen.
   *
   * The identity map and the claimed set are rebuilt here rather than carried,
   * which is what keeps them from outliving the nodes they describe: a
   * placeholder the framework has replaced is dropped, and its identity becomes
   * available again.
   */
  const scan = (): void => {
    claimed.clear()
    for (const [element, blockId] of identities) {
      if (container.contains(element)) {
        claimed.add(blockId)
      } else {
        identities.delete(element)
      }
    }

    const placeholders = container.querySelectorAll<HTMLElement>(PLACEHOLDER_SELECTOR)
    placeholders.forEach((element, index) => {
      hydrate(element, index)
    })

    /*
     * Abandon renders whose placeholder is gone.
     *
     * `renderMermaidSvg` serialises Mermaid's shared-config critical section, so
     * an abandoned render is not merely wasted work: it still occupies a queue
     * slot and delays the render that replaced it. The signal is checked twice
     * inside that queue - before the dynamic import, and again after `parse`,
     * the longest step - so aborting here actually saves the time.
     */
    for (const [element, entry] of live) {
      if (container.contains(element)) continue
      entry.controller.abort()
      live.delete(element)
    }
  }

  scan()

  /*
   * The signal that actually arrives: the framework replaces the preview's
   * children about 50 ms after the scan above, with new nodes and no React
   * dependency change. See the note at the top of this file.
   */
  const observer = new MutationObserver(() => {
    scan()
  })
  observer.observe(container, { childList: true })

  return () => {
    stopped = true
    observer.disconnect()
    for (const entry of live.values()) entry.controller.abort()
    live.clear()
    identities.clear()
    claimed.clear()
  }
}

/**
 * Puts the rendered diagram in the placeholder and hides the source.
 *
 * The source element is **hidden, not removed**: it is the reader's content, it
 * is what a render error shows, and a reader who selects the page and copies it
 * must get the diagram source back rather than a picture of one.
 *
 * `insertAdjacentHTML` rather than `innerHTML`, so the existing children -
 * chiefly the source - are left exactly as they are. The string is the output of
 * `sanitizeDiagramSvg`, which removes `script`, `iframe`, `object`, `embed`,
 * `foreignObject`, every `on*` handler and every external reference before this
 * is called; `renderMermaidSvg` returns a failure rather than SVG at all if that
 * pass rejects the output.
 */
function showDiagram(element: HTMLElement, source: HTMLElement | null, svg: string): void {
  element.insertAdjacentHTML('beforeend', svg)
  if (source !== null) source.hidden = true
  element.setAttribute(MERMAID_STATE_ATTRIBUTE, MERMAID_STATE_RENDERED)
}

/**
 * Shows a readable message and leaves the source on screen.
 *
 * The message is a dictionary string, the same one the editor's Diagram block
 * shows for the same two failure codes, and the source below it is the fix. A
 * diagram that will not draw must not cost the reader the text they wrote.
 */
function showRenderError(
  element: HTMLElement,
  source: HTMLElement | null,
  code: 'parse_error' | 'render_error'
): void {
  const message = document.createElement('p')
  message.className = MERMAID_ERROR_CLASS
  message.setAttribute('role', 'alert')
  message.textContent = RENDER_ERROR_MESSAGES[code]
  element.append(message)
  if (source !== null) source.hidden = false
  element.setAttribute(MERMAID_STATE_ATTRIBUTE, MERMAID_STATE_ERROR)
}
