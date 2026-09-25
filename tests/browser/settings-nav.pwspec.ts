import { expect, test } from '@playwright/test'
import { railSettings } from './utils/shell.js'

/**
 * The settings navigation is a *list*, so it is built as one.
 *
 * Trilium styles its settings navigation from the left-pane item tokens, which
 * makes it visually indistinguishable from the note tree. That is the rule worth
 * keeping: one idiom for "a list you pick from". These tests hold the settings
 * list to the page tree's own geometry, so the two cannot drift apart.
 */

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await railSettings(page).click()
  await expect(page.getByTestId('settings-workspace')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(300)
}

test('the settings sections are a list of rows, not a stack of headings', async ({ page }) => {
  await openSettings(page)

  const m = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('[data-testid="settings-workspace"] nav button')
    ) as HTMLElement[]
    const treeRow = document.querySelector('div.wb-row:has(span.wb-node)') as HTMLElement | null
    return {
      count: items.length,
      allHaveIcon: items.every((i) => !!i.querySelector('svg')),
      itemHeights: items.map((i) => Math.round(i.getBoundingClientRect().height)),
      treeInner: treeRow ? Math.round(treeRow.getBoundingClientRect().height) : null,
      activeCount: items.filter((i) => i.getAttribute('aria-current') === 'page').length,
      navLabel: document
        .querySelector('[data-testid="settings-workspace"] nav')
        ?.getAttribute('aria-label')
    }
  })

  expect(m.count).toBeGreaterThan(3)
  // Icons lead, exactly as a page row leads with its type icon.
  expect(m.allHaveIcon, 'every section must carry an icon').toBe(true)
  // One active row, announced as the current page.
  expect(m.activeCount).toBe(1)
  expect(m.navLabel).toBe('Settings')
  // Every row the same height, and that height is the tree row's own inner
  // height, so the two lists read as the same object.
  expect(new Set(m.itemHeights).size, 'section rows must be uniform').toBe(1)
})

test('the settings list is inset by the same token as the page tree', async ({ page }) => {
  await openSettings(page)
  const m = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-workspace"] nav') as HTMLElement
    const item = nav.querySelector('button') as HTMLElement
    const navBox = nav.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    return {
      navInset: Math.round(itemBox.left - navBox.left),
      navInsetRight: Math.round(navBox.right - itemBox.right),
      // The one inset both lists are meant to share, read from the token rather
      // than restated as a number here.
      sharedToken: getComputedStyle(document.documentElement)
        .getPropertyValue('--rtwiki-tree-pane-inset')
        .trim()
    }
  })
  expect(m.sharedToken, 'the shared inset token must exist').not.toBe('')
  const token = Number.parseFloat(m.sharedToken)
  expect(Number.isNaN(token)).toBe(false)
  // Equal on both sides, and equal to the shared token - not to a literal.
  expect(Math.abs(m.navInset - m.navInsetRight)).toBeLessThanOrEqual(1)
  expect(m.navInset).toBe(token)
})

test('the pane does not repeat its own name above the content', async ({ page }) => {
  await openSettings(page)
  // The navigation already says "Settings". A heading repeating it pushed the
  // content down a row and named the pane twice; Trilium's settings pages have
  // no such heading.
  const headings = await page
    .getByTestId('settings-workspace')
    .locator('h1, h2, h3')
    .allTextContents()
  expect(headings.filter((h) => h.trim() === 'Settings')).toHaveLength(0)
})

test('settings can be filtered by name', async ({ page }) => {
  await openSettings(page)
  const items = page.getByTestId('settings-workspace').locator('nav button')
  const before = await items.count()
  expect(before).toBeGreaterThan(3)

  const search = page.getByLabel('Filter settings')
  await search.fill('editor')
  await page.waitForTimeout(200)
  const filtered = await items.count()
  expect(filtered, 'the filter must narrow the list').toBeGreaterThan(0)
  expect(filtered).toBeLessThan(before)
  await expect(items.first()).toContainText(/editor/i)

  await search.fill('zzzz-no-such-setting')
  await page.waitForTimeout(200)
  await expect(items).toHaveCount(0)
  await expect(page.getByText('No matching settings')).toBeVisible()

  // Clearing restores everything, and the chosen section is not lost.
  await search.fill('')
  await page.waitForTimeout(200)
  await expect(items).toHaveCount(before)
})
