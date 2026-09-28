import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sharedDom, sharedWindow } from './utils/dom-harness.js'

/**
 * The drag on a rendered `:::columns` divider.
 *
 * ## Why the wiring is tested here and not in the browser spec
 *
 * `attachColumnDividers` is plain DOM code over a container it does not own, and
 * the three things most likely to break — the pointer-capture arithmetic, the
 * clamping, and the teardown that ends a drag in flight — are all reachable from
 * jsdom. The browser spec covers what only a real browser can: that a pointer
 * drag on a rendered page moves the divider, that the drag survives leaving the
 * element, and that the measured container width is non-zero.
 *
 * jsdom has no layout, so `clientWidth` is always 0. The wiring guards with
 * `Math.max(width, 1)`, and the tests set it explicitly through
 * `Object.defineProperty` so a percent-of-container conversion is exercised at
 * a known width rather than by accident.
 *
 * The DOM is the process-shared one and is never closed; see
 * `utils/dom-harness.ts`.
 */

const CONTAINER_WIDTH = 800

/**
 * The grow factor on one pane, as the wiring reads and writes it.
 *
 * The value is the **custom property**, because the `flex` shorthand that
 * consumes it belongs to `markdown-columns.css` and the drag writes the property
 * on every pointermove. Read through `getPropertyValue` rather than off the
 * attribute, because `setProperty` re-serialises the attribute (it appends a
 * `;`) and the attribute is not what the wiring touches.
 */
const FLEX_PROPERTY = '--rt-cols-pane-flex'

function flexOf(element: HTMLElement | null | undefined): string {
  return element?.style.getPropertyValue(FLEX_PROPERTY) ?? ''
}

interface DividerDom {
  container: HTMLElement
  root: HTMLElement
  left: HTMLElement
  divider: HTMLElement
  right: HTMLElement
  document: Document
  window: Window
}

type Attach = (el: HTMLElement) => () => void

let attach: Attach

beforeEach(async () => {
  sharedDom()
  const module_ = await import('../src/web/features/markdown/markdown-columns-divider.js')
  attach = module_.attachColumnDividers
})

/**
 * Clears the body between tests. The shared document persists, so without this a
 * block left mounted by one test would be found by the next one's `querySelectorAll`.
 */
afterEach(() => {
  sharedDom().window.document.body.innerHTML = ''
})

/**
 * The `data-*` attributes on `<html>`.
 *
 * The right granularity for "a drag wrote nothing to the document", and the
 * right *form* of the assertion:
 *
 * - Not `documentElement.outerHTML`, which also compares the body, where a drag
 *   legitimately rewrites the pane's `style` and the divider's
 *   `aria-valuenow` — reporting the feature working as a failure.
 * - Not a before/after snapshot, which is **order-dependent**: a flag left set
 *   by an earlier test is in the "before" too, so the test would agree with a
 *   reintroduced flag and pass. Checked, not assumed — the snapshot version of
 *   these assertions passed against code that had the flag back in it, and only
 *   the one that read the attribute outright failed.
 *
 * `<html>` carries no `data-*` attributes in this app: this file's own
 * `layoutResizing` flag was the sole exception and is gone (ADR-017). Asserted by
 * absence, so a document-level write has to come back here and name its consumer.
 */
function documentDataAttrs(el: Element): string[] {
  return el.getAttributeNames().filter((name) => name.startsWith('data-'))
}

/**
 * The DOM `renderMarkdown` would have produced, expressed directly.
 *
 * Faithful to the current output, including `data-width` on every pane and the
 * grow-factor **custom property** on each: a fixture in the old `flex: 0 0 40%`
 * shape, or in the older `flex: N 1 0%` inline shape, would test a row the render
 * path no longer produces, and the drag assertions would pass for the wrong
 * reason.
 */
function buildDom(): DividerDom {
  return buildRow([40, 60])
}

