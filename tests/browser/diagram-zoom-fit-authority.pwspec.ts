import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * One authoritative zoom, and a full-screen fit that is a real fit.
 *
 * ## Zoom: exactly one multiplier
 *
 * A diagram was magnified two ways on the Diagram page and one way on a Rich Note:
 *
 *   page:     diagram-zoom-in / -out / label  ->  --zoom-level  ->  .zoomHost  (50-200%)
 *   block:    DiagramView zoom-in / -out      ->  --view-scale  ->  .layer      (20-600%)
 *
 * They composed multiplicatively, with different ranges, no way to see the product, and
 * the lower half of the page range inert because `.zoomHost` carried `min-width: 100%` —
 * measured: at `--zoom-level: 50%` the host's `offsetWidth` was unchanged. The Rich Note's
 * equivalent legacy zoom had already been removed as a duplicate, which is what left the
 * Diagram page inconsistent with it.
 *
 * `DiagramView`'s `--view-scale` is the authority: it is the only zoom with a pan, a full
 * screen, a reset and a documented 20-600% range, and the only one whose reachability is
 * proved. These tests measure the **effective** scale — painted width over layout width,
 * which is what a reader actually sees — and require it to equal the single declared
 * value. A second multiplier anywhere shows up as a difference between the two.
 *
 * ## Fit: the scale at which the drawing fills the screen
 *
 * `--view-fit` was measured against the picture's *painted* box, so the reader's own zoom
 * was inside the measurement: a 1.25 zoom on a wide diagram produced a ratio of 0.80,
 * was clamped to 1, and fit silently did nothing. It is now measured from the picture's
 * **layout** box (`clientWidth`, transform-independent) against the **overlay's** box, so
 * fit is a property of the drawing and the screen and the two compose instead of one
 * cancelling the other. The composed magnification is exactly `viewScale x fit`, and the
 * painted start is `max(0, (viewport - painted) / 2)` per axis: centred when it fits, and
 * anchored at the start edge when it does not, which is what keeps the four edges
 * reachable.
 */

