import { expect, type Page, test } from '@playwright/test'

/**
 * The app must follow the operating system's light/dark preference.
 *
 * `MantineProvider` defaults to 'light', so with no explicit choice the app
 * rendered light on a machine set to dark, however the OS was configured.
 * `defaultColorScheme="auto"` makes the OS preference the starting point, and an
 * explicit choice in Settings still wins afterwards because Mantine persists it.
 */

const scheme = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))

/**
 * A choice in the appearance control.
 *
 * Mantine's SegmentedControl puts the real `<input type="radio">` visually
 * hidden inside a `<label>`, so `getByRole('radio')` resolves to an element
 * Playwright reports as hidden. The label is what a person actually clicks.
 */
function appearanceOption(page: Page, label: string) {
  return page
    .getByTestId('appearance-control')
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
}

async function openApp(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('nav[aria-label="RTWiki"] button[aria-label="Settings"]').click()
  await expect(page.getByTestId('settings-workspace')).toBeVisible({ timeout: 10_000 })
}

test('with no stored choice the app follows prefers-color-scheme: dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openApp(page)
  expect(await scheme(page)).toBe('dark')
})

test('with no stored choice the app follows prefers-color-scheme: light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  expect(await scheme(page)).toBe('light')
})

test('an explicit choice overrides the OS preference and survives a reload', async ({ page }) => {
  // A dark OS, but the user asks for light: their choice must win.
  await page.emulateMedia({ colorScheme: 'dark' })
  await openApp(page)
  expect(await scheme(page)).toBe('dark')

  await openSettings(page)
  await appearanceOption(page, 'Light').click()
  await expect.poll(async () => scheme(page), { timeout: 5_000 }).toBe('light')

  // Persisted, so a reload keeps it even though the OS still says dark.
  await page.reload()
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  expect(await scheme(page)).toBe('light')
})

test('choosing System hands control back to the operating system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openApp(page)
  await openSettings(page)

  // Pin it to light first, so "System" has something to undo.
  await appearanceOption(page, 'Light').click()
  await expect.poll(async () => scheme(page), { timeout: 5_000 }).toBe('light')

  await appearanceOption(page, 'System').click()
  await expect.poll(async () => scheme(page), { timeout: 5_000 }).toBe('dark')

  // And the OS flipping now moves the app with it.
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(async () => scheme(page), { timeout: 5_000 }).toBe('light')
})

test('the appearance control offers System alongside Light and Dark', async ({ page }) => {
  await openApp(page)
  await openSettings(page)
  for (const label of ['System', 'Light', 'Dark']) {
    await expect(appearanceOption(page, label)).toBeVisible()
  }
})
