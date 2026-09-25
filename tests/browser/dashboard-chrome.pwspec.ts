import { expect, type Page, test } from '@playwright/test'

/**
 * Chrome on the dashboard.
 *
 * On Home there are no open tabs, so the tab strip used to render as an empty
 * 40px band across the top of the dashboard, and the status bar dropped its
 * breadcrumb entirely, leaving only the app name and a readiness line.
 */
/**
 * Opens a page created through the API. The tree virtualises and new pages sort
 * last, so the row has to be scrolled into existence before it can be clicked.
 */
async function openNewest(page: Page, title: string): Promise<void> {
  const tree = page.locator('[data-testid="page-tree"]')
  await expect(tree).toBeVisible({ timeout: 20_000 })
  await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(400)
  const row = page.locator('[role="treeitem"]').filter({ hasText: title }).first()
  await row.scrollIntoViewIfNeeded()
  await row.click()
}

test.describe('Dashboard chrome', () => {
  test('the tab row is absent when no tabs are open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('[data-testid="dashboard-scroll"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    // A dead band is worse than no band: the dashboard content should start at
    // the top of the workspace.
    await expect(page.locator('[role="tablist"]')).toHaveCount(0)
    const top = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement | null
      const heading = document.querySelector(
        'main h1, main h2, main [class*="title"]'
      ) as HTMLElement | null
      return {
        mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
        headingTop: heading ? Math.round(heading.getBoundingClientRect().top) : null
      }
    })
    expect(top.mainTop, 'the workspace must start at the top of the window').toBeLessThanOrEqual(1)
  })

  test('the tab row returns once a page is open', async ({ page, request }) => {
    const title = `TabRow ${Date.now()}`
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await openNewest(page, title)
    await expect(page.getByRole('tab')).toBeVisible({ timeout: 10_000 })
  })

  test('the active tab reaches the bottom of its band so it merges with the content', async ({
    page,
    request
  }) => {
    // A short active tab centred in a 40px band leaves canvas showing beneath
    // it, which made the tab read as a floating rounded rectangle.
    const title = `Merge ${Date.now()}`
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await openNewest(page, title)
    await expect(page.getByRole('tab')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(400)

    const m = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]') as HTMLElement
      const active = list.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null
      if (!active) return null
      const lb = list.getBoundingClientRect()
      const ab = active.getBoundingClientRect()
      return {
        listBottom: Math.round(lb.bottom),
        tabBottom: Math.round(ab.bottom),
        gapBelow: Math.round(lb.bottom - ab.bottom)
      }
    })
    expect(m).not.toBeNull()
    expect(m!.gapBelow, 'the active tab must meet the band floor').toBeLessThanOrEqual(1)
  })

  test('the status bar shows where you are on the dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const status = page.locator('[data-testid="workspace-status-bar"]')
    await expect(status).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    // The location breadcrumb renders on the dashboard too, so there is a Home
    // control and a label - not just the app name.
    await expect(page.getByTestId('status-home')).toBeVisible()
    const text = (await status.innerText()).trim()
    expect(text.length, 'the status bar must not be blank on the dashboard').toBeGreaterThan(3)
  })

  test('the status bar still shows the page on a real page', async ({ page, request }) => {
    const title = `StatusBar ${Date.now()}`
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await openNewest(page, title)
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="workspace-status-bar"]')).toContainText(title)
  })
})
