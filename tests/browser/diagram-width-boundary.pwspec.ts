import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * One authoritative width boundary.
 *
 * ## What is being proved
 *
 * A block's width is bounded by exactly one thing: the CSS `max-width: 100%` on
 * `.sizeContainer`, which resolves against **its containing block's content box**. The
 * resize system used to consult a *second* authority — `widthCeiling`, which walked to
 * the nearest `overflow-y: auto` ancestor and subtracted a hardcoded `2`.
 *
 * On a Rich Note that second authority landed on `.blockNoteWrapper`, whose content box
 * measured **788px at a 1440px window while the note's text column was 662px**. The drag
 * clamped to 788, published it, and CSS drew 662: for the whole gesture the system
 * believed 126px more width existed than the page could show, and dragging outwards read
 * as a dead handle. On the Diagram page the same `- 2` left the drag 2px short of the row
 * it was allowed to fill.
 *
 * ## Why the boundary is not the block's parent on both surfaces
 *
 * It usually is, and where it is not, the parent is **sized by the block itself**:
 *
 * - **Rich Note.** `.sizeContainer` sits in `.previewPane`, which is `width: 100%`. Its
 *   content box comes from the text column and is independent of the block, so it is the
 *   boundary. One level up.
 * - **Diagram page.** `.sizeContainer` sits in Motion's `Reorder.Item`, whose width is
 *   `var(--block-width-live, var(--block-width, auto))` — the block's own size, written
 *   back onto it. Clamping to it would forbid all growth. The boundary is the wrapping
 *   flex row, one level further up.
 *
 * So each surface states **which ancestor** holds the boundary, and the tests assert that
 * the one it names is not sized by the block while the one it skips is. That keeps the
 * expectation physical and per-surface instead of restating the implementation.
 *
 * Every assertion here reads rendered geometry. `data-width`, an inline custom property
 * and a class name are all read only as *what the system asked for*, always next to the
 * width the box actually drew.
 */

const DIAGRAM = [
  'flowchart LR',
  '  A[Alpha] --> B[Beta]',
  '  B --> C[Gamma]',
  '  C --> D[Delta]',
  '  D --> E[Epsilon]',
  '  E --> F[Zeta]',
  '  F --> G[Eta]',
  '  G --> H[Theta]',
  '  H --> I[Iota]',
  '  I --> J[Kappa]'
].join('\n')

/** The preset that asks for 960px, wider than both surfaces allow at most viewports. */
const PRESET_LARGE_WIDTH = 960

const VIEWPORTS = [
  { width: 1600, height: 950 },
  { width: 1440, height: 900 },
  { width: 700, height: 800 }
]

interface Surface {
  name: string
  seed: (request: APIRequestContext, title: string, block: Record<string, unknown>) => Promise<void>
  container: string
  handle: string
  svg: string
  hover: string
  presetLarge: string
  /**
   * Levels from the container up to the ancestor that bounds it: 1 on a Rich Note, whose
   * text column is the immediate parent, and 2 on the Diagram page, whose `Reorder.Item`
   * shrink-wraps the block so the wrapping row one level higher is the real boundary.
   */
  boundaryLevels: number
  /** Whether such a shrink-wrapping element exists at all: the note has none. */
  hasSizedByBlockAncestor: boolean
}

const RICH: Surface = {
  name: 'rich note',
  seed: async (request, title, block) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'rich',
        content: JSON.stringify([
          { id: 'd', type: 'diagram', content: DIAGRAM, props: { width: '', height: '', ...block } }
        ])
      }
    })
    expect(res.status()).toBe(201)
  },
  container: '[data-testid="diagram-container"]',
  handle: 'diagram-resize-handle',
  svg: '[data-testid="diagram-svg"] svg',
  hover: '[data-testid="diagram-preview"]',
  presetLarge: 'diagram-preset-large',
  boundaryLevels: 1,
  hasSizedByBlockAncestor: false
}

const DIAGRAM_PAGE: Surface = {
  name: 'diagram page',
  seed: async (request, title, block) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: [{ id: 'a', source: DIAGRAM, ...block }]
        })
      }
    })
    expect(res.status()).toBe(201)
  },
  container: '[data-testid="diagram-block-0-container"]',
  handle: 'diagram-block-0-resize-handle',
  svg: '[data-testid="diagram-block-0-svg"] svg',
  hover: '[data-testid="diagram-block-0-container"]',
  presetLarge: 'diagram-block-0-preset-large',
  boundaryLevels: 2,
  hasSizedByBlockAncestor: true
}

