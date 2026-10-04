import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * The width boundary is a **declared surface contract**, not an inference.
 *
 * ## The contract
 *
 * ```
 * surface owns the boundary
 *         ↓  data-block-width-boundary
 * shared resize component (blockWidthBoundary)
 *         ↓
 * one authoritative number
 * ```
 *
 * A surface that hosts resizable blocks marks the one element whose **content box** is the
 * width a block may occupy. `blockWidthBoundary` walks to the nearest marked ancestor and
 * measures it, read-only. It does not infer the boundary from flex, grid or width CSS, and
 * it does not write to the tree to discover it.
 *
 * Two surfaces mark two elements, and the tests assert each resolves to the right one:
 *
 * | surface | marked element | test id |
 * |---|---|---|
 * | Rich Note | `.previewPane` — the note's text column | `diagram-preview` |
 * | Diagram page | `.blockList` — the wrapping flex row | `diagram-block-list` |
 *
 * The Diagram page's marker sits on Motion's `Reorder.Group`, so forwarding is not assumed:
 * `the surface declares its boundary` asserts the attribute is on a real element in the DOM
 * and that the resolved element is neither `<html>` nor `<body>`.
 *
 * ## Why it is declared rather than inferred
 *
 * The previous implementation inferred it, and the inference needed two pieces of incidental
 * layout CSS to work at all: an inline `--block-width` property, and `flex: 1 1 <a definite
 * length>`. That is a *flex* distinction, and nothing else distinguishes these two boxes —
 * measured, `max-width` is `none` the whole way up the note's chain, and is `100%` only on the
 * very `Reorder.Item` the inference had to skip. A third surface nesting a block in
 * `flex: 1 1 <length>` would need the same reasoning re-derived by hand, and getting it wrong
 * is silent: a boundary taken from a shrink-wrapped parent is the block's own width, so nothing
 * can be widened and the control looks broken rather than wrong.
 *
 * ## What "read-only" is proven to mean here
 *
 * The alternative — offer the block maximum through the width custom properties, read what was
 * drawn, put it back — is exact, and was measured and abandoned: writing to the tree trips the
 * block's own `ResizeObserver`, whose state update **replaces the resize grip**, destroying the
 * pointer capture `onPointerDown` takes. `the grip node survives the drag` and
 * `nothing at or above the boundary is written` are the two tests that would catch a return to
 * it; both failed when the probe was in place.
 *
 * Every assertion here reads rendered geometry. `data-width`, inline custom properties and
 * attributes are read only as *what the system asked for*, always beside the width drawn.
 */