const WIDE = [
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

/** A two-node flowchart: 196x168 laid out, which full screen has to magnify. */
const SMALL = 'flowchart TD\n  A[Start] --> B[End]'

/** `FULLSCREEN_FIT_MAX`, and the whole of the automatic fit range. */
const FIT_MAX = 4
const FIT_MIN = 1
/** `ZOOM_MIN` / `ZOOM_MAX` on `DiagramView`. */
const ZOOM_MIN = 0.2
const ZOOM_MAX = 6

const VIEWPORTS = [
  { width: 1600, height: 950 },
  { width: 1440, height: 900 },
  { width: 700, height: 800 }
]

interface Surface {
  name: string
  seedBlocks: (request: APIRequestContext, title: string, sources: string[]) => Promise<void>
  container: string
  layer: string
  svg: string
  hover: string
  zoomIn: string
  zoomOut: string
  reset: string
  fullScreen: string
  overlay: string
}

function surfaces(prefix: string, svgIndex = 0): Surface[] {
  return [
    {
      name: 'rich note',
      seedBlocks: async (request, title, sources) => {
        const res = await request.post('/api/pages', {
          data: {
            title,
            pageType: 'rich',
            content: JSON.stringify(
              sources.map((content, i) => ({
                id: `d${String(i)}`,
                type: 'diagram',
                content,
                props: { width: '', height: '' }
              }))
            )
          }
        })
        expect(res.status()).toBe(201)
      },
      container: '[data-testid="diagram-container"]',
      layer: '[data-testid="diagram-container"] [class*="_layer_"]',
      svg: '[data-testid="diagram-svg"] svg',
      hover: '[data-testid="diagram-preview"]',
      zoomIn: 'note-view-zoom-in',
      zoomOut: 'note-view-zoom-out',
      reset: 'note-view-reset-view',
      fullScreen: 'note-view-full-screen',
      overlay: '[data-testid="note-view-full-screen-open"]'
    },
    {
      name: 'diagram page',
      seedBlocks: async (request, title, sources) => {
        const res = await request.post('/api/pages', {
          data: {
            title,
            pageType: 'diagram',
            content: JSON.stringify({
              version: 2,
              type: 'diagram',
              blocks: sources.map((source, i) => ({ id: String.fromCharCode(97 + i), source }))
            })
          }
        })
        expect(res.status()).toBe(201)
      },
      container: `[data-testid="diagram-block-${String(svgIndex)}-container"]`,
      layer: `[data-testid="diagram-block-${String(svgIndex)}-container"] [class*="_layer_"]`,
      svg: `[data-testid="diagram-block-${String(svgIndex)}-svg"] svg`,
      hover: `[data-testid="diagram-block-${String(svgIndex)}-container"]`,
      zoomIn: `diagram-block-${String(svgIndex)}-zoom-in`,
      zoomOut: `diagram-block-${String(svgIndex)}-zoom-out`,
      reset: `diagram-block-${String(svgIndex)}-reset-view`,
      fullScreen: `diagram-block-${String(svgIndex)}-full-screen`,
      overlay: `[data-testid="diagram-block-${String(svgIndex)}-full-screen-open"]`
    }
  ]
}

interface ScaleReading {
  /** The one declared zoom. */
  declared: number
  /** Painted width over layout width: what a reader sees, transform included. */
  effective: number
  /** The `scale()` argument Chromium computed, i.e. `view-scale x view-fit`. */
  matrixScale: number
  fit: number
  layoutWidth: number
  paintedWidth: number
  transformOrigin: string
}

async function readScale(page: Page, surface: Surface): Promise<ScaleReading> {
  return await page.locator(surface.layer).evaluate((el) => {
    const picture = el.querySelector('svg')
    if (picture === null) throw new Error('no diagram in the layer')
    const cs = getComputedStyle(el)
    const layoutWidth = picture.clientWidth
    const paintedWidth = picture.getBoundingClientRect().width
    const m = /matrix\(([^)]+)\)/.exec(cs.transform)
    const parts = m === null ? [] : (m[1] ?? '').split(',').map((v) => Number.parseFloat(v))
    return {
      declared: Number.parseFloat(cs.getPropertyValue('--view-scale')) || 1,
      effective: paintedWidth / layoutWidth,
      matrixScale: parts[0] ?? 1,
      fit: Number.parseFloat(cs.getPropertyValue('--view-fit')) || 1,
      layoutWidth,
      paintedWidth,
      transformOrigin: cs.transformOrigin
    }
  })
}

interface FitReading extends ScaleReading {
  viewport: [number, number]
  layout: [number, number]
  painted: [number, number]
  /** The picture's top-left relative to the overlay's top-left. */
  paintedStart: [number, number]
  fitOffset: string
}

async function readFit(page: Page, surface: Surface): Promise<FitReading> {
  return await page.locator(surface.overlay).evaluate((overlay) => {
    if (overlay === null) throw new Error('no overlay')
    const layer = overlay.querySelector<HTMLElement>('[class*="_layer_"]')
    if (layer === null) throw new Error('no layer in the overlay')
    const picture = layer.querySelector('svg')
    if (picture === null) throw new Error('no diagram in the overlay')
    const cs = getComputedStyle(layer)
    const m = /matrix\(([^)]+)\)/.exec(cs.transform)
    const parts = m === null ? [] : (m[1] ?? '').split(',').map((v) => Number.parseFloat(v))
    const ob = overlay.getBoundingClientRect()
    const pb = picture.getBoundingClientRect()
    return {
      declared: Number.parseFloat(cs.getPropertyValue('--view-scale')) || 1,
      effective: picture.getBoundingClientRect().width / picture.clientWidth,
      matrixScale: parts[0] ?? 1,
      fit: Number.parseFloat(cs.getPropertyValue('--view-fit')) || 1,
      layoutWidth: picture.clientWidth,
      paintedWidth: picture.getBoundingClientRect().width,
      transformOrigin: cs.transformOrigin,
      viewport: [overlay.clientWidth, overlay.clientHeight],
      layout: [picture.clientWidth, picture.clientHeight],
      painted: [pb.width, pb.height],
      paintedStart: [pb.left - ob.left, pb.top - ob.top],
      fitOffset: cs.getPropertyValue('--view-fit-offset').trim()
    }
  })
}

