import { ActionIcon, Tooltip } from '@mantine/core'
import {
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
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

/**
 * Y axis points down, so "up" is a negative offset.
 *
 * The two vertical arrows were the other way round: measured, one press of pan-up
 * set `--view-y` to `40px`, which moves the picture **down**, and pan-down set it to
 * `-40px`, which moves it up. Left and right were correct, which is why the fault
 * looked like a rendering problem rather than a swapped pair of signs.
 */
const PAN_UP_Y = -PAN_STEP_PX
const PAN_DOWN_Y = PAN_STEP_PX

/** Zoom is bounded so a diagram cannot be zoomed into nothing or blown past usefulness. */
const ZOOM_MIN = 0.2
const ZOOM_MAX = 6
const ZOOM_IN = 1.25
const ZOOM_OUT = 0.8

/**
 * Ceiling on the automatic full-screen fit.
 *
 * Full screen scales the picture up to fill the window, but a two-node flowchart is
 * a 200px drawing and scaling it to a 4K screen turns its labels into furniture.
 * Capped so full screen always makes a diagram *bigger and never absurd*, which is
 * what the user asked it for; the zoom buttons cover the rest, and they are in the
 * overlay.
 */
const FULLSCREEN_FIT_MAX = 4

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
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
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

  /**
   * Moves the one layer node in and out of the full-screen overlay.
   *
   * ## Why the node is moved rather than rendered twice
   *
   * The first version rendered the same React element in both places. React mounts
   * it twice, so the document held **two copies of the diagram** while full screen
   * was open, and Mermaid's output is full of `id` attributes that its own markers
   * and clip paths are referenced by. Measured with full screen open on one
   * flowchart: 24 element ids present twice. The second copy's `url(#...)`
   * references resolve to the first copy's definitions, so the two renderings are
   * not independent of each other at all.
   *
   * There is one node, and it is re-parented. The picture is therefore literally
   * the same DOM in the box and on the screen, which is what makes "come back to it
   * exactly as it was" true by construction rather than by keeping two copies in
   * step.
   *
   * ## Why the stage is pinned while the node is away
   *
   * The layer is the only thing giving the block its height, so moving it out would
   * collapse the block behind the overlay and the box would come back a different
   * size. The stage therefore holds the height the layer had at the moment of
   * opening, written as a custom property (the project's rule, and
   * `tests/theme-registry.test.ts`, keep inline style objects to custom properties).
   * It is removed on close, so nothing is pinned in the steady state.
   */
  useLayoutEffect(() => {
    const stage = stageRef.current
    const layer = layerRef.current
    if (stage === null || layer === null) return
    if (!fullscreen) {
      stage.style.removeProperty('--stage-height')
      // The screen fit goes too, and it has to be removed **explicitly**. React owns
      // the three properties in this element's `style` prop and rewrites those, but it
      // has no idea `--view-fit` exists and will never clear it. Left behind, it
      // multiplies into the transform in the box as well and the diagram comes back
      // from full screen enormously magnified and cropped - which is the very symptom
      // this work is fixing, reintroduced by the fix.
      layer.style.removeProperty('--view-fit')
      if (layer.parentElement !== stage) stage.appendChild(layer)
      return
    }
    const overlay = overlayRef.current
    if (overlay === null) return
    stage.style.setProperty(
      '--stage-height',
      `${Math.round(layer.getBoundingClientRect().height)}px`
    )
    overlay.appendChild(layer)
  }, [fullscreen])

  /**
   * The extra scale full screen applies so the diagram actually fills the screen.
   *
   * Measured before this existed: at a 1600x950 window the overlay covered the
   * whole viewport and the diagram sat in the middle of it at 426x414, unchanged
   * from its size in the box. "Full screen" was a big empty canvas.
   *
   * The scale is measured against the picture's **current laid-out box** rather than
   * its natural size, because the layout already caps the picture at the container
   * (`max-width: 100%` on the SVG). Measuring the natural size as well would apply
   * that cap twice and overshoot. `--view-fit` is multiplied into the same transform
   * as the reader's own zoom, so the two compose instead of fighting, and it is
   * dropped on close along with the rest of the overlay.
   */
  const fitToScreen = useCallback((): void => {
    const layer = layerRef.current
    const overlay = overlayRef.current
    if (layer === null || overlay === null) return
    // The first `svg` inside the layer is the diagram. The control icons are a
    // sibling of the layer, not a descendant, so they cannot be reached from here,
    // and Mermaid's own output nests no `svg` before the root one.
    const picture = layer.querySelector('svg') as SVGElement | null
    if (picture === null) return
    // Measure with the previous fit removed, or the second measurement compounds the
    // first. Both writes land before the browser paints.
    layer.style.setProperty('--view-fit', '1')
    const box = picture.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return
    const overlayBox = overlay.getBoundingClientRect()
    if (overlayBox.width <= 0 || overlayBox.height <= 0) return
    const fit = Math.min(
      overlayBox.width / box.width,
      overlayBox.height / box.height,
      FULLSCREEN_FIT_MAX
    )
    layer.style.setProperty('--view-fit', fit > 1 ? String(Math.round(fit * 1000) / 1000) : '1')
  }, [])

  // Refit whenever full screen opens, and whenever the window changes size while it
  // is open. The observer is only attached while it is, so a page full of diagrams
  // is not watching the viewport for nothing.
  useEffect(() => {
    if (!fullscreen) return
    fitToScreen()
    const overlay = overlayRef.current
    if (overlay === null) return
    const observer = new ResizeObserver(fitToScreen)
    observer.observe(overlay)
    return () => observer.disconnect()
  }, [fullscreen, fitToScreen])

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

  /**
   * The eight buttons, as one element.
   *
   * Rendered in the box and again in the full-screen overlay. They hold no state of
   * their own, they drive the one `view` value, and the overlay had **none at all**
   * before this: measured, zero zoom buttons inside the overlay. That is what made
   * full screen a dead end. The one control that must not be duplicated is the
   * full-screen trigger itself, which is why it is passed in rather than always
   * drawn.
   */
  const controls = (withFullScreen: boolean): JSX.Element => (
    <div className={classes.controls}>
      <ViewButton
        icon="up"
        label={UI_TEXT.diagramPanUpLabel}
        testId={`${testIdPrefix}-pan-up`}
        onClick={() => panBy(0, PAN_UP_Y)}
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
        onClick={() => panBy(0, PAN_DOWN_Y)}
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
      {withFullScreen ? (
        <ViewButton
          icon="fit"
          label={UI_TEXT.diagramFullScreenLabel}
          testId={`${testIdPrefix}-full-screen`}
          onClick={() => setFullscreen(true)}
        />
      ) : null}
    </div>
  )

  return (
    <div className={classes.host} ref={hostRef}>
      {/* The stage is what holds the layer. It is a plain wrapper rather than the
       * host itself so the layer can be lifted out of it for full screen while the
       * block keeps the height the layer gave it. */}
      <div className={classes.stage} ref={stageRef}>
        {layer}
      </div>
      {controls(true)}
      {fullscreen ? (
        <div
          className={classes.fullscreen}
          ref={overlayRef}
          data-testid={`${testIdPrefix}-full-screen-open`}
        >
          {/* The layer is appended here by the effect above, and put back on close.
           * It is deliberately not a child in the markup: rendering it in both
           * places at once is what produced two copies of the diagram and 24
           * duplicated element ids. */}
          {controls(false)}
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