const BIG = [
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

/** The preset that asks for 960px — wider than either surface can draw at most viewports. */
const PRESET_LARGE_WIDTH = 960

/**
 * What the resize system reports when the surface has declared no boundary: the block
 * maximum, which is the only other constraint in the product.
 */
const BLOCK_MAX_WIDTH = 1600

const VIEWPORTS = [
  { width: 1600, height: 950 },
  { width: 1440, height: 900 },
  { width: 700, height: 800 }
]

interface Surface {
  name: string
  seed: (request: APIRequestContext, title: string, blocks: number) => Promise<void>
  container: string
  handle: string
  svg: string
  hover: string
  presetLarge: string
  /** The element this surface must mark, and the test id that proves it is the right one. */
  boundaryTestId: string
  /** Blocks to seed; the Diagram page can hold more than one, a Rich Note one per block host. */
  blocks: number
}

const RICH: Surface = {
  name: 'rich note',
  seed: async (request, title) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'rich',
        content: JSON.stringify([
          { id: 'd', type: 'diagram', content: BIG, props: { width: '', height: '' } }
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
  boundaryTestId: 'diagram-preview',
  blocks: 1
}

const DIAGRAM_PAGE: Surface = {
  name: 'diagram page',
  seed: async (request, title, blocks) => {
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: Array.from({ length: blocks }, (_, i) => ({
            id: String.fromCharCode(97 + i),
            source: BIG
          }))
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
  boundaryTestId: 'diagram-block-list',
  blocks: 1
}

const SURFACES = [RICH, DIAGRAM_PAGE]

interface BoundaryReading {
  /** The nearest declared boundary, if the surface declared one. */
  found: boolean
  boundaryClass: string
  boundaryTestId: string
  /** The boundary's content box: the number `blockWidthBoundary` computes. */
  contentBox: number
  /** Every declared boundary on the page, so a stray duplicate is visible. */
  markersOnPage: string[]
  /** Guards against a resolver that walked off the top of the document. */
  resolvedToDocumentElement: boolean
  resolvedToBody: boolean
  containerWidth: number
  cssMaxWidth: string
}

/**
 * Reads the declared boundary the same way the component does — nearest marked ancestor of
 * the container — so the expectation is the contract, not a restatement of the resolver.
 */
async function readBoundary(page: Page, surface: Surface): Promise<BoundaryReading> {
  return await page.locator(surface.container).evaluate((el) => {
    const boundary = el.parentElement?.closest('[data-block-width-boundary]') ?? null
    const cs = boundary === null ? null : getComputedStyle(boundary)
    const padding =
      cs === null
        ? 0
        : (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
    return {
      found: boundary !== null,
      boundaryClass: boundary === null ? '' : (boundary.getAttribute('class') ?? '').split(' ')[0],
      boundaryTestId: boundary === null ? '' : (boundary.getAttribute('data-testid') ?? ''),
      contentBox: boundary === null ? -1 : boundary.clientWidth - padding,
      markersOnPage: Array.from(document.querySelectorAll('[data-block-width-boundary]')).map(
        (m) => {
          const el2 = m as HTMLElement
          return `${(el2.getAttribute('class') ?? el2.tagName).split(' ')[0]}@${el2.getAttribute('data-testid') ?? '-'}`
        }
      ),
      resolvedToDocumentElement: boundary === document.documentElement,
      resolvedToBody: boundary === document.body,
      containerWidth: Math.round(el.getBoundingClientRect().width),
      cssMaxWidth: getComputedStyle(el).maxWidth
    }
  })
}

interface Frame {
  rendered: number
  /** Every px width the resize system published, in flight or committed. */
  reported: number[]
}

/** Records, every animation frame, what was asked for and what was drawn. */
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
      rows.push({ rendered: Math.round(container.getBoundingClientRect().width), reported })
      if (performance.now() - t0 < 3200) requestAnimationFrame(tick)
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

      test('the surface declares its boundary and the resolver reads that element', async ({
        page,
        request
      }) => {
        const title = `Declared ${Date.now()}`
        await surface.seed(request, title, surface.blocks)
        await openSurface(page, title, surface)

        const reading = await readBoundary(page, surface)

        expect(reading.found, `no ancestor of the block carries data-block-width-boundary`).toBe(
          true
        )
        expect(
          reading.boundaryTestId,
          `the nearest declared boundary must be ${surface.boundaryTestId}, found ${reading.boundaryTestId}`
        ).toBe(surface.boundaryTestId)
        expect(
          reading.resolvedToDocumentElement || reading.resolvedToBody,
          'the resolver walked off the top of the document instead of finding a declared boundary'
        ).toBe(false)
        expect(
          reading.markersOnPage.length,
          `exactly one boundary should be declared on this page, found ${reading.markersOnPage.join(', ')}`
        ).toBe(1)
        expect(reading.cssMaxWidth, 'the container is bounded by max-width: 100%').toBe('100%')
        expect(reading.contentBox, 'a real, positive boundary').toBeGreaterThan(200)

        // An unsized block has no width of its own, so it fills the declared boundary.
        expect(
          Math.abs(reading.containerWidth - reading.contentBox),
          `an unsized block fills its ${String(reading.contentBox)}px boundary exactly, drew ${String(reading.containerWidth)}`
        ).toBeLessThanOrEqual(1)

        // And the number is the same once the block is sized, which is what a resolver
        // reading the block's own width would break.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        const sized = await readBoundary(page, surface)
        expect(
          sized.contentBox,
          `the declared boundary must not change when the block is sized: ${String(reading.contentBox)} unsized, ${String(sized.contentBox)} sized`
        ).toBe(reading.contentBox)
        expect(
          Math.abs(sized.containerWidth - reading.contentBox),
          'and the block really did get narrower, so the reading above means something'
        ).toBeGreaterThan(150)
      })

      test('pointer, keyboard and preset all stop on the declared boundary', async ({
        page,
        request
      }) => {
        // The longest test here by design: three resize paths end to end, a paced keyboard
        // walk that can need a dozen presses, the autosave debounce, and a reload. It
        // measured 16-20s on an idle machine and once exceeded the default 30s budget
        // inside a loaded full-suite chunk, which is a harness limit rather than a defect,
        // so it is given a budget that fits what it does.
        test.setTimeout(120_000)
        const title = `Stops ${Date.now()}`
        await surface.seed(request, title, surface.blocks)
        await openSurface(page, title, surface)
        const boundary = (await readBoundary(page, surface)).contentBox

        // --- pointer. Narrow it first, so a rightward drag has room to run past the end.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        const narrow = await widthOf(page, surface)
        expect(narrow, `the block should have narrowed from the boundary`).toBeLessThan(
          boundary - 150
        )

        await startSampling(page, surface)
        await hoverHost(page, surface)
        await dragHandle(page, surface, 2400, 12, 30)
        const frames = await collectFrames(page)

        expect(frames.length, 'the sampler must have recorded frames').toBeGreaterThan(10)
        const moving = frames.filter((f) => f.rendered >= narrow)
        expect(moving.length, 'frames from the widening part of the drag').toBeGreaterThan(5)

        // The core defect this whole area is about: the system asking for more width than
        // the page can draw.
        const overreach: string[] = []
        for (const [i, f] of moving.entries()) {
          const asked = f.reported.length === 0 ? 0 : Math.max(...f.reported)
          if (asked > f.rendered + 1) {
            overreach.push(`frame ${String(i)}: asked ${String(asked)}, drew ${String(f.rendered)}`)
          }
        }
        expect(
          overreach,
          `every published width must be one the block can draw (boundary ${String(boundary)})`
        ).toEqual([])
        expect(
          Math.max(...moving.map((f) => f.rendered)),
          'the drag should have reached the boundary'
        ).toBeGreaterThan(narrow + 150)

        const drawn = await widthOf(page, surface)
        expect(
          Math.abs(drawn - boundary),
          `a pointer drag must stop exactly on the declared ${String(boundary)}px boundary, drew ${String(drawn)}`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs((await storedWidth(page, surface)) - drawn),
          'the stored width must be the width the block draws'
        ).toBeLessThanOrEqual(1)

        // --- keyboard. One press per commit, or a burst faster than React commits reads
        // the same stale measurement repeatedly and grows by a fraction of a step.
        await hoverHost(page, surface)
        await dragHandle(page, surface, -400)
        expect(await widthOf(page, surface), 'narrowed again').toBeLessThan(boundary - 150)
        const paced = 150
        let unchanged = 0
        for (let i = 0; i < 60 && unchanged < 3; i++) {
          const before = await widthOf(page, surface)
          await page.getByTestId(surface.handle).focus()
          await page.keyboard.press('ArrowRight')
          await page.waitForTimeout(paced)
          unchanged = Math.abs((await widthOf(page, surface)) - before) <= 1 ? unchanged + 1 : 0
        }
        const keyed = await widthOf(page, surface)
        expect(
          Math.abs(keyed - boundary),
          `Arrow Right must stop exactly on the declared ${String(boundary)}px boundary, stopped at ${String(keyed)}`
        ).toBeLessThanOrEqual(1)

        // --- preset. It must store the width the block can actually be drawn at.
        await hoverHost(page, surface)
        await page.getByTestId(surface.presetLarge).click()
        await page.waitForTimeout(600)
        const expected = Math.min(PRESET_LARGE_WIDTH, boundary)
        expect(
          Math.abs((await storedWidth(page, surface)) - expected),
          `the ${String(PRESET_LARGE_WIDTH)}px preset must store ${String(expected)} at this viewport`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs((await widthOf(page, surface)) - expected),
          'and draw exactly what it stored'
        ).toBeLessThanOrEqual(1)

        // The autosave is debounced by `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` (2000ms), so a
        // reload sooner than that would test the debounce rather than persistence.
        await page.waitForTimeout(2500)
        await page.reload()
        await expect(page.locator(surface.svg).first()).toBeVisible({ timeout: 25_000 })
        await page.waitForTimeout(800)
        expect(
          Math.abs((await storedWidth(page, surface)) - expected),
          'the reload must restore the stored size'
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs((await widthOf(page, surface)) - expected),
          'and draw it'
        ).toBeLessThanOrEqual(1)
      })
    })
  }
}

// ---------------------------------------------------------------------------- contract
// integrity. Once per surface rather than once per viewport: none of these is about a
// particular width, they are about how the boundary is found and found *not* to be found.

for (const surface of SURFACES) {
  test.describe(`${surface.name}: the contract itself`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    test.afterEach(async ({ request }) => {
      await purgeUntitledPages(request)
    })

    test('the grip node and the pointer capture survive the drag', async ({ page, request }) => {
      const title = `Grip ${Date.now()}`
      await surface.seed(request, title, surface.blocks)
      await openSurface(page, title, surface)
      const boundary = (await readBoundary(page, surface)).contentBox
      await hoverHost(page, surface)
      await dragHandle(page, surface, -400)
      const before = await widthOf(page, surface)
      expect(before, 'narrowed, so there is room to widen').toBeLessThan(boundary - 150)

      // The probe that was measured and abandoned replaced this node, which is what cost
      // the drag its pointer capture. Identity is therefore part of the contract.
      await page.evaluate((handleSel) => {
        const w = window as unknown as { __gripSame?: boolean | null; __seen?: number }
        const before2 = document.querySelector(handleSel)
        w.__seen = 0
        const check = (): void => {
          const now = document.querySelector(handleSel)
          if (w.__seen === 0) {
            w.__gripSame = before2 === now
            w.__seen = 1
            return
          }
          if (before2 !== now) w.__gripSame = false
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }, `[data-testid="${surface.handle}"]`)

      await hoverHost(page, surface)
      await dragHandle(page, surface, 400, 8, 30)
      const sameNode = await page.evaluate(
        () => (window as unknown as { __gripSame?: boolean | null }).__gripSame
      )
      expect(sameNode, 'the resize grip element must be the same node for the whole gesture').toBe(
        true
      )

      // And the drag must have worked, which it cannot without the capture.
      const after = await widthOf(page, surface)
      expect(
        after,
        `a rightward drag must widen the block (pointer capture would be lost otherwise) — ${String(before)} to ${String(after)}`
      ).toBeGreaterThan(before + 100)
      expect(after, 'and stop on the boundary').toBeLessThanOrEqual(boundary + 1)
    })

    test('nothing at or above the declared boundary is written during the drag', async ({
      page,
      request
    }) => {
      const title = `ReadOnly ${Date.now()}`
      await surface.seed(request, title, surface.blocks)
      await openSurface(page, title, surface)
      const boundary = (await readBoundary(page, surface)).contentBox
      await hoverHost(page, surface)
      await dragHandle(page, surface, -400)

      // Watch the boundary and every ancestor above it. The abandoned probe offered the
      // block maximum through the width custom properties to exactly these elements, and
      // restored them in the same task - a MutationObserver records both writes anyway,
      // because its callback runs as a microtask after the task yields.
      await page.evaluate((containerSel) => {
        const w = window as unknown as {
          __mut?: Array<{ cls: string; name: string; value: string }>
          __carriers?: () => number
          __carriersBefore?: number
        }
        const mutations: Array<{ cls: string; name: string; value: string }> = []
        w.__mut = mutations
        const container = document.querySelector(containerSel)
        if (container === null) throw new Error('no container')
        const boundary = container.parentElement?.closest('[data-block-width-boundary]')
        if (boundary === null || boundary === undefined) throw new Error('no declared boundary')
        let node: Element | null = boundary
        while (node !== null) {
          const target: Element = node
          const cls = (target.getAttribute('class') ?? target.tagName).split(' ')[0]
          const observer = new MutationObserver((records) => {
            for (const r of records) {
              mutations.push({
                cls,
                name: r.attributeName ?? '(none)',
                value: target.getAttribute(r.attributeName ?? '') ?? ''
              })
            }
          })
          observer.observe(target, { attributes: true, attributeFilter: ['style', 'class'] })
          node = target.parentElement
        }
        // Also count how many elements carry a width property, before and after.
        w.__carriers = (): number => {
          let count = 0
          let e: Element | null = container
          while (e !== null) {
            const inline = (e as HTMLElement).style
            if (
              inline.getPropertyValue('--block-width').trim() !== '' ||
              inline.getPropertyValue('--block-width-live').trim() !== ''
            ) {
              count += 1
            }
            e = e.parentElement
          }
          return count
        }
        w.__carriersBefore = w.__carriers()
      }, surface.container)

      await hoverHost(page, surface)
      await dragHandle(page, surface, 600, 8, 30)
      await page.waitForTimeout(200)

      const result = await page.evaluate(() => {
        const w = window as unknown as {
          __mut?: Array<{ cls: string; name: string; value: string }>
          __carriers?: () => number
          __carriersBefore?: number
        }
        return {
          mutations: w.__mut ?? [],
          carriersBefore: w.__carriersBefore ?? -1,
          carriersAfter: w.__carriers?.() ?? -1
        }
      })

      const widthWrites = result.mutations.filter((m) => m.name === 'style')
      expect(
        widthWrites,
        `a read-only boundary lookup must not write to the boundary or its ancestors — got ${JSON.stringify(result.mutations)}`
      ).toEqual([])
      expect(
        result.carriersAfter,
        'and must not have left a width property on any element'
      ).toBeLessThanOrEqual(result.carriersBefore + 1)

      const drawn = await widthOf(page, surface)
      expect(
        Math.abs(drawn - boundary),
        'and the drag still stopped on the boundary'
      ).toBeLessThanOrEqual(1)
    })

    test('the resolver follows the marker wherever the surface puts it', async ({
      page,
      request
    }) => {
      const title = `Moved ${Date.now()}`
      await surface.seed(request, title, surface.blocks)
      await openSurface(page, title, surface)
      const declared = await readBoundary(page, surface)
      expect(declared.found, 'the surface declares a boundary').toBe(true)

      // Move the declaration to an ancestor that is genuinely wider. This proves the
      // declaration is what the DOM contract is read from - nearest marker wins - and that
      // the resize never exceeds whatever element is marked.
      //
      // It does **not** by itself tell a declared resolver from an inferred one, because
      // this helper reads the marker the same way the component does. The test that does
      // discriminate is `the clamp follows the declaration, not the layout` below, which
      // observes the resolver through the only thing it can affect: the width a drag stops
      // at.
      const moved = await page.locator(surface.container).evaluate((el) => {
        const contentBox = (n: Element): number => {
          const cs = getComputedStyle(n)
          return (
            (n as HTMLElement).clientWidth -
            ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0))
          )
        }
        const before = el.parentElement?.closest('[data-block-width-boundary]')
        if (before === null || before === undefined) throw new Error('no declared boundary')
        const beforeBox = contentBox(before)
        // Walk up to the first ancestor wide enough to be unmistakable.
        let target: Element | null = before.parentElement
        while (target !== null && contentBox(target) < beforeBox + 50) {
          target = target.parentElement
        }
        if (target === null) throw new Error('no ancestor is 50px wider than the boundary')
        before.removeAttribute('data-block-width-boundary')
        target.setAttribute('data-block-width-boundary', '')
        return {
          beforeContentBox: beforeBox,
          afterContentBox: contentBox(target),
          afterClass: (target.getAttribute('class') ?? target.tagName).split(' ')[0],
          afterTestId: target.getAttribute('data-testid')
        }
      })

      const nowBoundary = await readBoundary(page, surface)
      expect(nowBoundary.found, 'the relocated declaration must still be found').toBe(true)
      expect(
        Math.abs(nowBoundary.contentBox - moved.afterContentBox),
        `the resolver must follow the marker onto ${moved.afterClass}@${String(moved.afterTestId)}: it reported ${String(nowBoundary.contentBox)}, which measures ${String(moved.afterContentBox)} (the original boundary was ${String(moved.beforeContentBox)})`
      ).toBeLessThanOrEqual(1)

      // The declaration is the **clamp''s ceiling**, not a promise that CSS will allow that
      // much. Relocating the marker above the element that carries `max-width: 100%` widens
      // the clamp while the browser keeps its own, narrower limit: measured on the Diagram
      // page, the marker moved to `.contentRow` (1104px) and the block still stopped at
      // 814px, because the `Reorder.Item''s own `max-width: 100%` resolves against
      // `.blockList`. So the invariant asserted here is one-sided - never wider than the
      // declaration - and the two limits are deliberately not conflated.
      await hoverHost(page, surface)
      await dragHandle(page, surface, -400)
      await hoverHost(page, surface)
      await dragHandle(page, surface, 2400, 12, 30)
      const drawn = await widthOf(page, surface)
      expect(
        drawn,
        `a block must never draw wider than the declared boundary (${String(moved.afterContentBox)}), drew ${String(drawn)}`
      ).toBeLessThanOrEqual(moved.afterContentBox + 1)
      expect(drawn, 'and the block must still be a real width').toBeGreaterThan(200)
    })

    test('removing the marker is reported, and no unrelated ancestor is chosen instead', async ({
      page,
      request
    }) => {
      const title = `NoMarker ${Date.now()}`
      await surface.seed(request, title, surface.blocks)
      await openSurface(page, title, surface)
      const withMarker = await readBoundary(page, surface)
      expect(withMarker.contentBox, 'the boundary exists to begin with').toBeGreaterThan(200)
      expect(
        withMarker.contentBox,
        'and the 960px preset must be clamped by it, so the marker-removal case below is visible'
      ).toBeLessThan(PRESET_LARGE_WIDTH)

      const warnings: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'warning') warnings.push(m.text())
      })

      // Take the surface's declaration away, the way a refactor that moved the wrapper
      // would. Nothing in the implementation is modified: this is the contract failing.
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('[data-block-width-boundary]'))) {
          el.removeAttribute('data-block-width-boundary')
        }
      })
      expect(
        await page.locator('[data-block-width-boundary]').count(),
        'the marker must really be gone for this test to mean anything'
      ).toBe(0)

      await hoverHost(page, surface)
      await page.getByTestId(surface.presetLarge).click()
      await page.waitForTimeout(600)

      // It must be reported, not silent.
      expect(
        warnings.some((w) => w.includes('block width boundary missing')),
        `a missing boundary must be reported — console saw ${JSON.stringify(warnings)}`
      ).toBe(true)

      // And it must not have quietly settled on some other ancestor: the preset now stores
      // the block maximum rather than the surface's width, so the document holds a size the
      // page cannot draw. That is the defect class the declared contract exists to remove,
      // and it is asserted rather than assumed.
      const stored = await storedWidth(page, surface)
      const drawn = await widthOf(page, surface)
      expect(
        stored,
        `with no declared boundary the clamp must fall back to the block maximum (${String(BLOCK_MAX_WIDTH)}), not to an unrelated ancestor`
      ).toBe(Math.min(PRESET_LARGE_WIDTH, BLOCK_MAX_WIDTH))
      expect(
        stored,
        `and the consequence must be visible: stored ${String(stored)} exceeds the ${String(withMarker.contentBox)}px the surface can draw`
      ).toBeGreaterThan(withMarker.contentBox)
      expect(
        drawn,
        `CSS still clamps the drawing, so the block drew ${String(drawn)} of a stored ${String(stored)}`
      ).toBeLessThanOrEqual(withMarker.contentBox + 1)

      // The marker stays off, proving the resolver kept looking and kept failing rather
      // than quietly re-resolving.
      expect(
        await page.locator('[data-block-width-boundary]').count(),
        'nothing re-added the marker behind the test'
      ).toBe(0)
    })
  })
}

