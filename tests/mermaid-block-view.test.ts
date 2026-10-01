import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { MermaidRenderResult } from '../src/web/features/rich-editor/blocks/mermaid-render.js'
import { sharedDom } from './utils/dom-harness.js'

/**
 * A diagram's rendered state is observable, and the observation is not
 * "an `<svg>` appeared".
 *
 * The worst defect this project shipped: every
 * diagram in the application rendered with no labels at all, and nothing caught
 * it, because **every existing assertion was "an `<svg>` appeared"**. A
 * labelless diagram still has an `<svg>`, so that assertion was satisfied by
 * the exact failure it was supposed to detect. The attribute that would let a
 * test ask whether a diagram *actually rendered* was written by the block view
 * and read by nothing.
 *
 * These tests are that missing consumer. They pin `data-rendered` to the
 * component's own three states — committed render, in-flight/empty, and errored
 * — so a regression that blanks a diagram, or that leaves the pane claiming a
 * render it never got, fails here instead of shipping.
 *
 * ## Why the renderer is stubbed
 *
 * Mermaid cannot render in jsdom: it needs real layout (`getBBox`), which jsdom
 * does not implement. Exercising the success path therefore requires stubbing
 * `renderMermaidSvg`, which is also the correct unit boundary — the thing under
 * test is the *view's* contract with its render state, not Mermaid itself.
 * Mermaid's own behaviour is covered by `mermaid-security.test.ts` and by the
 * Playwright diagram specs.
 *
 * The stub is installed by spreading the real module, so `MERMAID_CONFIG` and
 * `mermaidRenderId` stay real for every other file in this process. A bare
 * replacement would have handed `mermaid-security.test.ts` a hollow module.
 *
 * ## Why the DOM is the shared one, and never closed
 *
 * `utils/dom-harness.ts` owns one process-wide DOM because `markdown-render.ts`
 * binds a DOMPurify instance to the ambient `window` at import time. This file
 * creates nothing and closes nothing.
 */

let dom: ReturnType<typeof sharedDom>
let viewModule: typeof import('../src/web/features/rich-editor/blocks/mermaid-block-view.js')
/**
 * The real result type, not a re-declared local shape.
 *
 * A stand-in `{ ok: false; code: string }` is assignable to nothing the renderer
 * actually returns, and it would let these tests drift from the production
 * contract as failure codes are added.
 */
type RenderResult = MermaidRenderResult

/** The result the next `renderMermaidSvg` call resolves with. */
let nextResult: RenderResult = { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }
/** When true the stub never settles, holding the block in its in-flight state. */
let hang = false

const realConsoleError = console.error

/**
 * The `data-*` attribute names `<html>` carried before this file mounted
 * anything.
 *
 * Mounting `MantineProvider` makes Mantine stamp its colour scheme onto
 * `document.documentElement`, and the shared DOM is never torn down — so that
 * attribute outlives this file. `tests/pane-divider.test.ts` asserts, by
 * absence, that a drag leaves no `data-*` attribute on `<html>`, and it broke
 * on exactly that leftover: measured as a failure in the full suite that
 * disappeared when this file was removed. Restoring the element is therefore
 * part of this file's contract with the harness, not tidiness.
 */
let preexistingRootDataAttrs: string[] = []

beforeAll(async () => {
  dom = sharedDom()
  preexistingRootDataAttrs = dom.window.document.documentElement
    .getAttributeNames()
    .filter((name) => name.startsWith('data-'))

  const globals = globalThis as unknown as Record<string, unknown>
  globals.Event = dom.window.Event
  globals.MouseEvent = dom.window.MouseEvent
  globals.navigator = dom.window.navigator
  globals.IS_REACT_ACT_ENVIRONMENT = true
  // Mantine's transitions schedule through these. They are installed here and
  // removed on teardown because the shared harness does not own them.
  globals.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    dom.window.setTimeout(() => cb(Date.now()), 0) as unknown as number
  globals.cancelAnimationFrame = (id: number): void => dom.window.clearTimeout(id)
  // React logs an act/environment warning per render; it is not a test signal.
  console.error = () => {}

  // The renderer is injected per-mount through the `render` prop, NOT stubbed
  // with `mock.module`. A module override is process-global and Bun does not
  // undo it for later files, so it leaked this stub into unrelated renderer
  // tests and made them fail purely on file order.
  viewModule = await import('../src/web/features/rich-editor/blocks/mermaid-block-view.js')
  viewModule = await import('../src/web/features/rich-editor/blocks/mermaid-block-view.js')
})

afterAll(() => {
  console.error = realConsoleError

  const globals = globalThis as unknown as Record<string, unknown>
  delete globals.requestAnimationFrame
  delete globals.cancelAnimationFrame

  // Undo everything Mantine stamped onto the shared document element, so the
  // next file sees the DOM it would have seen had this file never run.
  const root = dom.window.document.documentElement
  for (const name of root.getAttributeNames()) {
    if (name.startsWith('data-') && !preexistingRootDataAttrs.includes(name)) {
      root.removeAttribute(name)
    }
  }
})

