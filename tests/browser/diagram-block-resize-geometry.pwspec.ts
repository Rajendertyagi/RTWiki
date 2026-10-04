import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * Diagram block geometry that is not about the diagram's size in the document: what
 * the box does **while** and **immediately after** a pointer drag, and how short it is
 * allowed to be.
 *
 * Two faults are guarded here, both found by measuring rendered geometry rather than
 * by reading attributes:
 *
 * 1. **The release rebound.** `ResizableBlockContainer` publishes the in-flight size by
 *    writing `--block-width-live` straight onto Motion's `Reorder.Item`, and clears it
 *    again when the drag ends. Clearing that *synchronously*, inside the `pointerup`
 *    handler, landed before React had published the committed width — so for one commit
 *    the item had neither, fell back to `width: auto` with the row-sharing flex rules
 *    back in force, snapped to the full column, and then Motion animated the correction
 *    down to the stored size. Measured: 614, 814, 812, 811 … 634, 614 — about 280ms of
 *    the block being the full column width. The stored value was always right, so only
 *    the frames could see it.
 *
 * 2. **The minimum height.** The control pad is anchored to `.host`, which is the
 *    *second* row of the Diagram page's card; the first is the action row. One shared
 *    floor for both surfaces under-floored the card, so `overflow: hidden` clipped the
 *    pad: at a stored height of 140 the card ended at y=298 with the pad ending at
 *    y=304, putting the pan-down and full-screen buttons partly outside the card and
 *    clipping 28px of canvas. A Rich Note block at the same 140 is fine, because its
 *    padding gives the pad room — which is why the floor is per surface.
 */

const DIAGRAM = 'flowchart LR\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]\n  C --> D[Delta]'

const DIAGRAM_PAGE = {
  container: '[data-testid="diagram-block-0-container"]',
  item: '[data-testid="diagram-block-item-0"]',
  handle: 'diagram-block-0-resize-handle',
  svg: '[data-testid="diagram-block-0-svg"] svg',
  blockSvg: '[data-testid="diagram-block-0-svg"]',
  stage: '[data-testid="diagram-block-0-container"] [class*="_stage_"]',
  hover: '[data-testid="diagram-block-0-container"]'
}

const RICH = {
  container: '[data-testid="diagram-container"]',
  handle: 'diagram-resize-handle',
  svg: '[data-testid="diagram-svg"] svg',
  hover: '[data-testid="diagram-preview"]'
}

/** The eight view controls, by which the clip is proved. */
const VIEW_CONTROLS = [
  'pan-up',
  'pan-left',
  'reset-view',
  'pan-down',
  'zoom-in',
  'pan-right',
  'zoom-out',
  'full-screen'
] as const

async function seedDiagramPage(
  request: APIRequestContext,
  title: string,
  block: Record<string, unknown>
): Promise<void> {
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
}

async function seedNote(
  request: APIRequestContext,
  title: string,
  props: Record<string, unknown>
): Promise<string> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      // A note block carries its size in `props`, not beside `type` as a Diagram page
      // block does. Spreading them at the top level seeds keys BlockNote ignores, and the
      // block then renders unsized — which looks exactly like a broken height floor.
      content: JSON.stringify([
        { id: 'd', type: 'diagram', content: DIAGRAM, props: { width: '', height: '', ...props } }
      ])
    }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page.id
}

async function hoverHost(page: Page, container: string): Promise<void> {
  const box = await page.locator(`${container} [class*="_host_"]`).first().boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(260)
}

/** Loads the app, opens a page through the finder, and waits for its diagram. */
async function openSurface(page: Page, title: string, svgSelector: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  await expect(page.locator(svgSelector).first()).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(900)
}

/**
 * Where each of the eight controls sits relative to the box that clips them.
 *
 * Hit-testing is included, and only after a hover, because the pad is inert until
 * revealed — measuring it un-hovered would report every button as unreachable and
 * pass for the wrong reason.
 */
