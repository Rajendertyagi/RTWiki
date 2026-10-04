import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Roving tabindex for a `role="toolbar"`, so the whole bar is one tab stop.
 *
 * ## Why this exists rather than living in the toolbar component
 *
 * The APG calls this the roving-tabindex pattern, and it is a general widget
 * behaviour, not a toolbar detail. Writing it once here means the keyboard
 * contract is testable without a DOM and cannot drift between the two bars
 * that need it.
 *
 * ## Why the tab strip's handler is not reused
 *
 * `tab-strip.tsx` has a `tabIndex={active ? 0 : -1}` line and arrow-key
 * handling, so it looks like the same primitive. It is not, and reusing it
 * would have been the more expensive option:
 *
 * - Its arrows **change selection** (a tab strip selects as it navigates). In a
 *   toolbar, arrows must move focus **without** running the command, or arrowing
 *   across the bar would bold, un-bold and re-format the document.
 * - Its `Ctrl+Arrow` reorders tabs, which has no toolbar analogue.
 * - It announces moves through a live region, because a reordered tab strip is
 *   not otherwise perceivable. A toolbar's pressed state already is.
 * - Its focus is driven by *selection*; a toolbar has no selection, so its
 *   roving index has to stand on its own.
 *
 * The shared idea is only the one-line `tabIndex` computation, which is not
 * worth a cross-feature import.
 */

/** The keys that move focus within a toolbar, per the APG toolbar pattern. */
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp'])
const FIRST_KEY = 'Home'
const LAST_KEY = 'End'

export interface RovingFocus {
  /**
   * `tabIndex` for the control at `index`.
   *
   * Exactly one control is 0 and the rest are -1, so Tab enters the bar once and
   * Tab again leaves it. This is the whole reason the previous attempt had
   * seventeen tab stops: it set `role="toolbar"` and copied the ARIA label
   * without this.
   */
  tabIndexAt: (index: number) => 0 | -1
  /**
   * The keydown handler for the bar. Attach it to the bar element, not to each
   * control: one listener, and the target is found from the event rather than
   * tracked in state that can drift from the DOM.
   */
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
  /**
   * The index that currently holds the roving position, or -1 before the bar has
   * been focused. Exposed so a surface can restore focus after the control set
   * changes underneath it.
   */
  activeIndex: number
  /**
   * Ref callback for the bar element. The handler needs the element to find the
   * controls, and taking it through a ref rather than a closure keeps the
   * handler's identity stable for the life of the bar.
   */
  setContainer: (node: HTMLElement | null) => void
}

export function useRovingFocus(itemCount: number): RovingFocus {
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLElement | null>(null)

  /**
   * The controls, in DOM order, that can hold focus.
   *
   * Read from the DOM rather than kept as a list in state, because the controls
   * are also rendered inside the overflow menu and the two must not be confused.
   * Scoped to the bar itself and marked with the data attribute the shell sets,
   * so a control that has moved into the menu is not counted as present here.
   */
  const focusable = useCallback((): HTMLElement[] => {
    const root = containerRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[data-toolbar-item]')).filter(
      // A disabled control is skipped rather than focused, per the APG: arrowing
      // onto a control that cannot act wastes the keypress and hides the fact
      // that it is unavailable. `data-disabled` counts as disabled here for the
      // same reason the native attribute does.
      (el) => !el.hasAttribute('disabled') && !el.hasAttribute('data-disabled')
    )
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>): void => {
      const isNext = NEXT_KEYS.has(event.key)
      const isPrevious = PREVIOUS_KEYS.has(event.key)
      const isEdge = event.key === FIRST_KEY || event.key === LAST_KEY
      if (!isNext && !isPrevious && !isEdge) return

      /*
       * Ignore keys that came from something other than this bar.
       *
       * A panel opened by a control is portalled into `document.body`, but React
       * events propagate through the **React** tree rather than the DOM tree — so
       * an arrow pressed inside a colour swatch arrives here, and the handler
       * treats it as "move the toolbar's focus".
       *
       * Measured, not assumed: with an arrow pressed on the first swatch, the
       * swatch's own `tabIndex` correctly moved to the second item while the
       * browser's real focus jumped to the toolbar's **Redo** button. Two roving
       * systems disagreed about where focus was, which is worse than either
       * alone.
       *
       * The test is containment in the bar's own DOM, which is exact: a portalled
       * panel is not inside it, and a control on the bar always is.
       */
      const container = containerRef.current
      const origin = event.target as HTMLElement | null
      if (!container || !origin || !container.contains(origin)) return

      const items = focusable()
      if (items.length === 0) return

      // Home/End are absolute, so they act from the event target rather than
      // from the tracked index: the target is the ground truth about where
      // focus actually is, and the tracked index can lag a click.
      const target = origin.closest<HTMLElement>('[data-toolbar-item]')
      const current = target
        ? items.indexOf(target)
        : items.indexOf(document.activeElement as HTMLElement)

      let next: number
      if (event.key === FIRST_KEY) {
        next = 0
      } else if (event.key === LAST_KEY) {
        next = items.length - 1
      } else {
        const from = current >= 0 ? current : 0
        next = isNext ? from + 1 : from - 1
      }

      if (next < 0 || next >= items.length) {
        // At an end: consume the key so the page does not scroll, but do not
        // wrap. Wrapping would send focus from the last control to the first,
        // which is never what was meant and hides the end of the row.
        event.preventDefault()
        return
      }

      event.preventDefault()
      const item = items[next]
      if (!item) return
      setActiveIndex(next)
      item.focus()
    },
    [focusable]
  )

  const setContainer = useCallback((node: HTMLElement | null): void => {
    containerRef.current = node
  }, [])

  const tabIndexAt = useCallback(
    (index: number): 0 | -1 => {
      // Before the bar has been focused, nothing is a tab stop, so Tab reaches
      // the bar from the page and the first arrow press lands on a control
      // rather than skipping the first one.
      if (activeIndex === -1) return index === 0 ? 0 : -1
      return index === activeIndex ? 0 : -1
    },
    [activeIndex]
  )

  // A bar whose control set shrinks must not leave its index pointing past the
  // end, which would leave every control at tabIndex -1 and make the bar
  // unreachable by keyboard.
  useEffect(() => {
    setActiveIndex((current) => (current >= itemCount ? itemCount - 1 : current))
  }, [itemCount])

  return { tabIndexAt, onKeyDown, activeIndex, setContainer }
}