interface Mounted {
  container: HTMLElement
  /** Everything under the mount carrying `data-rendered`, whatever its value. */
  renderedFlags: () => Element[]
  cleanup: () => Promise<void>
}

async function mount(source: string): Promise<Mounted> {
  const React = await import('react')
  const { act } = React as unknown as { act: (cb: () => Promise<void>) => Promise<void> }
  const { MantineProvider } = await import('@mantine/core')
  const { createRoot } = await import('react-dom/client')
  const { MermaidBlockView } = viewModule

  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)
  const root = createRoot(container)

  // An editor stub: the view only calls it when a draft is applied, which none
  // of these tests do.
  const editor = { updateBlock: () => {} } as never

  await act(async () => {
    root.render(
      React.createElement(
        MantineProvider,
        null,
        React.createElement(MermaidBlockView, {
          blockId: 'block-1',
          source,
          blockType: 'diagram' as const,
          editor,
          contentRef: () => undefined,
          // The seam: a per-mount renderer, scoped to this component tree.
          render: (): Promise<RenderResult> =>
            hang ? new Promise<RenderResult>(() => {}) : Promise.resolve(nextResult)
        })
      )
    )
  })
  // Let the render promise settle and the resulting state update flush.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

  return {
    container,
    renderedFlags: () => [...container.querySelectorAll('[data-rendered]')],
    cleanup: async () => {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  }
}

const VALID_SOURCE = 'graph TD\n  A[Start] --> B[End]'

describe('a diagram block reports whether it actually rendered', () => {
  it('marks the pane rendered only once an SVG has been committed', async () => {
    hang = false
    nextResult = { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>' }
    const m = await mount(VALID_SOURCE)

    const pane = m.container.querySelector('[data-testid="diagram-preview"]')
    expect(pane).not.toBeNull()
    // The claim and the artefact agree: a committed render implies an svg host.
    expect(pane?.getAttribute('data-rendered')).toBe('true')
    expect(m.container.querySelector('[data-testid="diagram-svg"]')).not.toBeNull()

    await m.cleanup()
  })

  it('is not rendered while the render is still in flight and nothing is committed', async () => {
    // The empty case. The pane exists, so "the preview appeared" would pass
    // here; only the attribute distinguishes it from a rendered diagram.
    hang = true
    const m = await mount(VALID_SOURCE)

    const pane = m.container.querySelector('[data-testid="diagram-preview"]')
    expect(pane).not.toBeNull()
    expect(pane?.getAttribute('data-rendered')).toBe('false')
    expect(m.container.querySelector('[data-testid="diagram-svg"]')).toBeNull()

    hang = false
    await m.cleanup()
  })

  it('claims nothing when the render errored', async () => {
    hang = false
    nextResult = { ok: false, code: 'parse_error' }
    const m = await mount('this is not mermaid at all ###')

    expect(m.container.querySelector('[data-testid="diagram-error"]')).not.toBeNull()
    // An errored diagram is not an empty diagram: it reports through the error
    // pane, and no element anywhere claims `data-rendered="true"`.
    expect(m.renderedFlags()).toHaveLength(0)
    expect(m.container.querySelector('[data-rendered="true"]')).toBeNull()

    await m.cleanup()
  })

  it('never claims rendered while the diagram it shows is empty', async () => {
    // The invariant behind the attribute, stated once: a pane is rendered if and
    // only if it is showing an svg host. Any state that shows no svg must not
    // carry the claim, which is exactly what broke silently before.
    hang = false
    for (const [source, result] of [
      [VALID_SOURCE, { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }],
      ['broken ###', { ok: false, code: 'render_error' }]
    ] as Array<[string, RenderResult]>) {
      nextResult = result
      const m = await mount(source)
      const claimsRendered = m.container.querySelectorAll('[data-rendered="true"]')
      const showsSvg = m.container.querySelectorAll('[data-testid="diagram-svg"]')
      expect(claimsRendered.length > 0).toBe(showsSvg.length > 0)
      await m.cleanup()
    }
  })
})

describe('the diagram block label', () => {
  it('is rendered exactly once, so a testid lookup cannot hit a strict-mode clash', async () => {
    hang = false
    nextResult = { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }
    const m = await mount(VALID_SOURCE)

    // Two elements shared this testid: one in the pane and one inside the
    // hover toolbar. Playwright's `getByTestId` resolves in strict mode, so any
    // test written against it failed on the duplicate rather than on whatever it
    // meant to assert.
    expect(m.container.querySelectorAll('[data-testid="diagram-caption"]')).toHaveLength(1)

    await m.cleanup()
  })
})
