import { createDividerDrag, type DividerDrag } from '../../layout/pane-divider.js'
import {
  COLUMN_MAX_PERCENT,
  COLUMN_MIN_PERCENT,
  COLUMNS_DIVIDER_SELECTOR,
  COLUMNS_PANE_SELECTOR,
  COLUMNS_ROOT_SELECTOR
} from './markdown-columns.js'

/**
 * Makes the rendered dividers in a Markdown page draggable, for any number of
 * panes.
 *
 * ## Why this is a delegated DOM listener and not a React island
 *
 * The preview is one `dangerouslySetInnerHTML` element whose `innerHTML` is
 * replaced from scratch on **every keystroke** (`markdown-workspace.tsx`). A
 * React root inside it would mount and unmount continuously, and `createRoot`
 * appears exactly once in this app — there is no island infrastructure to hang
 * one on. The established precedent for "attach behaviour after injection" is
 * the Rich Note's broken-link and link-interception effects
 * (`rich-editor.tsx:453-511`): vanilla `querySelectorAll` plus a **delegated**
 * listener on a container ref, with teardown. This is that, applied to a
 * container React does not own.
 *
 * `pointerdown` and `keydown` are delegated on the container, which `innerHTML`
 * does not replace — only its children — so they survive every re-render. The
 * move/up pair is bound to each divider, because pointer capture retargets those
 * to the capturing element and a container listener would not see them.
 *
 * ## What one divider changes
 *
 * Dragging divider *i* resizes the pane to its **left**. The pane to its right
 * keeps its own width and the last pane absorbs the difference, so a row of N
 * panes behaves as N independent boundaries rather than one shared budget that
 * has to be rebalanced on every move.
 *
 * That is what makes the two-pane case exactly what it always was: its one
 * divider resizes its left pane and the right pane takes the rest. The N-pane
 * case is the same rule applied N−1 times, not a different model.
 *
 * ## The drag arithmetic is shared, not reimplemented
 *
 * {@link createDividerDrag} is the same object the shell's pane dividers use
 * (`layout/pane-divider.tsx`), extracted for exactly this second consumer. The
 * one difference is `unitsPerPixel`: a shell divider's value is a pixel width
 * and passes `1`, a column divider's is a **percentage of its container**, so it
 * passes `100 / containerWidth` — which is what makes a drag across the
 * container worth the full range. The `layoutResizing` document flag that
 * suppresses transitions during a drag is set from inside the shared object, so
 * a column drag has the same effect as a shell one.
 */

/** One pane, as the wiring needs it. */
interface PaneState {
  element: HTMLElement
  /** This pane's share as a percent, owned here once a drag has moved it. */
  percent: number
}

/** One boundary: the divider element and the two panes it sits between. */
interface Boundary {
  divider: HTMLElement
  left: PaneState
  right: PaneState
  drag: DividerDrag
}

const clampPercent = (value: number): number =>
  Math.min(Math.max(Math.round(value), COLUMN_MIN_PERCENT), COLUMN_MAX_PERCENT)

/**
 * The percent a pane element declares, or `null` when it declares none.
 *
 * Read from `data-width`, which the render path wrote as a validated integer.
 * `null` and a number are distinguished because "no width asked for" means an
 * equal share, which is a different layout decision from "width 0".
 */
function readDeclaredPercent(pane: HTMLElement): number | null {
  const raw = pane.dataset.width
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : null
}

/**
 * Builds the boundary list for the rows currently inside `container`.
 *
 * ## Why this is a separate function, called again on every change
 *
 * The first version built the list once and looked every event up by element
 * identity. The framework replaced the preview's `innerHTML` **17 ms after** the
 * wiring ran — measured in a browser, with a `MutationObserver` on the container
 * and the wiring itself instrumented — and no re-attach followed, because nothing
 * in React's dependency array had changed. The list then held detached nodes: the
 * container listener still fired, still received the right event on the right
 * target, still did not throw, and every lookup missed. Drag and keyboard were
 * both dead on every page opened from the sidebar, and both worked after an
 * Edit → Preview round trip, because that *does* change a dep.
 *
 * So the list cannot be a snapshot. It is rebuilt whenever the container's
 * children change, which is the only signal that is guaranteed to arrive.
 */
