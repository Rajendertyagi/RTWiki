import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/**
 * Measures a single-row toolbar and decides how many of its controls fit.
 *
 * Shared by every toolbar that holds more controls than fit on screen: the rich
 * document toolbar and the diagram template toolbar. Both want the same
 * behaviour — one row, never wrapping, never scrolling, and whatever does not
 * fit moves into a trailing "more" dropdown. The measurement lives here so the
 * two toolbars cannot drift apart, and so a fix to one is a fix to both.
 *
 * Why a measured split rather than a scroll or a wrap: a scrolling row slices
 * the last control mid-icon with nothing to indicate there is more, and a
 * wrapping row changes the toolbar's height as the window resizes.
 *
 * @param items      The controls, in order, as they will be rendered. Rebuilt
 *                   on every render, so it is read through a ref rather than
 *                   captured: depending on it directly would give `measure` a
 *                   new identity each render and re-run the observer every pass.
 * @param options    `isDivider` identifies separator nodes so the split never
 *                   strands one at the end; `moreButtonWidth` is the room
 *                   reserved for the trailing button.
 * @returns `split` is the number of leading items that fit, or `null` when they
 *          all do. `barRef` goes on the row; `slotProps(index)` goes on the
 *          wrapper around item `index` so its width can be measured.
 */
export interface ToolbarOverflowOptions {
  isDivider?: (node: ReactNode) => boolean
  moreButtonWidth?: number
}

export interface ToolbarOverflow {
  split: number | null
  barRef: RefObject<HTMLDivElement | null>
  slotProps: (index: number) => { ref: (node: HTMLSpanElement | null) => void }
}

const DEFAULT_MORE_BUTTON_WIDTH = 28

export function useToolbarOverflow(
  items: ReactNode[],
  options: ToolbarOverflowOptions = {}
): ToolbarOverflow {
  const { isDivider, moreButtonWidth = DEFAULT_MORE_BUTTON_WIDTH } = options

  const barRef = useRef<HTMLDivElement | null>(null)
  const slots = useRef<Map<number, HTMLSpanElement>>(new Map())
  const widths = useRef<Map<number, number>>(new Map())
  const itemsRef = useRef<ReactNode[]>(items)
  itemsRef.current = items
  const [split, setSplit] = useState<number | null>(null)

  const measure = useCallback(() => {
    const bar = barRef.current
    if (!bar) return
    const total = itemsRef.current.length
    if (total === 0) return

    // Cache the natural width of every control currently rendered. Widths are
    // cached rather than read live because once a split is applied the tail is
    // no longer in the bar: measuring only what is visible would report "it
    // fits", clear the split, re-overflow, and loop forever.
    for (const [index, node] of slots.current) {
      widths.current.set(index, node.offsetWidth)
    }
    const list: number[] = []
    for (let i = 0; i < total; i += 1) {
      const w = widths.current.get(i)
      // Not every control has been seen at a real width yet; wait rather than
      // guess, or the first pass would strand the row.
      if (w === undefined) return
      list.push(w)
    }

    const cs = getComputedStyle(bar)
    const gap = Number.parseFloat(cs.columnGap || cs.gap || '0') || 0
    const padding =
      (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
    const available = bar.clientWidth - padding
    // Not laid out yet. Measuring against zero would move everything out.
    if (available <= 0) return

    let used = 0
    for (const w of list) used += (used === 0 ? 0 : gap) + w
    if (used <= available) {
      setSplit(null)
      return
    }

    // Recompute with room left for the button that will replace the tail.
    const budget = available - moreButtonWidth - gap
    let fit = 0
    let running = 0
    for (let i = 0; i < list.length; i += 1) {
      const next = running + (running === 0 ? 0 : gap) + list[i]
      if (next > budget) break
      running = next
      fit = i + 1
    }
    // Never strand the row with a lone separator at the split.
    if (isDivider) {
      while (fit > 0 && isDivider(itemsRef.current[fit - 1])) fit -= 1
    }
    setSplit(fit >= list.length ? null : Math.max(fit, 0))
  }, [isDivider, moreButtonWidth])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `split` is a trigger, not a dependency — the observer must re-attach after a split so it can measure the controls that just moved out of the bar. Reading it here would be exactly the loop the width cache exists to prevent.
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    for (const node of slots.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [measure, split])

  const slotProps = useCallback(
    (index: number) => ({
      ref: (node: HTMLSpanElement | null) => {
        if (node) slots.current.set(index, node)
        else slots.current.delete(index)
      }
    }),
    []
  )

  return { split, barRef, slotProps }
}
