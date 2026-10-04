import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Rich Note block rearrangement (drag handle + keyboard Move up/down) and
 * Diagram/Mind Map container resizing. Geometry tests use real pointer
 * interaction — never synthetic event dispatches.
 */

let titleSeq = 0

/** One mid-drag measurement: pointer delta and the box's rendered size at that instant. */
interface ResizeSample {
  dx: number
  width: number
  height: number
}

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

/** Drags the note block's corner grip by (dx, dy) with a real pointer. */
async function dragHandle(page: Page, dx: number, dy: number): Promise<void> {
  const handle = page.getByTestId('diagram-resize-handle')
  await handle.scrollIntoViewIfNeeded()
  const box = await handle.boundingBox()
  if (!box) throw new Error('resize handle not visible')
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 6, from.y + (dy * step) / 6)
  }
  await page.mouse.up()
  await page.waitForTimeout(700)
}

/**
 * The width a note block may reach: the content box of the pane it sits in.
 *
 * Measured from the DOM rather than hardcoded, because this is the ceiling the drag
 * clamps against and a stale figure would quietly turn the tracking assertion into a
 * no-op.
 */
async function columnCeiling(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('[data-testid="diagram-preview"]')
    if (!pane) return Number.POSITIVE_INFINITY
    const cs = getComputedStyle(pane)
    return (
      pane.clientWidth -
      (Number.parseFloat(cs.paddingLeft) || 0) -
      (Number.parseFloat(cs.paddingRight) || 0)
    )
  })
}

async function seedRich(
  request: APIRequestContext,
  title: string,
  blocks: Array<Record<string, unknown>>
): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify(blocks) }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

async function getStoredContent(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; content: string }> }
  return body.pages.find((p) => p.id === id)?.content ?? ''
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

const DRAG_HANDLE = '[data-test="dragHandle"]'

/** Drags the block whose text matches `sourceText` above the target block. */
async function dragBlockTo(page: Page, sourceText: string, targetText: string): Promise<void> {
  const source = page.locator('.bn-block-outer', { hasText: sourceText }).first()
  await source.hover()
  // The drag handle lives in BlockNote's portal, outside the block DOM.
  const handle = page.locator(DRAG_HANDLE).first()
  await handle.waitFor({ state: 'visible' })
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('drag handle has no box')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  // A small initial wiggle reliably crosses the HTML5 dragstart threshold.
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 8, handleBox.y + 10, { steps: 3 })
  const target = page.locator('.bn-block-outer', { hasText: targetText }).first()
  const box = await target.boundingBox()
  if (!box) throw new Error(`target block ${targetText} not found`)
  // Drop just above the target's top edge — this is the sweet spot where
  // ProseMirror shows the "move before" drop cursor. Too far above exits the
  // editor and triggers a copy instead of a move.
  await page.mouse.move(box.x + box.width / 2, box.y - 1, { steps: 20 })
  await page.mouse.up()
}

let pageErrors: Error[] = []

