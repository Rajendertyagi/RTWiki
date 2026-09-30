import { expect, type Page, test } from '@playwright/test'

/**
 * The diagram template bar: one row that responds to the window, and one look for a
 * template wherever it is shown.
 *
 * ## The two defects
 *
 * 1. **The bar never grew again.** `useToolbarOverflow` measures the bar's
 *    `clientWidth`, and the bar was shrink-to-fit inside a shrink-to-fit group, so
 *    its width was the width of whatever was still in it. Once a split was applied
 *    the tail left the bar, the bar got narrower, and the measurement stopped
 *    tracking the window entirely. Measured: 504px at a 1000px window, still 504px
 *    after widening to 1800px with the "more" dropdown still open, and still 319px
 *    after widening again from a narrower one. This is "the toolbar does not expand
 *    when the page expands".
 *
 * 2. **A template looked different depending on where it was.** The bar drew a 24px
 *    icon coloured by family; its own overflow dropdown and the Rich Note's Insert
 *    menu drew an 18px icon in the default text colour. Measured on the Diagram page:
 *    bar icons `rgb(76, 141, 255)`, dropdown rows `rgb(0, 0, 0)`. So a control
 *    changed its appearance the moment the window narrowed and pushed it into the
 *    dropdown beside it, and the richest list of diagram types in the application
 *    was the least recognisable version of itself.
 */

async function openDiagramPage(
  page: import('@playwright/test').Page,
  label: string
): Promise<void> {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(`${label} ${Date.now()}`)
  await dialog.getByTestId('new-page-type-diagram').click()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('template-bar')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(400)
}

/** Every template button actually on the bar. The bar itself shares the prefix. */
const BAR_BUTTONS =
  '[data-testid^="template-"]:not([data-testid="template-more"]):not([data-testid="template-bar"])'

/** The six family colours, as the stylesheet defines them. */
const FAMILY_PALETTE = [
  'rgb(76, 141, 255)',
  'rgb(157, 123, 255)',
  'rgb(47, 184, 122)',
  'rgb(217, 161, 58)',
  'rgb(224, 100, 140)',
  'rgb(53, 184, 196)'
]

/** Computed colour of a template's icon, wherever it is currently shown. */
async function iconColours(page: Page, selector: string): Promise<string[]> {
  return await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)]
      .map((el) => {
        const svg = el.matches('svg') ? el : el.querySelector('svg')
        return svg ? getComputedStyle(svg).color : null
      })
      .filter((colour): colour is string => colour !== null)
  }, selector)
}

test.describe('the diagram template bar follows the window', () => {
  test('widening the window brings the split controls back out of the dropdown', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await openDiagramPage(page, 'BarGrows')

    // Narrow enough that the bar must split. Asserted rather than assumed, because a
    // test that assumed it would pass vacuously on a window wide enough not to.
    await expect(page.getByTestId('template-more'), 'narrow: the split is needed').toHaveCount(1)
    expect(
      await page.locator(BAR_BUTTONS).count(),
      'narrow: some templates are in the dropdown'
    ).toBeLessThan(30)

    // Wide enough for all of them.
    await page.setViewportSize({ width: 1900, height: 900 })
    await expect
      .poll(async () => page.locator(BAR_BUTTONS).count(), {
        timeout: 10_000,
        message: 'widening the window must bring the tail back onto the bar'
      })
      .toBe(30)
    await expect(page.getByTestId('template-more'), 'wide: no split is needed').toHaveCount(0)

    // And back again, both ways, because a bar that only ever shrinks is half a fix.
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(page.getByTestId('template-more'), 'narrow again: the split returns').toHaveCount(
      1
    )
    await page.setViewportSize({ width: 1900, height: 900 })
    await expect(page.getByTestId('template-more'), 'wide again: the split clears').toHaveCount(0)
  })

  test('the row itself does not overflow the window at any width', async ({ page }) => {
    // The property that must survive making the bar fill its row: filling the row
    // must not mean spilling out of it.
    //
    // The narrowest width here is 900, not 700. Below the `sm` breakpoint the
    // launcher rail becomes a drawer, so the New page control this needs to create a
    // page is genuinely not on screen. That is the mobile layout, not a toolbar
    // fault, and testing it here would measure the wrong thing.
    for (const width of [1600, 1200, 900]) {
      await page.setViewportSize({ width, height: 900 })
      await openDiagramPage(page, `BarFits${width}`)
      const geom = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="diagram-toolbar-row"]') as HTMLElement
        const add = document.querySelector('[data-testid="diagram-add-block"]') as HTMLElement
        const bar = document.querySelector('[data-testid="template-bar"]') as HTMLElement
        return {
          rowScroll: row.scrollWidth,
          rowClient: row.clientWidth,
          addWidth: Math.round(add.getBoundingClientRect().width),
          barRight: Math.round(bar.getBoundingClientRect().right),
          viewport: window.innerWidth
        }
      })
      expect(geom.rowScroll, `the toolbar row must not overflow at ${width}px`).toBeLessThanOrEqual(
        geom.rowClient
      )
      expect(geom.addWidth, `Add Diagram must keep its label at ${width}px`).toBeGreaterThan(90)
      expect(
        geom.barRight,
        `the bar must stay inside the window at ${width}px`
      ).toBeLessThanOrEqual(geom.viewport)
    }
  })
})

