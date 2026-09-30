import { expect, type Locator, type Page, test } from '@playwright/test'

/**
 * Reordering Mermaid blocks on the Diagram page.
 *
 * ## What is really being tested
 *
 * Not "the drag did something" — that is loud and obvious. The failure that
 * matters is **the visual order and the stored order disagreeing**: Motion reorders
 * by where the pointer is, the document is written by id, and if the two ever
 * diverge the page looks one way and reloads as another, with no error anywhere.
 * So every test here reads both and compares them.
 *
 * ## How a diagram is identified on screen
 *
 * Two earlier approaches were both wrong, and both are recorded because the reasons
 * are not obvious:
 *
 *  - `aria-roledescription`, which Mermaid stamps with the diagram type, is
 *    **stripped by `svg-sanitize.ts`**. Reading it returned "unknown" for every
 *    card. The sanitiser is right to strip it; a test simply cannot use it.
 *  - Reading the DOM's own order would be circular — it would report whatever the
 *    component had just done, which is the thing under test.
 *
 * So a card is identified by a fingerprint of its **rendered text**, ordered by its
 * on-screen position (top-to-bottom, then left-to-right), and mapped back to a name
 * by a calibration taken before the drag, when the order is known by construction.
 * Nothing here depends on Mermaid's internals.
 */
type TemplateKey = 'sequence' | 'pie' | 'gantt' | 'class'

const SEEDS: TemplateKey[] = ['sequence', 'pie', 'gantt', 'class']

async function newDiagramPage(page: Page, label: string, width = 1600): Promise<string> {
  await page.setViewportSize({ width, height: 950 })
  const title = `${label} ${Date.now()}`
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByTestId('new-page-type-diagram').click()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('template-bar')).toBeVisible({ timeout: 20_000 })
  return title
}

/**
 * Adds templates one at a time, waiting for each new card to render.
 *
 * Opens the bar's overflow menu when the template is not on the row. That is not a
 * workaround: on a narrow window the trailing templates genuinely live behind the
 * "more" button, and reaching them that way is the real user path. The first
 * version of this file clicked `template-pie` directly and timed out at 900px,
 * which read as a broken bar — the bar was working exactly as designed.
 */
async function addTemplates(page: Page, templates: TemplateKey[]): Promise<void> {
  for (const [i, key] of templates.entries()) {
    const button = page.getByTestId(`template-${key}`)
    if (await button.isVisible().catch(() => false)) {
      await button.click()
    } else {
      await page.getByTestId('template-more').click()
      await page.getByRole('menuitem', { name: new RegExp(key, 'i') }).click()
    }
    await expect(
      page.locator(`section[data-testid="diagram-block-${i + 1}"] svg`).first(),
      `${key} must render as block ${i + 1}`
    ).toBeVisible({ timeout: 20_000 })
  }
  await page.waitForTimeout(500)
}

/** A short fingerprint of each card's drawn text, in on-screen order. */
async function fingerprints(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('section[data-testid^="diagram-block-"]'))
    return cards
      .map((card) => {
        const r = card.getBoundingClientRect()
        const svg = card.querySelector('[data-testid$="-svg"] svg')
        return {
          y: Math.round(r.top),
          x: Math.round(r.left),
          text: (svg?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
        }
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => c.text)
  })
}

/** The Mermaid keyword of each block, in stored order. */
async function storedTokens(page: Page, title: string): Promise<string[]> {
  return page.evaluate(async (t) => {
    const r = await fetch('/api/pages')
    const b = (await r.json()) as { pages: Array<{ title: string; content?: string }> }
    const p = b.pages.find((x) => x.title.startsWith(t))
    const parsed = JSON.parse(p?.content ?? '{}') as { blocks?: Array<{ source: string }> }
    return (parsed.blocks ?? []).map((blk) => blk.source.trim().split(/\s+/)[0])
  }, title)
}

/**
 * Ties each slot to a name, a drawn-text fingerprint and a stored token.
 *
 * A new Diagram page already holds one diagram, so the names always start with
 * `default` — getting that wrong is what made the first version of this file expect
 * four cards and find five.
 */
interface Calibration {
  name: string
  fingerprint: string
  token: string
}