/** Builds a row of `shares.length` panes, exactly as the render path emits one. */
function buildRow(shares: number[]): DividerDom {
  const document = sharedDom().window.document
  const container = document.createElement('div')
  const total = shares.length - 1
  const parts: string[] = [
    `<div class="rt-cols" data-left="${shares[0]}" data-count="${shares.length}">`
  ]
  shares.forEach((share, index) => {
    parts.push(
      `<div class="rt-cols__pane" data-side="${
        shares.length === 2 ? (index === 0 ? 'left' : 'right') : 'middle'
      }" data-width="${share}" data-index="${index}" style="--rt-cols-pane-flex: ${share}">P${index}</div>`
    )
    if (index < total) {
      parts.push(
        `<div class="rt-cols__divider" role="separator" aria-orientation="vertical" ` +
          `aria-label="${
            total === 1
              ? 'Resize columns'
              : `Resize columns: boundary ${index + 1} of ${total}, between column ${index + 1} and column ${index + 2}`
          }" aria-valuenow="${share}" aria-valuemin="1" aria-valuemax="99" tabindex="0" ` +
          `data-index="${index}" data-testid="rt-cols-divider"></div>`
      )
    }
  })
  parts.push('</div>')
  container.innerHTML = parts.join('')
  document.body.append(container)
  const root = container.querySelector('.rt-cols') as HTMLElement
  const left = container.querySelector('.rt-cols__pane') as HTMLElement
  const divider = container.querySelector('.rt-cols__divider') as HTMLElement
  const right = container.querySelectorAll('.rt-cols__pane')[1] as HTMLElement
  // jsdom has no layout, so the measured width is set explicitly. The wiring
  // converts pixels to a percent of this, which is the assertion that matters.
  Object.defineProperty(root, 'clientWidth', {
    value: CONTAINER_WIDTH,
    configurable: true
  })
  // Pointer capture is not implemented in jsdom at all — the method does not
  // exist on an element — so every divider gets a stub. The call is part of the
  // behaviour under test (it is what keeps a move event coming after the pointer
  // leaves the element), so it is stubbed rather than omitted, and the ids are
  // recorded so a test can assert it happened.
  const captured: number[] = []
  for (const each of container.querySelectorAll('.rt-cols__divider')) {
    each.setPointerCapture = (pointerId: number): void => {
      captured.push(pointerId)
    }
  }
  return { container, root, left, divider, right, document, window: sharedWindow() }
}

/**
 * jsdom implements neither `PointerEvent` nor pointer capture, so a real
 * `PointerEvent` cannot be constructed. The drag code reads four properties off
 * the event — `button`, `clientX`, `pointerId` and `preventDefault` — and
 * dispatches nothing else, so a `MouseEvent` carrying `pointerId` is a faithful
 * stand-in and avoids hand-rolling a fake that could diverge from the real
 * interface. `KeyboardEvent` is implemented, so key events are the real thing.
 */
function pointer(
  type: string,
  init: { clientX: number; button?: number; pointerId?: number }
): MouseEvent & { pointerId: number } {
  const event = new (sharedWindow() as Window & typeof globalThis).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    button: init.button ?? 0
  })
  // Not in MouseEvent, and the only field the drag reads that MouseEvent lacks.
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  return event as MouseEvent & { pointerId: number }
}

function key(type: 'keydown', k: string): KeyboardEvent {
  return new (sharedWindow() as Window & typeof globalThis).KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    key: k
  })
}