async function hoverHost(page: Page, surface: Surface): Promise<void> {
  const box = await page.locator(`${surface.container} [class*="_host_"]`).first().boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(240)
}

async function openSurface(page: Page, title: string, surface: Surface): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  await expect(page.locator(surface.svg).first()).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(900)
}

for (const surface of surfaces('')) {
  for (const viewport of VIEWPORTS) {
    const where = `${surface.name} at ${String(viewport.width)}x${String(viewport.height)}`

    test.describe(where, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize(viewport)
      })

      test.afterEach(async ({ request }) => {
        await purgeUntitledPages(request)
      })

      test('the effective scale is exactly the one the block declares at every level', async ({
        page,
        request
      }) => {
        // Walking from the maximum down to the minimum and back up again is ~24 clicks
        // with a re-measure after each, which does not fit the default budget.
        test.setTimeout(120_000)
        const title = `Zoom ${Date.now()}`
        await surface.seedBlocks(request, title, [WIDE])
        await openSurface(page, title, surface)

        // Walk the ladder the controls actually produce and measure each step.
        const seen: number[] = []
        const check = async (label: string): Promise<ScaleReading> => {
          const r = await readScale(page, surface)
          expect(
            Math.abs(r.effective - r.declared),
            `${label}: painted ${String(Math.round(r.paintedWidth))} over layout ${String(r.layoutWidth)} must equal the declared ${String(r.declared)}, got ${String(r.effective)}`
          ).toBeLessThan(0.005)
          // In the box there is no full screen, so fit is absent and the matrix is the
          // declared scale and nothing else.
          expect(
            Math.abs(r.matrixScale - r.declared),
            `${label}: the computed scale() must be the declared zoom alone`
          ).toBeLessThan(0.005)
          expect(r.fit, `${label}: no fit outside full screen`).toBe(1)
          seen.push(r.declared)
          return r
        }

        await check('at rest')
        await hoverHost(page, surface)
        await page.getByTestId(surface.zoomIn).click()
        await page.waitForTimeout(300)
        await check('after one zoom in')

        // Down to the floor, and the floor holds. One hover is enough: every click lands
        // on a control inside the host, so the cluster stays revealed throughout.
        for (let i = 0; i < 30; i++) {
          const btn = page.getByTestId(surface.zoomOut)
          if (!(await btn.isEnabled())) break
          await btn.click()
          await page.waitForTimeout(90)
        }
        const floor = await check('at the minimum')
        expect(floor.declared, `the floor is ZOOM_MIN`).toBeCloseTo(ZOOM_MIN, 3)

        // Up to the ceiling, and the ceiling holds.
        for (let i = 0; i < 40; i++) {
          const btn = page.getByTestId(surface.zoomIn)
          if (!(await btn.isEnabled())) break
          await btn.click()
          await page.waitForTimeout(90)
        }
        const ceiling = await check('at the maximum')
        expect(ceiling.declared, `the ceiling is ZOOM_MAX`).toBeCloseTo(ZOOM_MAX, 3)

        // Reset returns to exactly 1, from anywhere.
        await hoverHost(page, surface)
        await page.getByTestId(surface.reset).click()
        await page.waitForTimeout(350)
        const reset = await check('after reset')
        expect(reset.declared, 'reset returns to 100%').toBe(1)

        expect(
          new Set(seen).size,
          `the ladder must have visited several levels: ${seen.join(', ')}`
        ).toBeGreaterThanOrEqual(4)
        expect(
          floor.transformOrigin,
          'reachability depends on the transform origin staying at the start corner'
        ).toMatch(/^0(px)? 0(px)?$/)

        // The mechanism-independent half: **nothing between the picture and its
        // DiagramView layer may change the room the drawing has**. A second zoom system
        // hides itself best as a width on a wrapper, which is precisely what the page-level
        // zoom did - `.zoomHost { width: var(--zoom-level) }`. Requiring every wrapper
        // between the two to offer exactly the picture's own layout width, and no transform
        // of its own, catches any such layer whatever it is called, and it is a statement
        // about geometry rather than about a class name.
        //
        // Compared against the wrapper's **content** box, not its border box: `.blockCanvas`
        // carries 12px of padding, and padding is not the drawing being scaled.
        const wrappers = await page.locator(surface.layer).evaluate((layer) => {
          const picture = layer.querySelector('svg')
          if (picture === null) throw new Error('no diagram in the layer')
          const rows: Array<{ cls: string; contentWidth: number; transform: string }> = []
          let node: Element | null = picture.parentElement
          while (node !== null && node !== layer) {
            const cs = getComputedStyle(node)
            const pad =
              (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
            rows.push({
              cls: (node.getAttribute('class') ?? node.tagName).split(' ')[0],
              contentWidth: (node as HTMLElement).offsetWidth - pad,
              transform: cs.transform
            })
            node = node.parentElement
          }
          return { pictureLayout: picture.clientWidth, rows }
        })
        expect(wrappers.rows.length, 'there is at least one wrapper to check').toBeGreaterThan(0)
        for (const row of wrappers.rows) {
          expect(
            row.transform,
            `${row.cls} applies a transform of its own, so it magnifies the diagram independently of --view-scale`
          ).toBe('none')
          expect(
            Math.abs(row.contentWidth - wrappers.pictureLayout),
            `${row.cls} offers ${String(row.contentWidth)}px to a ${String(wrappers.pictureLayout)}px drawing, so something between the two is scaling it`
          ).toBeLessThanOrEqual(1)
        }
        // **What this check cannot see, stated plainly, because the difference matters.**
        // The page-level zoom multiplied by *width*, and a width multiplier widens the
        // layout as well, so while it sat at 100% it left the painted-over-layout ratio -
        // the effective scale - exactly right. No ratio detects a second zoom layer that
        // happens to be at neutral; only its existence does, which is what the next test
        // asserts. What this check does catch is the moment such a layer is moved off
        // neutral, and any layer that scales by transform at any value.
      })

      test('the page exposes no second, page-level zoom', async ({ page, request }) => {
        test.setTimeout(60_000)
        const title = `NoPageZoom ${Date.now()}`
        await surface.seedBlocks(request, title, [WIDE])
        await openSurface(page, title, surface)

        // The wrapper and the custom property are how the page-level zoom expressed
        // itself. A control set with no effect is still a second system.
        await expect(
          page.locator('[class*="_zoomHost_"]'),
          'the page-level zoom host, .zoomHost'
        ).toHaveCount(0)
        const inlineZoomLevels = await page.evaluate(
          () =>
            Array.from(document.querySelectorAll('*'))
              .filter(
                (el) => (el as HTMLElement).style.getPropertyValue('--zoom-level').trim() !== ''
              )
              .map((el) => (el as HTMLElement).style.getPropertyValue('--zoom-level').trim()).length
        )
        expect(inlineZoomLevels, 'inline --zoom-level declarations').toBe(0)
        for (const id of ['diagram-zoom-in', 'diagram-zoom-out', 'diagram-zoom-label']) {
          await expect(page.getByTestId(id), `${id} was the page-level control`).toHaveCount(0)
        }
        // And the whole page's magnification is one value, readable from the one layer.
        const layers = page.locator('[class*="_layer_"]')
        await expect(layers, 'one layer per diagram, and only one kind of layer').toHaveCount(1)
      })

      test('zoom never touches a stored size, and on the Diagram page each block zooms alone', async ({
        page,
        request
      }) => {
        const title = `Indep ${Date.now()}`
        // Only the Diagram page can hold two blocks side by side. A Rich Note renders one
        // diagram block per host, and two of them share the block-level test ids, so the
        // independence half is not meaningful there and is not asserted.
        await surface.seedBlocks(
          request,
          title,
          surface.name === 'diagram page' ? [WIDE, SMALL] : [WIDE]
        )
        await openSurface(page, title, surface)

        const first = await readScale(page, surface)
        const before = {
          width: await page
            .locator(surface.container)
            .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
          height: await page
            .locator(surface.container)
            .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
          stored: await page.locator(surface.container).getAttribute('data-width'),
          storedHeight: await page.locator(surface.container).getAttribute('data-height')
        }
        expect(before.width).toBeGreaterThan(0)

        await hoverHost(page, surface)
        await page.getByTestId(surface.zoomIn).click()
        await page.waitForTimeout(320)
        const zoomed = await readScale(page, surface)
        expect(zoomed.declared).toBeGreaterThan(first.declared)

        if (surface.name === 'diagram page') {
          // The other block on the page must not have moved with it.
          const other = surfaces('', 1)[1]
          if (other !== undefined) {
            const otherScale = await readScale(page, other)
            expect(otherScale.declared, 'the second block keeps its own zoom').toBe(1)
            expect(
              Math.abs(otherScale.effective - 1),
              'and its effective scale is still 1: no page-level multiplier'
            ).toBeLessThan(0.005)
          }
        }

        // Neither width nor height may have moved, at any zoom.
        const after = {
          width: await page
            .locator(surface.container)
            .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
          height: await page
            .locator(surface.container)
            .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
          stored: await page.locator(surface.container).getAttribute('data-width'),
          storedHeight: await page.locator(surface.container).getAttribute('data-height')
        }
        expect(
          after,
          `zoom must not change the box: was ${JSON.stringify(before)} now ${JSON.stringify(after)}`
        ).toEqual(before)

        // And a reload restores the box, with the zoom back at 1 because it was never stored.
        await page.reload()
        await expect(page.locator(surface.svg).first()).toBeVisible({ timeout: 25_000 })
        await page.waitForTimeout(800)
        const reloaded = await readScale(page, surface)
        expect(reloaded.declared, 'zoom is visual and is not persisted').toBe(1)
        expect(
          await page
            .locator(surface.container)
            .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
          'the stored width survives the reload unchanged'
        ).toBe(before.width)
      })

      test('full screen magnifies a drawing that does not fill the screen, and centres it', async ({
        page,
        request
      }) => {
        const title = `Fit ${Date.now()}`
        await surface.seedBlocks(request, title, [SMALL])
        await openSurface(page, title, surface)
        const before = await page.locator(surface.container).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { width: Math.round(r.width), height: Math.round(r.height) }
        })

        await hoverHost(page, surface)
        await page.getByTestId(surface.fullScreen).click()
        await expect(page.locator(surface.overlay)).toBeVisible({ timeout: 10_000 })
        await page.waitForTimeout(900)
        const unzoomed = await readFit(page, surface)

        // fit is derived from the viewport and the layout, nothing else.
        const expectedFit = Math.max(
          FIT_MIN,
          Math.min(
            unzoomed.viewport[0] / unzoomed.layout[0],
            unzoomed.viewport[1] / unzoomed.layout[1],
            FIT_MAX
          )
        )
        expect(
          Math.abs(unzoomed.fit - expectedFit),
          `fit must be max(1, min(${unzoomed.viewport.join('/')}, ${unzoomed.layout.join('/')}, ${String(FIT_MAX)})) = ${String(expectedFit)}, got ${String(unzoomed.fit)}`
        ).toBeLessThan(0.01)

        // The magnification actually applied is the one product of the two declared values.
        expect(
          Math.abs(unzoomed.matrixScale - unzoomed.declared * unzoomed.fit),
          `the scale() must be view-scale x view-fit = ${String(unzoomed.declared * unzoomed.fit)}, computed ${String(unzoomed.matrixScale)}`
        ).toBeLessThan(0.005)

        // And the drawing really is magnified, and centred.
        expect(
          unzoomed.fit,
          'a 196x168 drawing has something to gain from full screen'
        ).toBeGreaterThan(2)
        expect(
          unzoomed.painted[0],
          `a ${String(unzoomed.layout[0])}px layout must be drawn wider than itself`
        ).toBeGreaterThan(unzoomed.layout[0] * 2)
        const wantStartX = Math.max(0, (unzoomed.viewport[0] - unzoomed.painted[0]) / 2)
        const wantStartY = Math.max(0, (unzoomed.viewport[1] - unzoomed.painted[1]) / 2)
        expect(
          Math.abs(unzoomed.paintedStart[0] - wantStartX),
          `centred horizontally: painted starts at ${unzoomed.paintedStart.join(',')}, expected ${String(Math.round(wantStartX))}`
        ).toBeLessThanOrEqual(2)
        expect(
          Math.abs(unzoomed.paintedStart[1] - wantStartY),
          `centred vertically: painted starts at ${unzoomed.paintedStart.join(',')}, expected ${String(Math.round(wantStartY))}`
        ).toBeLessThanOrEqual(2)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          'full screen must not create document-level horizontal overflow'
        ).toBeLessThanOrEqual(0)

        await page.keyboard.press('Escape')
        await page.waitForTimeout(700)

        // The stored box never moved while all of that happened.
        const after = await page.locator(surface.container).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { width: Math.round(r.width), height: Math.round(r.height) }
        })
        expect(after, 'full screen must not resize the block').toEqual(before)
      })

      test('fit is the same number zoomed or not, and closing full screen leaves nothing behind', async ({
        page,
        request
      }) => {
        const title = `FitZoom ${Date.now()}`
        await surface.seedBlocks(request, title, [SMALL])
        await openSurface(page, title, surface)
        const before = await page.locator(surface.container).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { width: Math.round(r.width), height: Math.round(r.height) }
        })

        const enterAndRead = async (): Promise<FitReading> => {
          await hoverHost(page, surface)
          await page.getByTestId(surface.fullScreen).click()
          await expect(page.locator(surface.overlay)).toBeVisible({ timeout: 10_000 })
          await page.waitForTimeout(900)
          return await readFit(page, surface)
        }

        const unzoomed = await enterAndRead()
        await page.keyboard.press('Escape')
        await page.waitForTimeout(700)

        // --- zoomed, and fit must be the *same* number: it is a property of the drawing
        // and the screen, not of the reader's magnification. The pre-fix fit measured the
        // picture's painted box, which contained the reader's zoom, so the ratio fell below
        // 1 and was clamped to 1 - fit silently did nothing at any zoom.
        await hoverHost(page, surface)
        await page.getByTestId(surface.zoomIn).click()
        await page.waitForTimeout(320)
        const zoomed = await enterAndRead()

        expect(zoomed.declared, 'the reader zoom is 1.25 here').toBeCloseTo(1.25, 3)
        expect(
          Math.abs(zoomed.fit - unzoomed.fit),
          `fit must not depend on the reader zoom: ${String(unzoomed.fit)} unzoomed, ${String(zoomed.fit)} at 1.25`
        ).toBeLessThan(0.001)
        expect(
          Math.abs(zoomed.matrixScale - 1.25 * zoomed.fit),
          `the scale() must be 1.25 x ${String(zoomed.fit)} = ${String(1.25 * zoomed.fit)}, computed ${String(zoomed.matrixScale)}`
        ).toBeLessThan(0.005)
        expect(
          zoomed.fitOffset,
          'the centring offset must be present while full screen is open'
        ).not.toBe('')

        // Leaving full screen must leave nothing of it behind.
        await page.keyboard.press('Escape')
        await page.waitForTimeout(700)
        const leftovers = await page.locator(surface.layer).evaluate((el) => ({
          fit: el.style.getPropertyValue('--view-fit'),
          offset: el.style.getPropertyValue('--view-fit-offset'),
          painted: el.querySelector('svg')?.getBoundingClientRect().width ?? 0,
          layout: el.querySelector('svg')?.clientWidth ?? 0
        }))
        expect(leftovers.fit.trim(), '--view-fit must be removed on close').toBe('')
        expect(leftovers.offset.trim(), '--view-fit-offset must be removed on close').toBe('')
        expect(
          Math.abs(leftovers.painted / leftovers.layout - 1.25),
          'and the box must be back at the reader zoom alone'
        ).toBeLessThan(0.005)

        const after = await page.locator(surface.container).evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { width: Math.round(r.width), height: Math.round(r.height) }
        })
        expect(after, 'full screen must not resize the block').toEqual(before)
      })
    })
  }
}