function buildBoundaries(container: HTMLElement): Boundary[] {
  const boundaries: Boundary[] = []

  for (const root of container.querySelectorAll<HTMLElement>(COLUMNS_ROOT_SELECTOR)) {
    // Panes in document order, which is their authored order. `querySelectorAll`
    // is document-order, so a nested row's panes do not leak into this one.
    const panes = [...root.querySelectorAll<HTMLElement>(COLUMNS_PANE_SELECTOR)].filter(
      (pane) => pane.closest(COLUMNS_ROOT_SELECTOR) === root
    )
    const dividers = [...root.querySelectorAll<HTMLElement>(COLUMNS_DIVIDER_SELECTOR)].filter(
      (divider) => divider.closest(COLUMNS_ROOT_SELECTOR) === root
    )
    if (panes.length < 2) continue

    const states: PaneState[] = panes.map((element) => ({
      element,
      percent: readDeclaredPercent(element) ?? Math.floor(100 / panes.length)
    }))

    // Divider *i* sits between pane *i* and pane *i+1*. Both are found by
    // position rather than by index attribute, because the index attribute is
    // what a drag is expected to preserve and reading it back would mean
    // trusting state this function owns.
    for (const [index, divider] of dividers.entries()) {
      const left = states[index]
      const right = states[index + 1]
      if (!left || !right) continue

      const applyPercent = (percent: number): void => {
        const clamped = clampPercent(percent)
        left.percent = clamped
        // Grow by the pane's own share. Every pane grows by its own share, so
        // the ratios across the row are what the percentages mean — see the note
        // on `renderRow` for why the last pane is not left at `1 1 0%`.
        left.element.style.flex = `${clamped} 1 0%`
        divider.setAttribute('aria-valuenow', String(clamped))
      }

      const drag = createDividerDrag({
        element: divider,
        min: COLUMN_MIN_PERCENT,
        max: COLUMN_MAX_PERCENT,
        // The left pane grows with a rightward drag, the same sense as the shell.
        direction: 1,
        // Percent of the container per pixel of travel. A getter, not a value:
        // read on every pointermove, so a window resize mid-drag cannot skew it.
        get unitsPerPixel(): number {
          return 100 / Math.max(root.clientWidth, 1)
        },
        getValue: () => left.percent,
        onChange: applyPercent,
        onCommit: () => {
          divider.setAttribute('data-dragging', 'false')
        },
        onDraggingChange: (dragging) => {
          divider.setAttribute('data-dragging', dragging ? 'true' : 'false')
        }
      })
      boundaries.push({ divider, left, right, drag })
    }
  }

  return boundaries
}

/**
 * Wires every `:::columns` divider inside `container`, and returns a teardown.
 *
 * @param container The preview element whose `innerHTML` holds the rendered
 * Markdown. It is queried, never replaced, so the delegated listeners here
 * outlive every re-render of its contents.
 */
