import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * Reachability of a zoomed diagram.
 *
 * ## What is being proved
 *
 * Zoom is a CSS transform. A transformed element does contribute to an ancestor's
 * scrollable overflow, but only on the side the scroll container can travel to — in
 * LTR that is the **end**. A `transform-origin` at the centre grows the box in *both*
 * directions while only the end-side growth becomes scrollable, so half the overflow is
 * produced and then discarded, and the start-side of the drawing cannot be reached from
 * any scroll position at all.
 *
 * So these tests do not assert that a CSS property exists. For each of the four edges
 * of the diagram's **painted** box they compute the scroll offset that should bring
 * that edge into the scroll port, apply it, and re-read `getBoundingClientRect()` to
 * confirm the edge really is inside. An origin that strands overflow on the start side
 * fails this regardless of what else is true.
 *
 * Both surfaces are covered at three viewports, because they have different scroll
 * chains — the note adds an `overflow-x:auto` wrapper and clips in a different box —
 * and a fix verified on one is not evidence about the other.
 *
 * The zoom ladder is the one the controls actually produce: `ZOOM_IN` is 1.25, so the
 * reachable levels are 1, 1.25, 1.5625, 1.953125 and 2.44140625. Asserting levels the
 * UI cannot reach would be asserting a fiction.
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

const VIEWPORTS = [
  { width: 1600, height: 950 },
  { width: 1440, height: 900 },
  { width: 700, height: 800 }
]

interface Surface {
  /** How the page is seeded. */
  seed: (request: APIRequestContext, title: string) => Promise<void>
  /** Carries the stored size and the scroll chain. */
  container: string
  /** The scroll owner: the box that has to be able to reach the whole drawing. */
  stage: string
  /** The full-screen overlay, once opened. */
  overlay: string
  /** The drawing itself. */
  svg: string
  /** Zoom-in control id, from which the full-screen control id is derived. */
  zoomIn: string
  /** A size preset, to give the block a definite box. */
  presetMedium: string
  /** The element that reveals the control cluster on hover. */
  hover: string
}

const RICH: Surface = {
  seed: async (request, title) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'rich',
        content: JSON.stringify([{ id: 'd', type: 'diagram', content: DIAGRAM }])
      }
    })
    expect(res.status()).toBe(201)
  },
  container: '[data-testid="diagram-container"]',
  stage: '[data-testid="diagram-container"] [class*="_stage_"]',
  overlay: '[data-testid="note-view-full-screen-open"]',
  svg: '[data-testid="diagram-svg"] svg',
  zoomIn: 'note-view-zoom-in',
  presetMedium: 'diagram-preset-medium',
  hover: '[data-testid="diagram-preview"]'
}

const DIAGRAM_PAGE: Surface = {
  seed: async (request, title) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: [{ id: 'a', source: DIAGRAM }]
        })
      }
    })
    expect(res.status()).toBe(201)
  },
  container: '[data-testid="diagram-block-0-container"]',
  stage: '[data-testid="diagram-block-0-container"] [class*="_stage_"]',
  overlay: '[data-testid="diagram-block-0-full-screen-open"]',
  svg: '[data-testid="diagram-block-0-svg"] svg',
  zoomIn: 'diagram-block-0-zoom-in',
  presetMedium: 'diagram-block-0-preset-medium',
  hover: '[data-testid="diagram-block-0-container"]'
}

interface Reachability {
  scale: string
  transformOrigin: string
  port: [number, number]
  scroll: [number, number]
  extent: [number, number]
  contentLocal: { l: number; t: number; r: number; b: number }
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
  allReachable: boolean
}

/**
 * Proves each edge of the painted drawing by scrolling to it and re-measuring.
 *
 * The whole measurement runs in one page task, so setting a scroll offset and reading
 * the geometry it produced are not separated by a protocol round trip.
 */
