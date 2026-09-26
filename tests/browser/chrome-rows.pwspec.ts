import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Chrome row behaviour: separators, tab overflow, toolbar overflow.
 *
 * Geometry is asserted from the settled layout only, and every claim is read
 * back from the running app rather than from the stylesheet, because a computed
 * style can pass while the painted result is wrong.
 */

const DESKTOP = { width: 1280, height: 800 }
/**
 * The full toolbar needs ~1050px of row width. 1280 with the tree open leaves
 * less than that, so "everything fits" is only true on a wide window.
 */
const WIDE = { width: 1600, height: 800 }
/** Above Mantine's `sm` breakpoint so the tree is on screen and can be clicked. */
const CROWDED = { width: 1024, height: 800 }
const NARROW = { width: 620, height: 800 }

let seq = 0
function uniqueTitle(base: string): string {
  seq += 1
  return `${base} ${Date.now()}-${seq}`
}

async function openRichNote(page: Page, request: APIRequestContext, base: string): Promise<string> {
  const title = uniqueTitle(base)
  const res = await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page?: { id: string }; id?: string }
  const id = body.page?.id ?? body.id
  expect(id).toBeTruthy()
  await page.goto(`/?page=${id}`)
  await expect(page.getByRole('toolbar')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(400)
  return title
}

test.describe('Chrome row separators', () => {
  test('the tab bar and the toolbar are separated by tone, not a line', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    await openRichNote(page, request, 'SepProbe')

    const read = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]') as HTMLElement
      const toolbar = document.querySelector('[role="toolbar"]') as HTMLElement
      const pick = (el: HTMLElement) => {
        const cs = getComputedStyle(el)
        return {
          borderBottom: cs.borderBottomWidth,
          borderTop: cs.borderTopWidth,
          background: cs.backgroundColor
        }
      }
      return { tablist: pick(tablist), toolbar: pick(toolbar) }
    })

    // No hairline between the two rows. Trilium removes the editor toolbar's own
    // border in exactly this position and separates the rows by tint instead.
    expect(read.tablist.borderBottom, 'tab bar must not draw a line under itself').toBe('0px')
    expect(read.toolbar.borderTop, 'toolbar must not draw a line above itself').toBe('0px')
    // And the tint must actually differ, or removing the line leaves them merged.
    expect(read.toolbar.background, 'toolbar must be tinted differently from the tab bar').not.toBe(
      read.tablist.background
    )
  })
})

test.describe('Tab bar overflow', () => {
  test('chevrons are absent while every tab fits', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP)
    await openRichNote(page, request, 'TabFit')
    await expect(page.getByTestId('tab-scroll-prev')).toHaveCount(0)
    await expect(page.getByTestId('tab-scroll-next')).toHaveCount(0)
  })

  test('chevrons appear, scroll, and disable at each end', async ({ page, request }) => {
    await page.setViewportSize(CROWDED)
    // Pages created through the API do not open tabs, so they would not make
    // the row overflow. Real tree rows are opened instead — the titles do not
    // matter, only that enough tabs accumulate to crowd the row.
    for (let i = 0; i < 10; i += 1) {
      const res = await request.post('/api/pages', {
        data: { title: uniqueTitle(`TabFlood${i}`), pageType: 'rich', content: '' }
      })
      expect(res.status()).toBe(201)
    }
    await page.goto('/')
    await expect(page.getByRole('button', { name: /theme/i }).first()).toBeVisible({
      timeout: 20_000
    })
    const rows = page.locator('[role="treeitem"]')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    const rowCount = Math.min(await rows.count(), 10)
    expect(rowCount, 'the tree must have enough rows to crowd the tab row').toBeGreaterThan(4)
    for (let i = 0; i < rowCount; i += 1) {
      await rows.nth(i).click()
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(600)
    expect(await page.getByRole('tab').count(), 'several tabs must be open').toBeGreaterThan(4)

    const prev = page.getByTestId('tab-scroll-prev')
    const next = page.getByTestId('tab-scroll-next')
    await expect(next).toBeVisible({ timeout: 10_000 })
    await expect(prev).toBeVisible()

    // At the left edge, "previous" has nowhere to go.
    await expect(prev).toBeDisabled()

    const scroller = page.getByTestId('tab-scroll-container')
    const before = await scroller.evaluate((el) => el.scrollLeft)
    await next.click()
    await page.waitForTimeout(400)
    const after = await scroller.evaluate((el) => el.scrollLeft)
    expect(after, 'next chevron must scroll the row').toBeGreaterThan(before)

    // Scrolled away from the start, "previous" becomes usable.
    await expect(prev).toBeEnabled()

    // The scrollbar itself stays hidden; the chevrons are the affordance.
    const scrollbarHidden = await scroller.evaluate((el) => {
      const cs = getComputedStyle(el)
      return cs.scrollbarWidth === 'none' || cs.overflowX === 'hidden'
    })
    expect(scrollbarHidden, 'the raw scrollbar must not be the affordance').toBe(true)
  })
})

test.describe('Toolbar overflow', () => {
  test('every button is in the bar when there is room', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, 'ToolFit')
    await expect(page.getByTestId('toolbar-more')).toHaveCount(0)
    // And nothing is clipped.
    const overflows = await page
      .getByRole('toolbar')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflows).toBe(false)
  })

  test('buttons that do not fit move into a more menu', async ({ page, request }) => {
    await page.setViewportSize(NARROW)
    await openRichNote(page, request, 'ToolOverflow')

    const more = page.getByTestId('toolbar-more')
    await expect(more).toBeVisible({ timeout: 10_000 })

    // The bar itself must no longer overflow: that is the defect being fixed.
    const overflows = await page
      .getByRole('toolbar')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(overflows, 'the toolbar must not be clipped once overflow is handled').toBe(false)

    // A button that was pushed out of the bar is reachable from the menu.
    const clearFormatting = page.getByLabel(/clear formatting/i)
    const inBar = await page
      .getByRole('toolbar')
      .getByLabel(/clear formatting/i)
      .count()
    await more.click()
    // The overflow panel is a `Popover`, not a `Menu`, so Mantine's
    // `Menu-dropdown` class no longer applies. `toolbar-overflow-panel` is our own
    // stable hook on it.
    const dropdown = page.getByTestId('toolbar-overflow-panel')
    await expect(dropdown).toBeVisible()
    if (inBar === 0) {
      // The same control, moved rather than reimplemented: still the same
      // labelled button, and still operable.
      const inMenu = await dropdown.getByLabel(/clear formatting/i).count()
      expect(inMenu, 'an overflowed button must be in the menu').toBeGreaterThan(0)
      await dropdown
        .getByLabel(/clear formatting/i)
        .first()
        .click()
      await expect(clearFormatting).toHaveCount(1)
    }
  })
})
