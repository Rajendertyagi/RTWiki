import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'

/**
 * The Diagram page's own layout and resize behaviour.
 *
 * Separate from `diagram-templates.pwspec.ts` because that file is about *which*
 * diagrams are offered and whether they render; this one is about how the page
 * arranges and sizes them, and about the page adopting the Rich Document's
 * structure. Every assertion runs against the real application — a real page, real
 * autosave, real layout — because the failure modes here (a row that overflows
 * sideways, a diagram silently shrunk to fit) are exactly the ones a unit test
 * cannot see.
 */

/** One synchronously-sampled moment of a resize drag. */
interface TrackSample {
  /** Pointer movement from where the drag started, in px. */
  dx: number
  dy: number
  /** The resize container's rendered box at that moment. */
  width: number
  height: number
  /** The reorder item's rendered box — the element the drag has to move. */
  itemWidth: number
  /** The in-flight size published on the item, and its marker attribute. */
  live: string
  liveAttr: string
}

interface TrackingWindow {
  __trackOrigin?: { px: number; py: number; w: number; h: number }
  __track?: TrackSample[]
}

async function newDiagramPage(page: Page, label: string): Promise<void> {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(`${label} ${Date.now()}`)
  await dialog.getByTestId('new-page-type-diagram').click()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('template-bar')).toBeVisible({ timeout: 20_000 })
}

/** Clicks a template in the toolbar and waits for the new block to render. */
async function addTemplate(page: Page, templateId: string, index: number): Promise<void> {
  await page.getByTestId(`template-${templateId}`).click()
  const svg = page.locator(`section[data-testid="diagram-block-${index}"] svg`).first()
  await expect(svg, `${templateId} must render`).toBeVisible({ timeout: 20_000 })
}

/** Seeds a Rich Note holding one diagram, and returns its title. */
async function seedNoteWithDiagram(request: APIRequestContext): Promise<string> {
  const title = `Surface ${Date.now()}`
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify([
        { type: 'paragraph', content: 'A note with one diagram.' },
        {
          type: 'diagram',
          content:
            'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]'
        }
      ])
    }
  })
  expect(res.status(), 'the seeded note should be created').toBe(201)
  return title
}

/** The three surface properties that decide whether two blocks look like each other. */
async function readSurface(
  locator: Locator
): Promise<{ bg: string; border: string; radius: string }> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el)
    return {
      bg: cs.backgroundColor,
      // The **width**, not the colour. `borderTopColor` resolves to the inherited text
      // colour even when the style is `none`, so asserting on it cannot distinguish
      // "no border" from "a border in the text colour" — which is precisely the
      // distinction this is read for.
      border: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius
    }
  })
}

/**
 * The stored content of the page whose title starts with `title`.
 *
 * Read from the list endpoint because that is where `content` lives: the
 * single-page route wraps its payload in `{ page }`, so reading `.content` off it
 * silently yields undefined and every assertion built on it passes or fails for
 * the wrong reason.
 */
async function storedContent(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ title: string; content?: string }> }
  const match = body.pages.find((candidate) => candidate.title.startsWith(title))
  expect(
    match,
    `no page titled like "${title}" in [${body.pages.map((p) => p.title).join(', ')}]`
  ).toBeDefined()
  expect(typeof match?.content, `the stored content for "${title}" must be a string`).toBe('string')
  return match?.content ?? ''
}

/** The stored block list, parsed. Fails loudly rather than throwing inside a poll. */
async function storedBlocks(request: APIRequestContext, title: string): Promise<unknown[]> {
  const raw = await storedContent(request, title)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`stored content for "${title}" is not JSON: ${raw.slice(0, 200)}`)
  }
  const blocks = (parsed as { blocks?: unknown[] }).blocks
  expect(Array.isArray(blocks), `stored content for "${title}" has no block list`).toBe(true)
  return blocks ?? []
}