export function attachColumnDividers(container: HTMLElement): () => void {
  /**
   * The boundaries currently in the DOM. **Not** a permanent list: the observer
   * below reassigns it whenever the container's children change, because the
   * elements it holds are replaced wholesale whenever the framework re-renders
   * the preview. See {@link buildBoundaries}.
   */
  let boundaries: Boundary[] = buildBoundaries(container)
  /** The one divider currently being dragged. A pointer drives one boundary. */
  let activeBoundary: Boundary | null = null

  /**
   * The boundary an event on `event.target` belongs to, or `null`.
   *
   * The one place element identity is relied on, which is exactly why the list
   * above is rebuilt on every change to the container's children.
   */
  const boundaryFor = (event: Event): Boundary | null => {
    const target = event.target as HTMLElement | null
    const divider = target?.closest<HTMLElement>(COLUMNS_DIVIDER_SELECTOR)
    if (!divider || !container.contains(divider)) return null
    return boundaries.find((candidate) => candidate.divider === divider) ?? null
  }

  const onPointerDown = (event: PointerEvent): void => {
    const boundary = boundaryFor(event)
    if (!boundary || activeBoundary !== null) return
    // Delegate **first**, and record the active boundary only if the drag
    // actually started.
    //
    // The order matters more than it looks. `pointerDown` calls
    // `setPointerCapture`, which a real browser throws from for a pointer it does
    // not consider active, and it declines to start for a non-primary button.
    // Recording the boundary first left the wiring believing a drag was in
    // progress while the drag object believed none was: `pointermove` was
    // dispatched into a dead drag, `aria-valuenow` never moved, and because
    // nothing ever cleared it, **every later drag was refused as well**. The
    // symptom is a pane that does not move, permanently. A unit test that stubs
    // `setPointerCapture` to succeed cannot see any of that.
    boundary.drag.pointerDown(event)
    if (boundary.drag.isDragging()) activeBoundary = boundary
  }

  /**
   * The move and release pair, delegated on the container rather than bound to
   * each divider.
   *
   * ## Why delegation is enough even with pointer capture
   *
   * Pointer capture retargets an event to the capturing element, and the first
   * draft of this file assumed that therefore only the capturing element could
   * see it. Captured events still **bubble** — from the capture target, through
   * its ancestors — so a container listener sees every one of them. Binding here
   * rather than per divider is what makes the drag independent of which divider
   * elements existed when this function ran.
   *
   * `setPointerCapture` is still doing its real job: it keeps the drag alive when
   * the pointer leaves the container entirely, which no amount of delegation can
   * do. The two are complementary, not alternatives.
   */
  const onPointerMove = (event: PointerEvent): void => {
    // No active boundary on every mouse move over the preview; one call and out.
    if (!activeBoundary) return
    activeBoundary.drag.pointerMove(event)
  }

  const onPointerEnd = (event: PointerEvent): void => {
    if (!activeBoundary) return
    activeBoundary.drag.pointerEnd(event)
    activeBoundary = null
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const boundary = boundaryFor(event)
    if (!boundary) return
    // `keyDown` only steps on a key it owns, and a key it does not must leave
    // the percent alone — so the change is detected rather than written back
    // unconditionally.
    const before = boundary.left.percent
    boundary.drag.keyDown(event)
    if (boundary.left.percent === before) return
    boundary.divider.setAttribute('data-dragging', 'false')
  }

  /*
   * The list is a snapshot, so it has to be invalidated when the snapshot goes
   * stale — and `childList` on the container is the one signal that is
   * guaranteed to arrive when the framework replaces the preview's contents.
   *
   * `attributes` is deliberately not observed: `applyPercent` writes `style` and
   * `aria-valuenow` during a drag, and re-scanning on those would rebuild the
   * boundary list under the pointer, discarding the value being dragged.
   */
  const observer = new MutationObserver(() => {
    // A drag in progress belongs to nodes that are about to be discarded.
    activeBoundary?.drag.cancel()
    activeBoundary = null
    boundaries = buildBoundaries(container)
  })
  observer.observe(container, { childList: true })

  // Delegated: the container survives `innerHTML`, so these are bound once per
  // attach and removed on teardown.
  container.addEventListener('pointerdown', onPointerDown)
  container.addEventListener('pointermove', onPointerMove)
  container.addEventListener('pointerup', onPointerEnd)
  container.addEventListener('pointercancel', onPointerEnd)
  container.addEventListener('lostpointercapture', onPointerEnd)
  container.addEventListener('keydown', onKeyDown)

  return () => {
    // Every listener is on the container, so every one is removed here. The
    // earlier design bound the move/release pair to each divider and deliberately
    // did not remove those, on the reasoning that the divider nodes and their
    // listeners die together with the `innerHTML` swap. They do — but the
    // `boundaries` array in this closure does not, and it went on holding
    // detached nodes whose `pointermove` nobody was listening for any more.
    container.removeEventListener('pointerdown', onPointerDown)
    container.removeEventListener('pointermove', onPointerMove)
    container.removeEventListener('pointerup', onPointerEnd)
    container.removeEventListener('pointercancel', onPointerEnd)
    container.removeEventListener('lostpointercapture', onPointerEnd)
    container.removeEventListener('keydown', onKeyDown)
    observer.disconnect()
    // A drag in flight when the preview unmounts must not leave the
    // `layoutResizing` document flag set, which would suppress transitions for
    // the rest of the session.
    activeBoundary?.drag.cancel()
    activeBoundary = null
    boundaries = []
  }
}
