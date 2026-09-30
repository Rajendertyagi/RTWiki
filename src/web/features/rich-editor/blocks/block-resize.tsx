import { ActionIcon, Tooltip } from '@mantine/core'
import { IconResize } from '@tabler/icons-react'
import type * as React from 'react'
import type { JSX, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
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
 * Clamps: min/max constants bound both axes, dragging clamps against the
 * parent width, and CSS max-width:100% re-clamps responsively on narrow
 * screens WITHOUT touching the stored desktop size. Zoom/Fit of the rendered
 * SVG stays independent ΓÇö this container only bounds the box around it.
 */

export interface ResizableBlockContainerProps {
  /** Stored width prop: pixel number as a string, or '' for auto (100%). */
  width: string
  /** Stored height prop: pixel number as a string, or '' for auto. */
  height: string
  /** Persists a new size through editor.updateBlock (props-preserving). */
  onCommit: (width: string, height: string) => void
  /**
   * An element that must follow this container *during* a drag, written directly.
   *
   * Two problems it solves, both measured rather than assumed.
   *
   * 1. **The drag could not widen the box.** This container is capped to
   *    `max-width: 100%` of its parent. When the parent is itself width-constrained
   *    ΓÇö a flex item in a wrapping row ΓÇö a horizontal drag tracked the pointer on the
   *    vertical axis only and snapped to the dragged width on release. Measured in the
   *    prototype: publishing on the container alone left the box at its starting width
   *    for all eight samples of a 160px drag ΓÇö a 160px tracking error.
   *
   * 2. **Going through React made it junky.** The first fix here called a callback
   *    per `pointermove`, and the owner held the value in state, so every mouse move
   *    re-rendered the whole workspace ΓÇö including every Mermaid canvas on the page.
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

export function clampHeight(height: number): number {
  return Math.min(
    // The controls floor, not the bare minimum: a box shorter than the controls it
    // carries clips them away, and a control you cannot see is not a control.
    // `LAYOUT.blockControlsMinHeight` explains the figure.
    Math.max(height, LAYOUT.blockControlsMinHeight, LAYOUT.blockMinHeight),
    LAYOUT.blockMaxHeight
  )
}

/**
 * The width a block may be dragged to, measured from the space actually available.
 *
 * The parent's **content** box, not its outer width. `clientWidth` includes the
 * parent's padding, while `max-width: 100%` ΓÇö which is what really bounds the
 * container ΓÇö resolves against the content box, so the two disagree by the padding.
 * Measured on a Rich Note: `clientWidth` said 840, the content box was 820, so the
 * `large` preset stored 840 and rendered 820, leaving the document holding a width
 * the page could never draw.
 *
 * A note's block already fills this width, so a block stored at full width cannot be
 * widened ΓÇö which is why the horizontal grips work from the *edges* rather than
 * dragging the whole box: moving an edge is always possible, growing an already-maximal
 * box is not.
 *
 * Falls back to the block max when there is no parent to measure, which is the same
 * "no row to share with" case the drag's own ceiling has to handle.
 */
function contentBoxWidth(parent: HTMLElement): number {
  const style = getComputedStyle(parent)
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  return parent.clientWidth - padding
}

/**
 * A size preset's icon, drawn as bars.
 *
 * These used to be `label.charAt(0)` ΓÇö five bare letters reading `S M L F A`, with the
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

/**
 * The widest a block may be dragged: the full width of the row or column it sits in.
 *
 * The scrolling ancestor is that row or column in both surfaces ΓÇö the rich note's
 * document column, and the Diagram page's block list. Two narrower ceilings were
 * tried and both are wrong in a way that reads as the control being broken:
 *
 *  - **The parent's width.** A block that has been sized sits inside an element that
 *    shrink-wraps it, so the parent's width *is* the block's width and the clamp
 *    forbade any growth at all.
 *  - **The space to the block's right.** Correct for a single-column list, but the
 *    Diagram page's list wraps, so a block in the right-hand column had only a few
 *    pixels of room and could not be widened ΓÇö measured at 10px of travel for a
 *    block 481px wide, with an 160px drag.
 *
 * The full width of the row is the ceiling because that is what the layout can
 * actually accommodate: growing past the current column makes the row re-wrap,
 * which is the correct behaviour for a wrapping flex row and is exactly what a user
 * widening a diagram expects to happen.
 *
 * Never below the block's current width, so a block stored from a wider window can
 * still be dragged rather than pinned at a size it cannot change.
 */
function widthCeiling(container: HTMLElement, rect: DOMRect): number {
  let scroller: HTMLElement | null = container.parentElement
  while (scroller !== null) {
    const style = getComputedStyle(scroller)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') break
    scroller = scroller.parentElement
  }
  const width = scroller?.clientWidth ?? window.innerWidth
  const padding = scroller
    ? (Number.parseFloat(getComputedStyle(scroller).paddingLeft) || 0) +
      (Number.parseFloat(getComputedStyle(scroller).paddingRight) || 0)
    : 0
  return Math.max(rect.width, width - padding - 2)
}

export function ResizableBlockContainer({
  width,
  height,
  onCommit,
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
      // The ceiling for a drag, and the reasoning behind it is in
      // `widthCeiling` below: a block may grow to the full width of its row or
      // column, which is what the wrapping layout can actually accommodate.
      maxWidth: widthCeiling(container, rect)
    }
    setDragSize({ width: rect.width, height: rect.height })
  }

  /**
   * Writes the in-flight size onto the live target, bypassing React entirely.
   *
   * Publishing on the *target* rather than on this container is the whole point: the
   * container is capped to `max-width: 100%` of the target, so a container that can
   * grow on its own is not enough ΓÇö the box that has to grow is the target's.
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
   * Unconditional, and on release as well as unmount: a drag interrupted by a page
   * switch must not leave a size painted on an element.
   */
  const clearLive = (): void => {
    const target = liveStyleTarget?.current
    if (target === null || target === undefined) return
    target.style.removeProperty('--block-width-live')
    target.style.removeProperty('--block-height-live')
    target.removeAttribute('data-live')
  }

  // A drag interrupted by unmount ΓÇö a page switch, a closing tab ΓÇö must not leave
  // the live size painted on an element that is about to disappear.
  //
  // `clearLive` is held in a ref so the effect below can depend on it without
  // re-registering. It is a new function identity on every render, so listing it
  // directly would tear down and re-arm the cleanup on every render for no benefit;
  // an empty dependency list is then correct, and the ref indirection is what makes
  // that true rather than merely lucky.
  const clearLiveRef = useRef(clearLive)
  clearLiveRef.current = clearLive
  useEffect(() => () => clearLiveRef.current(), [])

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragOriginRef.current
    if (origin === null) return
    const next = {
      width: clampWidth(origin.startWidth + (event.clientX - origin.pointerX), origin.maxWidth),
      height: clampHeight(origin.startHeight + (event.clientY - origin.pointerY))
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
      // Published, then committed, then cleared, so the live size and the stored one
      // cannot disagree for a frame in either direction.
      publishLive(requestedWidth, requestedHeight)

      /*
       * Store the size the box **actually reached**, not the size that was asked for.
       *
       * `max-width: 100%` bounds this container to its parent, so a drag can request
       * more width than exists and have it reduced on screen. In a Rich Note the block
       * already spans the whole document column, so a rightward drag asks for 948px in
       * an 820px box: measured, it stored `948` and rendered `820`, so the document
       * held a size the page could never show ΓÇö and a reload would re-clamp it, leaving
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
    clearLive()
    setDragSize(null)
  }

  /*
   * The width this container can actually occupy: its parent's **content** box.
   *
   * `clientWidth` is the wrong number here. It includes the parent's padding, while
   * `max-width: 100%` ΓÇö which is what really bounds this container ΓÇö resolves against
   * the content box. Measured on a Rich Note: `clientWidth` said 840, the content box
   * was 820, so the `large` preset stored 840 and rendered 820, leaving the document
   * holding a width the page could never draw.
   *
   * Falls back to the block max when there is no parent to measure, which is the same
   * "no row to share with" case the drag's own ceiling has to handle.
   */
  const availableWidth = (): number => {
    const parent = containerRef.current?.parentElement
    if (parent === null || parent === undefined) return LAYOUT.blockMaxWidth
    const style = getComputedStyle(parent)
    const padding =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    return parent.clientWidth - padding
  }

  const applyPreset = (key: BlockSizePresetKey): void => {
    const preset = BLOCK_SIZE_PRESETS[key]
    const nextWidth = preset.width === 0 ? '' : String(clampWidth(preset.width, availableWidth()))
    const nextHeight = preset.height === 0 ? '' : String(clampHeight(preset.height))
    onCommit(nextWidth, nextHeight)
  }

  return (
    <div
      ref={containerRef}
      // `sizeContainerSized` is applied whenever a height is actually in play ΓÇö stored,
      // or being dragged right now ΓÇö and is what switches the diagram from "drawn at
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
            const parent = containerRef.current?.parentElement
            const parentWidth =
              parent === null || parent === undefined
                ? LAYOUT.blockMaxWidth
                : contentBoxWidth(parent)
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width + step, parentWidth)),
                String(clampHeight(current.height + step))
              )
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault()
              onCommit(
                String(clampWidth(current.width - step, parentWidth)),
                String(clampHeight(current.height - step))
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