test.describe('Diagram page layout', () => {
  test('the page carries the same chrome as a Rich Note: tabs, toolbar, info, workspace', async ({
    page
  }) => {
    await newDiagramPage(page, 'Chrome')

    // The toolbar row, which the Rich Note also has. This is the row that did not
    // exist here before.
    const row = page.getByTestId('diagram-toolbar-row')
    await expect(row).toBeVisible()
    await expect(page.getByTestId('template-bar')).toBeVisible()

    // The page-information bar: the shared title header, above the toolbar. It has
    // no testid of its own, so the page title inside it stands in for it.
    await expect(page.getByTestId('editor-title')).toBeVisible()

    // And the workspace itself, below them.
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    // Ordering, which is the part a "has all three" check would miss. The required
    // order is tabs, toolbar, info bar, workspace — and the Rich Note puts its
    // toolbar above its title header too, so matching it is what "the same UI
    // structure" means here.
    const order = await page.evaluate(() => {
      const top = (testId: string): number => {
        const el = document.querySelector(`[data-testid="${testId}"]`)
        return el ? el.getBoundingClientRect().top : Number.NaN
      }
      return {
        header: top('editor-title'),
        toolbar: top('diagram-toolbar-row'),
        workspace: top('diagram-workspace')
      }
    })
    expect(order.toolbar, 'the toolbar sits above the page information').toBeLessThan(order.header)
    expect(order.header, 'the page information sits above the workspace').toBeLessThan(
      order.workspace
    )
  })

  test('Add Diagram and the template chooser are together in the one toolbar row', async ({
    page
  }) => {
    // The complaint this fixes: the template chooser was in the toolbar row while
    // "Add diagram" was still on the workspace's own view bar *below* the page
    // header, so the page's two ways of creating a diagram were split across two
    // bars and the one that added a specific type was the one you had to find.
    await newDiagramPage(page, 'CreateColocated')

    const row = page.getByTestId('diagram-toolbar-row')
    const add = page.getByTestId('diagram-add-block')
    const bar = page.getByTestId('template-bar')

    await expect(add, 'Add Diagram is in the toolbar row').toBeVisible()
    await expect(bar).toBeVisible()

    // Containment, not just visibility. "Both are on screen" is satisfied by the
    // old split arrangement, which is the whole defect.
    await expect(row.locator('[data-testid="diagram-add-block"]')).toHaveCount(1)
    await expect(row.locator('[data-testid="template-bar"]')).toHaveCount(1)
    // Exactly one Add control on the page — a second one in the view bar would be
    // the regression coming back.
    await expect(page.getByTestId('diagram-add-block')).toHaveCount(1)

    // Both in the same row, add button first.
    const tops = await page.evaluate(() => {
      const top = (sel: string): number => {
        const el = document.querySelector(sel)
        return el ? el.getBoundingClientRect().top : Number.NaN
      }
      return {
        add: top('[data-testid="diagram-add-block"]'),
        bar: top('[data-testid="template-bar"]')
      }
    })
    expect(tops.add, 'Add Diagram and the chooser share one row').toBeCloseTo(tops.bar, -1)
  })

  test('Add Diagram creates a default diagram, repeatedly', async ({ page, request }) => {
    // Specifically a repeated press. The first version of this feature stored the
    // action's function instead of calling through a ref, so every press rebuilt
    // the list from the closure captured when the toolbar appeared — two presses
    // produced one new block. One press would not have caught it.
    await newDiagramPage(page, 'AddRepeated')

    await expect(page.getByTestId('diagram-block-0')).toBeVisible()
    await page.getByTestId('diagram-add-block').click()
    await expect(page.getByTestId('diagram-block-1')).toBeVisible()
    await page.getByTestId('diagram-add-block').click()
    await expect(page.getByTestId('diagram-block-2')).toBeVisible()

    // Still in view mode: creating a diagram is not entering edit mode.
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')

    // And it persisted, rather than only appearing on screen.
    await expect
      .poll(async () => (await storedBlocks(request, 'AddRepeated')).length, { timeout: 20_000 })
      .toBe(3)
  })

  test('the creation controls stay usable as the window narrows', async ({ page }) => {
    // Two layout defects this pins down.
    //
    // 1. The bar was `flex: 0 0 auto`, so its `clientWidth` always equalled the full
    //    width of all 30 templates. `useToolbarOverflow` budgets against that width,
    //    so the budget was never exceeded and the trailing "more" menu could never
    //    appear — the bar simply spilled past the window. Measured at 900px: 1093px
    //    of content in a 564px row.
    // 2. Adding the Add Diagram button beside it made that worse, because in a
    //    `nowrap` row the button absorbed the squeeze and its label was compressed
    //    to a 15px sliver.
    //
    // So this asserts the *row* never overflows and the button never collapses,
    // across three widths.
    for (const width of [1600, 1200, 900]) {
      await page.setViewportSize({ width, height: 950 })
      await newDiagramPage(page, `Narrow${width}`)

      const geom = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="diagram-toolbar-row"]') as HTMLElement
        const add = document.querySelector('[data-testid="diagram-add-block"]') as HTMLElement
        const bar = document.querySelector('[data-testid="template-bar"]') as HTMLElement
        return {
          scrollW: row.scrollWidth,
          clientW: row.clientWidth,
          addW: add.getBoundingClientRect().width,
          barRight: bar.getBoundingClientRect().right,
          viewport: window.innerWidth
        }
      })

      expect(geom.scrollW, `the toolbar row must not overflow at ${width}px`).toBeLessThanOrEqual(
        geom.clientW
      )
      // The label is "Add diagram" plus a 14px icon; anything under 90px means the
      // text has been squeezed out of it.
      expect(geom.addW, `Add Diagram must keep its label at ${width}px`).toBeGreaterThan(90)
      expect(
        geom.barRight,
        `the template bar must stay inside the window at ${width}px`
      ).toBeLessThanOrEqual(geom.viewport)
    }
  })

  test('the workspace view bar keeps the view controls and no longer creates', async ({ page }) => {
    // The complementary half: moving Add out must not have emptied the view bar
    // or taken a view control with it.
    await newDiagramPage(page, 'ViewControls')

    for (const id of ['diagram-refresh', 'diagram-zoom-in', 'diagram-zoom-out']) {
      await expect(page.getByTestId(id), `${id} stays in the workspace`).toBeVisible()
    }
    await expect(page.getByTestId('diagram-zoom-label')).toBeVisible()
    // No creation control left behind in the workspace.
    await expect(
      page.locator('[data-testid="diagram-workspace"] [data-testid="diagram-add-block"]')
    ).toHaveCount(0)
  })

  test('the toolbar is visible without entering edit mode, and picking adds a diagram', async ({
    page
  }) => {
    await newDiagramPage(page, 'ToolbarAdds')

    // No edit mode was entered, and the bar was still there.
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')
    await expect(page.getByTestId('template-bar')).toBeVisible()

    await addTemplate(page, 'sequence', 1)
    await expect(page.locator('section[data-testid="diagram-block-1"]')).toBeVisible()
    // Still in view mode: choosing a type is not an editing gesture.
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')
  })

  test('several diagrams coexist and survive a reload', async ({ page, request }) => {
    await newDiagramPage(page, 'Multi')
    await addTemplate(page, 'sequence', 1)
    await addTemplate(page, 'gantt', 2)

    // Autosave is debounced, so give the write a moment before reloading.
    await expect
      .poll(async () => (await storedBlocks(request, 'Multi')).length, { timeout: 20_000 })
      .toBe(3)

    await page.reload()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    for (const index of [0, 1, 2]) {
      await expect(
        page.locator(`section[data-testid="diagram-block-${index}"]`),
        `block ${index} must survive the reload`
      ).toBeVisible()
    }
  })

  test('diagrams sit side by side when the width allows, and stack when it does not', async ({
    page
  }) => {
    // Measured at both ends of the range, because "when the available width
    // allows" is only half the claim. A test at one width proves one of them.
    const boxesNow = async (): Promise<Array<{ top: number; left: number; width: number }>> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('section[data-testid^="diagram-block-"]')).map(
          (el) => {
            const r = el.getBoundingClientRect()
            return { top: Math.round(r.top), left: Math.round(r.left), width: r.width }
          }
        )
      )
    const rowCount = (boxes: Array<{ top: number }>): number =>
      new Set(boxes.map((b) => b.top)).size
    const sideOverflow = async (): Promise<void> => {
      const list = page.getByTestId('diagram-block-list')
      const m = await list.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      }))
      // The assertion that fails if the row were a fixed-column grid, and it is
      // why the layout wraps rather than dividing into columns.
      expect(m.scrollWidth, 'the diagram row must not overflow horizontally').toBeLessThanOrEqual(
        m.clientWidth + 1
      )
    }

    // Wide: diagrams share rows.
    await page.setViewportSize({ width: 1800, height: 1000 })
    await newDiagramPage(page, 'WrapWide')
    await addTemplate(page, 'sequence', 1)
    await addTemplate(page, 'gantt', 2)
    const wide = await boxesNow()
    expect(wide.length, 'all three diagrams are present').toBe(3)
    expect(
      rowCount(wide),
      `wide: diagrams should share rows, got ${JSON.stringify(wide)}`
    ).toBeLessThan(wide.length)
    await sideOverflow()

    // Narrow: the same diagrams stack one per row rather than being squeezed,
    // and still do not overflow sideways.
    await page.setViewportSize({ width: 900, height: 1000 })
    await page.waitForTimeout(800)
    const narrow = await boxesNow()
    expect(
      rowCount(narrow),
      `narrow: diagrams should stack one per row, got ${JSON.stringify(narrow)}`
    ).toBe(narrow.length)
    await sideOverflow()
  })

  test('a diagram taller than the viewport scrolls the page instead of shrinking', async ({
    page
  }) => {
    await newDiagramPage(page, 'Tall')

    // A gantt with many rows is the realistic tall case; the stored height is left
    // unset so the block takes the height the diagram needs.
    await addTemplate(page, 'gantt', 1)
    await expect(page.locator('section[data-testid="diagram-block-1"]')).toBeVisible()

    const list = page.getByTestId('diagram-block-list')
    const canScroll = await list.evaluate((el) => getComputedStyle(el).overflowY)
    expect(canScroll, 'the diagram area is the vertical scroll owner').toBe('auto')

    // And the diagram is not clamped to the viewport height by any max-height, which
    // is what "do not shrink it to fit" means in the DOM.
    const clamped = await page
      .locator('section[data-testid="diagram-block-1"] svg')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return { maxHeight: s.maxHeight, height: el.getBoundingClientRect().height }
      })
    expect(clamped.maxHeight).toBe('none')
    expect(clamped.height).toBeGreaterThan(0)
  })

  test('a diagram block resizes on both axes, and the size is stored', async ({
    page,
    request
  }) => {
    await newDiagramPage(page, 'Resize')
    await addTemplate(page, 'sequence', 1)

    const container = page.getByTestId('diagram-block-1-container')
    await expect(container).toBeVisible()
    const before = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))

    // The right edge grip is the one control that drives both axes at once. It is
    // 8px wide and sits mid-height on the block's right edge, so it is grabbed at its
    // own centre — the old corner handle was 18px square and a fixed +8 offset from
    // its top-left was inside it, which the edge grip is not.
    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    const from = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2
    }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x - 120, from.y - 60, { steps: 8 })
    await page.mouse.up()

    const after = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))
    expect(after.width, 'a leftward drag narrows the block').toBeLessThan(before.width)
    expect(after.height, 'an upward drag shortens the block').toBeLessThan(before.height)

    // Both dimensions are committed to the document, not just held in the DOM.
    await expect
      .poll(
        async () => {
          const blocks = (await storedBlocks(request, 'Resize')) as Array<{
            width?: string
            height?: string
          }>
          const block = blocks[1]
          return Boolean(block?.width) && Boolean(block?.height)
        },
        { timeout: 20_000 }
      )
      .toBe(true)
  })

  // The three tests below all guard one defect: the box did not follow the pointer,
  // it snapped to the dragged size on release. Every other resize test checks the
  // size *after* the pointer comes up, so all of them passed while the control felt
  // frozen and inconsistent.
  //
  // The cause was that the resize container is capped to `max-width: 100%` of its
  // parent, and the parent here is a flex item that only re-sized on commit. Narrowing
  // still appeared to work, because the box could shrink inside its share, so the
  // drag has to go the other way to catch it.

  test('the block follows the pointer during a widening drag, on both axes', async ({ page }) => {
    await newDiagramPage(page, 'Tracking')
    await addTemplate(page, 'sequence', 1)

    // Wide enough that the block is *not* already filling the row. At the default
    // viewport block 1 spans the whole list, the drag ceiling equals its current
    // width, and widening is correctly refused — which would make this test measure
    // the clamp instead of the tracking.
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.waitForTimeout(300)

    const container = page.getByTestId('diagram-block-1-container')
    await expect(container).toBeVisible()
    const start = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))

    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    // Grabbed at the grip's own centre: it is 8px wide, so the old +8 offset from
    // the top-left corner landed outside it and the drag never started.
    const from = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2
    }

    // Sampled synchronously inside the same `pointermove` event that published the
    // size. The size reaches the DOM as a custom property rather than through React
    // state, so it is already on the element when this runs and a reading cannot lag
    // a commit behind and hide a stall.
    await page.evaluate(
      (origin) => {
        const w = window as unknown as TrackingWindow
        w.__trackOrigin = origin
        w.__track = []
        document.addEventListener('pointermove', (event) => {
          const pointer = event as PointerEvent
          const boxEl = document.querySelector<HTMLElement>(
            '[data-testid="diagram-block-1-container"]'
          )
          const itemEl = document.querySelector<HTMLElement>('[data-testid="diagram-block-item-1"]')
          if (boxEl === null || itemEl === null || w.__trackOrigin === undefined) return
          const track = w.__track ?? []
          w.__track = track
          track.push({
            dx: Math.round(pointer.clientX - w.__trackOrigin.px),
            dy: Math.round(pointer.clientY - w.__trackOrigin.py),
            width: boxEl.getBoundingClientRect().width,
            height: boxEl.getBoundingClientRect().height,
            itemWidth: itemEl.getBoundingClientRect().width,
            live: itemEl.style.getPropertyValue('--block-width-live').trim(),
            liveAttr: itemEl.getAttribute('data-live') ?? ''
          })
        })
      },
      { px: from.x, py: from.y, w: start.width, h: start.height }
    )

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(from.x + step * 15, from.y + step * 6)
      await page.waitForTimeout(40)
    }
    await page.mouse.up()

    const samples = (await page.evaluate(
      () => (window as unknown as TrackingWindow).__track ?? []
    )) as TrackSample[]

    expect(samples.length, 'the drag produced samples to judge').toBeGreaterThan(4)

    // Widening by 120px stays well inside the row, so no sample should be clamped and
    // the expected size is simply the start plus the pointer's own delta.
    for (const s of samples) {
      const expectedWidth = start.width + s.dx
      const expectedHeight = start.height + s.dy
      expect(
        Math.abs(s.width - expectedWidth),
        `box width ${s.width} vs expected ${expectedWidth} at dx=${s.dx}`
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(s.height - expectedHeight),
        `box height ${s.height} vs expected ${expectedHeight} at dy=${s.dy}`
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(s.itemWidth - expectedWidth),
        `item width ${s.itemWidth} vs expected ${expectedWidth} at dx=${s.dx}`
      ).toBeLessThanOrEqual(1)
    }

    // The last sample has to be a real width, not the start width with the drag
    // about to be applied on release.
    const last = samples.at(-1)
    expect(last?.width ?? 0, 'the box actually widened during the drag').toBeGreaterThan(
      start.width + 80
    )

    // The in-flight size is published under its own property name, and only while the
    // drag is running.
    for (const s of samples.slice(1)) {
      expect(s.live, `live width published at dx=${s.dx}`).not.toBe('')
      expect(s.liveAttr, `data-live set at dx=${s.dx}`).toBe('true')
    }

    // On release the live size is gone and the stored one is in charge. If the two
    // shared a property name, clearing the live value would strip the stored size
    // here and the block would fall back to its share of the row.
    const item = page.getByTestId('diagram-block-item-1')
    await expect
      .poll(async () =>
        item.evaluate((el) => ({
          live: el.style.getPropertyValue('--block-width-live').trim(),
          attr: el.getAttribute('data-live'),
          width: Math.round(el.getBoundingClientRect().width)
        }))
      )
      .toEqual({ live: '', attr: null, width: Math.round(start.width + 120) })
    expect(
      await item.evaluate((el) => (el as HTMLElement & { style: CSSStyleDeclaration }).style.width),
      'no leftover inline width on the item'
    ).toBe('')
  })

  test('a resize drag that ends where it started leaves the stored size intact', async ({
    page
  }) => {
    // The live size is cleared on release without telling React, and React only
    // rewrites a style property it believes has changed. So a drag whose net effect is
    // zero is the case where a shared property name would silently strip the stored
    // size and leave the block at its row share instead.
    await newDiagramPage(page, 'NetZero')
    await addTemplate(page, 'sequence', 1)
    // Wide enough that the block is not already filling the row, otherwise the drag
    // ceiling equals its width and the first drag cannot widen it.
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.waitForTimeout(300)

    const item = page.getByTestId('diagram-block-item-1')
    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await expect(page.getByTestId('diagram-block-1-container')).toBeVisible()

    const dragBy = async (dx: number, dy: number): Promise<void> => {
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      expect(box).not.toBeNull()
      // The grip's own centre, not a fixed offset from its top-left: it is 8px wide,
      // so a +8 offset misses it entirely and no drag happens.
      const cx = (box?.x ?? 0) + (box?.width ?? 0) / 2
      const cy = (box?.y ?? 0) + (box?.height ?? 0) / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(250)
    }

    await dragBy(140, 0)
    await expect.poll(async () => item.getAttribute('data-width')).toMatch(/^\d+$/)
    const stored = await item.getAttribute('data-width')
    const storedWidth = Number.parseInt(stored ?? '0', 10)
    expect(storedWidth).toBeGreaterThan(0)

    // Out and back within one drag: no net change to commit. The return target is the
    // pointer's *starting* position, not that position plus the outward step — the
    // handle travels with the box, so `origin.x + 90` would be 180px from where the
    // pointer actually is and would leave the block 90px wider than it started.
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    expect(box).not.toBeNull()
    const origin = {
      x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      y: (box?.y ?? 0) + (box?.height ?? 0) / 2
    }
    await page.mouse.move(origin.x, origin.y)
    await page.mouse.down()
    await page.mouse.move(origin.x - 90, origin.y, { steps: 6 })
    await page.mouse.move(origin.x, origin.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(400)

    await expect
      .poll(async () =>
        item.evaluate((el) => ({
          dataWidth: el.getAttribute('data-width'),
          live: el.style.getPropertyValue('--block-width-live').trim(),
          width: Math.round(el.getBoundingClientRect().width)
        }))
      )
      .toEqual({ dataWidth: stored, live: '', width: storedWidth })
  })

  test('clicking the resize handle without moving does not size the block', async ({ page }) => {
    // A bare click used to commit the block's current measured size, which turned an
    // unsized block into a sized one the user never asked to size and could not undo
    // except by resizing it again.
    await newDiagramPage(page, 'NoClickSize')
    await addTemplate(page, 'sequence', 1)

    const item = page.getByTestId('diagram-block-item-1')
    await expect(page.getByTestId('diagram-block-1-container')).toBeVisible()
    await expect(item).toHaveAttribute('data-width', '')

    const handle = page.getByTestId('diagram-block-1-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    const before = await item.evaluate((el) => Math.round(el.getBoundingClientRect().width))

    await handle.click()
    await page.waitForTimeout(500)

    await expect(item).toHaveAttribute('data-width', '')
    expect(
      await item.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      'the block kept its width'
    ).toBe(before)
  })

  test('a stored height makes the diagram scale to fit, without distorting it', async ({
    page
  }) => {
    // The defect: the container stored and applied a height, but nothing inside
    // obeyed it. The card was a plain block box, the canvas had no height of its
    // own, and the SVG was `height: auto` with the card clipping the overflow — so
    // the box shrank while the diagram kept its natural size. The card looked the
    // same, with dead space under it, and the absolutely-positioned handle
    // (anchored to the container, not the diagram) floated over the picture.
    //
    // These assertions are about the *rendered SVG*, not the container, which is
    // what the old test measured and why it passed while the page was broken.
    await newDiagramPage(page, 'ScaleToFit')
    await addTemplate(page, 'sequence', 1)

    const container = page.getByTestId('diagram-block-1-container')

    // The diagram is addressed inside the `page.evaluate` blocks below rather than
    // through a locator variable. An earlier version declared `canvas` and `svg`
    // here and never used them — everything moved into the page context so it could
    // be measured in one round trip — and lint correctly reported both as dead.

    // Carried across polls so the stability check can compare consecutive samples.
    let previousHeight = -1

    // Make it small, so "fits" is a real constraint rather than a coincidence.
    await page.getByTestId('diagram-block-1-preset-small').click({ force: true })
    // Wait for the *reorder item* to carry the height, not merely the resize
    // container. They are separate elements: the item is what has the stored size
    // and the one Motion transforms, and the container is told to fill it. Waiting
    // only on the container can measure a frame where the box has been given a
    // height the diagram has not yet been told about — which showed up as a
    // non-uniform scale of 0.808 against 0.721.
    await expect(container).toHaveAttribute('data-height', /\d+/, { timeout: 10_000 })
    await expect(
      page.getByTestId('diagram-block-item-1'),
      'the sized element must have received the height'
    ).toHaveAttribute('data-height', /\d+/, { timeout: 10_000 })
    await expect
      .poll(
        async () =>
          page
            .getByTestId('diagram-block-item-1')
            .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
        { timeout: 10_000 }
      )
      .toBeGreaterThan(100)
    // Wait for the layout to *settle* before measuring it. Two consecutive identical
    // heights, rather than one sample: the SVG's box is reached through a chain of
    // flex items (item -> container -> card -> canvas -> svgHost -> zoomHost ->
    // svgInner) and a single frame can catch it a pixel or two from final, which
    // showed up as a 0.63% non-uniform scale on a diagram that was in fact uniform.
    // Polling for the *assertion* to become true would be circular; this waits for
    // the layout to stop moving and then asserts.
    await expect
      .poll(
        async () => {
          const h = await page
            .getByTestId('diagram-block-item-1')
            .evaluate((el) => Math.round(el.getBoundingClientRect().height * 100) / 100)
          const stable = h === previousHeight
          previousHeight = h
          return stable
        },
        { timeout: 10_000, message: 'the block box must stop resizing before it is measured' }
      )
      .toBe(true)

    const measured = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          bottom: r.bottom,
          right: r.right
        }
      }
      const svgEl = document.querySelector(
        '[data-testid="diagram-block-1-svg"] svg'
      ) as SVGSVGElement | null
      return {
        container: box('[data-testid="diagram-block-1-container"]'),
        canvas: box('section[data-testid="diagram-block-1"] [data-testid="diagram-rendered"]'),
        svg: box('[data-testid="diagram-block-1-svg"] svg'),
        // The bounding box of the *drawn content*, not of the `<svg>` element. This
        // distinction is the whole measurement: the element is deliberately stretched
        // to fill the canvas and `preserveAspectRatio` letterboxes the drawing
        // inside it, so the element's on-screen box has the canvas's proportions and
        // says nothing about distortion. The root content group is uniformly
        // scaled, so its box keeps the drawing's ratio.
        content: box('[data-testid="diagram-block-1-svg"] svg > g'),
        handle: box('[data-testid="diagram-block-1-resize-handle"]'),
        viewBox: svgEl?.getAttribute('viewBox') ?? null
      }
    })

    expect(measured.container, 'the container must exist').not.toBeNull()
    expect(measured.svg, 'the diagram must exist').not.toBeNull()

    // 1. The SVG is inside the box that was given a height. This is the assertion
    //    that failed before: the SVG overflowed its container.
    expect(
      measured.svg?.height ?? 0,
      'the diagram must not be taller than the block it is in'
    ).toBeLessThanOrEqual(measured.container?.height ?? 0)
    expect(
      measured.svg?.bottom ?? 0,
      'the diagram must not spill below the block'
    ).toBeLessThanOrEqual(measured.container?.bottom ?? 0)

    // 2. The diagram is undistorted **and wholly visible**, measured from the SVG's
    //    own geometry rather than from its markup.
    //
    //    `getScreenCTM()` is the matrix mapping viewBox user units to screen pixels,
    //    so pushing the viewBox rect through it gives the drawing's on-screen extent.
    //    Two properties follow, and together they are what "scale to fit without
    //    distorting" means:
    //
    //      - `a === d`: a uniform scale. A stretched diagram — the failure mode of
    //        sizing an SVG with width and height percentages and no
    //        preserveAspectRatio — is exactly `a !== d`.
    //      - the drawn extent sits **within** the element's box, so the whole diagram
    //        is visible. Filling the box and overflowing would crop the drawing while
    //        the transform stayed uniform, which is why this is a second assertion
    //        and not a restatement of the first.
    //
    //    Two earlier versions of this test were wrong, not the rendering, and both
    //    are worth recording. One compared the first `<g>`'s bounding box with the
    //    viewBox ratio and reported 41% distortion — Mermaid's first `<g>` is a
    //    labelled subgroup, not the whole drawing. The other read
    //    `preserveAspectRatio.baseVal` and compared it against
    //    `SVGPreserveAspectRatio.SVG_MEET`, which is `undefined` in Chromium, so it
    //    asserted equality with a constant that does not exist. This needs neither
    //    the DOM's element tree nor its enum.
    const drawn = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="diagram-block-1-svg"] svg'
      ) as SVGSVGElement | null
      if (!el) return null
      const vb = (el.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
      const m = el.getScreenCTM()
      const r = el.getBoundingClientRect()
      if (!m || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return null
      return {
        scaleX: m.a,
        scaleY: m.d,
        // Mermaid's viewBox origin is frequently **negative** — a sequence diagram
        // emits something like "-8 -8 816 466" to leave a margin around the drawing.
        // Mapping the viewBox *rect* rather than the origin is what makes the corners
        // land where they actually are; an earlier version assumed the origin was
        // (0,0) and reported the drawing as 14px off-centre and overflowing.
        drawnW: vb[2]! * m.a,
        drawnH: vb[3]! * m.d,
        boxW: r.width,
        boxH: r.height,
        drawnLeft: m.a * vb[0]! + m.e - r.left,
        drawnTop: m.d * vb[1]! + m.f - r.top
      }
    })
    expect(drawn, 'the SVG must expose a viewBox and a screen transform').not.toBeNull()
    expect(
      Math.abs(drawn?.scaleX ?? 0),
      'the diagram must be drawn at a real scale'
    ).toBeGreaterThan(0)
    expect(
      Math.abs((drawn?.scaleX ?? 0) - (drawn?.scaleY ?? 0)) / (drawn?.scaleX ?? 1),
      `a non-uniform scale distorts the drawing: scaleX=${drawn?.scaleX} scaleY=${drawn?.scaleY}`
    ).toBeLessThan(0.001)
    expect(
      drawn?.drawnH ?? 0,
      'the whole diagram must be visible vertically, not cropped'
    ).toBeLessThanOrEqual((drawn?.boxH ?? 0) + 1)
    expect(
      drawn?.drawnW ?? 0,
      'the whole diagram must be visible horizontally, not cropped'
    ).toBeLessThanOrEqual((drawn?.boxW ?? 0) + 1)

    // 3. The leftover space is split evenly, so the diagram sits in the middle of its
    //    box rather than in a corner.
    const leftMargin = drawn?.drawnLeft ?? 0
    const rightMargin = (drawn?.boxW ?? 0) - leftMargin - (drawn?.drawnW ?? 0)
    expect(
      Math.abs(leftMargin - rightMargin),
      `centred horizontally: ${leftMargin.toFixed(1)} left vs ${rightMargin.toFixed(1)} right`
    ).toBeLessThan(1.5)
    const topMargin = drawn?.drawnTop ?? 0
    const bottomMargin = (drawn?.boxH ?? 0) - topMargin - (drawn?.drawnH ?? 0)
    expect(
      Math.abs(topMargin - bottomMargin),
      `centred vertically: ${topMargin.toFixed(1)} top vs ${bottomMargin.toFixed(1)} bottom`
    ).toBeLessThan(1.5)

    // 4. The corner grip sits on the container's bottom-right corner, not floating over
    //    the picture. Also part of the original complaint: the icons "moved out of the
    //    box", which is exactly what an absolutely-positioned control looks like when
    //    the diagram inside the container ignores that container's height.
    //
    //    Asserted on the grip's **edges** against the container's, not on its centre.
    //    The grip is 18px square and anchored at `right:0; bottom:0`, so its centre
    //    necessarily sits 9px inside the corner; an earlier version compared centres
    //    with a 4px tolerance and failed on 9px of correct layout.
    const handle = measured.handle
    expect(handle, 'the resize grip must have a box').not.toBeNull()
    if (handle && measured.container) {
      expect(
        Math.abs(handle.bottom - measured.container.bottom),
        'the grip must sit on the container bottom edge, not mid-diagram'
      ).toBeLessThan(1.5)
      expect(
        Math.abs(handle.right - measured.container.right),
        'the grip must sit on the container right edge'
      ).toBeLessThan(1.5)
    }
  })

  test("a note's diagram sits on the page, with no frame of its own", async ({ page, request }) => {
    // A diagram block in a Rich Note has **no border and no background**.
    //
    // This reverses an earlier decision, and deliberately. The note's block and the
    // Diagram page's card were once made identical — same pane grey, same hairline —
    // so the two surfaces would match. But a note is prose, and a flowchart draws its
    // own boxes: putting a raised card around it gives a picture-in-a-picture and the
    // diagram stops reading as part of the note. The Diagram page is a different thing
    // — a board of cards, where each one is a distinct object worth framing — so its
    // card keeps its edge. Asserting the note's surface is transparent is what stops
    // the frame creeping back.
    await page.setViewportSize({ width: 1600, height: 950 })

    const title = await seedNoteWithDiagram(request)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    const pane = page.locator('[data-testid="diagram-preview"]')
    await expect(pane).toBeVisible({ timeout: 20_000 })
    await expect(pane.locator('svg').first()).toBeVisible({ timeout: 20_000 })
    const noteSurface = await readSurface(pane)

    // Transparent, and no visible edge. Computed values rather than by eye, because the
    // rule lives in a CSS module and nothing else would notice it returning.
    expect(noteSurface.bg, `the note block must have no background, got ${noteSurface.bg}`).toBe(
      'rgba(0, 0, 0, 0)'
    )
    expect(
      noteSurface.border,
      `the note block must have no border, got ${noteSurface.border}`
    ).toBe('0px')

    // The Diagram page keeps its card, and this asserts that too — the two surfaces
    // being *different* is now the intent, and a test that only checked the note would
    // not notice the card losing its edge by mistake.
    await newDiagramPage(page, 'Surface')
    await addTemplate(page, 'sequence', 1)
    const card = page.locator('section[data-testid="diagram-block-1"]')
    await expect(card).toBeVisible()
    const pageSurface = await readSurface(card)
    expect(pageSurface.bg, 'the Diagram page keeps its card background').not.toBe(
      'rgba(0, 0, 0, 0)'
    )
  })

  test('an unsized block keeps its natural size, not the scale-to-fit behaviour', async ({
    page
  }) => {
    // The scale-to-fit rule is scoped to blocks with a stored height. If it leaked
    // to every block, a default diagram would be stretched or letterboxed to fill a
    // box it was never given.
    //
    // What is asserted is *content-driven vs box-driven*. Deliberately NOT "the
    // diagram fills its canvas": Mermaid caps an SVG at its natural width with an
    // inline `max-width`, so a small diagram stays small on a wide card. That is
    // correct pre-existing behaviour, and an earlier version of this test asserted
    // the opposite and failed on it.
    await newDiagramPage(page, 'Unsized')

    const canvas = page.locator(
      'section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"]'
    )
    await expect(canvas, 'a default block carries no stored size').not.toHaveAttribute(
      'data-sized',
      'true'
    )
    // The default diagram has to exist before it can be measured. An earlier version
    // measured straight after the workspace appeared, read `null`, and reported a
    // missing diagram rather than a missing wait.
    await expect(
      page.locator('section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"] svg'),
      'the default diagram must render'
    ).toBeVisible({ timeout: 20_000 })

    const m = await page.evaluate(() => {
      const svg = document.querySelector(
        'section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"] svg'
      )
      const box = document.querySelector(
        'section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"]'
      )
      if (!svg || !box) return null
      return { svgH: svg.getBoundingClientRect().height, boxH: box.getBoundingClientRect().height }
    })
    expect(m).not.toBeNull()
    // A content-sized canvas differs from its diagram only by its own padding.
    const padding = 2 * 8 // --mantine-spacing-sm, top and bottom
    expect(
      Math.abs((m?.boxH ?? 0) - (m?.svgH ?? 0) - padding),
      `canvas ${m?.boxH} vs diagram ${m?.svgH}`
    ).toBeLessThan(24)
  })

  test('size presets sit below the block action row, not on top of it', async ({ page }) => {
    // Both surfaces that use the resize container put a toolbar at the top of the
    // block, and the presets were drawn over it at `top: 2px`.
    await newDiagramPage(page, 'PresetOverlap')
    await addTemplate(page, 'sequence', 1)

    const container = page.getByTestId('diagram-block-1-container')
    await container.hover()
    const preset = page.getByTestId('diagram-block-1-preset-medium')
    await expect(preset, 'the presets appear on hover').toBeVisible()

    const geom = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel)
        return el ? el.getBoundingClientRect() : null
      }
      return {
        preset: r('[data-testid="diagram-block-1-preset-medium"]'),
        // The action row's testids are `${pageType}-block-<action>-${index}`, so
        // the edit control on the second block is `diagram-block-edit-1`. An
        // earlier version of this test guessed `diagram-block-1-edit-1`, found
        // nothing, and reported a missing control instead of a wrong selector.
        edit: r('[data-testid="diagram-block-edit-1"]'),
        remove: r('[data-testid="diagram-block-remove-1"]')
      }
    })
    expect(geom.preset, 'the preset row must have a box').not.toBeNull()
    expect(geom.edit, 'the block edit control must exist').not.toBeNull()
    // The preset row starts below the action controls it used to cover.
    expect(
      geom.preset?.top ?? 0,
      'presets must not overlap the block action row'
    ).toBeGreaterThanOrEqual(geom.edit?.bottom ?? 0)
    // Including the last control in that row, which is the one most likely to be
    // reached for.
    expect(geom.preset?.top ?? 0).toBeGreaterThanOrEqual(geom.remove?.bottom ?? 0)
  })

  test('a size preset resizes the block, which is the keyboard-reachable path', async ({
    page
  }) => {
    await newDiagramPage(page, 'Preset')
    await addTemplate(page, 'sequence', 1)

    const container = page.getByTestId('diagram-block-1-container')
    const before = await container.evaluate((el) => el.getBoundingClientRect().width)
    await page.getByTestId('diagram-block-1-preset-small').click()
    const after = await container.evaluate((el) => el.getBoundingClientRect().width)
    expect(after, 'the Small preset narrows the block').toBeLessThan(before)
  })
})