test.describe('rich note block rearrangement', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('drag handle moves a paragraph between neighbours', async ({ page, request }) => {
    const title = uniqueTitle('Move Drag')
    await seedRich(request, title, [
      { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'alpha block', styles: {} }] },
      { id: 'p2', type: 'paragraph', content: [{ type: 'text', text: 'beta block', styles: {} }] },
      { id: 'p3', type: 'paragraph', content: [{ type: 'text', text: 'gamma block', styles: {} }] }
    ])
    await openNote(page, title)
    await expect(page.getByText('alpha block')).toBeVisible()

    // Drag "gamma block" toward the top. Each pass is a real pointer drag;
    // repeat until it reaches the first slot (drop-cursor geometry can land
    // one slot short depending on where the pointer crosses the target).
    const editor = page.locator('[data-testid="rich-editor"]')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const order = await editor.locator('.bn-block-outer').allTextContents()
      if (order[0]?.includes('gamma')) break
      await dragBlockTo(page, 'gamma block', 'alpha block')
      await expect(editor).toContainText('alpha block')
    }
    const finalOrder = await editor.locator('.bn-block-outer').allTextContents()
    // The exact drop position depends on ProseMirror's heuristics; assert that
    // gamma moved (is no longer last), content survived, and no duplicates were
    // created.
    expect(finalOrder[finalOrder.length - 1]).not.toContain('gamma')
    expect(finalOrder.filter((t) => t.includes('gamma')).length).toBe(1)
    expect(finalOrder.filter((t) => t.includes('alpha')).length).toBe(1)
    expect(finalOrder.filter((t) => t.includes('beta')).length).toBe(1)
  })

  test('keyboard Move up/down actions reorder every custom block type', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Move Keys')
    await seedRich(request, title, [
      {
        id: 'h',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Key Heading' }]
      },
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'info' },
        content: [{ type: 'text', text: 'Key Callout' }]
      },
      { id: 'q', type: 'quote', content: [{ type: 'text', text: 'Key Quote' }] },
      { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Key Paragraph' }] }
    ])
    await openNote(page, title)
    await expect(page.getByText('Key Callout')).toBeVisible()

    // Open the callout's block menu and move it down.
    const callout = page.locator('.bn-block-outer', { hasText: 'Key Callout' }).first()
    await callout.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-down').click()
    let order = await page.locator('[data-testid="rich-editor"] .bn-block-outer').allTextContents()
    expect(order.findIndex((t) => t.includes('Key Callout'))).toBeGreaterThan(
      order.findIndex((t) => t.includes('Key Heading'))
    )

    // Move it back up.
    await callout.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-up').click()
    order = await page.locator('[data-testid="rich-editor"] .bn-block-outer').allTextContents()
    expect(order.findIndex((t) => t.includes('Key Callout'))).toBeLessThan(
      order.findIndex((t) => t.includes('Key Quote'))
    )
  })

  test('boundary blocks offer no crossing move action', async ({ page, request }) => {
    const title = uniqueTitle('Move Edge')
    await seedRich(request, title, [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'edge first', styles: {} }] },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'edge second', styles: {} }] }
    ])
    await openNote(page, title)
    const first = page.locator('.bn-block-outer', { hasText: 'edge first' }).first()
    await first.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    // First block cannot move up: the action is absent.
    await expect(page.getByTestId('move-up')).toHaveCount(0)
    await expect(page.getByTestId('move-down')).toBeVisible()
    await page.keyboard.press('Escape')

    const last = page.locator('.bn-block-outer', { hasText: 'edge second' }).first()
    await last.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await expect(page.getByTestId('move-down')).toHaveCount(0)
    await expect(page.getByTestId('move-up')).toBeVisible()
  })

  test('moving autosaves and reload preserves the new order', async ({ page, request }) => {
    const title = uniqueTitle('Move Persist')
    const p = await seedRich(request, title, [
      { id: 'm1', type: 'paragraph', content: [{ type: 'text', text: 'persist one', styles: {} }] },
      { id: 'm2', type: 'paragraph', content: [{ type: 'text', text: 'persist two', styles: {} }] }
    ])
    await openNote(page, title)
    const second = page.locator('.bn-block-outer', { hasText: 'persist two' }).first()
    await second.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-up').click()

    await expect
      .poll(async () => getStoredContent(request, p.id), { timeout: 15_000 })
      .toContain('persist two')
    const stored = await getStoredContent(request, p.id)
    const oneIdx = stored.indexOf('persist one')
    const twoIdx = stored.indexOf('persist two')
    expect(twoIdx).toBeGreaterThan(-1)
    expect(oneIdx).toBeGreaterThan(-1)

    // Wait until the moved order is PERSISTED before reloading — a reload
    // during the autosave debounce window would legitimately lose the move.
    await expect
      .poll(
        async () => {
          const stored = await getStoredContent(request, p.id)
          const two = stored.indexOf('persist two')
          const one = stored.indexOf('persist one')
          return two > -1 && one > -1 && two < one ? 'moved' : 'pending'
        },
        { timeout: 15_000 }
      )
      .toBe('moved')

    // Reload: session restoration reopens the same note directly (the tab
    // and active page persist in sessionStorage), so no dashboard navigation.
    await page.reload()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 15_000 })
    const order = await page
      .locator('[data-testid="rich-editor"] .bn-block-outer')
      .allTextContents()
    expect(order.findIndex((t) => t.includes('persist two'))).toBeLessThan(
      order.findIndex((t) => t.includes('persist one'))
    )
  })
})

