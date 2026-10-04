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
 *
 * The other end of the range is `1`, and that is not a fallback value: a picture the
 * layout has already fitted to the overlay has nothing to gain, and `1` is the correct
 * answer for it. See `fitToScreen`.
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

  /**
   * The reader's own magnification, readable from inside a stable callback.
   *
   * `fitToScreen` must not close over `view`, or it would be a new function on every
   * pan and its effect would re-run — and re-running it is what re-derives fit. A ref
   * keeps the callback identity constant while the value stays current.
   */
  const viewRef = useRef(view)
  viewRef.current = view

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
      // has no idea `--view-fit` or `--view-fit-offset` exist and will never clear
      // them. Left behind, they multiply into the transform in the box as well and the
      // diagram comes back from full screen enormously magnified, offset and cropped -
      // which is the very symptom this work is fixing, reintroduced by the fix.
      layer.style.removeProperty('--view-fit')
      layer.style.removeProperty('--view-fit-offset')
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
   * The extra scale full screen applies so the diagram actually fills the screen, and
   * the centring that goes with it. Both are written only while full screen is open and
   * removed with it, so the box view is untouched.
   *
   * ## The contract
   *
   * **Fit is the scale at which the picture fills the viewport on its limiting axis.**
   * That is the whole of it, and it is derived from two numbers: the overlay's size and
   * the picture's size. There is no constant, no margin and no remembered value.
   *
   * Three properties make that contract deterministic, and each replaces a measured
   * failure:
   *
   * 1. **Measured from the picture's LAYOUT box, not its painted box.**
   *    `clientWidth`/`clientHeight` on the `<svg>` are layout metrics and are unaffected
   *    by `transform`; `getBoundingClientRect()` is not. The previous version measured
   *    the rect, so the reader's own zoom was inside the measurement: at a 1.25 zoom on a
   *    wide diagram the ratio fell to 0.80, was clamped to `1`, and fit silently did
   *    nothing at all. Fit is a property of the drawing and the screen, so it must not
   *    contain the reader's magnification. `clientWidth` is on `Element`, so it exists on
   *    an inline `<svg>` (measured: 196x168 for a two-node flowchart); `offsetWidth` does
   *    **not** — that is `HTMLElement` only, and reads `undefined` here.
   *
   * 2. **Clamped to [1, FULLSCREEN_FIT_MAX], so it can only ever make a diagram
   *    bigger.** `1` is the "it already fills the screen" answer, which is a real answer
   *    and now a deterministic one: a wide diagram is capped to the overlay's width by
   *    `max-width: 100%` before fit is computed, so it genuinely has nothing to gain and
   *    fit is exactly `1`. The upper bound is the existing product decision that a
   *    two-node flowchart is a 200px drawing and scaling it to a 4K screen turns its
   *    labels into furniture.
   *
   * 3. **Composed with the reader's zoom, never substituted for it.** `--view-fit`
   *    multiplies into the same `scale()` as `--view-scale`, so the effective
   *    magnification is exactly `viewScale x fit` — one product, both terms known, both
   *    readable from the computed matrix.
   *
   * ## Centring, and why it cannot break reachability
   *
   * The scale is applied with `transform-origin: 0 0` (see `diagram-view.module.css`,
   * and the note there on why the origin cannot be the centre), so a fitted picture
   * grows from the overlay's top-left and would otherwise sit in that corner with a band
   * of empty screen beside it. "Fills the screen" with the content jammed into one
   * corner is not filling the screen.
   *
   * The offset is therefore chosen in **painted** space, because that is where the
   * requirement lives:
   *
   *     paintedStart = max(0, (viewport - paintedSize) / 2)      per axis
   *
   * i.e. centre the picture, and when it is too big to centre, put its start edge on the
   * start edge of the screen. That `max(0, …)` is what keeps F1 true: it is the only
   * place a value is clamped, and what it clamps is the picture's **start** coordinate to
   * 0, so every pixel of overflow stays end-side and reachable by scrolling. Measured
   * reachability in full screen is unchanged; see `diagram-zoom-reachability.pwspec.ts`.
   *
   * Turning that into the custom property needs one number the transform hides: the
   * picture's own origin inside the layer. It is not `(0, 0)`, and it is not derivable
   * from the styles - `.layer` centres its child, the Diagram page's `.blockCanvas` and
   * `.svgInner` centre again, and the Rich Note's `.svgHost` centres a third way. So it
   * is measured, with the fit cleared for one synchronous read: both writes and both
   * reads land before the browser paints, so an unfitted picture is never displayed.
   * Assuming `(0, 0)` instead - which needs no measurement at all - puts a 4x-fitted
   * 196px picture at a left offset of **2816px** in a 1440px overlay, four fifths of it
   * off the screen.
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
    const viewportWidth = overlay.clientWidth
    const viewportHeight = overlay.clientHeight
    if (viewportWidth <= 0 || viewportHeight <= 0) return
    // Layout metrics: unaffected by the transform, unlike the bounding rect.
    const layoutWidth = picture.clientWidth
    const layoutHeight = picture.clientHeight
    if (layoutWidth <= 0 || layoutHeight <= 0) return

    const { x: panX, y: panY, z: scale } = viewRef.current

    // The picture's origin inside the layer, read with the fit neutralised so that the
    // only remaining transform is the reader's own, whose magnification is known.
    layer.style.setProperty('--view-fit', '1')
    layer.style.setProperty('--view-fit-offset', '0px, 0px')
    const layerBox = layer.getBoundingClientRect()
    const pictureBox = picture.getBoundingClientRect()
    const originX = (pictureBox.left - layerBox.left - panX) / scale
    const originY = (pictureBox.top - layerBox.top - panY) / scale

    const raw = Math.min(
      viewportWidth / layoutWidth,
      viewportHeight / layoutHeight,
      FULLSCREEN_FIT_MAX
    )
    const fit = Math.max(1, Math.round(raw * 1000) / 1000)
    // The reader's magnification composed with the screen fit: one product, which is
    // exactly what `--view-scale * --view-fit` evaluates to inside the `scale()`.
    const total = fit * scale

    // Comma-separated, because `translate()` takes its two values that way. See the
    // note on `transform` in `diagram-view.module.css`.
    const startX = Math.max(0, Math.round((viewportWidth - layoutWidth * total) / 2))
    const startY = Math.max(0, Math.round((viewportHeight - layoutHeight * total) / 2))
    layer.style.setProperty('--view-fit', String(fit))
    layer.style.setProperty(
      '--view-fit-offset',
      `${Math.round(startX - panX - total * originX)}px, ${Math.round(startY - panY - total * originY)}px`
    )
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
