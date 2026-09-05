import { LAYOUT } from '../config/index.js'
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { useEffect, useRef, useState } from 'react'
import classes from './pane-divider.module.css'

/**
 * Shared draggable pane divider (Slice 2). Pointer-capture drag resizes a
 * pane live through onChange; pointer-up commits through onCommit (persist).
 * Keyboard arrows move the boundary itself in LAYOUT.dividerStepWidth steps
 * with Home/End jumping to the bounds. Rendered only while its pane is
 * expanded; inert below Mantine sm through CSS.
 */

export interface PaneDividerProps {
  value: number
  min: number
  max: number
  /** +1 grows with rightward drag (left pane); -1 grows with leftward drag. */
  direction?: 1 | -1
  /** Live value during drag and keyboard steps. */
  onChange: (value: number) => void
  /** Pointer-up / keyboard commit (persist the value). */
  onCommit: (value: number) => void
  ariaLabel: string
  testId?: string
}

// Module scope (stable for effects): Mantine does not transition navbar
// width today, but zeroing its duration var while dragging keeps resizes
// snap-exact against any theme change.
function setResizingFlag(on: boolean): void {
  if (on) document.documentElement.dataset.layoutResizing = ''
  else delete document.documentElement.dataset.layoutResizing
}

export function PaneDivider({
  value,
  min,
  max,
  direction = 1,
  onChange,
  onCommit,
  ariaLabel,
  testId
}: PaneDividerProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const clamp = (next: number): number => Math.min(Math.max(next, min), max)

  // A drag started on an unmounted-then-removed divider must not leave the
  // flag set for the rest of the session.
  useEffect(() => {
    return () => {
      dragRef.current = null
      setResizingFlag(false)
    }
  }, [])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || dragRef.current !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: valueRef.current
    }
    setDragging(true)
    setResizingFlag(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onChange(clamp(drag.startValue + direction * (event.clientX - drag.startX)))
  }

  const endDrag = (pointerId: number): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return
    dragRef.current = null
    setDragging(false)
    setResizingFlag(false)
    onCommit(clamp(valueRef.current))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null
    if (event.key === 'ArrowRight') next = valueRef.current + direction * LAYOUT.dividerStepWidth
    else if (event.key === 'ArrowLeft') next = valueRef.current - direction * LAYOUT.dividerStepWidth
    else if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    if (next === null) return
    event.preventDefault()
    const clamped = clamp(next)
    onChange(clamped)
    onCommit(clamped)
  }

  return (
    // Vertical pane dividers have no semantic HTML equivalent (<hr> is
    // horizontal and non-interactive); the WAI pattern for a resizable
    // boundary is a focusable separator with slider semantics.
    // biome-ignore lint/a11y/useSemanticElements: no semantic element models an interactive vertical pane divider
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging ? 'true' : 'false'}
      data-testid={testId}
      className={classes.divider}
      style={{ width: LAYOUT.dividerHitWidth }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event.pointerId)}
      onPointerCancel={(event) => endDrag(event.pointerId)}
      onLostPointerCapture={(event) => endDrag(event.pointerId)}
      onKeyDown={handleKeyDown}
    >
      <div className={classes.line} aria-hidden="true" />
    </div>
  )
}
