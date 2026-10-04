import { ActionIcon, Tooltip } from '@mantine/core'
import { IconResize } from '@tabler/icons-react'
import type * as React from 'react'
import type { JSX, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BLOCK_SIZE_PRESETS,
  type BlockSizePresetKey,
  LAYOUT,
  UI_TEXT
} from '../../../config/index.js'
import type { CSSVars } from '../../../style-props.js'
import classes from './mermaid-block.module.css'

/**
 * Resizable container for embedded Diagram / Mind Map blocks.
 *
 * Dimensions persist as typed block props (`width`/`height`, pixel strings,
 * '' = auto) so reload and duplicate preserve them without any migration.
 * Pointer dragging resizes width and height independently from a corner
 * handle; keyboard users get the always-rendered size-preset buttons.
 *
 * Clamps: min/max constants bound both axes, and the width clamp is measured against
 * **one** boundary — the containing block that `max-width: 100%` resolves against — so
 * the drag, the keyboard and the size presets can never disagree with what CSS will draw.
 * That same rule re-clamps responsively on narrow screens WITHOUT touching the stored
 * desktop size. Zoom/Fit of the rendered SVG stays independent: this container only
 * bounds the box around it.
 */

export interface ResizableBlockContainerProps {
  /** Stored width prop: pixel number as a string, or '' for auto (100%). */
  width: string
  /** Stored height prop: pixel number as a string, or '' for auto. */
  height: string
  /** Persists a new size through editor.updateBlock (props-preserving). */
  onCommit: (width: string, height: string) => void
  /**
   * The shortest this block may be, in px.
   *
   * Defaults to the shared controls floor. A surface that stacks chrome *above* the
   * control pad inside the same box must raise it, or the pad is clipped: the Diagram
   * page's card puts its action row there, so it passes
   * `LAYOUT.visualPageBlockMinHeight`. Omit it and you get the Rich Note's floor, which
   * is right for a note block and 29px short for a diagram card.
   */
  minHeight?: number
  /**
   * An element that must follow this container *during* a drag, written directly.
   *
   * Two problems it solves, both measured rather than assumed.
   *
   * 1. **The drag could not widen the box.** This container is capped to
   *    `max-width: 100%` of its parent. When the parent is itself width-constrained
   *    — a flex item in a wrapping row — a horizontal drag tracked the pointer on the
   *    vertical axis only and snapped to the dragged width on release. Measured in the
   *    prototype: publishing on the container alone left the box at its starting width
   *    for all eight samples of a 160px drag — a 160px tracking error.
   *
   * 2. **Going through React made it junky.** The first fix here called a callback
   *    per `pointermove`, and the owner held the value in state, so every mouse move
   *    re-rendered the whole workspace — including every Mermaid canvas on the page.
   *    Measured: the box lagged the pointer by up to 31px on a 160px drag and only
   *    caught up on release. That lag is the "junky, not consistent" report.
   *
   * So the size is written straight onto the target's `style`, bypassing React
   * entirely. A standalone prototype of this exact DOM and CSS measured **0px**
   * tracking error at every sample, on both axes, against 160px for the
   * container-only version.
   *
   * The properties are `--block-width-live` / `--block-height-live`, **not** the
   * stored `--block-width` / `--block-height`, and that is load-bearing. The target
   * also carries the stored size, published by React; clearing the live value on
   * release must not remove it. A shared name would leave the block with no size at
   * all, and React would not put the stored one back, because the value it believes
   * it wrote has not changed.
   *
   * A ref, not an id or a query: it keeps the coupling in the type signature, and
   * `Reorder.Item` forwards a ref to its DOM node (framer-motion 13.4.4,
   * `ReorderItemComponent(..., externalRef)`).
   */
  liveStyleTarget?: React.RefObject<HTMLElement | null>
  testIdPrefix: string
  children: ReactNode
}