describe('dragging a column divider resizes the left pane', () => {
  it('converts pointer travel into a percent of the container', () => {
    const dom = buildDom()
    attach(dom.container)
    // 40% authored. Dragging right by 20% of an 800px container is +160px,
    // which must become 60.
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 1 }))
    expect(flexOf(dom.left)).toBe('60')
    expect(dom.divider.getAttribute('aria-valuenow')).toBe('60')
  })

  it('writes the grow-factor property, never an inline flex shorthand', () => {
    /**
     * The drag is the hot path, and it is where the dead-rule problem would come
     * straight back.
     *
     * The render path was changed to emit `--rt-cols-pane-flex` so that
     * `markdown-columns.css` could own the `flex` shorthand. A drag that wrote
     * `style.flex` on every pointermove would put the shorthand back inline the
     * moment a reader touched a divider — leaving the stylesheet rule dead for
     * exactly the rows a reader has interacted with, and with every assertion
     * above still green, because each one checks the resulting *width*.
     */
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 1 }))

    expect(flexOf(dom.left), 'the property the stylesheet reads').toBe('60')
    expect(dom.left.style.flex, 'an inline shorthand would make the rule dead').toBe('')
    // Asserted on the whole attribute, so a second declaration cannot hide behind
    // the one the previous line checks. Matched on the declaration *name*, not on
    // the substring `flex:` — which is inside `--rt-cols-pane-flex:` and would
    // match the feature's own property.
    expect(
      /(?:^|;)\s*flex(?:-grow|-shrink|-basis)?\s*:/.test(dom.left.getAttribute('style') ?? '')
    ).toBe(false)
    // And a keyboard step, which takes the same path, agrees.
    dom.divider.dispatchEvent(pointer('pointerup', { clientX: 160, pointerId: 1 }))
    dom.divider.dispatchEvent(key('keydown', 'ArrowRight'))
    expect(flexOf(dom.left)).toBe('80')
    expect(dom.left.style.flex).toBe('')
  })

  it('clamps to the grammar bounds rather than overflowing the row', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    // Far past the right edge: the pane must stop at 99, not at 140%.
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 5000, pointerId: 1 }))
    expect(flexOf(dom.left)).toBe('99')
    expect(dom.divider.getAttribute('aria-valuenow')).toBe('99')
  })

  it('clamps the other way too, and never produces a 0-width pane', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: -5000, pointerId: 1 }))
    expect(flexOf(dom.left)).toBe('1')
  })

  it('captures the pointer on drag start, so a drag survives leaving the element', () => {
    const dom = buildDom()
    attach(dom.container)
    const captured: number[] = []
    dom.divider.setPointerCapture = (pointerId: number): void => {
      captured.push(pointerId)
    }
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 7 }))
    expect(captured, 'without capture a drag dies at the element edge').toEqual([7])
  })

  it('ignores a non-primary button, so a right-click does not start a drag', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 2, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 1 }))
    expect(flexOf(dom.left), 'the width must not change').toBe('40')
  })

  it('marks the divider as dragging, and clears it on pointer up', () => {
    const dom = buildDom()
    attach(dom.container)
    const root = dom.document.documentElement
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    expect(dom.divider.getAttribute('data-dragging')).toBe('true')
    // No document-level write. The `layoutResizing` flag that used to be set
    // here was deleted: no stylesheet in `src/` selects it and no layout
    // property has a transition anywhere, so the rule it existed to enable
    // would have suppressed nothing. See ADR-017 for the reversible alternative.
    // A column drag now has exactly the effect a shell drag has - the divider's
    // own attribute, and nothing else.
    expect(documentDataAttrs(root), 'a drag must not flag the document').toEqual([])
    dom.divider.dispatchEvent(pointer('pointerup', { clientX: 160, pointerId: 1 }))
    expect(dom.divider.getAttribute('data-dragging')).toBe('false')
    expect(documentDataAttrs(root), 'and must leave no document flag behind').toEqual([])
  })

  it('ends the drag on pointer cancel, not only on a clean release', () => {
    const dom = buildDom()
    attach(dom.container)
    const root = dom.document.documentElement
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointercancel', { clientX: 10, pointerId: 1 }))
    // The cancel path must still leave the divider not-dragging, which is what
    // it did when it cleared the document flag.
    expect(dom.divider.getAttribute('data-dragging')).toBe('false')
    expect(documentDataAttrs(root), 'and must leave no document flag behind').toEqual([])
  })

  it('ignores move and up events from a different pointer', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 2 }))
    expect(flexOf(dom.left), 'a second pointer must not drag').toBe('40')
  })

  it('wires every divider of a four-pane row, not just the first', () => {
    /**
     * The N-pane case, which is the same arithmetic applied N-1 times.
     *
     * A wiring that only found the first divider would still pass every
     * two-pane test, so this asserts the count and that each one moves its own
     * pane.
     */
    const dom = buildRow([25, 25, 25, 25])
    attach(dom.container)
    const dividers = [...dom.container.querySelectorAll<HTMLElement>('.rt-cols__divider')]
    const panes = [...dom.container.querySelectorAll<HTMLElement>('.rt-cols__pane')]
    expect(dividers, 'a row of four has three boundaries').toHaveLength(3)
    expect(panes).toHaveLength(4)

    // Divider 1 is the second one. Dragging it must move the pane to its left
    // (index 1) and leave the others alone.
    const second = dividers[1] as HTMLElement
    second.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 3 }))
    second.dispatchEvent(pointer('pointermove', { clientX: 80, pointerId: 3 }))
    // 25 + 10% of an 800px container (80px = 10 points).
    expect(flexOf(panes[1])).toBe('35')
    expect(second.getAttribute('aria-valuenow')).toBe('35')
    // The untouched panes keep their authored widths.
    expect(flexOf(panes[0])).toBe('25')
    expect(flexOf(panes[2])).toBe('25')
    expect(flexOf(panes[3])).toBe('25')
    second.dispatchEvent(pointer('pointerup', { clientX: 80, pointerId: 3 }))
  })

  it('keeps a nested row from stealing its parent divider, and vice versa', () => {
    // A `::::columns` inside a `::::columns` puts a second row inside the first.
    // Panes are filtered to the nearest enclosing root, so the outer row's
    // divider must not drive an inner pane.
    const outer = buildRow([50, 50])
    const inner = buildRow([50, 50])
    outer.container.append(inner.container)
    attach(outer.container)
    const outerDividers = outer.root.querySelectorAll<HTMLElement>('.rt-cols__divider')
    const innerDividers = inner.root.querySelectorAll<HTMLElement>('.rt-cols__divider')
    expect(outerDividers).toHaveLength(1)
    expect(innerDividers).toHaveLength(1)

    const innerPane = inner.root.querySelector<HTMLElement>('.rt-cols__pane') as HTMLElement
    const before = flexOf(innerPane)
    const outerDivider = outerDividers[0] as HTMLElement
    outerDivider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 4 }))
    outerDivider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 4 }))
    outerDivider.dispatchEvent(pointer('pointerup', { clientX: 160, pointerId: 4 }))
    expect(flexOf(innerPane), 'the inner row must be untouched').toBe(before)
  })

  it('keeps two column blocks independent', () => {
    const dom = buildDom()
    // A second block, appended into the same container.
    const second = dom.document.createElement('div')
    second.className = 'rt-cols'
    second.setAttribute('data-left', '70')
    // Faithful to what `renderMarkdown` emits, including `aria-valuenow`: the
    // wiring reads the authored `data-left` and keeps the announced value in
    // step, so a fixture missing it would test a shape that never occurs.
    second.innerHTML = [
      '<div class="rt-cols__pane" data-side="left" style="--rt-cols-pane-flex: 70">L2</div>',
      '<div class="rt-cols__divider" role="separator" aria-orientation="vertical" ',
      'aria-label="Resize columns" aria-valuenow="70" aria-valuemin="1" aria-valuemax="99" ',
      'tabindex="0"></div>',
      '<div class="rt-cols__pane" data-side="right" style="--rt-cols-pane-flex: 1">R2</div>'
    ].join('')
    Object.defineProperty(second, 'clientWidth', { value: CONTAINER_WIDTH, configurable: true })
    const secondDivider = second.querySelector('.rt-cols__divider') as HTMLElement
    secondDivider.setPointerCapture = (): void => undefined
    dom.container.append(second)
    const secondLeft = second.querySelector('.rt-cols__pane[data-side="left"]') as HTMLElement
    attach(dom.container)

    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointerup', { clientX: 160, pointerId: 1 }))

    expect(flexOf(dom.left)).toBe('60')
    expect(flexOf(secondLeft), 'the untouched block must keep its width').toBe('70')
    expect(secondDivider.getAttribute('aria-valuenow'), 'and its announced value').toBe('70')
  })
})

