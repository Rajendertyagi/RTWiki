import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sharedDom, sharedWindow } from './utils/dom-harness.js'

/**
 * The shared drag object, and the shell's `PaneDivider` that binds to it.
 *
 * ## Why this is tested after the extraction
 *
 * `createDividerDrag` was extracted from `PaneDivider` so a Markdown page's
 * column divider could use the same behaviour. Two shell dividers depend on it
 * — the page-tree pane in `app-shell.tsx` and the right sidebar in
 * `right-sidebar-region.tsx` — so the extraction is a change to shipped
 * behaviour, not a refactor with no consumers.
 *
 * What is asserted here is the **behaviour**, not the previous implementation:
 * a pointer drag resizes, arrows step, Home/End jump to the bounds, a
 * non-primary button is ignored, the drag writes nothing to the document, and a
 * teardown mid-drag leaves nothing behind. If the extraction changed any of
 * that, this fails.
 */

interface Harness {
  drag: ReturnType<typeof import('../src/web/layout/pane-divider.js').createDividerDrag>
  element: HTMLElement
  changes: number[]
  commits: number[]
  dragging: boolean[]
  document: Document
  window: Window
}

beforeEach(async () => {
  sharedDom()
  const module_ = await import('../src/web/layout/pane-divider.js')
  createDividerDrag = module_.createDividerDrag
})

/**
 * Clears the body between tests. The shared document persists, so without this an
 * element left mounted by one test would accumulate in the next one's document.
 */
afterEach(() => {
  sharedDom().window.document.body.innerHTML = ''
})

/**
 * jsdom implements no `PointerEvent` and no pointer capture. The drag reads
 * `button`, `clientX`, `pointerId` and `preventDefault`, so a `MouseEvent` with
 * `pointerId` defined is a faithful stand-in.
 *
 * The cast to `PointerEvent` is at the boundary, and is what it looks like: the
 * stand-in implements the four fields the code under test reads and no others.
 * The alternative — declaring a whole `PointerEvent` interface and building it
 * field by field — would be a larger surface that could silently drift from the
 * real thing.
 */
function pointer(
  type: string,
  init: { clientX: number; button?: number; pointerId?: number }
): PointerEvent {
  const event = new (sharedWindow() as Window & typeof globalThis).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    button: init.button ?? 0
  })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  return event as unknown as PointerEvent
}

function key(k: string): KeyboardEvent {
  return new (sharedWindow() as Window & typeof globalThis).KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: k
  })
}

type CreateDrag = typeof import('../src/web/layout/pane-divider.js').createDividerDrag
let createDividerDrag: CreateDrag

/** A divider configured the way `app-shell.tsx` configures the tree pane. */
function harness(overrides: { direction?: 1 | -1; min?: number; max?: number } = {}): Harness {
  const document = sharedDom().window.document
  const element = document.createElement('div')
  document.body.append(element)
  element.setPointerCapture = (): void => undefined
  const changes: number[] = []
  const commits: number[] = []
  const dragging: boolean[] = []
  const drag = createDividerDrag({
    element,
    min: overrides.min ?? 220,
    max: overrides.max ?? 520,
    direction: overrides.direction ?? 1,
    // 1, because a shell divider's value is a pixel width. This is the field
    // the Markdown column divider differs on, and the reason it exists.
    unitsPerPixel: 1,
    getValue: () => (changes.length > 0 ? (changes[changes.length - 1] as number) : 300),
    onChange: (value) => changes.push(value),
    onCommit: (value) => commits.push(value),
    onDraggingChange: (value) => dragging.push(value)
  })
  return { drag, element, changes, commits, dragging, document, window: sharedWindow() }
}