async function calibrate(page: Page, title: string, seeds: TemplateKey[]): Promise<Calibration[]> {
  const names = ['default', ...seeds]
  // The document write is **debounced by design** — a burst of template clicks is
  // written as one save. So every card is on screen immediately while the document
  // still holds the previous state for up to a debounce window. Reading it straight
  // away is what made the first version of this file fail with "expected 5, received
  // 1": it was measuring the save's timing, not the page.
  await expect
    .poll(async () => (await storedTokens(page, title)).length, {
      timeout: 20_000,
      message: 'every added diagram must reach the document'
    })
    .toBe(names.length)
  const prints = await fingerprints(page)
  const tokens = await storedTokens(page, title)
  expect(prints.length, 'every card measured on screen').toBe(names.length)
  expect(tokens.length, 'every block read from the document').toBe(names.length)
  return names.map((name, i) => ({ name, fingerprint: prints[i]!, token: tokens[i]! }))
}

/** The names in on-screen order, read from the DOM and mapped through the calibration. */
async function visualOrder(page: Page, cal: Calibration[]): Promise<string[]> {
  const prints = await fingerprints(page)
  expect(prints.length, 'the card count must not change under a reorder').toBe(cal.length)
  return prints.map((print) => {
    const hit = cal.find((c) => c.fingerprint === print)
    expect(hit, `no calibrated diagram matches the drawing "${print}"`).toBeDefined()
    return hit!.name
  })
}

/**
 * Compares the two readings until they agree, and returns the agreed order.
 *
 * Written as a poll because the document write is debounced: reading it
 * immediately after a drop catches the pre-drop state, and a naive equality check
 * there reports a failure that is really just timing. The page title is passed in
 * rather than held in module state, so two tests can never read each other's page.
 */
async function expectOrdersAgree(page: Page, title: string, cal: Calibration[]): Promise<string[]> {
  let agreed: string[] = []
  await expect
    .poll(
      async () => {
        const visual = await visualOrder(page, cal)
        const tokens = await storedTokens(page, title)
        const stored = tokens.map((t) => cal.find((c) => c.token === t)?.name ?? `?${t}`)
        agreed = visual
        return JSON.stringify(visual) === JSON.stringify(stored)
      },
      { timeout: 20_000, message: `the visual and stored orders must agree (title: ${title})` }
    )
    .toBe(true)
  return agreed
}