describe('the keyboard moves the divider', () => {
  it('steps the width on an arrow key and announces the new value', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(key('keydown', 'ArrowRight'))
    // The shared step is LAYOUT.dividerStepWidth, the same one the shell's pane
    // dividers use, so the two feel identical.
    expect(dom.divider.getAttribute('aria-valuenow')).toBe('60')
    expect(flexOf(dom.left)).toBe('60')
  })

  it('steps the other way with the opposite arrow', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(key('keydown', 'ArrowLeft'))
    expect(flexOf(dom.left)).toBe('20')
  })

  it('jumps to the bounds with Home and End', () => {
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(key('keydown', 'Home'))
    expect(flexOf(dom.left)).toBe('1')
    dom.divider.dispatchEvent(key('keydown', 'End'))
    expect(flexOf(dom.left)).toBe('99')
  })

  it('leaves the width alone for a key it does not own', () => {
    const dom = buildDom()
    attach(dom.container)
    const event = key('keydown', 'a')
    dom.divider.dispatchEvent(event)
    expect(flexOf(dom.left)).toBe('40')
    expect(event.defaultPrevented, 'a key we ignore must not be swallowed').toBe(false)
  })

  it('prevents the default for the keys it owns, so the page does not scroll', () => {
    const dom = buildDom()
    attach(dom.container)
    const event = key('keydown', 'ArrowRight')
    dom.divider.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('a key step does not leave the divider marked as dragging', () => {
    // A keyboard step is a commit, not a drag. If it set `data-dragging`, the
    // blue line would stay lit after the key was released.
    const dom = buildDom()
    attach(dom.container)
    dom.divider.dispatchEvent(key('keydown', 'ArrowRight'))
    expect(dom.divider.getAttribute('data-dragging')).not.toBe('true')
  })
})