// The one test that tells a **declared** boundary from an **inferred** one, because it
// observes the resolver through the only thing it can affect: the width a drag stops at.
//
// It needs a case where the declaration and the layout inference disagree, and only the
// Diagram page has one. Its `Reorder.Item` is *narrower* than the row it sits in - 401px of
// 814px when a second block is beside it - and it is exactly the element the inference had
// to skip, because it is sized by the block and shares the row. So:
//
//   declared on the item  ->  the clamp is the item's 401px, and the drag stops at 401
//   inferred (item skipped) ->  the clamp is the row's 814px, and the drag stops at 814
//
// The markers are moved at runtime; no implementation code is touched.

test.describe('diagram page: the clamp follows the declaration, not the layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test.afterEach(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('declaring the boundary on the item clamps the drag to the item', async ({
    page,
    request
  }) => {
    const title = `Clamp ${Date.now()}`
    await DIAGRAM_PAGE.seed(request, title, 2)
    await page.goto('/')
    await openPageViaFinder(page, title)
    await expect(page.locator('[data-testid="diagram-block-1-svg"] svg').first()).toBeVisible({
      timeout: 25_000
    })
    await page.waitForTimeout(1200)

    const second = '[data-testid="diagram-block-1-container"]'
    const geometry = await page.locator(second).evaluate((el) => {
      const box = (n: Element): number => {
        const cs = getComputedStyle(n)
        return (
          (n as HTMLElement).clientWidth -
          ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0))
        )
      }
      const item = el.parentElement
      if (item === null) throw new Error('the block has no item')
      const list = item.closest('[data-block-width-boundary]')
      if (list === null) throw new Error('no declared boundary')
      return { itemBox: box(item), rowBox: box(list) }
    })
    expect(
      geometry.itemBox,
      `the item must be a share of the row for this to discriminate (item ${String(geometry.itemBox)}, row ${String(geometry.rowBox)})`
    ).toBeLessThan(geometry.rowBox - 100)

    // Declare the boundary on the item instead of the row.
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (el === null || el.parentElement === null) throw new Error('no container')
      const item = el.parentElement
      const list = item.closest('[data-block-width-boundary]')
      list?.removeAttribute('data-block-width-boundary')
      item.setAttribute('data-block-width-boundary', '')
    }, second)

    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    const handleBox = await handle.boundingBox()
    if (handleBox === null) throw new Error('no handle')
    const from = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(from.x + i * 60, from.y)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(900)

    const drawn = await page
      .locator(second)
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(
      Math.abs(drawn - geometry.itemBox),
      `the clamp must follow the declaration onto the item: drew ${String(drawn)}, the item is ${String(geometry.itemBox)} and the row is ${String(geometry.rowBox)}. An inferred boundary skips the item and would stop at ${String(geometry.rowBox)}.`
    ).toBeLessThanOrEqual(1)
  })
})