async function measureReachability(page: Page, stage: string, svg: string): Promise<Reachability> {
  return await page.evaluate(
    ({ stage: stageSel, svg: svgSel }) => {
      const el = document.querySelector(stageSel)
      const picture = document.querySelector(svgSel)
      if (el === null || picture === null) throw new Error('reachability: element not found')
      const layer = el.querySelector<HTMLElement>('[class*="_layer_"]') ?? el

      const maxLeft = el.scrollWidth - el.clientWidth
      const maxTop = el.scrollHeight - el.clientHeight

      el.scrollLeft = 0
      el.scrollTop = 0
      const port = el.getBoundingClientRect()
      const first = picture.getBoundingClientRect()
      const contentLocal = {
        l: Math.round(first.left - port.left),
        t: Math.round(first.top - port.top),
        r: Math.round(first.right - port.left),
        b: Math.round(first.bottom - port.top)
      }

      // The union of every window this container can present is [0, extent + port] on
      // each axis. A point outside that union is outside every window, so no scroll
      // position can show it — which is exactly the centre-origin failure.
      const reachRight = Math.max(maxLeft, 0) + el.clientWidth
      const reachBottom = Math.max(maxTop, 0) + el.clientHeight

      // Then actually do it: scroll the edge against the port edge, clamped to the
      // legal range, and confirm with a fresh read.
      const reaches = (edge: 'left' | 'right' | 'top' | 'bottom'): boolean => {
        el.scrollLeft = 0
        el.scrollTop = 0
        const box = picture.getBoundingClientRect()
        const view = el.getBoundingClientRect()
        let wantLeft = 0
        let wantTop = 0
        if (edge === 'left') wantLeft = box.left - view.left
        if (edge === 'right') wantLeft = box.right - view.right + el.clientWidth
        if (edge === 'top') wantTop = box.top - view.top
        if (edge === 'bottom') wantTop = box.bottom - view.bottom + el.clientHeight
        el.scrollLeft = Math.max(0, Math.min(maxLeft, wantLeft))
        el.scrollTop = Math.max(0, Math.min(maxTop, wantTop))
        const after = picture.getBoundingClientRect()
        const shown = el.getBoundingClientRect()
        if (edge === 'left') return after.left >= shown.left - 1
        if (edge === 'right') return after.right <= shown.right + 1
        if (edge === 'top') return after.top >= shown.top - 1
        return after.bottom <= shown.bottom + 1
      }

      const measured = {
        scale: getComputedStyle(layer).getPropertyValue('--view-scale').trim() || '1',
        transformOrigin: getComputedStyle(layer).transformOrigin,
        port: [el.clientWidth, el.clientHeight] as [number, number],
        scroll: [el.scrollWidth, el.scrollHeight] as [number, number],
        extent: [maxLeft, maxTop] as [number, number],
        contentLocal,
        left: contentLocal.l >= -1 && contentLocal.l <= reachRight + 1 && reaches('left'),
        right: contentLocal.r >= -1 && contentLocal.r <= reachRight + 1 && reaches('right'),
        top: contentLocal.t >= -1 && contentLocal.t <= reachBottom + 1 && reaches('top'),
        bottom: contentLocal.b >= -1 && contentLocal.b <= reachBottom + 1 && reaches('bottom')
      }
      el.scrollLeft = 0
      el.scrollTop = 0
      return {
        ...measured,
        allReachable: measured.left && measured.right && measured.top && measured.bottom
      }
    },
    { stage, svg }
  )
}

/** The measurement, formatted so a failure says which edge and by how much. */
function describeReach(r: Reachability): string {
  return [
    `scale ${r.scale}`,
    `origin ${r.transformOrigin}`,
    `port ${r.port[0]}x${r.port[1]}`,
    `scroll ${r.scroll[0]}x${r.scroll[1]}`,
    `extent ${r.extent[0]}x${r.extent[1]}`,
    `content l=${r.contentLocal.l} r=${r.contentLocal.r} t=${r.contentLocal.t} b=${r.contentLocal.b}`,
    `L${r.left ? 'ok' : 'XX'} R${r.right ? 'ok' : 'XX'} T${r.top ? 'ok' : 'XX'} B${r.bottom ? 'ok' : 'XX'}`
  ].join(' | ')
}

async function openSurface(page: Page, title: string, surface: Surface): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  await expect(page.locator(`${surface.container} svg`).first()).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(900)
}

/** The cluster is revealed on hover, so it must be hovered before every press. */
async function hoverHost(page: Page, surface: Surface): Promise<void> {
  const box = await page.locator(`${surface.container} [class*="_host_"]`).first().boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(260)
}

const storedSize = async (page: Page, surface: Surface) => ({
  w: await page.locator(surface.container).getAttribute('data-width'),
  h: await page.locator(surface.container).getAttribute('data-height')
})