describe('teardown leaves nothing behind', () => {
  it('removes its listeners, so a later event changes nothing', () => {
    const dom = buildDom()
    const detach = attach(dom.container)
    detach()
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    dom.divider.dispatchEvent(pointer('pointermove', { clientX: 160, pointerId: 1 }))
    expect(flexOf(dom.left), 'a detached wiring must not respond').toBe('40')
  })

  it('ends a drag torn down mid-drag', () => {
    /**
     * The one teardown case that cannot be left to a pointer event: the preview
     * is replaced on every keystroke, so a drag in flight when it unmounts has
     * no `pointerup` coming. This asserted a `layoutResizing` document flag was
     * cleared here; the flag itself is gone (no stylesheet in `src/` selects it,
     * and no layout property has a transition anywhere - see ADR-017). What
     * survives is the teardown behaviour it was standing in for: the drag is
     * ended, so a stale one cannot still hold the pointer capture.
     */
    const dom = buildDom()
    const detach = attach(dom.container)
    dom.divider.dispatchEvent(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    expect(dom.divider.getAttribute('data-dragging'), 'the drag is live before the teardown').toBe(
      'true'
    )
    detach()
    expect(dom.divider.getAttribute('data-dragging'), 'and ended by the teardown').toBe('false')
    // Nothing document-level is left behind either, which is what the deleted
    // flag used to guarantee for the rest of the session.
    expect(documentDataAttrs(dom.document.documentElement)).toEqual([])
  })

  it('is safe to call twice', () => {
    const dom = buildDom()
    const detach = attach(dom.container)
    detach()
    expect(() => detach()).not.toThrow()
  })

  it('a container with no column blocks is a no-op', () => {
    const document = sharedDom().window.document
    const empty = document.createElement('div')
    document.body.append(empty)
    const detach = attach(empty)
    expect(() => detach()).not.toThrow()
  })

  it('a root with no divider element is skipped rather than throwing', () => {
    const document = sharedDom().window.document
    const broken = document.createElement('div')
    broken.innerHTML = '<div class="rt-cols" data-left="50"></div>'
    document.body.append(broken)
    const detach = attach(broken)
    expect(() => detach()).not.toThrow()
  })
})