test.describe('a template looks the same wherever it is shown', () => {
  test('the overflow dropdown colours its icons by family, like the bar does', async ({ page }) => {
    // The palette is read from a window wide enough to show every template, so it is
    // the complete set of family colours rather than whichever three happen to be
    // visible in a narrow row.
    await page.setViewportSize({ width: 1900, height: 900 })
    await openDiagramPage(page, 'IconPalette')
    await expect(page.getByTestId('template-more'), 'wide: no split').toHaveCount(0)
    const palette = new Set(await iconColours(page, BAR_BUTTONS))
    expect([...palette].sort(), 'the bar is coloured by family').toEqual([...FAMILY_PALETTE].sort())

    // Narrow, so the bar has to split, and the dropdown is the other rendering.
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(page.getByTestId('template-more'), 'narrow: the split is needed').toHaveCount(1)
    const barNarrow = await iconColours(page, BAR_BUTTONS)
    await page.getByTestId('template-more').click()
    await page.waitForTimeout(400)
    const inMenu = await iconColours(page, '[data-testid^="template-row-"]')
    expect(inMenu.length, 'the dropdown has rows to compare').toBeGreaterThan(3)
    // Every row is a family colour, and between them the rows cover all six - so
    // nothing in the dropdown is a family the bar has never shown, and nothing has
    // quietly lost its colour on the way.
    for (const colour of inMenu) {
      expect(
        FAMILY_PALETTE,
        `a dropdown row icon must use a family colour, got ${colour}`
      ).toContain(colour)
    }
    expect(
      new Set([...barNarrow, ...inMenu]),
      'the bar and its dropdown between them show every family'
    ).toEqual(new Set(FAMILY_PALETTE))
  })

  test("the Rich Note's Insert > Diagram menu uses the same coloured icons", async ({ page }) => {
    // The third rendering of the same list, and the one a Rich Note user sees. It
    // drew a bare 16px icon in the default text colour while the Diagram page showed
    // the same template as a coloured 24px glyph, so the two pages disagreed about
    // what a Flowchart looks like.
    await page.setViewportSize({ width: 1900, height: 950 })
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`IconNote ${Date.now()}`)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    const trigger = page.getByTestId('insert-diagram')
    if ((await trigger.count()) === 0) {
      await page.getByTestId('toolbar-more').click()
      await trigger.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await trigger.click()
    await expect(page.locator('[data-testid^="insert-diagram-option-"]').first()).toBeVisible({
      timeout: 5_000
    })

    const inMenu = await iconColours(page, '[data-testid^="insert-diagram-option-"]')
    // The same six family colours, no more and no fewer. Asserted as the exact set
    // rather than "more than one", because "more than one" is equally true of a menu
    // that coloured its icons at random.
    expect(new Set(inMenu), 'the note menu uses exactly the family palette').toEqual(
      new Set(FAMILY_PALETTE)
    )
  })
})