describe('the shared drag resizes through onChange and commits on release', () => {
  it('adds the pointer delta in the direction sense, one unit per pixel', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 100, button: 0, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 130, pointerId: 1 }))
    // 300 + 30px, clamped into [220, 520].
    expect(h.changes).toEqual([330])
  })

  it('subtracts for direction -1, which is how the right sidebar behaves', () => {
    // `right-sidebar-region.tsx` passes `direction={-1}` because its pane grows
    // to the *left* as the pointer moves right. Getting this backwards would
    // make the sidebar drag mirrored, so it is pinned.
    const h = harness({ direction: -1 })
    h.drag.pointerDown(pointer('pointerdown', { clientX: 100, button: 0, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 130, pointerId: 1 }))
    expect(h.changes).toEqual([270])
  })

  it('honours unitsPerPixel, which is what makes one drag object serve both cases', () => {
    // A percentage-valued divider passes 100/containerWidth, so a pixel delta
    // becomes a percent delta. With a 500px container, 100 units per pixel is
    // 0.2 - asserted as a property of the field, not of the shell's use.
    const document = sharedDom().window.document
    const element = document.createElement('div')
    document.body.append(element)
    element.setPointerCapture = (): void => undefined
    const changes: number[] = []
    const drag = createDividerDrag({
      element,
      min: 1,
      max: 99,
      direction: 1,
      unitsPerPixel: 0.2,
      getValue: () => 40,
      onChange: (value) => changes.push(value),
      onCommit: () => undefined
    })
    drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    drag.pointerMove(pointer('pointermove', { clientX: 100, pointerId: 1 }))
    // 40 + 1 * 0.2 * 100 = 60.
    expect(changes).toEqual([60])
  })

  it('clamps a drag to the configured bounds', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    // Far past the right edge: 300 + 5000 clamps to max.
    h.drag.pointerMove(pointer('pointermove', { clientX: 5000, pointerId: 1 }))
    expect(h.changes).toEqual([520])
    // Far past the left edge: 300 - 5000 clamps to min.
    h.drag.pointerMove(pointer('pointermove', { clientX: -5000, pointerId: 1 }))
    expect(h.changes).toEqual([520, 220])
  })

  it('commits once on release, with the value the drag reached', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 40, pointerId: 1 }))
    h.drag.pointerEnd(pointer('pointerup', { clientX: 40, pointerId: 1 }))
    // onChange drove the value to 340, and the commit persists that.
    expect(h.commits).toEqual([340])
  })

  it('commits on pointer cancel and on lost capture, not only a clean release', () => {
    for (const end of ['pointercancel', 'lostpointercapture'] as const) {
      const h = harness()
      h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
      h.drag.pointerMove(pointer('pointermove', { clientX: 40, pointerId: 1 }))
      h.drag.pointerEnd(pointer(end, { clientX: 40, pointerId: 1 }))
      expect(h.commits, end).toEqual([340])
    }
  })

  it('ignores a non-primary button', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 2, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 40, pointerId: 1 }))
    expect(h.changes).toEqual([])
    expect(h.drag.isDragging()).toBe(false)
  })

  it('ignores events from another pointer, and cannot be started twice', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 40, pointerId: 2 }))
    expect(h.changes, 'a second pointer must not drive the drag').toEqual([])
    // A second pointerdown while dragging is refused rather than restarting the
    // drag from the new position — so the drag is still measured from x=0, and a
    // move to x=40 lands back on 300 + 40.
    h.drag.pointerDown(pointer('pointerdown', { clientX: 500, button: 0, pointerId: 2 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 540, pointerId: 1 }))
    // 300 + 540 clamps to max. If the second pointerdown had restarted the drag
    // at x=500, this would have been a *smaller* delta and a different value.
    expect(h.changes, 'the original drag must survive').toEqual([520])
  })

  it('prevents the default on drag start, so the page does not select text', () => {
    const h = harness()
    const event = pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 })
    h.drag.pointerDown(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('the shared drag reports dragging state and leaves the document alone', () => {
  /**
   * The `layoutResizing` document flag used to be set on `pointerdown` and
   * cleared on release, and this block asserted it. It was deleted rather than
   * implemented, because **no stylesheet in `src/` selects it** and no layout
   * property has a transition anywhere, so a `transition: none` rule keyed on it
   * would have suppressed nothing. The flag was a live API with no consumer,
   * tested as though it worked, and documented as a pending decision.
   *
   * A drag now touches the document not at all. That is the assertion, and it is
   * worth keeping: a future change that reintroduces a document-level write
   * during a drag has to come back here and say what consumes it.
   *
   * All three tests in this block are kept, restated against what a drag
   * actually does, so the count is unchanged and the coverage is not quietly
   * reduced. The flag had a real cost — a style recalculation over the whole
   * document on every drag start — and the reversible alternative is recorded in
   * ADR-017, not left implicit.
   */
  it('touches no document state on start or release', () => {
    const h = harness()
    // The `data-*` attributes on `<html>`, asserted by **absence** rather than
    // as a before/after snapshot. A snapshot is order-dependent: a flag left set
    // by an earlier test is in the "before" too, so it would agree with a
    // reintroduced flag and pass. (Checked, not assumed — the snapshot version
    // of this assertion passed against code that had the flag back in it.)
    // `<html>` carries no `data-*` attributes in this app at all; this file's
    // `layoutResizing` flag was the sole exception and is gone.
    const root = h.document.documentElement
    const documentDataAttrs = (): string[] =>
      root.getAttributeNames().filter((name) => name.startsWith('data-'))
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    expect(documentDataAttrs(), 'a drag must not flag the document').toEqual([])
    h.drag.pointerEnd(pointer('pointerup', { clientX: 0, pointerId: 1 }))
    expect(documentDataAttrs(), 'and must leave no document flag behind').toEqual([])
  })

  it('reports dragging state to the caller, for the data-dragging attribute', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.pointerEnd(pointer('pointerup', { clientX: 0, pointerId: 1 }))
    expect(h.dragging).toEqual([true, false])
  })

  it('cancel ends the drag without committing, which is what teardown relies on', () => {
    // A drag in flight when a divider unmounts has no `pointerup` coming. If
    // `cancel` did not end it, the node would keep reporting itself as dragging.
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.cancel()
    expect(h.dragging).toEqual([true, false])
    expect(h.drag.isDragging()).toBe(false)
  })

  it('cancel does not commit, because a torn-down divider has nowhere to persist to', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.pointerMove(pointer('pointermove', { clientX: 40, pointerId: 1 }))
    h.drag.cancel()
    expect(h.commits).toEqual([])
  })
})

