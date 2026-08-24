import { expect, type Page, test } from '@playwright/test'

/**
 * Visual-shell layout contract:
 * - full-height launcher rail at the outermost left, starting at viewport top
 * - no global app-title header row
 * - desktop tree collapse that keeps the rail and expands the workspace
 * - mobile drawer exposing rail + tree regardless of desktop collapse
 * - central ordering: tabs -> toolbar -> title -> document (stable geometry)
 *
 * Geometry is asserted from final settled layout only — no races against
 * editor initialization state.
 */

const DESKTOP = { width: 1280, height: 800 }

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function box(page: Page, selector: string): Promise<Box> {
  const el = page.locator(selector).first()
  await el.waitFor({ state: 'visible' })
  const b = (await el.boundingBox()) as Box
  expect(b, `bounding box for ${selector}`).not.toBeNull()
  return b
}

function uniqueTitle(base: string): string {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`
}

/** The CI server keeps state across tests, so rows are targeted by unique title. */
async function openRowByTitle(page: Page, title: string): Promise<void> {
  const row = page.locator('[role="treeitem"]').filter({ hasText: title })
  await row.waitFor({ state: 'visible' })
  await row.click()
}

test.describe('Shell layout regions', () => {
  test('rail spans the full viewport height and no header row remains', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    await request.post('/api/pages', {
      data: { title: uniqueTitle('ShellA'), pageType: 'rich', content: '' }
    })
    await page.goto('/')

    const rail = await box(page, 'nav[aria-label="RTWiki"]')
    // Rail starts at the very top and reaches the bottom of the viewport.
    expect(rail.y).toBeLessThanOrEqual(1)
    expect(rail.y + rail.height).toBeGreaterThanOrEqual(DESKTOP.height - 1)
    // Rail is the outermost column.
    expect(rail.x).toBeLessThanOrEqual(1)

    // No global app-title header row above the tab strip / content.
    const tabs = await box(page, '[role="tablist"]')
    expect(tabs.y).toBeLessThanOrEqual(1)
    await expect(page.getByRole('heading', { name: 'RTWiki' })).toHaveCount(0)
  })

  test('desktop tree collapse keeps the rail and expands the workspace', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    const title = uniqueTitle('ShellB')
    await request.post('/api/pages', {
      data: { title, pageType: 'rich', content: '' }
    })
    await page.goto('/')
    await openRowByTitle(page, title)

    const toggle = page.getByTestId('tree-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const before = await box(page, '.bn-editor')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Tree pane gone on desktop; rail still visible; workspace wider.
    const tree = page.locator('[role="tree"]')
    await expect(tree).toBeHidden()
    const rail = await box(page, 'nav[aria-label="RTWiki"]')
    expect(rail.width).toBeLessThanOrEqual(70)
    const after = await box(page, '.bn-editor')
    expect(after.width).toBeGreaterThan(before.width)

    // Document still receives clicks after expansion (no overlay interception).
    await page.locator('.bn-editor').click()
    await expect(page.locator('.bn-editor')).toBeFocused()

    // Expand restores the tree.
    await toggle.click()
    await expect(tree).toBeVisible()
  })

  test('mobile drawer exposes rail and tree even when desktop tree is collapsed', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    await request.post('/api/pages', {
      data: { title: uniqueTitle('ShellC'), pageType: 'rich', content: '' }
    })
    await page.goto('/')

    // Collapse on desktop first.
    await page.getByTestId('tree-toggle').click()
    await expect(page.locator('[role="tree"]')).toBeHidden()

    // Shrink to mobile: the drawer must show BOTH rail and tree.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Toggle navigation' }).click()
    await expect(page.locator('[role="tree"]')).toBeVisible()
    await expect(page.locator('nav[aria-label="RTWiki"]')).toBeVisible()
  })

  test('central order is tabs, toolbar, title, document with stable toolbar slot', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    const title = uniqueTitle('ShellD')
    await request.post('/api/pages', {
      data: { title, pageType: 'rich', content: '' }
    })
    await page.goto('/')
    await openRowByTitle(page, title)

    const tabs = await box(page, '[role="tablist"]')
    const toolbarRow = await box(page, '[data-testid="rich-toolbar-row"]')
    const titleBox = await box(page, 'input[aria-label="Title"]')
    const doc = await box(page, '.bn-editor')

    expect(tabs.y + tabs.height).toBeLessThanOrEqual(toolbarRow.y + 1)
    expect(toolbarRow.y + toolbarRow.height).toBeLessThanOrEqual(titleBox.y + 1)
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(doc.y + 1)

    // The toolbar slot has a fixed reserved height (no post-init shift).
    expect(Math.round(toolbarRow.height)).toBe(42)

    // Real controls eventually occupy the stable slot.
    await expect(page.locator('[data-testid="rich-toolbar-row"] button').first()).toBeVisible()
  })

  test('HTML pages keep their own header flow without a rich toolbar', async ({
    page,
    request
  }) => {
    await page.setViewportSize(DESKTOP)
    const title = uniqueTitle('ShellE')
    // Empty content is schema-valid; the workspace shows its placeholder,
    // which is enough to assert the shell regions around it.
    const res = await request.post('/api/pages', {
      data: { title, pageType: 'html', content: '' }
    })
    expect(res.status()).toBe(201)
    await page.goto('/')
    await openRowByTitle(page, title)

    await expect(page.getByTestId('rich-toolbar-row')).toHaveCount(0)
    const tabs = await box(page, '[role="tablist"]')
    const titleBox = await box(page, 'input[aria-label="Title"]')
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(titleBox.y + 1)
  })
})