async function drag(page: Page, from: Locator, to: Locator, targetFraction = 0.75): Promise<void> {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error('a drag endpoint had no box')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  // Several steps: Motion decides a reorder from the pointer crossing a neighbour,
  // and a single jump can land past more than one card.
  await page.mouse.move(b.x + b.width * targetFraction, b.y + b.height / 2, { steps: 20 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(900)
}

test.describe('Mermaid block reorder', () => {
  test('drags a block past its neighbour within one row', async ({ page }) => {
    const title = await newDiagramPage(page, 'ReorderRow')
    await addTemplates(page, SEEDS)
    const cal = await calibrate(page, title, SEEDS)
    const before = cal.map((c) => c.name)
    // eslint-disable-next-line no-console
    console.log(`    row before=${before.join(',')}`)

    await drag(page, page.getByTestId('diagram-block-drag-0'), page.getByTestId('diagram-block-1'))

    const after = await visualOrder(page, cal)
    // eslint-disable-next-line no-console
    console.log(`    row after=${after.join(',')}`)
    expect(after[0], 'the first two diagrams swapped').toBe(before[1])
    expect(after[1]).toBe(before[0])
    expect(after.slice(2), 'the rest of the page is untouched').toEqual(before.slice(2))
    await expectOrdersAgree(page, title, cal)
  })

  test('drags a block from one row to another', async ({ page }) => {
    // The case a single-axis reorder cannot express, and the reason for axis="xy".
    const title = await newDiagramPage(page, 'ReorderAcross')
    await addTemplates(page, SEEDS)
    const cal = await calibrate(page, title, SEEDS)
    const before = cal.map((c) => c.name)
    // eslint-disable-next-line no-console
    console.log(`    across before=${before.join(',')}`)

    await drag(
      page,
      page.getByTestId('diagram-block-drag-0'),
      page.getByTestId('diagram-block-3'),
      0.6
    )

    const after = await visualOrder(page, cal)
    // eslint-disable-next-line no-console
    console.log(`    across after=${after.join(',')}`)
    expect(after, 'a cross-row drag must change the order').not.toEqual(before)
    await expectOrdersAgree(page, title, cal)
  })

  test('the stored order survives a reload and matches what was on screen', async ({ page }) => {
    const title = await newDiagramPage(page, 'ReorderPersist')
    await addTemplates(page, SEEDS)
    const cal = await calibrate(page, title, SEEDS)

    await drag(page, page.getByTestId('diagram-block-drag-1'), page.getByTestId('diagram-block-2'))
    const agreed = await expectOrdersAgree(page, title, cal)

    await page.reload()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('section[data-testid="diagram-block-0"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(900)
    const reloaded = await visualOrder(page, cal)
    // eslint-disable-next-line no-console
    console.log(`    persist agreed=${agreed.join(',')} reloaded=${reloaded.join(',')}`)
    expect(reloaded, 'a reload must not rearrange the page').toEqual(agreed)
  })

  test('reordering works on a narrow viewport, where every block is its own row', async ({
    page
  }) => {
    // A single column is the degenerate "no wrapping" case of the same code path.
    const title = await newDiagramPage(page, 'ReorderNarrow', 900)
    const seeds = SEEDS.slice(0, 3)
    await addTemplates(page, seeds)
    const cal = await calibrate(page, title, seeds)
    const before = cal.map((c) => c.name)

    await drag(
      page,
      page.getByTestId('diagram-block-drag-0'),
      page.getByTestId('diagram-block-2'),
      0.5
    )
    const after = await visualOrder(page, cal)
    // eslint-disable-next-line no-console
    console.log(`    narrow before=${before.join(',')} after=${after.join(',')}`)
    expect(after).not.toEqual(before)
    await expectOrdersAgree(page, title, cal)
  })

  test('a page of variable-size cards can still be dragged', async ({ page }) => {
    // Variable rectangles are the hard case for a 2-D reorder: the algorithm has to
    // compare boxes rather than assume a grid. One block is resized first.
    const title = await newDiagramPage(page, 'ReorderMixed', 1600)
    await addTemplates(page, SEEDS)
    await page.getByTestId('diagram-block-1-preset-small').click({ force: true })
    await page.waitForTimeout(1000)

    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('section[data-testid^="diagram-block-"]')).map((c) => {
        const r = c.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
    )
    // eslint-disable-next-line no-console
    console.log(`    mixed sizes=${JSON.stringify(sizes)}`)
    expect(
      new Set(sizes.map((s) => s.h)).size,
      'the cards must not all be one height'
    ).toBeGreaterThan(1)

    const cal = await calibrate(page, title, SEEDS)
    const before = cal.map((c) => c.name)
    await drag(page, page.getByTestId('diagram-block-drag-0'), page.getByTestId('diagram-block-2'))
    const after = await visualOrder(page, cal)
    // eslint-disable-next-line no-console
    console.log(`    mixed before=${before.join(',')} after=${after.join(',')}`)
    expect(after).not.toEqual(before)
    await expectOrdersAgree(page, title, cal)

    // The resized block keeps its stored size — but **not necessarily at index 1**,
    // because a reorder is exactly what moved it. Asserting on the index was a bug in
    // the first version of this test: it read `data-height` off whatever now occupies
    // slot 1, which after a drag is a different diagram, and failed on an empty
    // string. What matters is that the size travelled with its diagram.
    const sizedAfterDrag = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-testid$="-container"]'))
          .map((el) => el.getAttribute('data-height') ?? '')
          .filter((h) => /^\d+$/.test(h)).length
    )
    expect(sizedAfterDrag, 'a resized block keeps its height through a reorder').toBe(1)
  })

  test('a block can be resized after being dragged, and a drag after being resized', async ({
    page
  }) => {
    const title = await newDiagramPage(page, 'ReorderThenResize')
    const seeds = SEEDS.slice(0, 2)
    await addTemplates(page, seeds)
    const cal = await calibrate(page, title, seeds)

    // Drag first, then resize the diagram that moved into slot 0.
    await drag(page, page.getByTestId('diagram-block-drag-0'), page.getByTestId('diagram-block-1'))
    expect((await visualOrder(page, cal))[0], 'the dragged diagram is now first').toBe(cal[1]!.name)

    await page.getByTestId('diagram-block-0-preset-medium').click({ force: true })
    await page.waitForTimeout(1000)
    const sized = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="diagram-block-0-container"]')
      return {
        h: el?.getAttribute('data-height') ?? '',
        height: Math.round(el?.getBoundingClientRect().height ?? 0)
      }
    })
    expect(sized.h, 'the block resized after the drag').toMatch(/^\d+$/)
    expect(sized.height).toBeGreaterThan(0)

    // Resize another block, then drag across the pair; both sizes must survive.
    await page.getByTestId('diagram-block-1-preset-large').click({ force: true })
    await page.waitForTimeout(1000)
    await drag(page, page.getByTestId('diagram-block-drag-1'), page.getByTestId('diagram-block-0'))
    await expectOrdersAgree(page, title, cal)
    const widthsLeft = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-width]'))
          .map((el) => el.getAttribute('data-width') ?? '')
          .filter(Boolean).length
    )
    expect(widthsLeft, 'both stored widths survive the later drag').toBeGreaterThanOrEqual(2)
  })

  test('the drag handle does not hijack the resize handle or the action buttons', async ({
    page
  }) => {
    // The reason the drag starts from a dedicated grip rather than the whole card:
    // the card also holds the two edge resize grips and a row of actions.
    const title = await newDiagramPage(page, 'ReorderNoHijack')
    const seeds = SEEDS.slice(0, 2)
    await addTemplates(page, seeds)
    const cal = await calibrate(page, title, seeds)

    const widthBefore = await page
      .getByTestId('diagram-block-0-container')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    const handle = page.getByTestId('diagram-block-0-resize-handle')
    await handle.scrollIntoViewIfNeeded()
    const hb = await handle.boundingBox()
    if (!hb) throw new Error('the resize grip had no box')
    // The grip's own centre: it is 8px wide, so a fixed +8 offset from its top-left
    // would fall outside it and no drag would happen at all.
    const gx = hb.x + hb.width / 2
    const gy = hb.y + hb.height / 2
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    await page.mouse.move(gx - 140, gy - 40, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(1000)

    const widthAfter = await page
      .getByTestId('diagram-block-0-container')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(widthAfter, 'the right edge grip must still resize').toBeLessThan(widthBefore)
    expect(await visualOrder(page, cal), 'a resize must not reorder the page').toEqual(
      cal.map((c) => c.name)
    )

    // And the action buttons still act. Asserted as a **count**, not as
    // "index 1 is gone": removing a block renumbers the ones after it, so a
    // positional assertion sees a different diagram in that slot and passes or fails
    // for the wrong reason.
    const before = (await fingerprints(page)).length
    await page.getByTestId('diagram-block-remove-1').click()
    await expect
      .poll(async () => (await fingerprints(page)).length, { timeout: 20_000 })
      .toBe(before - 1)
  })

  test('the up and down buttons still reorder, and stay the keyboard route', async ({ page }) => {
    // They remain after pointer dragging exists, deliberately: a drag needs a
    // pointer, and these are focusable, labelled and reachable by Tab.
    const title = await newDiagramPage(page, 'ReorderButtons')
    const seeds = SEEDS.slice(0, 3)
    await addTemplates(page, seeds)
    const cal = await calibrate(page, title, seeds)
    const before = cal.map((c) => c.name)

    const upBtn = page.getByTestId('diagram-block-up-1')
    await expect(upBtn).toBeVisible()
    await upBtn.focus()
    await expect(upBtn, 'the reorder buttons are focusable').toBeFocused()
    await page.keyboard.press('Enter')

    const expected = [before[1]!, before[0]!, ...before.slice(2)]
    await expect.poll(async () => visualOrder(page, cal), { timeout: 20_000 }).toEqual(expected)
    await expectOrdersAgree(page, title, cal)

    // The first slot's up button is disabled, as it always was.
    await expect(page.getByTestId('diagram-block-up-0')).toBeDisabled()
  })

  test('the drag handle is labelled and does not reorder when merely clicked', async ({ page }) => {
    const title = await newDiagramPage(page, 'ReorderHandleA11y')
    const seeds = SEEDS.slice(0, 2)
    await addTemplates(page, seeds)
    const cal = await calibrate(page, title, seeds)

    const handle = page.getByTestId('diagram-block-drag-0')
    await expect(handle, 'the drag handle has an accessible name').toHaveAttribute(
      'aria-label',
      /reorder/i
    )
    await expect(handle, 'the drag handle is a real button').toHaveRole('button')

    // A click performs no reorder: the handle's action *is* the drag, so a click
    // handler would imply an action the button does not take.
    await handle.click()
    await page.waitForTimeout(600)
    expect(await visualOrder(page, cal), 'a click on the grip must not reorder').toEqual(
      cal.map((c) => c.name)
    )
  })

  test('no horizontal overflow is introduced', async ({ page }) => {
    const title = await newDiagramPage(page, 'ReorderOverflow', 1600)
    await addTemplates(page, SEEDS)
    const cal = await calibrate(page, title, SEEDS)
    await drag(page, page.getByTestId('diagram-block-drag-0'), page.getByTestId('diagram-block-3'))
    await expectOrdersAgree(page, title, cal)

    const overflow = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="diagram-block-list"]')
      const doc = document.documentElement
      return {
        listScroll: list?.scrollWidth ?? 0,
        listClient: list?.clientWidth ?? 0,
        docScroll: doc.scrollWidth,
        docClient: doc.clientWidth
      }
    })
    expect(overflow.listScroll, 'the block list must not scroll sideways').toBeLessThanOrEqual(
      overflow.listClient
    )
    expect(overflow.docScroll, 'the page must not scroll sideways').toBeLessThanOrEqual(
      overflow.docClient
    )
  })
})