// ------------------------------------------------------------------------ the second
// column, which is the case the inferred implementation got wrong: the block's own parent
// is a share of the row, so a boundary read from the parent forbids all growth.

test.describe('diagram page: a block sharing the row', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test.afterEach(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('a second-column block widens to the row, not to its own share', async ({
    page,
    request
  }) => {
    const title = `Second ${Date.now()}`
    await DIAGRAM_PAGE.seed(request, title, 2)
    await page.goto('/')
    await openPageViaFinder(page, title)
    await expect(page.locator('[data-testid="diagram-block-1-svg"] svg').first()).toBeVisible({
      timeout: 25_000
    })
    await page.waitForTimeout(1200)

    const second = '[data-testid="diagram-block-1-container"]'
    const boundary = await page.locator(second).evaluate((el) => {
      const b = el.parentElement?.closest('[data-block-width-boundary]')
      if (b === null || b === undefined) throw new Error('no declared boundary')
      const cs = getComputedStyle(b)
      return (
        b.clientWidth - ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0))
      )
    })
    const start = await page
      .locator(second)
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    const item = await page
      .locator(second)
      .evaluate((el) => (el.parentElement as HTMLElement).clientWidth)
    expect(
      start,
      `two blocks must actually share the row, or this test is not testing a share (block ${String(start)}, item ${String(item)}, row ${String(boundary)})`
    ).toBeLessThan(boundary - 100)

    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    if (box === null) throw new Error('no handle')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(from.x + i * 60, from.y)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()
    await page.waitForTimeout(900)

    const after = await page
      .locator(second)
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(
      after,
      `a block in the second column must widen — ${String(start)} to ${String(after)} against a ${String(boundary)}px row`
    ).toBeGreaterThan(start + 200)
    expect(
      Math.abs(after - boundary),
      `and stop on the declared row boundary: ${String(after)} vs ${String(boundary)}`
    ).toBeLessThanOrEqual(1)
  })
})
