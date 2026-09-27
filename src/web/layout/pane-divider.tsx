import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import { useEffect, useRef, useState } from 'react'
import { LAYOUT } from '../config/index.js'
import classes from './pane-divider.module.css'

/**
 * Shared draggable pane divider (Slice 2). Pointer-capture drag resizes a
 * pane live through onChange; pointer-up commits through onCommit (persist).
 * Keyboard arrows move the boundary itself in LAYOUT.dividerStepWidth steps
 * with Home/End jumping to the bounds. Rendered only while its pane is
 * expanded; inert below Mantine sm through CSS.
 *
 * ## Why the drag is a plain object and not a React hook
 *
 * The *behaviour* is not React's; only the rendering is. {@link createDividerDrag}
 * is the whole of it, framework-free, and it is exported because a second
 * consumer needs the identical behaviour on a DOM node that React never
 * renders: the draggable divider in a rendered **Markdown page**
 * (`features/markdown/markdown-columns-divider.ts`), which lives inside an
 * `innerHTML` string that is replaced on every keystroke. A React island there
 * would mount and unmount continuously, and `createRoot` appears exactly once
 * in this app - there is no island infrastructure to hang one on.
 *
 * So there is one implementation, used two ways: this component binds it to
 * props, and the Markdown path binds it to delegated DOM listeners. The
 * document-level `layoutResizing` flag is set from inside the shared object, so
 * both paths get the transition suppression the app shell and sidebar rely on.
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

/**
 * Configuration for {@link createDividerDrag}. Every field is read on each
 * event rather than captured once, so a caller may hand over a stable object
 * whose getters change underneath it.
 */
export interface DividerDragConfig {
  /** The element that receives the pointer capture and the keyboard focus. */
  element: HTMLElement
  min: number
  max: number
  /** +1 grows with rightward drag (left pane); -1 grows with leftward drag. */
  direction: 1 | -1
  /**
   * Output units per pixel of pointer travel.
   *
   * `1` for a divider whose value is a pixel width. A divider whose value is a
   * **percentage** of a container passes `100 / containerWidth`, which is what
   * makes the same drag arithmetic correct for both: a drag across the
   * container is worth the full range.
   */
  unitsPerPixel: number
  /** Current value, read fresh on every event. */
  getValue: () => number
  /** Live value during a drag and on each keyboard step. */
  onChange: (value: number) => void
  /** Pointer-up and keyboard commit (persist the value). */
  onCommit: (value: number) => void
  /** Drag in progress. Drives the `data-dragging` attribute and its styling. */
  onDraggingChange?: (dragging: boolean) => void
}

/** A wired drag, ready to be bound to DOM events. */
export interface DividerDrag {
  pointerDown(event: PointerEvent): void
  pointerMove(event: PointerEvent): void
  /** Bound to pointerup, pointercancel and lostpointercapture alike. */
  pointerEnd(event: PointerEvent): void
  keyDown(event: KeyboardEvent): void
  /**
   * Ends any drag in progress and clears the document flag. A caller must
   * invoke this on teardown: a drag started on an unmounted divider would
   * otherwise leave `layoutResizing` set for the rest of the session.
   */
  cancel(): void
  isDragging(): boolean
}

/**
 * The document-level flag the app shell and sidebar read to suppress CSS
 * transitions while any pane is being dragged. Set from the shared drag object
 * so a Markdown column divider has the same effect as the shell's.
 */
function setResizingFlag(on: boolean): void {
  if (on) document.documentElement.dataset.layoutResizing = ''
  else delete document.documentElement.dataset.layoutResizing
}

/**
 * Builds the pointer-capture drag and keyboard stepping shared by every
 * draggable boundary in RTWiki.
 *
 * Exported rather than kept private because a Markdown page's column divider
 * has the same behaviour over a DOM node React does not own; see the note at
 * the top of this file.
 */