async function controlPlacement(
  page: Page,
  container: string,
  clipSelector: string,
  idPrefix: string
): Promise<{ padInside: boolean; controlsInside: boolean; outside: string[]; occluded: string[] }> {
  await hoverHost(page, container)
  return await page.evaluate(
    ({ container: c, clip: clipSel, prefix }) => {
      const clip = document.querySelector(clipSel)
      const pad = document.querySelector(`${c} [class*="_controls_"]`)
      if (clip === null || pad === null) throw new Error('placement: element not found')
      const bounds = clip.getBoundingClientRect()
      const names = [
        'pan-up',
        'pan-left',
        'reset-view',
        'pan-down',
        'zoom-in',
        'pan-right',
        'zoom-out',
        'full-screen'
      ]
      const within = (el: Element): boolean => {
        const b = el.getBoundingClientRect()
        return (
          b.top >= bounds.top - 1 &&
          b.bottom <= bounds.bottom + 1 &&
          b.left >= bounds.left - 1 &&
          b.right <= bounds.right + 1
        )
      }
      const hittable = (el: Element): boolean => {
        const b = el.getBoundingClientRect()
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        return top !== null && (top === el || el.contains(top))
      }
      const outside: string[] = []
      const occluded: string[] = []
      for (const name of names) {
        const el = document.querySelector<HTMLElement>(`[data-testid="${prefix}-${name}"]`)
        if (el === null) {
          outside.push(`${name}:missing`)
          continue
        }
        if (!within(el)) outside.push(name)
        else if (!hittable(el)) occluded.push(name)
      }
      return {
        padInside: within(pad),
        controlsInside: outside.length === 0 && occluded.length === 0,
        outside,
        occluded
      }
    },
    { container, clip: clipSelector, prefix: idPrefix }
  )
}