function parsePx(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function clampWidth(width: number, maxWidth: number): number {
  return Math.min(
    Math.max(width, LAYOUT.blockMinWidth),
    Math.max(LAYOUT.blockMinWidth, Math.min(LAYOUT.blockMaxWidth, maxWidth))
  )
}

export function clampHeight(height: number, floor: number = LAYOUT.blockControlsMinHeight): number {
  return Math.min(
    // The controls floor, not the bare minimum: a box shorter than the controls it
    // carries clips them away, and a control you cannot see is not a control.
    // `LAYOUT.blockControlsMinHeight` explains the figure, and `floor` lets a
    // surface that carries extra chrome above those controls raise it —
    // `LAYOUT.visualPageBlockMinHeight` is the Diagram page's.
    Math.max(height, floor, LAYOUT.blockMinHeight),
    LAYOUT.blockMaxHeight
  )
}
/**
 * The attribute a surface puts on the element that bounds its blocks' width.
 *
 * This is the whole width contract, and it is declared rather than inferred. A surface
 * that hosts resizable blocks marks the one element whose **content box** is the width a
 * block may occupy, and the shared resize component asks for exactly that. Two surfaces
 * mark two elements:
 *
 * - **Rich Note** marks `.previewPane` (in `mermaid-block-view.tsx`) — the note's text column.
 * - **Diagram page** marks `.blockList` (in `mermaid-workspace.tsx`) — the wrapping flex row.
 *
 * ## Why this is declared and not inferred
 *
 * The previous implementation walked up from the container while the ancestor's width
 * "looked like" the block's own, deciding that by two pieces of incidental layout CSS: an
 * inline `--block-width` property, and `flex: 1 1 <a definite length>`. Both were read from
 * `getComputedStyle`, and both were correct only because of how these two surfaces happen
 * to be built today:
 *
 * - The Rich Note's `.previewPane` computes `flex-basis: auto, flex-grow: 0`; the Diagram
 *   page's `Reorder.Item` computes `flex-basis: 352px, flex-grow: 1`. The distinction between
 *   "the column" and "a share of the row" is a *flex* distinction, and no other CSS signal
 *   distinguishes them: measured, `max-width` is `none` all the way up the note's chain and
 *   is `100%` only on the very item the heuristic had to skip.
 * - A second surface nesting a block inside `flex: 1 1 <length>` would need the same
 *   reasoning re-derived by hand, and getting it wrong is silent: a boundary taken from a
 *   shrink-wrapped parent is the block's own width, so nothing can be widened and the
 *   control looks broken rather than wrong.
 *
 * Asking the layout instead — offering the block maximum through the width custom
 * properties, reading what was drawn, restoring — was measured and abandoned, and the
 * reason belongs here because it constrains any future attempt: writing to the tree trips
 * the block's own `ResizeObserver`, whose state update **replaces the resize grip**, so the
 * pointer capture `onPointerDown` takes is destroyed and every following `pointermove` goes
 * to whatever is under the cursor. Measured: with the probe, the grip node after
 * `pointerdown` was a *different element* and a Rich Note drag moved nothing on either
 * axis; without it, the same node and a working drag.
 *
 * A marker costs one attribute per surface and cannot be got wrong silently: a surface that
 * forgets it is reported (see below) instead of quietly clamping to a neighbour.
 */
export const BLOCK_WIDTH_BOUNDARY_ATTR = 'data-block-width-boundary'

/**
 * Boundaries already reported missing, so a surface that has forgotten its marker is
 * reported once rather than on every grip press and every arrow key.
 */
const reportedMissingBoundary = new Set<string>()

/**
 * The nearest ancestor the surface has declared as its width boundary.
 *
 * Read-only: `closest()` inspects the tree and writes nothing. The container itself is
 * excluded — it is the block, never the thing that bounds it — so the walk starts at its
 * parent.
 */
function nearestBlockWidthBoundary(container: HTMLElement): HTMLElement | null {
  return container.parentElement?.closest<HTMLElement>(`[${BLOCK_WIDTH_BOUNDARY_ATTR}]`) ?? null
}

/**
 * The one authoritative width boundary for a block: a read-only lookup of the surface's
 * declared element, measured with its padding removed.
 *
 * A block's width is bounded by CSS and by nothing else — `.sizeContainer` carries
 * `max-width: 100%`, which resolves against its containing block's content box — so
 * reading the boundary's content box is reading the same number CSS enforces. There is no
 * second authority and nothing to keep in step.
 *
 * ## When no surface has declared a boundary
 *
 * Reported once per container, and capped at `LAYOUT.blockMaxWidth`, which is the only
 * other constraint that exists. Deliberately **not** a fallback to some other ancestor:
 * picking an unmarked ancestor is how the previous version produced a boundary 126px wider
 * than the space a block could ever occupy, and it would do so silently. Capping at the
 * block maximum keeps the failure visible — a block can then be wider than its surface
 * asks for, which the tests assert is worse than the marker being absent silently.
 */
function blockWidthBoundary(container: HTMLElement): number {
  const boundary = nearestBlockWidthBoundary(container)
  if (boundary === null) {
    const who = container.getAttribute('data-testid') ?? container.tagName.toLowerCase()
    if (!reportedMissingBoundary.has(who)) {
      reportedMissingBoundary.add(who)
      console.warn(
        `rtwiki block width boundary missing: no ancestor of "${who}" carries ${BLOCK_WIDTH_BOUNDARY_ATTR}, so resizing falls back to the block maximum (${String(LAYOUT.blockMaxWidth)}px) instead of the width this surface can actually draw`
      )
    }
    return LAYOUT.blockMaxWidth
  }
  const style = getComputedStyle(boundary)
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  return boundary.clientWidth - padding
}

/**
 * A size preset's icon, drawn as bars.
 *
 * These used to be `label.charAt(0)` — five bare letters reading `S M L F A`, with the
 * real name only in a hover tooltip. Two of those letters mean *behaviour* rather than
 * size ("Full width", "Auto height") and neither is guessable, and a tooltip is no help
 * to anyone on a touch screen.
 *
 * Bars read as size without a word and work in any language. The two behavioural
 * presets are told apart by shape rather than by count, because neither has a "bigger"
 * version to count up to: `full` is one bar spanning the width inside a solid frame,
 * `fit` is a frame open to vertical arrows.
 *
 * The accessible name is unchanged and still carries the full label, so this is a visual
 * change only: a screen reader announces "Size: Medium", not "M".
 */
function SizePresetGlyph({ preset }: { preset: BlockSizePresetKey }): JSX.Element {
  if (preset === 'fit') {
    // Auto height: the height follows the drawing, so the glyph is a frame with
    // vertical arrows rather than anything of a fixed size.
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="4.5"
          y="5.4"
          width="7"
          height="5.2"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M8 1.4v2.4M8 12.2v2.4M6.4 2.6 8 1l1.6 1.6M6.4 13.4 8 15l1.6-1.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  /*
   * One solid bar whose **width** is the size. A dashed frame was tried first and read
   * as noise at the 16px an `ActionIcon size="compact-xs"` leaves: the outline
   * dominated and the three sizes looked identical. A single filled bar is legible at
   * that size and needs no counting.
   */
  const widths: Record<'small' | 'medium' | 'large', number> = { small: 5, medium: 8.5, large: 12 }
  const w = preset === 'full' ? 12 : widths[preset]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x={(16 - w) / 2} y="6.4" width={w} height="3.2" rx="1.1" fill="currentColor" />
      {preset === 'full' ? (
        /* Full width is `large` plus "as wide as it goes", so the extra is the arrows
           out to the edges rather than a longer bar the box has no room for. */
        <path
          d="M3 8 1.2 6.2M1.2 6.2h2.2M1.2 6.2v2.2M13 8l1.8-1.8M14.8 6.2h-2.2M14.8 6.2v2.2"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(0 -1.9)"
        />
      ) : null}
    </svg>
  )
}

export function ResizableBlockContainer({
  width,
  height,
  onCommit,
  minHeight = LAYOUT.blockControlsMinHeight,
  liveStyleTarget,
  testIdPrefix,
  children
}: ResizableBlockContainerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragOriginRef = useRef<{
    pointerX: number
    pointerY: number
    startWidth: number
    startHeight: number
    maxWidth: number
  } | null>(null)
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null)

  const storedWidth = parsePx(width)
  const storedHeight = parsePx(height)
  const activeWidth = dragSize?.width ?? storedWidth
  const activeHeight = dragSize?.height ?? storedHeight

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const container = containerRef.current
    if (container === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = container.getBoundingClientRect()
    dragOriginRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      // The one boundary, which is also what `max-width: 100%` resolves against.
      // See `blockWidthBoundary`.
      maxWidth: blockWidthBoundary(container)
    }
    setDragSize({ width: rect.width, height: rect.height })
  }

  /**
   * Writes the in-flight size onto the live target, bypassing React entirely.
   *
   * Publishing on the *target* rather than on this container is the whole point: the
   * container is capped to `max-width: 100%` of the target, so a container that can
   * grow on its own is not enough — the box that has to grow is the target's.
   *
   * `data-live` goes alongside so the layout drops the row-sharing flex rules for the
   * duration of the drag, which is what lets the target take the dragged width rather
   * than its share of the row.
   */
  const publishLive = (w: number, h: number): void => {
    const target = liveStyleTarget?.current
    if (target === null || target === undefined) return
    target.style.setProperty('--block-width-live', `${Math.round(w)}px`)
    target.style.setProperty('--block-height-live', `${Math.round(h)}px`)
    target.setAttribute('data-live', 'true')
  }

  /**
   * Removes exactly what `publishLive` wrote, and nothing else.
   *
   * The `-live` names are what make this safe: the target's own `--block-width` is
   * the *stored* size, owned by React, and removing it here would strip a size the
   * document still holds. React would not restore it, because from its point of view
   * the value it wrote has not changed.
   *
   * NOT called from `onPointerUp`. It is called from the layout effect below, once
   * React has published the committed size. See the note there for the measurement.
   */
  const clearLive = (): void => {
    const target = liveStyleTarget?.current
    if (target === null || target === undefined) return
    target.style.removeProperty('--block-width-live')
    target.style.removeProperty('--block-height-live')
    target.removeAttribute('data-live')
  }

  /*
   * Why `clearLive` is not called from `onPointerUp`, and what replaced that call.
   *
   * It used to be, and clearing there was a visible defect on the Diagram page.
   *
   * `pointerup` is a discrete event, so React flushes at the end of the handler — but
   * `clearLive` is a **direct DOM mutation** and lands *immediately*, before that
   * flush. For one commit the target therefore carried neither size: the live one had
   * just been removed and the stored one had not been published yet.
   *
   * On the Diagram page that target is Motion's `Reorder.Item`. Its width falls back to
   * `var(--block-width, auto)`, and the `data-live` attribute is what takes it out of the
   * row-sharing flex rules in `mermaid-workspace.module.css` — so with both gone the
   * item snapped back to its share of the row, and Motion then animated the correction
   * down to the committed size. Measured frame by frame on a block dragged from 814px
   * to 614px: 614, then **814**, then 812, 811, 806, 797 … 634, then 614. Roughly
   * 280ms of the block being the wrong width, and the wrong width was the full column.
   *
   * The comment that used to sit above that call asserted the live and stored sizes
   * "cannot disagree for a frame in either direction". They could, and did, precisely
   * because the clear was ordered *before* React rather than after it.
   *
   * The fix is ordering, not timing. A layout effect runs after React has written the
   * committed `--block-width` onto the target, so by the time it removes the live one
   * both hold the same number: no geometry changes, Motion sees nothing to animate, and
   * the stored value is never missing for even one frame. No `setTimeout`, no
   * `requestAnimationFrame`, no frame counting, no observer.
   *
   * `dragSize` is the trigger. It is non-null for exactly the duration of a drag and
   * `onPointerUp` sets it to null, so the effect fires on release whether or not the
   * commit changed the stored props — a drag that ends where it began still clears.
   *
   * `clearLive` is held in a ref so this effect can depend on it without
   * re-registering on every render: it is a new function identity each time, and
   * listing it directly would re-run the effect constantly for no benefit.
   */
  const clearLiveRef = useRef(clearLive)
  clearLiveRef.current = clearLive

  useLayoutEffect(() => {
    if (dragSize !== null) return
    clearLiveRef.current()
  }, [dragSize])

  // A drag interrupted by unmount — a page switch, a closing tab — must not leave the
  // live size painted on an element that is about to disappear. The layout effect above
  // covers the normal release; this covers the abnormal one.
  useEffect(() => () => clearLiveRef.current(), [])

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOriginRef.current
    if (origin === null) return
    const next = {
      width: clampWidth(origin.startWidth + (event.clientX - origin.pointerX), origin.maxWidth),
      height: clampHeight(origin.startHeight + (event.clientY - origin.pointerY), minHeight)
    }
    setDragSize(next)
    publishLive(next.width, next.height)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOriginRef.current
    if (origin === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragOriginRef.current = null
    if (dragSize !== null) {
      const requestedWidth = Math.round(dragSize.width)
      const requestedHeight = Math.round(dragSize.height)
      // Republished so the box holds the requested size while the commit travels, and
      // deliberately NOT cleared here. Clearing from this handler is what made the
      // Diagram page jump to the full column width for ~280ms on release; the layout
      // effect above clears it, in the right order. See the note there.
      publishLive(requestedWidth, requestedHeight)

      /*
       * Store the size the box **actually reached**, not the size that was asked for.
       *
       * `max-width: 100%` bounds this container to its parent, so a drag can request
       * more width than exists and have it reduced on screen. In a Rich Note the block
       * already spans the whole document column, so a rightward drag asks for 948px in
       * an 820px box: measured, it stored `948` and rendered `820`, so the document
       * held a size the page could never show — and a reload would re-clamp it, leaving
       * the stored width quietly disagreeing with the picture forever.
       *
       * Read with the live size still applied, which is the only moment the box holds
       * its final geometry. This also makes the "did anything change" test below
       * truthful: on the Diagram page the live size *is* the rendered size, so nothing
       * changes there.
       */
      const finalRect = containerRef.current?.getBoundingClientRect()
      const finalWidth = finalRect === undefined ? requestedWidth : Math.round(finalRect.width)
      const finalHeight = finalRect === undefined ? requestedHeight : Math.round(finalRect.height)

      // Only write when this drag actually changed the box. Comparing against the
      // drag's own measured start, not against the stored prop: an unsized block's
      // stored width is `''` while its measured width is a real number, so comparing
      // the two would commit on every bare click and turn an unsized block into a
      // sized one the user never asked to size and could not undo without resizing it
      // again.
      if (
        finalWidth !== Math.round(origin.startWidth) ||
        finalHeight !== Math.round(origin.startHeight)
      ) {
        onCommit(String(finalWidth), String(finalHeight))
      }
    }
    setDragSize(null)
  }

  /*
   * The width this container can actually occupy: the same single boundary the drag and
   * the keyboard use — see `blockWidthBoundary`. A preset therefore stores the width it
   * can actually be drawn at, and can never leave the document holding a size the page
   * cannot show.
   */
  const availableWidth = (): number => {
    const container = containerRef.current
    return container === null ? LAYOUT.blockMaxWidth : blockWidthBoundary(container)
  }

  const applyPreset = (key: BlockSizePresetKey): void => {
    const preset = BLOCK_SIZE_PRESETS[key]
    const nextWidth = preset.width === 0 ? '' : String(clampWidth(preset.width, availableWidth()))
    const nextHeight = preset.height === 0 ? '' : String(clampHeight(preset.height, minHeight))
    onCommit(nextWidth, nextHeight)
  }

  return (
    <div
      ref={containerRef}
      // `sizeContainerSized` is applied whenever a height is actually in play — stored,
      // or being dragged right now — and is what switches the diagram from "drawn at
      // its natural size in a scrolling pane" to "scaled to fit its box". It mirrors the
      // Diagram page's `.blockCanvasSized`; without the matching class here a note
      // cropped its diagram instead of scaling it. See
      // docs/DIAGRAM_BLOCK_SPECIFICATION.md section 5.4.
      className={`${classes.sizeContainer}${activeHeight !== null ? ` ${classes.sizeContainerSized}` : ''}`}
      // Drag-resized dimensions are data, so they arrive as custom properties
      // and the box model stays in the stylesheet.
      style={
        {
          '--block-width': activeWidth !== null ? `${activeWidth}px` : undefined,
          '--block-height': activeHeight !== null ? `${activeHeight}px` : undefined
        } as CSSVars
      }
      data-testid={`${testIdPrefix}-container`}
      data-width={activeWidth ?? ''}
      data-height={activeHeight ?? ''}
    >
      {children}
      <div className={classes.sizePresets} role="toolbar" aria-label={UI_TEXT.sizePresetLabel}>
        {(Object.keys(BLOCK_SIZE_PRESETS) as BlockSizePresetKey[]).map((key) => (
          <Tooltip key={key} label={BLOCK_SIZE_PRESETS[key].label} position="top">
            <ActionIcon
              size="compact-xs"
              variant="subtle"
              aria-label={`${UI_TEXT.sizePresetLabel}: ${BLOCK_SIZE_PRESETS[key].label}`}
              data-testid={`${testIdPrefix}-preset-${key}`}
              onClick={() => applyPreset(key)}
            >
              <SizePresetGlyph preset={key} />
            </ActionIcon>
          </Tooltip>
        ))}
      </div>
      <Tooltip label={UI_TEXT.resizeHandleLabel} position="top">
        <button
          type="button"
          className={classes.resizeHandle}
          aria-label={UI_TEXT.resizeHandleLabel}
          data-testid={`${testIdPrefix}-resize-handle`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(event) => {
            // Keyboard-equivalent resizing in 40px steps.
            const step = 40
            /*
             * Start from the box that is **actually on screen**, not from the stored
             * size. An unsized block stores nothing, so reading the stored value here
             * began from the smallest permitted size and then *added* 40 to it - which
             * made Arrow Right, the key that enlarges a box, shrink it. Measured: a box
             * of 820px became 280px on one press of Arrow Right. The pointer drag does
             * not share this fault because it measures the real box on press; the same
             * measurement is what the keyboard path was missing.
             *
             * `dragSize` still wins where it exists, so a keypress during a drag steps
             * from the in-flight size rather than snapping back to the committed one.
             */
            const measured = containerRef.current?.getBoundingClientRect()
            const current = {
              width: dragSize?.width ?? measured?.width ?? storedWidth ?? LAYOUT.blockMinWidth,
              height: dragSize?.height ?? measured?.height ?? storedHeight ?? LAYOUT.blockMinHeight
            }
            // The same boundary the drag and the presets use.
            const boundary =
              containerRef.current === null
                ? LAYOUT.blockMaxWidth
                : blockWidthBoundary(containerRef.current)
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width + step, boundary)),
                String(clampHeight(current.height + step, minHeight))
              )
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width - step, boundary)),
                String(clampHeight(current.height - step, minHeight))
              )
            }
          }}
        >
          <IconResize size={12} />
        </button>
      </Tooltip>
    </div>
  )
}