const SURFACES = [RICH, DIAGRAM_PAGE]

interface BoundaryReading {
  /** The content box of the ancestor this surface names as the boundary. */
  boundary: number
  boundaryClass: string
  /** Whether the element in between carries the block's own size once it has one. */
  intermediateCarriesBlockSize: boolean
  /** `max-width` on the container, i.e. the rule CSS is actually enforcing. */
  cssMaxWidth: string
  containerWidth: number
}

/**
 * The boundary this surface must land on, read **without** the app's help.
 *
 * A fixed ancestor per surface, named because it is a fact about the layout rather than a
 * number anyone chose: the note's text column is the block's immediate parent, and the
 * Diagram page's wrapping row is its grandparent because the item in between shrink-wraps
 * the block. Nothing here asks the application where its own boundary is, so the two
 * numbers are independent.
 */
async function readBoundary(page: Page, surface: Surface): Promise<BoundaryReading> {
  return await page.locator(surface.container).evaluate(
    (el, cfg) => {
      function up(levels: number): Element | null {
        let e: Element | null = el
        for (let i = 0; i < levels; i++) {
          if (e === null) return null
          e = e.parentElement
        }
        return e
      }
      const contentBox = (node: Element | null): number => {
        if (node === null) return -1
        const cs = getComputedStyle(node)
        const pad =
          (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
        return (node as HTMLElement).clientWidth - pad
      }
      const boundaryNode = up(cfg.levels)
      // The element in between is written the block's own width once it has one, which is
      // precisely why it cannot be the boundary.
      const inline = (up(1) as HTMLElement | null)?.style
      const intermediateCarriesBlockSize =
        inline !== undefined &&
        (inline.getPropertyValue('--block-width').trim() !== '' ||
          inline.getPropertyValue('--block-width-live').trim() !== '')
      return {
        boundary: contentBox(boundaryNode),
        boundaryClass:
          boundaryNode === null ? '' : (boundaryNode.getAttribute('class') ?? '').split(' ')[0],
        intermediateCarriesBlockSize,
        cssMaxWidth: getComputedStyle(el).maxWidth,
        containerWidth: Math.round(el.getBoundingClientRect().width)
      }
    },
    { levels: surface.boundaryLevels }
  )
}

interface Frame {
  rendered: number
  /** Every px width the resize system published, in flight or committed. */
  reported: number[]
  dataWidth: string
}

/** Starts a per-frame recorder of what was asked for and what was drawn. */
async function startSampling(page: Page, surface: Surface): Promise<void> {
  await page.evaluate((sel) => {
    const w = window as unknown as { __frames?: Frame[] }
    const rows: Frame[] = []
    w.__frames = rows
    const container = document.querySelector(sel)
    if (container === null) throw new Error('no container')
    const t0 = performance.now()
    const tick = (): void => {
      const reported: number[] = []
      let node: Element | null = container
      while (node !== null) {
        const inline = (node as HTMLElement).style
        for (const name of ['--block-width', '--block-width-live']) {
          const raw = inline.getPropertyValue(name).trim()
          if (raw.endsWith('px')) {
            const px = Number.parseFloat(raw)
            if (Number.isFinite(px)) reported.push(Math.round(px))
          }
        }
        node = node.parentElement
      }
      rows.push({
        rendered: Math.round(container.getBoundingClientRect().width),
        reported,
        dataWidth: container.getAttribute('data-width') ?? ''
      })
      if (performance.now() - t0 < 2600) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, surface.container)
}

async function collectFrames(page: Page): Promise<Frame[]> {
  return await page.evaluate(() => (window as unknown as { __frames?: Frame[] }).__frames ?? [])
}

async function hoverHost(page: Page, surface: Surface): Promise<void> {
  const box = await page.locator(`${surface.container} [class*="_host_"]`).first().boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(260)
}

async function dragHandle(
  page: Page,
  surface: Surface,
  dx: number,
  steps = 10,
  pause = 25
): Promise<void> {
  const handle = page.getByTestId(surface.handle)
  await handle.scrollIntoViewIfNeeded()
  const box = await handle.boundingBox()
  if (box === null) throw new Error('the resize handle is not visible')
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y)
    await page.waitForTimeout(pause)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

async function openSurface(page: Page, title: string, surface: Surface): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  await expect(page.locator(surface.svg).first()).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(800)
}

async function widthOf(page: Page, surface: Surface): Promise<number> {
  return await page
    .locator(surface.container)
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))
}