test.describe('diagram block resize geometry', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('the rendered width never rebounds to the column when the drag is released', async ({
    page,
    request
  }) => {
    const title = `Rebound ${Date.now()}`
    await seedDiagramPage(request, title, {})
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const column = await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))

    // Sample the rendered width every animation frame across the whole gesture. The
    // reader sees exactly this sequence, so this is the thing that has to be right.
    await page.evaluate((sel) => {
      const w = window as unknown as { __frames?: number[] }
      w.__frames = []
      const el = document.querySelector(sel)
      if (el === null) throw new Error('no container')
      const t0 = performance.now()
      const tick = (): void => {
        w.__frames?.push(Math.round(el.getBoundingClientRect().width))
        if (performance.now() - t0 < 1200) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }, DIAGRAM_PAGE.container)

    const handle = page.getByTestId(DIAGRAM_PAGE.handle)
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    if (box === null) throw new Error('resize handle not visible')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(from.x - step * 25, from.y)
      await page.waitForTimeout(28)
    }
    await page.mouse.up()
    await page.waitForTimeout(1000)

    const frames =
      (await page.evaluate(() => (window as unknown as { __frames?: number[] }).__frames)) ?? []
    expect(frames.length, 'the sampler must have recorded frames').toBeGreaterThan(10)

    // The gesture is a leftward drag, so the rendered width may only ever decrease.
    // The rebound was an increase back to the column width, which this forbids outright.
    const increases: string[] = []
    for (let i = 1; i < frames.length; i++) {
      if (frames[i] > frames[i - 1] + 1) {
        increases.push(`frame ${i}: ${frames[i - 1]} -> ${frames[i]}`)
      }
    }
    expect(
      increases,
      `the rendered width must not increase at any point during a leftward drag — sequence ${frames.join(',')}`
    ).toEqual([])
    // Nothing may exceed the width the block started at, which is the column here.
    expect(
      Math.max(...frames),
      `no frame may exceed the ${column}px the block started at — sequence ${frames.join(',')}`
    ).toBeLessThanOrEqual(column)
    // And the drag must actually have done its work, or the sequence above is trivial.
    expect(
      Math.min(...frames),
      `the drag should have narrowed the block by roughly 200px from ${column} — sequence ${frames.join(',')}`
    ).toBeLessThan(column - 150)

    // And the committed value must match what is on screen, with nothing left painted.
    const finalWidth = await container.evaluate((el) =>
      Math.round(el.getBoundingClientRect().width)
    )
    const stored = await container.getAttribute('data-width')
    expect(
      Math.abs(Number(stored) - finalWidth),
      `stored ${String(stored)} must equal the ${finalWidth}px the block draws`
    ).toBeLessThanOrEqual(1)
    expect(
      await page.evaluate((sel) => {
        const item = document.querySelector<HTMLElement>(sel)
        if (item === null) return { live: '(no item)', liveVar: '(no item)' }
        return {
          live: item.getAttribute('data-live'),
          liveVar: item.style.getPropertyValue('--block-width-live').trim()
        }
      }, DIAGRAM_PAGE.item),
      'the in-flight drag size must be cleared once the commit has landed'
    ).toEqual({ live: null, liveVar: '' })
  })

  test('a narrow → wide → narrow round trip tracks the pointer and persists each step', async ({
    page,
    request
  }) => {
    const title = `RoundTrip ${Date.now()}`
    await seedDiagramPage(request, title, {})
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const width = async (): Promise<number> =>
      await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))

    const drag = async (dx: number): Promise<void> => {
      const handle = page.getByTestId(DIAGRAM_PAGE.handle)
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      if (box === null) throw new Error('resize handle not visible')
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(from.x + (dx * step) / 8, from.y)
        await page.waitForTimeout(25)
      }
      await page.mouse.up()
      await page.waitForTimeout(1100)
    }

    const full = await width()
    expect(full, 'an unsized block takes the full row').toBeGreaterThan(600)

    await drag(-240)
    const narrow = await width()
    expect(narrow, 'dragging left must narrow the block').toBeLessThan(full - 40)
    expect(
      Math.abs(Number(await container.getAttribute('data-width')) - narrow),
      'the stored width must equal the narrowed width'
    ).toBeLessThanOrEqual(1)

    await drag(240)
    const wide = await width()
    expect(wide, 'the same grip must widen it again').toBeGreaterThan(narrow + 40)
    expect(
      Math.abs(Number(await container.getAttribute('data-width')) - wide),
      'the stored width must equal the widened width'
    ).toBeLessThanOrEqual(1)

    // Dragging past the row must clamp to the row, not exceed it.
    await drag(400)
    const clamped = await width()
    expect(clamped, 'a block may not grow past the row').toBeLessThanOrEqual(full + 1)
    expect(
      Math.abs(Number(await container.getAttribute('data-width')) - clamped),
      'the clamped width is what gets stored'
    ).toBeLessThanOrEqual(1)

    // And the last committed size is the one that survives a reload.
    await page.waitForTimeout(2500)
    await page.reload()
    await expect(page.locator(`${DIAGRAM_PAGE.blockSvg} svg`).first()).toBeVisible({
      timeout: 25_000
    })
    await page.waitForTimeout(1200)
    expect(await width(), 'the block must come back at the width it was left at').toBe(clamped)
  })

  test('a repeated height drag down and up lands where it is told and keeps the drawing whole', async ({
    page,
    request
  }) => {
    const title = `HeightDrag ${Date.now()}`
    await seedDiagramPage(request, title, { height: '400', width: '640' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const height = async (): Promise<number> =>
      await container.evaluate((el) => Math.round(el.getBoundingClientRect().height))

    const drag = async (dy: number): Promise<void> => {
      const handle = page.getByTestId(DIAGRAM_PAGE.handle)
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      if (box === null) throw new Error('resize handle not visible')
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(from.x, from.y + (dy * step) / 8)
        await page.waitForTimeout(25)
      }
      await page.mouse.up()
      await page.waitForTimeout(1000)
    }

    expect(await height()).toBe(400)

    await drag(300)
    const taller = await height()
    expect(taller, 'a downward drag must grow the box').toBeGreaterThan(650)
    expect(
      Math.abs(Number(await container.getAttribute('data-height')) - taller)
    ).toBeLessThanOrEqual(1)

    await drag(-300)
    const shorter = await height()
    expect(shorter, 'an upward drag must shrink the box').toBeLessThan(taller - 40)
    expect(
      Math.abs(Number(await container.getAttribute('data-height')) - shorter)
    ).toBeLessThanOrEqual(1)

    await drag(200)
    const again = await height()
    expect(again, 'a second downward drag must grow it again').toBeGreaterThan(shorter + 40)

    // Whatever the height, the drawing stays inside the box rather than being cropped.
    await page.waitForTimeout(2500)
    const inside = await page.evaluate((sel) => {
      const c = document.querySelector(sel)
      if (c === null) throw new Error('no container')
      const cb = c.getBoundingClientRect()
      const sb = c.querySelector<HTMLElement>('[class*="_svgHost_"] svg')?.getBoundingClientRect()
      if (sb === undefined) return { checked: false }
      return {
        checked: true,
        withinWidth: sb.left >= cb.left - 1 && sb.right <= cb.right + 1,
        withinHeight: sb.top >= cb.top - 1 && sb.bottom <= cb.bottom + 1
      }
    }, DIAGRAM_PAGE.container)
    expect(inside.checked, 'the drawing must be measurable').toBe(true)
    expect(inside.withinWidth, 'the drawing must not be cropped horizontally').toBe(true)
    expect(inside.withinHeight, 'the drawing must not be cropped vertically').toBe(true)
  })

  test('a diagram page block cannot be made shorter than its own controls', async ({
    page,
    request
  }) => {
    const title = `MinHeight ${Date.now()}`
    await seedDiagramPage(request, title, {})
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const geometry = async (): Promise<{ height: number; dataHeight: string | null }> => ({
      height: await container.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      dataHeight: await container.getAttribute('data-height')
    })

    // Unsized, the card is exactly bar + host floor + borders.
    const natural = await geometry()
    expect(
      natural.height,
      'an unsized card is sized by its own chrome and its controls'
    ).toBeGreaterThanOrEqual(169)

    // The keyboard cannot go below the floor, and the floor is honoured in the store.
    await page.getByTestId(DIAGRAM_PAGE.handle).focus()
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(900)
    const atFloor = await geometry()
    expect(atFloor.dataHeight, 'the floor must be committed, not merely painted').not.toBeNull()
    expect(
      Number(atFloor.dataHeight),
      `the committed height must be the floor or above, got ${String(atFloor.dataHeight)}`
    ).toBeGreaterThanOrEqual(169)
    expect(atFloor.height).toBeGreaterThanOrEqual(169)

    // And at the floor, all eight controls are inside the card that clips them.
    const placement = await controlPlacement(
      page,
      DIAGRAM_PAGE.container,
      'section[data-testid="diagram-block-0"]',
      'diagram-block-0'
    )
    expect(
      placement.outside,
      `no control may sit outside the card at the minimum height (outside: ${placement.outside.join(', ')}, occluded: ${placement.occluded.join(', ')})`
    ).toEqual([])
    expect(placement.padInside, 'the whole pad must be inside the card').toBe(true)
    expect(placement.controlsInside).toBe(true)
    expect(VIEW_CONTROLS.length, 'all eight view controls are covered').toBe(8)

    // Zoom and full screen still work at the floor, or the floor is too high.
    const before = await page
      .locator(`${DIAGRAM_PAGE.container} [class*="_layer_"]`)
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--view-scale').trim())
    await hoverHost(page, DIAGRAM_PAGE.container)
    await page.getByTestId('diagram-block-0-zoom-in').click()
    await page.waitForTimeout(400)
    expect(
      await page
        .locator(`${DIAGRAM_PAGE.container} [class*="_layer_"]`)
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--view-scale').trim()),
      'zoom must work at the minimum height'
    ).not.toBe(before)
    await hoverHost(page, DIAGRAM_PAGE.container)
    await expect(page.getByTestId('diagram-block-0-full-screen')).toBeVisible()
  })

  test('a diagram page block already stored below the floor still shows its controls', async ({
    page,
    request
  }) => {
    // A document written before the floor existed. Stored sizes are never rewritten on
    // load, so this state is reachable and has to render without losing a control.
    const title = `LegacyShort ${Date.now()}`
    await seedDiagramPage(request, title, { height: '140', width: '700' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)
    await page.waitForTimeout(100)

    expect(
      await page.locator(DIAGRAM_PAGE.container).getAttribute('data-height'),
      'the stored value is left alone'
    ).toBe('140')

    const placement = await controlPlacement(
      page,
      DIAGRAM_PAGE.container,
      'section[data-testid="diagram-block-0"]',
      'diagram-block-0'
    )
    expect(
      placement.outside,
      `a legacy short block must still show every control (outside: ${placement.outside.join(', ')}, occluded: ${placement.occluded.join(', ')})`
    ).toEqual([])
    expect(placement.padInside, 'the pad must be inside the card').toBe(true)

    // And the next edit moves it onto the floor.
    await page.getByTestId(DIAGRAM_PAGE.handle).focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(800)
    expect(
      Number(await page.locator(DIAGRAM_PAGE.container).getAttribute('data-height')),
      'editing a legacy short block stores a reachable height'
    ).toBeGreaterThanOrEqual(169)
  })

  test('a rich note block keeps the smaller floor, because it has no action row', async ({
    page,
    request
  }) => {
    const title = `NoteFloor ${Date.now()}`
    await seedNote(request, title, { height: '140', width: '500' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, RICH.svg)
    await page.waitForTimeout(100)

    expect(
      await page
        .locator(RICH.container)
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
      'the note floor stays at the controls height, with no action row added to it'
    ).toBe(140)

    const placement = await controlPlacement(
      page,
      RICH.container,
      '[data-testid="diagram-preview"]',
      'note-view'
    )
    expect(
      placement.outside,
      `every note control must be inside its pane at the floor (outside: ${placement.outside.join(', ')}, occluded: ${placement.occluded.join(', ')})`
    ).toEqual([])
    expect(placement.padInside).toBe(true)
  })

  test('a resized diagram page block restores its exact size after a reload', async ({
    page,
    request
  }) => {
    const title = `PersistD ${Date.now()}`
    await seedDiagramPage(request, title, {})
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const handle = page.getByTestId(DIAGRAM_PAGE.handle)
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    if (box === null) throw new Error('resize handle not visible')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(from.x - step * 22, from.y + step * 18)
      await page.waitForTimeout(25)
    }
    await page.mouse.up()
    await page.waitForTimeout(1200)

    const finalSize = await container.evaluate((el) => [
      Math.round(el.getBoundingClientRect().width),
      Math.round(el.getBoundingClientRect().height)
    ])
    const storedSize = {
      w: await container.getAttribute('data-width'),
      h: await container.getAttribute('data-height')
    }

    await page.waitForTimeout(3000)
    await page.reload()
    await expect(page.locator(`${DIAGRAM_PAGE.blockSvg} svg`).first()).toBeVisible({
      timeout: 25_000
    })
    await page.waitForTimeout(1400)

    const restored = page.locator(DIAGRAM_PAGE.container)
    expect(
      {
        w: await restored.getAttribute('data-width'),
        h: await restored.getAttribute('data-height')
      },
      'the stored size must survive a reload'
    ).toEqual(storedSize)
    expect(
      await restored.evaluate((el) => [
        Math.round(el.getBoundingClientRect().width),
        Math.round(el.getBoundingClientRect().height)
      ]),
      'the drawn size must be the size that was stored'
    ).toEqual(finalSize)
  })

  test('rapid resize then immediate in-app navigation still persists the final size', async ({
    page,
    request
  }) => {
    const title = `RapidD ${Date.now()}`
    const other = `RapidD other ${Date.now()}`
    await seedDiagramPage(request, title, {})
    const seedOther = await request.post('/api/pages', {
      data: {
        title: other,
        pageType: 'rich',
        content: JSON.stringify([{ id: 'p', type: 'paragraph', content: 'other' }])
      }
    })
    expect(seedOther.status()).toBe(201)

    await page.setViewportSize({ width: 1440, height: 900 })
    await openSurface(page, title, `${DIAGRAM_PAGE.blockSvg} svg`)

    const container = page.locator(DIAGRAM_PAGE.container)
    const handle = page.getByTestId(DIAGRAM_PAGE.handle)
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    if (box === null) throw new Error('resize handle not visible')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(from.x - step * 20, from.y)
      await page.waitForTimeout(20)
    }
    await page.mouse.up()
    // No settle: navigate inside the debounce window, which is where a lost size would
    // come from.
    const released = await container.evaluate((el) => [
      Math.round(el.getBoundingClientRect().width),
      Math.round(el.getBoundingClientRect().height)
    ])
    const stored = {
      w: await container.getAttribute('data-width'),
      h: await container.getAttribute('data-height')
    }

    await openPageViaFinder(page, other)
    await expect(page.getByTestId('rich-editor')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2500)

    await openPageViaFinder(page, title)
    await expect(page.locator(`${DIAGRAM_PAGE.blockSvg} svg`).first()).toBeVisible({
      timeout: 25_000
    })
    await page.waitForTimeout(1400)

    const back = page.locator(DIAGRAM_PAGE.container)
    expect(
      { w: await back.getAttribute('data-width'), h: await back.getAttribute('data-height') },
      'the size committed before navigating must be the one that comes back'
    ).toEqual(stored)
    expect(
      await back.evaluate((el) => [
        Math.round(el.getBoundingClientRect().width),
        Math.round(el.getBoundingClientRect().height)
      ]),
      'and it must be the size that was drawn at release'
    ).toEqual(released)
  })
})