test.describe('zoomed diagram reachability', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  const surfaces = [
    ['rich note', RICH],
    ['diagram page', DIAGRAM_PAGE]
  ] as const

  for (const [name, surface] of surfaces) {
    for (const viewport of VIEWPORTS) {
      test(`${name} at ${viewport.width}x${viewport.height}: every edge of the zoomed drawing is reachable by scrolling`, async ({
        page,
        request
      }) => {
        const title = `Reach ${name} ${viewport.width} ${Date.now()}`
        await surface.seed(request, title)
        await page.setViewportSize(viewport)
        await openSurface(page, title, surface)

        // A definite box, so the port exists on both axes. An unsized note block is
        // only as tall as its drawing, which cannot exercise the vertical axis.
        await page.locator(surface.hover).hover()
        await page.getByTestId(surface.presetMedium).click({ force: true })
        await page.waitForTimeout(800)

        const storedBefore = await storedSize(page, surface)
        const boxBefore = await page
          .locator(surface.container)
          .evaluate((el) => [
            Math.round(el.getBoundingClientRect().width),
            Math.round(el.getBoundingClientRect().height)
          ])
        const levels: number[] = []

        for (let press = 0; press <= 4; press++) {
          if (press > 0) {
            await hoverHost(page, surface)
            await page.getByTestId(surface.zoomIn).click()
            await page.waitForTimeout(280)
          }
          const r = await measureReachability(page, surface.stage, surface.svg)
          levels.push(Number.parseFloat(r.scale))

          expect(
            r.allReachable,
            `at ${r.scale} the whole drawing must be reachable by scrolling alone — ${describeReach(r)}`
          ).toBe(true)
          if (press >= 1) {
            // Without this the assertion above could pass on a drawing that never
            // overflowed, which proves nothing about reachability.
            expect(
              r.extent[0] + r.extent[1],
              `at ${r.scale} the drawing should overflow the port — ${describeReach(r)}`
            ).toBeGreaterThan(0)
          }
          // Zoom is view state and must never touch the document or the box.
          expect(
            await storedSize(page, surface),
            `zoom must not write a size at ${r.scale}`
          ).toEqual(storedBefore)
          expect(
            await page
              .locator(surface.container)
              .evaluate((el) => [
                Math.round(el.getBoundingClientRect().width),
                Math.round(el.getBoundingClientRect().height)
              ]),
            `zoom must not resize the box at ${r.scale}`
          ).toEqual(boxBefore)
        }

        // The ladder really was climbed, so those were five distinct states.
        expect(
          new Set(levels).size,
          `expected five distinct levels, got ${levels.join(', ')}`
        ).toBe(5)
        expect(levels[0]).toBeCloseTo(1, 5)
        expect(levels[levels.length - 1]).toBeGreaterThan(2.4)
      })
    }
  }

  for (const [name, surface] of surfaces) {
    for (const viewport of VIEWPORTS) {
      test(`${name} at ${viewport.width}x${viewport.height}: full screen reaches the zoomed drawing and leaves the box intact`, async ({
        page,
        request
      }) => {
        const title = `ReachFS ${name} ${viewport.width} ${Date.now()}`
        await surface.seed(request, title)
        await page.setViewportSize(viewport)
        await openSurface(page, title, surface)

        const container = page.locator(surface.container)
        await page.locator(surface.hover).hover()
        await page.getByTestId(surface.presetMedium).click({ force: true })
        await page.waitForTimeout(800)

        const storedBefore = await storedSize(page, surface)
        const boxBefore = await container.evaluate((el) => [
          Math.round(el.getBoundingClientRect().width),
          Math.round(el.getBoundingClientRect().height)
        ])

        await hoverHost(page, surface)
        await page.getByTestId(surface.zoomIn).click()
        await page.waitForTimeout(280)

        await hoverHost(page, surface)
        await page.getByTestId(surface.zoomIn.replace('zoom-in', 'full-screen')).click()
        await expect(page.locator(surface.overlay)).toBeVisible({ timeout: 10_000 })
        await page.waitForTimeout(1200)

        const overlay = await measureReachability(page, surface.overlay, surface.svg)
        expect(
          overlay.allReachable,
          `full screen must reach the whole drawing — ${describeReach(overlay)}`
        ).toBe(true)
        // Full screen gives the picture the whole window, so a zoomed diagram has to
        // overflow it. Otherwise the assertion above proved nothing.
        expect(
          overlay.extent[0] + overlay.extent[1],
          `full screen should overflow at this zoom — ${describeReach(overlay)}`
        ).toBeGreaterThan(0)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          'full screen must not widen the document'
        ).toBeLessThanOrEqual(0)

        await page.keyboard.press('Escape')
        await expect(page.locator(surface.overlay)).toHaveCount(0)
        await page.waitForTimeout(800)

        expect(
          await storedSize(page, surface),
          'leaving full screen must not alter the stored size'
        ).toEqual(storedBefore)
        expect(
          await container.evaluate((el) => [
            Math.round(el.getBoundingClientRect().width),
            Math.round(el.getBoundingClientRect().height)
          ]),
          'the box must come back at the size it had'
        ).toEqual(boxBefore)
        expect(
          await container.evaluate((el) => {
            const layer = el.querySelector<HTMLElement>('[class*="_layer_"]')
            const stage = el.querySelector<HTMLElement>('[class*="_stage_"]')
            return {
              fit:
                layer === null
                  ? '(gone)'
                  : getComputedStyle(layer).getPropertyValue('--view-fit').trim(),
              pinned:
                stage === null
                  ? '(gone)'
                  : getComputedStyle(stage).getPropertyValue('--stage-height').trim(),
              reparented: layer !== null && stage !== null && layer.parentElement === stage
            }
          }),
          'the layer must be back in its stage, with no full-screen fit or pinned height left'
        ).toEqual({ fit: '', pinned: '', reparented: true })
      })
    }
  }

  test('panning still moves the drawing at every zoom and never writes a size', async ({
    page,
    request
  }) => {
    const title = `ReachPan ${Date.now()}`
    await RICH.seed(request, title)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, RICH)
    await page.locator(RICH.hover).hover()
    await page.getByTestId(RICH.presetMedium).click({ force: true })
    await page.waitForTimeout(800)

    const storedBefore = await storedSize(page, RICH)
    const leftOf = async (): Promise<number> =>
      await page
        .locator(RICH.svg)
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().left))

    for (let step = 0; step <= 3; step++) {
      if (step > 0) {
        await hoverHost(page, RICH)
        await page.getByTestId('note-view-zoom-in').click()
      }
      await page.waitForTimeout(240)
      const scale = await page
        .locator(`${RICH.container} [class*="_layer_"]`)
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--view-scale').trim())

      const start = await leftOf()
      await hoverHost(page, RICH)
      await page.getByTestId('note-view-pan-right').click()
      await page.waitForTimeout(220)
      const moved = await leftOf()
      expect(moved, `pan right must move the drawing right at scale ${scale}`).toBeGreaterThan(
        start
      )

      await hoverHost(page, RICH)
      await page.getByTestId('note-view-pan-left').click()
      await page.waitForTimeout(220)
      expect(await leftOf(), `pan left must undo it at scale ${scale}`).toBe(start)
      expect(await storedSize(page, RICH), `pan must not write a size at scale ${scale}`).toEqual(
        storedBefore
      )
    }
  })

  test('a drawing smaller than its viewport still zooms with usable controls once it scrolls', async ({
    page,
    request
  }) => {
    // Specification case D: a small drawing, zoomed until it overflows. Scrolling now
    // exists, and the pad is anchored to a box that must not scroll with it.
    const title = `ReachSmall ${Date.now()}`
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: [{ id: 'a', source: 'flowchart TD\n  A[Start] --> B[End]' }]
        })
      }
    })
    expect(res.status()).toBe(201)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, DIAGRAM_PAGE)

    const scale = async (): Promise<string> =>
      await page
        .locator(`${DIAGRAM_PAGE.container} [class*="_layer_"]`)
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--view-scale').trim())

    const before = await scale()
    for (let i = 0; i < 3; i++) {
      await hoverHost(page, DIAGRAM_PAGE)
      await page.getByTestId('diagram-block-0-zoom-in').click()
    }
    await page.waitForTimeout(400)
    const zoomed = await scale()
    expect(zoomed, 'three presses must zoom in').not.toBe(before)

    await hoverHost(page, DIAGRAM_PAGE)
    const controls = await page.evaluate((sel) => {
      const host = document.querySelector(`${sel} [class*="_host_"]`)
      const stage = document.querySelector(`${sel} [class*="_stage_"]`)
      const pad = host?.querySelector<HTMLElement>('[class*="_controls_"]') ?? null
      if (host === null || stage === null || pad === null) throw new Error('controls not found')
      const h = host.getBoundingClientRect()
      const p = pad.getBoundingClientRect()
      return {
        opacity: getComputedStyle(pad).opacity,
        pointerEvents: getComputedStyle(pad).pointerEvents,
        insideHost:
          p.left >= h.left - 1 &&
          p.right <= h.right + 1 &&
          p.top >= h.top - 1 &&
          p.bottom <= h.bottom + 1,
        scrolling: stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight
      }
    }, DIAGRAM_PAGE.container)
    expect(controls.opacity, 'the pad must be revealed on hover').toBe('1')
    expect(controls.pointerEvents).toBe('auto')
    expect(controls.insideHost, 'the pad must not have scrolled away with the drawing').toBe(true)
    expect(controls.scrolling, 'this case is only meaningful if the stage now scrolls').toBe(true)

    await hoverHost(page, DIAGRAM_PAGE)
    await page.getByTestId('diagram-block-0-zoom-out').click()
    await page.waitForTimeout(350)
    expect(await scale(), 'zoom out must still work at this size').not.toBe(zoomed)
  })
})