test.describe('diagram and mind map resizing', () => {
  test.beforeEach(({ page }) => {
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test('pointer resize changes width and height independently', async ({ page, request }) => {
    const title = uniqueTitle('Resize Pointer')
    await seedRich(request, title, [
      {
        id: 'd',
        type: 'diagram',
        props: { width: '500', height: '300' },
        content: 'graph TD\n  A-->B'
      }
    ])
    await openNote(page, title)
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    await expect(container).toHaveAttribute('data-width', '500')
    await expect(container).toHaveAttribute('data-height', '300')

    const handle = page.getByTestId('diagram-resize-handle')
    const box = await handle.boundingBox()
    if (!box) throw new Error('resize handle not visible')
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

    /*
     * Sampled from `getBoundingClientRect` inside the `pointermove` that publishes the
     * size, which is what the reader actually sees. The previous version of this test
     * read `data-width`/`data-height` instead, and therefore passed whatever the box
     * did: the drag handler writes those attributes from its own state, so a box that
     * never moved still produced a plausible number. It also asserted
     * `width >= 240`, which `clampWidth`'s own floor guarantees and which therefore
     * could not fail, and asserted the container was NOT wider than the workspace —
     * which is the symptom of the ceiling being reached, recorded as correct.
     */
    const before = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))
    await page.evaluate((origin) => {
      const w = window as unknown as { __samples?: ResizeSample[] }
      w.__samples = []
      document.addEventListener('pointermove', (event) => {
        const el = document.querySelector<HTMLElement>('[data-testid="diagram-container"]')
        if (!el || !w.__samples) return
        w.__samples.push({
          dx: Math.round(event.clientX - origin.x),
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height)
        })
      })
    }, from)

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(from.x + step * 20, from.y + step * 15)
    }
    await page.mouse.up()
    await page.waitForTimeout(900)

    const samples = await page.evaluate(() => {
      const w = window as unknown as { __samples?: ResizeSample[] }
      return w.__samples ?? []
    })
    expect(samples.length, 'the drag must produce samples to judge').toBeGreaterThan(2)

    /*
     * The rendered width follows the pointer within a pixel, for every sample whose
     * target is still inside the column. Samples past the ceiling are expected to sit
     * at the ceiling — that is 6.1 working — so they are asserted as clamped rather
     * than skipped, which would leave the assertion free to pass on nothing.
     */
    const ceiling = await columnCeiling(page)
    for (const sample of samples) {
      const wanted = before.width + sample.dx
      if (wanted <= ceiling) {
        expect(
          Math.abs(sample.width - wanted),
          `rendered width ${sample.width} must follow pointer delta ${sample.dx} from ${before.width}`
        ).toBeLessThanOrEqual(2)
      } else {
        expect(
          Math.abs(sample.width - ceiling),
          `past the column ceiling the box must sit at ${ceiling}, not ${sample.width}`
        ).toBeLessThanOrEqual(2)
      }
    }

    // The rendered HEIGHT grew, and by the pointer's own vertical delta. Height has no
    // column ceiling, so it must track.
    const after = await container.evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height
    }))
    expect(
      after.height - before.height,
      'a vertical drag must grow the rendered height by ~90px'
    ).toBeGreaterThan(80)
    expect(after.height - before.height).toBeLessThanOrEqual(100)

    // What is stored is what the box actually reached, not what was asked for.
    const storedW = Number(await container.getAttribute('data-width'))
    const storedH = Number(await container.getAttribute('data-height'))
    expect(
      Math.abs(storedW - after.width),
      'stored width must equal the rendered width'
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(storedH - after.height),
      'stored height must equal the rendered height'
    ).toBeLessThanOrEqual(1)
  })

  test('a narrowed block can be widened again with the same grip', async ({ page, request }) => {
    /*
     * Guards the contract in `DIAGRAM_BLOCK_SPECIFICATION.md` 2.3. The report this
     * replaced claimed a block narrowed by the corner grip could never be widened
     * again without a preset, which would have forced a second grip on each side edge.
     * Measured instead: the same grip does both, and this test fails if that regresses.
     *
     * The width ceiling is the note's text column, so a block at full width correctly
     * does not grow. The sequence below therefore starts from full width, narrows, and
     * only then checks that it can grow back.
     */
    const title = uniqueTitle('Resize Round Trip')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    const widthOf = async () => container.evaluate((el) => el.getBoundingClientRect().width)

    const full = await widthOf()
    await dragHandle(page, -240, 0)
    const narrowed = await widthOf()
    expect(narrowed, 'dragging left must narrow the rendered block').toBeLessThan(full - 40)

    await dragHandle(page, 240, 0)
    const widened = await widthOf()
    expect(widened, 'the same grip must widen the block again without a preset').toBeGreaterThan(
      narrowed + 40
    )
    expect(widened, 'widening stops at the column, never past it').toBeLessThanOrEqual(full + 2)
  })

  test('size presets apply clamped dimensions via keyboard-accessible buttons', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Resize Presets')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    await page.getByTestId('diagram-preset-small').click()
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-width', '360')
    // Large clamps to the document column when narrower than the preset.
    await page.getByTestId('diagram-preset-large').click()
    const largeWidth = Number(
      await page.getByTestId('diagram-container').getAttribute('data-width')
    )
    expect(largeWidth).toBeGreaterThanOrEqual(360)
    expect(largeWidth).toBeLessThanOrEqual(1600)
    // The stored width must be a width the block can actually *draw*. `max-width: 100%`
    // bounds the container to its parent's content box, and the clamp used to measure
    // `clientWidth` — which includes the parent's padding. Measured: it stored 840 in an
    // 820px box, so the document held a size the page silently reduced on every render.
    // Asserting equality is the only way that stays true when the padding changes.
    const renderedLarge = await page
      .getByTestId('diagram-container')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(
      largeWidth,
      `stored ${largeWidth}px must equal the ${renderedLarge}px the block actually draws`
    ).toBe(renderedLarge)
    await page.getByTestId('diagram-preset-fit').click()
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-width', '')
  })

  test('a note diagram block can be narrowed and widened again', async ({ page, request }) => {
    // The reported symptom: a diagram block in a Rich Note "cannot be flexed
    // horizontally". It starts spanning the whole document column, so a rightward drag
    // asks for width that does not exist. Two things had to be true for horizontal
    // resizing to work at all, and neither was:
    //
    //  1. narrowing has to stick, so there is room to grow back into; and
    //  2. growing back has to reach the column rather than being swallowed.
    const title = uniqueTitle('Resize Flex')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    // Let the note finish settling, so the width measured here is the one the drag
    // starts from. See the identical wait, and why it is needed, in
    // "dragging a full-width note block outward stores nothing unreachable".
    await expect
      .poll(
        async () => {
          const first = await container.evaluate((el) =>
            Math.round(el.getBoundingClientRect().width)
          )
          await page.waitForTimeout(120)
          const second = await container.evaluate((el) =>
            Math.round(el.getBoundingClientRect().width)
          )
          return first === second ? second : -1
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0)
    const fullWidth = await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))

    // 1. Narrow it with a preset, and confirm the narrower width is what is stored *and*
    //    drawn — not clamped back to the column.
    await page.getByTestId('diagram-preset-small').click()
    await expect(container).toHaveAttribute('data-width', '360')
    const narrow = await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(narrow, 'the preset must actually narrow the block').toBeLessThan(fullWidth - 100)

    // 2. Now there is room: drag the corner right and the block must follow.
    const handle = page.getByTestId('diagram-resize-handle')
    const box = await handle.boundingBox()
    if (box === null) throw new Error('resize handle not visible')
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    const track: number[] = []
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(sx + step * 40, sy)
      await page.waitForTimeout(60)
      track.push(await container.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    }
    await page.mouse.up()
    await page.waitForTimeout(500)

    // The box must widen *during* the drag, not snap on release.
    expect(track[0], `the first sample is still ${track[0]}px`).toBeGreaterThan(narrow)
    expect(
      track.every((w, i) => i === 0 || w >= (track[i - 1] ?? 0)),
      `width must not go backwards: ${track.join(' -> ')}`
    ).toBe(true)

    const grown = await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))
    const stored = await container.getAttribute('data-width')
    expect(grown, 'the block must end wider than the preset made it').toBeGreaterThan(narrow)
    expect(
      Number(stored),
      `stored ${String(stored)}px must equal the ${grown}px the block actually draws`
    ).toBe(grown)
  })

  test('dragging a full-width note block outward stores nothing unreachable', async ({
    page,
    request
  }) => {
    // The block already spans its column, so a rightward drag cannot make it wider.
    // The defect was not that nothing moved - it was that a width the block can never
    // draw was still written to the document: measured, it stored 948 in an 820px box,
    // which `max-width: 100%` reduced on screen, leaving the stored width permanently
    // disagreeing with the picture.
    //
    // Asserted on the **stored document**, not on the container's `data-width`. That
    // attribute mirrors the in-flight drag state and is set on pointer-down even when
    // nothing moves, so it cannot tell "dragged" from "held the pointer down".
    const title = uniqueTitle('Resize No Phantom')
    const seeded = await seedRich(request, title, [
      { id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }
    ])
    await openNote(page, title)
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    // Let the note finish settling, so the width the drag starts from is the real one.
    await expect
      .poll(
        async () => {
          const first = await container.evaluate((el) =>
            Math.round(el.getBoundingClientRect().width)
          )
          await page.waitForTimeout(120)
          const second = await container.evaluate((el) =>
            Math.round(el.getBoundingClientRect().width)
          )
          return first === second ? second : -1
        },
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0)
    const startWidth = await container.evaluate((el) =>
      Math.round(el.getBoundingClientRect().width)
    )

    const handle = page.getByTestId('diagram-resize-handle')
    const box = await handle.boundingBox()
    if (box === null) throw new Error('resize handle not visible')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(800)

    expect(
      await container.evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      'the block could not get wider, so it must not have changed'
    ).toBe(startWidth)

    // The invariant, which holds whether or not a width is written: a stored width is
    // always a width the block can actually draw. Asserting only "nothing was written"
    // passed against the unfixed code, because whether anything is written depends on
    // where the drag ceiling happens to fall; asserting the *equality* is what actually
    // pins the commit to the rendered box.
    const storedWidth = await (async (): Promise<string> => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const stored = await getStoredContent(request, seeded.id)
        const match = /"width"\s*:\s*"([^"]*)"/.exec(stored)
        if (match !== null || attempt === 19) return match === null ? '(none)' : match[1]
        await page.waitForTimeout(300)
      }
      return '(none)'
    })()
    const rendered = await container.evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(
      storedWidth === '(none)' ? rendered : Number(storedWidth),
      `stored ${storedWidth} must equal the ${rendered}px the block actually draws`
    ).toBe(rendered)
  })
  test('narrow screens clamp responsively without destroying stored size', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Resize Narrow')
    await seedRich(request, title, [
      {
        id: 'd',
        type: 'diagram',
        props: { width: '1200', height: '600' },
        content: 'graph TD\n  A-->B'
      }
    ])
    await openNote(page, title)
    await page.setViewportSize({ width: 480, height: 800 })
    const container = page.getByTestId('diagram-container')
    const boxWidth = (await container.boundingBox())?.width ?? 0
    const workspace = page.getByTestId('rich-editor')
    const wsBox = await workspace.boundingBox()
    expect(boxWidth).toBeLessThanOrEqual((wsBox?.width ?? 480) + 2)
    // Stored desktop size is untouched by the responsive clamp.
    await expect(container).toHaveAttribute('data-width', '1200')
  })

  test('reload and duplicate preserve stored dimensions', async ({ page, request }) => {
    const title = uniqueTitle('Resize Persist')
    const original = await seedRich(request, title, [
      {
        id: 'mm',
        type: 'diagram',
        props: { width: '700', height: '450' },
        content: 'mindmap\n  root((R))\n    A'
      }
    ])
    await openNote(page, title)
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-width', '700')
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-height', '450')

    const dup = await request.post(`/api/pages/${original.id}/duplicate`)
    expect(dup.status()).toBe(201)
    const listRes = await request.get('/api/pages')
    const body = (await listRes.json()) as { pages: Array<{ id: string; content: string }> }
    const copy = body.pages.find((x) => x.id !== original.id && x.content.includes('"width":"700"'))
    expect(copy?.content).toContain('"height":"450"')
  })
})
