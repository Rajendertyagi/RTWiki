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

/**
 * This spec needs the page tree to exist, so it seeds a page rather than
 * assuming one.
 *
 * `Sidebar` renders `<PageTree>` only when the collection is non-empty
 * (`src/web/layout/sidebar.tsx:150`); against an empty database it renders the
 * empty state instead, so `data-testid="page-tree"` is never in the DOM and
 * every readiness check below fails with "element(s) not found". That is
 * correct product behaviour - a wiki with no pages has nothing to show - so
 * the spec supplies its own precondition rather than the app being changed to
 * satisfy a test. Nothing seeds `data/` (it is gitignored), so on a fresh
 * checkout or a CI runner the database is empty and this spec could not pass
 * without it.
 *
 * One page, seeded once for the file: four of the five tests only navigate to
 * Settings and one reloads, so none of them alters the tree, and per-test
 * seeding would buy nothing but five extra round trips. This is the file-scope
 * form of the `seedOwnedPage` fixture `tree-dnd.pwspec.ts` uses per test, and
 * keeps its invariant - teardown deletes exactly the IDs recorded here, so an
 * unrelated page, or one another spec left behind, is never touched.
 */
const seededPageIds: string[] = []

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/pages', {
    data: { title: `Color Scheme Fixture ${Date.now()}`, pageType: 'rich', content: '' }
  })
  if (res.status() !== 201) {
    throw new Error(`seed page failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as { page: { id: string } }
  seededPageIds.push(body.page.id)
})

test.afterAll(async ({ request }) => {
  for (const id of seededPageIds) {
    try {
      await request.delete(`/api/pages/${id}`)
    } catch {
      // Already deleted - ignore.
    }
  }
})

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