test.describe('Rich Document Mermaid blocks', () => {
  async function newRichNote(page: Page, label: string, seed?: unknown): Promise<void> {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`${label} ${Date.now()}`)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 20_000 })
    void seed
  }

  test('a Mermaid block resizes horizontally as well as vertically', async ({ page }) => {
    await newRichNote(page, 'RichResize')

    // Insert through the toolbar chooser, which is the rich note's only route to a
    // Mermaid block now.
    const trigger = page.getByTestId('insert-diagram')
    if ((await trigger.count()) === 0) {
      await page.getByTestId('toolbar-more').click()
      await trigger.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await trigger.click()
    await page.getByTestId('insert-diagram-option-sequence').click()

    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible({ timeout: 20_000 })
    const before = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))

    const handle = page.getByTestId('diagram-resize-handle')
    await expect(handle).toBeVisible()
    const box = await handle.boundingBox()
    // The grip's own centre: it is 8px wide, so a fixed +8 offset from the top-left
    // corner would miss it entirely and the drag would never start.
    const gx = (box?.x ?? 0) + (box?.width ?? 0) / 2
    const gy = (box?.y ?? 0) + (box?.height ?? 0) / 2
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    await page.mouse.move(gx - 150, gy - 50, { steps: 8 })
    await page.mouse.up()

    const after = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))
    // Both axes respond to the one right-edge grip. This is the "add/fix horizontal
    // resizing" requirement: before it, only the vertical axis moved.
    expect(after.width, 'horizontal resize narrows the block').toBeLessThan(before.width)
    expect(after.height, 'vertical resize shortens the block').toBeLessThan(before.height)
  })

  test('a resized block keeps its width across a reload', async ({ page, request }) => {
    await newRichNote(page, 'RichPersist')
    const trigger = page.getByTestId('insert-diagram')
    if ((await trigger.count()) === 0) {
      await page.getByTestId('toolbar-more').click()
      await trigger.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await trigger.click()
    await page.getByTestId('insert-diagram-option-sequence').click()

    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('diagram-preset-small').click()
    const width = await container.evaluate((el) => el.getBoundingClientRect().width)

    // Autosave is debounced; wait for the stored width rather than for the DOM,
    // then reload and read the width back off the re-rendered block.
    await expect
      .poll(async () => (await storedContent(request, 'RichPersist')).includes('"width"'), {
        timeout: 20_000
      })
      .toBe(true)

    await page.reload()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 20_000 })
    const after = await page
      .getByTestId('diagram-container')
      .evaluate((el) => el.getBoundingClientRect().width)
    expect(Math.abs(after - width), 'the stored width survives a reload').toBeLessThanOrEqual(2)
  })

  test('the note stays a scrolling document, not a canvas', async ({ page }) => {
    await newRichNote(page, 'RichScroll')
    const editor = page.getByTestId('rich-editor')
    await expect(editor).toBeVisible({ timeout: 20_000 })

    // Find the element that actually owns the note's scrolling by walking up from
    // BlockNote's own node, rather than guessing which wrapper it is. The claim is
    // that the note scrolls vertically on one element and that nothing inside it
    // scrolls sideways.
    const scroll = await page.evaluate(() => {
      const start =
        document.querySelector('.bn-editor') ??
        document.querySelector('[data-testid="rich-editor"]')
      if (!start) return null
      let node: HTMLElement | null = start as HTMLElement | null
      let owner: HTMLElement | null = null
      while (node) {
        const y = getComputedStyle(node).overflowY
        if (y === 'auto' || y === 'scroll') {
          owner = node
          break
        }
        node = node.parentElement
      }
      const sideways = Array.from(
        document.querySelectorAll('[data-testid="rich-editor"] *')
      ).filter((el) => {
        const cs = getComputedStyle(el)
        return (
          (cs.overflowX === 'auto' || cs.overflowX === 'scroll') &&
          el.scrollWidth > el.clientWidth + 1
        )
      }).length
      return { ownerFound: owner !== null, sideways }
    })

    expect(scroll, 'the rich editor host must exist').not.toBeNull()
    expect(scroll?.ownerFound, 'the note must have a vertical scroll owner').toBe(true)
    expect(scroll?.sideways, 'nothing inside the note may scroll horizontally').toBe(0)
  })
})