async function storedWidth(page: Page, surface: Surface): Promise<number> {
  const raw = await page.locator(surface.container).getAttribute('data-width')
  return raw === null || raw === '' ? Number.NaN : Number(raw)
}

for (const surface of SURFACES) {
  for (const viewport of VIEWPORTS) {
    const where = `${surface.name} at ${String(viewport.width)}x${String(viewport.height)}`

    test.describe(where, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport)
      })

      test.afterEach(async ({ request }) => {
        await purgeUntitledPages(request)
      })

      test('the boundary is the same box whether the block is sized or not', async ({
        page,
        request
      }) => {
        const title = `Boundary ${Date.now()}`
        await surface.seed(request, title, {})
        await openSurface(page, title, surface)

        // --- with the block unsized.
        const unsized = await readBoundary(page, surface)
        // The rule CSS enforces is the percentage that resolves against this box, and the
        // box is a real one.
        expect(unsized.cssMaxWidth, 'the container is bounded by max-width: 100%').toBe('100%')
        expect(unsized.boundary, 'a real, positive boundary').toBeGreaterThan(200)
        expect(unsized.boundaryClass, 'and it is a named element, not the document').not.toBe('')
        // An unsized block has no width of its own, so it fills the boundary exactly.
        expect(
          Math.abs(unsized.containerWidth - unsized.boundary),
          `an unsized block fills its ${String(unsized.boundary)}px boundary exactly, drew ${String(unsized.containerWidth)}`
        ).toBeLessThanOrEqual(1)

        // --- now size it, which is when the Diagram page's item starts carrying the
        // block's own width and stops being an independent constraint.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        const sized = await readBoundary(page, surface)
        expect(
          Math.abs(sized.containerWidth - unsized.boundary),
          'the block really did get narrower, so the next reading means something'
        ).toBeGreaterThan(150)
        if (surface.hasSizedByBlockAncestor) {
          expect(
            sized.intermediateCarriesBlockSize,
            "once sized, the immediate parent is written the block's own width and must never be mistaken for the boundary"
          ).toBe(true)
        }

        // The invariant that matters, and the one a boundary computed from the block's own
        // width would break: **the same number either way**.
        expect(
          sized.boundary,
          `the boundary must not move when the block is sized: ${String(unsized.boundary)} unsized, ${String(sized.boundary)} sized. A boundary derived from the block's own width collapses to the block's width and forbids all growth.`
        ).toBe(unsized.boundary)
      })

      test('the width the resize asks for never exceeds the width the block draws', async ({
        page,
        request
      }) => {
        const title = `Agrees ${Date.now()}`
        await surface.seed(request, title, {})
        await openSurface(page, title, surface)
        const boundary = (await readBoundary(page, surface)).boundary

        // Narrow it, so a rightward drag has room to run past the boundary.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        const narrow = await widthOf(page, surface)
        expect(narrow, `the block should have narrowed from the boundary`).toBeLessThan(
          boundary - 150
        )

        await startSampling(page, surface)
        // As far right as the pointer can physically travel, which is well past the
        // boundary at every viewport.
        await hoverHost(page, surface)
        await dragHandle(page, surface, 2400, 12, 30)
        const frames = await collectFrames(page)
        expect(frames.length, 'the sampler must have recorded frames').toBeGreaterThan(10)
        const moving = frames.filter((f) => f.rendered >= narrow)
        expect(moving.length, 'frames from the widening part of the drag').toBeGreaterThan(5)

        // The core of the defect: the system asking for more width than the page draws.
        const overreach: string[] = []
        for (const [i, f] of moving.entries()) {
          const asked = f.reported.length === 0 ? 0 : Math.max(...f.reported)
          if (asked > f.rendered + 1) {
            overreach.push(`frame ${String(i)}: asked ${String(asked)}, drew ${String(f.rendered)}`)
          }
        }
        expect(
          overreach,
          `every published width must be one the block can actually draw (boundary ${String(boundary)}) — ${JSON.stringify(moving.slice(0, 12))}`
        ).toEqual([])

        // The two must also track each other, or the assertion above is vacuous.
        const widest = Math.max(...moving.map((f) => f.rendered))
        expect(widest, 'the drag should have reached the boundary').toBeGreaterThan(narrow + 150)
        expect(widest, 'and no further').toBeLessThanOrEqual(boundary + 1)

        // And the committed value is the boundary, exactly: not the boundary minus the
        // hardcoded 2 the old ceiling subtracted.
        const drawn = await widthOf(page, surface)
        expect(
          Math.abs(drawn - boundary),
          `the block must end on its ${String(boundary)}px boundary, drew ${String(drawn)}`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs((await storedWidth(page, surface)) - drawn),
          'the stored width must be the width the block draws'
        ).toBeLessThanOrEqual(1)
      })

      test('the boundary is reachable by keyboard and by preset, and the maximum survives a reload', async ({
        page,
        request
      }) => {
        const title = `Ceiling ${Date.now()}`
        await surface.seed(request, title, {})
        await openSurface(page, title, surface)
        const boundary = (await readBoundary(page, surface)).boundary

        // --- the keyboard, which adds a fixed step however far the pointer could go.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        const narrow = await widthOf(page, surface)
        expect(
          narrow,
          `the block must start below its ${String(boundary)}px boundary`
        ).toBeLessThan(boundary - 150)
        // One press per commit. Each key press re-measures the box and commits a new
        // stored width, so a burst faster than React commits reads the same stale
        // measurement repeatedly and grows the block by a fraction of a step - measured
        // at 700x800: 24 presses with no pause moved a 246px block to 256px, while the
        // same 24 presses paced at 150ms took it 246 -> 268 -> 299 -> ... -> 646, the
        // boundary, and then held there. That is a property of the test harness, not of
        // the keyboard, and pacing is what a person does anyway.
        const paced = 150
        const readings: number[] = []
        let unchanged = 0
        for (let i = 0; i < 60 && unchanged < 3; i++) {
          const before = await widthOf(page, surface)
          await page.getByTestId(surface.handle).focus()
          await page.keyboard.press('ArrowRight')
          await page.waitForTimeout(paced)
          const after = await widthOf(page, surface)
          readings.push(after)
          unchanged = Math.abs(after - before) <= 1 ? unchanged + 1 : 0
        }
        const keyed = await widthOf(page, surface)
        expect(
          Math.abs(keyed - boundary),
          `Arrow Right must stop exactly on the ${String(boundary)}px boundary from ${String(narrow)}; it stopped at ${String(keyed)} after ${readings.join(',')}`
        ).toBeLessThanOrEqual(1)

        // --- a preset wider than the boundary stores the width it can be drawn at.
        await hoverHost(page, surface)
        await page.getByTestId(surface.presetLarge).click()
        await page.waitForTimeout(600)
        const preset = await storedWidth(page, surface)
        const presetDrawn = await widthOf(page, surface)
        const expected = Math.min(PRESET_LARGE_WIDTH, boundary)
        expect(
          Math.abs(preset - expected),
          `the ${String(PRESET_LARGE_WIDTH)}px preset must store ${String(expected)} at this viewport, stored ${String(preset)}`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(presetDrawn - preset),
          `stored ${String(preset)} but drew ${String(presetDrawn)}`
        ).toBeLessThanOrEqual(1)

        // --- and it is still there after a reload, which is the persisted half.
        // The autosave is debounced by `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` (2000ms), so a
        // reload sooner than that would be testing the debounce rather than persistence -
        // the same wait `diagram-block-resize-geometry.pwspec.ts` uses.
        await page.waitForTimeout(2500)
        await page.reload()
        await expect(page.locator(surface.svg).first()).toBeVisible({ timeout: 25_000 })
        await page.waitForTimeout(800)
        const reloaded = await widthOf(page, surface)
        expect(
          Math.abs((await storedWidth(page, surface)) - expected),
          `the reload must restore the ${String(expected)}px the preset stored`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(reloaded - expected),
          `and draw it: reloaded at ${String(reloaded)}`
        ).toBeLessThanOrEqual(1)
      })
    })
  }
}