describe('the keyboard steps by LAYOUT.dividerStepWidth and jumps to the bounds', () => {
  it('steps right and left by the shared step', () => {
    const h = harness()
    h.drag.keyDown(key('ArrowRight'))
    expect(h.changes).toEqual([320])
    // The second step is measured from the value the first one produced, because
    // the caller's `getValue` follows `onChange` — exactly how the shell's
    // `valueRef` behaves. Two steps return to the start, not one step below it.
    h.drag.keyDown(key('ArrowLeft'))
    expect(h.changes).toEqual([320, 300])
  })

  it('jumps to min on Home and max on End', () => {
    const h = harness()
    h.drag.keyDown(key('Home'))
    expect(h.changes).toEqual([220])
    h.drag.keyDown(key('End'))
    expect(h.changes).toEqual([220, 520])
  })

  it('commits every key step, because there is no pointer release to commit on', () => {
    const h = harness()
    h.drag.keyDown(key('ArrowRight'))
    // A key step is a decision the reader made; unlike a drag it is not
    // provisional, so it is persisted immediately.
    expect(h.commits).toEqual([320])
  })

  it('reverses the step direction for direction -1', () => {
    const h = harness({ direction: -1 })
    h.drag.keyDown(key('ArrowRight'))
    expect(h.changes).toEqual([280])
  })

  it('ignores a key it does not own, and does not swallow it', () => {
    const h = harness()
    const event = key('a')
    h.drag.keyDown(event)
    expect(h.changes).toEqual([])
    expect(event.defaultPrevented, 'a key we ignore must not be prevented').toBe(false)
  })

  it('prevents the default for the keys it owns, so the page does not scroll', () => {
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const event = key(k)
      harness().drag.keyDown(event)
      expect(event.defaultPrevented, k).toBe(true)
    }
  })

  it('clamps a key step at the bounds rather than overshooting', () => {
    const h = harness()
    h.drag.keyDown(key('End'))
    h.drag.keyDown(key('ArrowRight'))
    expect(h.changes).toEqual([520, 520])
  })

  it('ignores a key while a drag is in progress, so pointer and keyboard cannot desynchronise', () => {
    const h = harness()
    h.drag.pointerDown(pointer('pointerdown', { clientX: 0, button: 0, pointerId: 1 }))
    h.drag.keyDown(key('ArrowRight'))
    expect(h.changes, 'a key must not fight the live drag').toEqual([])
    h.drag.pointerEnd(pointer('pointerup', { clientX: 0, pointerId: 1 }))
  })
})
