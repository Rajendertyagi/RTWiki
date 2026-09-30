import { ActionIcon, Tooltip } from '@mantine/core'
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../../config/index.js'
import type { CSSVars } from '../../../style-props.js'
import classes from './diagram-view.module.css'

/**
 * The diagram's own view — zoom, pan, reset, full screen.
 *
 * ## Why this is shared
 *
 * Two surfaces render a diagram: the Diagram page's card and the Rich Note's block.
 * They had drifted so far apart that the same diagram looked like two different
 * things, and fixing one meant remembering the other. One component and one stylesheet,
 * used by both, so they cannot diverge again.
 *
 * ## Why this is not the block's size
 *
 * They are separate controls and deliberately do not affect each other. The block's
 * size is part of the document and is stored on the block; this is how one reader is
 * currently looking at the picture. Zooming does not resize the block and resizing the
 * block does not change the zoom, and nothing here is written to the document — a
 * reader who zooms in to read a wide diagram and reloads gets the diagram back at its
 * normal size, which is almost always what they want.
 */

/** How far one press of a pan arrow moves the picture. */
const PAN_STEP_PX = 40

/** Zoom is bounded so a diagram cannot be zoomed into nothing or blown past usefulness. */
const ZOOM_MIN = 0.2
const ZOOM_MAX = 6
const ZOOM_IN = 1.25
const ZOOM_OUT = 0.8

/**
 * Drawn icons rather than Mantine's icon set, so the cluster reads as one weight and
 * one shape language at 15px. The text characters this replaced looked like a row of
 * different punctuation.
 *
 * These are real elements, not markup injected with `dangerouslySetInnerHTML`. An
 * `ActionIcon` already supplies its own `children`, and React refuses an element
 * carrying both — it threw on mount and took the whole editor down with it, which is
 * a hard way to learn a rule.
 */
const ICONS = {
  up: <path d="M8 12.5V3.5M4 7.5 8 3.5l4 4" />,
  down: <path d="M8 3.5v9M4 8.5l4 4 4-4" />,
  left: <path d="M12.5 8h-9M7.5 4 3.5 8l4 4" />,
  right: <path d="M3.5 8h9M8.5 4l4 4-4 4" />,
  zoomIn: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14M7 5.2v3.6M5.2 7h3.6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 14 14M5.2 7h3.6" />
    </>
  ),
  reset: <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.6V5.4h2.8" />,
  fit: <path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />
} as const

type IconName = keyof typeof ICONS

function icon(name: IconName): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

interface ViewButtonProps {
  icon: IconName
  label: string
  onClick: () => void
  testId: string
}

function ViewButton({ icon: name, label, onClick, testId }: ViewButtonProps): JSX.Element {
  return (
    <Tooltip label={label} position="top" openDelay={400}>
      <ActionIcon
        variant="default"
        className={classes.button}
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
      >
        {icon(name)}
      </ActionIcon>
    </Tooltip>
  )
}

export interface DiagramViewProps {
  /** The diagram itself, already rendered. Goes inside the layer that moves. */
  children: ReactNode
  /** Test id stem, so the two surfaces can address their own controls. */
  testIdPrefix: string
}

export function DiagramView({ children, testIdPrefix }: DiagramViewProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, z: 1 })
  const [fullscreen, setFullscreen] = useState(false)

  const panBy = useCallback((dx: number, dy: number): void => {
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }, [])

  const zoomBy = useCallback((factor: number): void => {
    setView((v) => ({ ...v, z: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.z * factor)) }))
  }, [])

  const reset = useCallback((): void => {
    setView({ x: 0, y: 0, z: 1 })
  }, [])

  // Escape closes full screen, because that is what a full screen anything should do.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const layer = (
    <div
      ref={layerRef}
      className={classes.layer}
      // A custom property rather than a `transform` value: the project's rule (and
      // `tests/theme-registry.test.ts`) keeps inline style objects to custom
      // properties only, so the actual transform is applied in the stylesheet.
      // The offset and scale are genuine runtime values and cannot live in CSS.
      style={
        {
          '--view-x': `${view.x}px`,
          '--view-y': `${view.y}px`,
          '--view-scale': view.z
        } as CSSVars
      }
    >
      {children}
    </div>
  )

  const cluster = (
    <div className={classes.controls}>
      <ViewButton
        icon="up"
        label={UI_TEXT.diagramPanUpLabel}
        testId={`${testIdPrefix}-pan-up`}
        onClick={() => panBy(0, PAN_STEP_PX)}
      />
      <ViewButton
        icon="left"
        label={UI_TEXT.diagramPanLeftLabel}
        testId={`${testIdPrefix}-pan-left`}
        onClick={() => panBy(-PAN_STEP_PX, 0)}
      />
      <ViewButton
        icon="reset"
        label={UI_TEXT.diagramResetViewLabel}
        testId={`${testIdPrefix}-reset-view`}
        onClick={reset}
      />
      <ViewButton
        icon="down"
        label={UI_TEXT.diagramPanDownLabel}
        testId={`${testIdPrefix}-pan-down`}
        onClick={() => panBy(0, -PAN_STEP_PX)}
      />
      <ViewButton
        icon="zoomIn"
        label={UI_TEXT.diagramZoomInLabel}
        testId={`${testIdPrefix}-zoom-in`}
        onClick={() => zoomBy(ZOOM_IN)}
      />
      <ViewButton
        icon="right"
        label={UI_TEXT.diagramPanRightLabel}
        testId={`${testIdPrefix}-pan-right`}
        onClick={() => panBy(PAN_STEP_PX, 0)}
      />
      <ViewButton
        icon="zoomOut"
        label={UI_TEXT.diagramZoomOutLabel}
        testId={`${testIdPrefix}-zoom-out`}
        onClick={() => zoomBy(ZOOM_OUT)}
      />
      <ViewButton
        icon="fit"
        label={UI_TEXT.diagramFullScreenLabel}
        testId={`${testIdPrefix}-full-screen`}
        onClick={() => setFullscreen(true)}
      />
    </div>
  )

  return (
    <div className={classes.host}>
      {layer}
      {cluster}
      {fullscreen ? (
        // The layer is *moved* in here rather than copied, so whatever zoom and pan
        // the reader had set is exactly what they come back to on close.
        <div className={classes.fullscreen} data-testid={`${testIdPrefix}-full-screen-open`}>
          {layer}
          <ActionIcon
            variant="default"
            className={classes.fullscreenClose}
            aria-label={UI_TEXT.diagramCloseFullScreenLabel}
            data-testid={`${testIdPrefix}-full-screen-close`}
            onClick={() => setFullscreen(false)}
          >
            {icon('close')}
          </ActionIcon>
        </div>
      ) : null}
    </div>
  )
}