export function createDividerDrag(config: DividerDragConfig): DividerDrag {
  let drag: { pointerId: number; startX: number; startValue: number } | null = null

  const clamp = (next: number): number => Math.min(Math.max(next, config.min), config.max)

  const endDrag = (pointerId: number): void => {
    if (!drag || drag.pointerId !== pointerId) return
    drag = null
    setResizingFlag(false)
    config.onDraggingChange?.(false)
    config.onCommit(clamp(config.getValue()))
  }

  return {
    pointerDown(event) {
      if (event.button !== 0 || drag !== null) return
      event.preventDefault()
      config.element.setPointerCapture(event.pointerId)
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startValue: config.getValue()
      }
      setResizingFlag(true)
      config.onDraggingChange?.(true)
    },

    pointerMove(event) {
      if (!drag || drag.pointerId !== event.pointerId) return
      config.onChange(
        clamp(
          drag.startValue + config.direction * config.unitsPerPixel * (event.clientX - drag.startX)
        )
      )
    },

    pointerEnd(event) {
      endDrag(event.pointerId)
    },

    keyDown(event) {
      // A drag in progress owns the pointer; a key step during one would
      // desynchronise the two.
      if (drag !== null) return
      let next: number | null = null
      if (event.key === 'ArrowRight')
        next = config.getValue() + config.direction * LAYOUT.dividerStepWidth
      else if (event.key === 'ArrowLeft')
        next = config.getValue() - config.direction * LAYOUT.dividerStepWidth
      else if (event.key === 'Home') next = config.min
      else if (event.key === 'End') next = config.max
      if (next === null) return
      event.preventDefault()
      const clamped = clamp(next)
      config.onChange(clamped)
      config.onCommit(clamped)
    },

    cancel() {
      drag = null
      setResizingFlag(false)
      config.onDraggingChange?.(false)
    },

    isDragging() {
      return drag !== null
    }
  }
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

  // The drag object is built once and kept in a ref; the config it reads is
  // mutated in place on every render, so it always sees current props. That
  // mirrors the `valueRef` pattern below and keeps one stable object rather
  // than re-subscribing per prop change.
  const configRef = useRef<DividerDragConfig | null>(null)
  if (configRef.current === null) {
    configRef.current = {
      element: null as unknown as HTMLElement,
      min,
      max,
      direction,
      unitsPerPixel: 1,
      getValue: () => value,
      onChange,
      onCommit,
      onDraggingChange: setDragging
    }
  }
  const config = configRef.current
  config.min = min
  config.max = max
  config.direction = direction
  config.getValue = () => value
  config.onChange = onChange
  config.onCommit = onCommit
  const drag = useRef<DividerDrag>(createDividerDrag(config)).current

  // A drag started on an unmounted-then-removed divider must not leave the
  // flag set for the rest of the session.
  useEffect(() => {
    return () => {
      drag.cancel()
    }
  }, [drag])

  return (
    // Vertical pane dividers have no semantic HTML equivalent (<hr> is
    // horizontal and non-interactive); the WAI pattern for a resizable
    // boundary is a focusable separator with slider semantics.
    // biome-ignore lint/a11y/useSemanticElements: no semantic element models an interactive vertical pane divider
    <div
      // The ref callback assigns the node the drag object captures the pointer
      // on. Block-bodied so it does not return the node, which React 19 treats
      // as a cleanup function.
      ref={(node) => {
        config.element = node as HTMLElement
      }}
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
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) =>
        drag.pointerDown(event.nativeEvent)
      }
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) =>
        drag.pointerMove(event.nativeEvent)
      }
      onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => drag.pointerEnd(event.nativeEvent)}
      onPointerCancel={(event: ReactPointerEvent<HTMLDivElement>) =>
        drag.pointerEnd(event.nativeEvent)
      }
      onLostPointerCapture={(event: ReactPointerEvent<HTMLDivElement>) =>
        drag.pointerEnd(event.nativeEvent)
      }
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => drag.keyDown(event.nativeEvent)}
    >
      <div className={classes.line} aria-hidden="true" />
    </div>
  )
}
