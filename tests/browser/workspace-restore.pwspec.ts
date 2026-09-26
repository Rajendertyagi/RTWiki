import { expect, type Page, test } from '@playwright/test'

/**
 * Reload must not discard open tabs.
 *
 * The app writes `?page=<id>` into its own URL on every navigation, so a reload
 * almost always carries that parameter. A `?page=` deep link used to take an
 * early return before the session was read, which opened that one page and threw
 * away every other open tab - then rewrote the session with just that page, so
 * the loss became permanent. Two tabs went in and one came out, every time.
 *
 * These are the tests for that: the deep link is additive, and a session with
 * nothing valid still falls back to Home.
 */

const SESSION_KEY = 'rtwiki.workspace.session'

async function openByRow(page: import('@playwright/test').Page, title: string): Promise<void> {
  const tree = page.getByTestId('page-tree')
  await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(400)
  await page.locator('[role="treeitem"]').filter({ hasText: title }).first().click()
  await page.waitForTimeout(700)
}

test('a reload keeps every open tab even though the app put ?page= in the URL', async ({
  page,
  request
}) => {
  const stamp = Date.now()
  const first = `KeepA${stamp}`
  const second = `KeepB${stamp}`
  for (const title of [first, second]) {
    const r = await request.post('/api/pages', {
      data: { title, pageType: 'rich', content: '' }
    })
    expect(r.status()).toBe(201)
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, first)
  await openByRow(page, second)

  // The precondition, asserted rather than assumed: the app really does put the
  // active page in the URL, and both tabs really are open.
  expect(page.url(), 'the app writes ?page= into its own URL').toContain('?page=')
  await expect(page.getByRole('tab')).toHaveCount(2)

  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(2)

  // Both are still there, in the original order, and the deep-linked page is
  // still the active one.
  const tabs = page.getByRole('tab')
  await expect(tabs.nth(0)).toContainText(first)
  await expect(tabs.nth(1)).toContainText(second)
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

  // And the session was not rewritten down to one tab, which is what made the
  // original loss permanent.
  const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), SESSION_KEY)
  const parsed = JSON.parse(stored ?? '{}') as { openPageIds?: string[] }
  expect(parsed.openPageIds, 'both ids must survive in the rewritten session').toHaveLength(2)
})

test('a ?page= link opens a page that is not in the session, without dropping the rest', async ({
  page,
  request
}) => {
  const stamp = Date.now()
  const open = `DeepOpen${stamp}`
  const linked = `DeepLink${stamp}`
  for (const title of [open, linked]) {
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, open)
  await expect(page.getByRole('tab')).toHaveCount(1)

  // The linked page's id, fetched rather than parsed out of the title.
  const all = await request.get('/api/pages')
  const body = (await all.json()) as { pages: Array<{ id: string; title: string }> }
  const linkedId = body.pages.find((p) => p.title === linked)?.id
  expect(linkedId, 'the linked page must exist').toBeDefined()

  await page.goto(`/?page=${linkedId}`)
  // The linked page joins the session; the already-open one is not discarded.
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab').filter({ hasText: linked })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page.getByRole('tab').filter({ hasText: open })).toBeVisible()
})

test('an unknown ?page= id falls back to the session rather than to nothing', async ({
  page,
  request
}) => {
  const stamp = Date.now()
  const keep = `Fall${stamp}`
  await request.post('/api/pages', { data: { title: keep, pageType: 'rich', content: '' } })

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, keep)
  await expect(page.getByRole('tab')).toHaveCount(1)

  await page.goto('/?page=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  // The bogus id resolves to nothing, so the session stands.
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab')).toContainText(keep)
})

/**
 * The address bar must describe the workspace that is actually open.
 *
 * Four separate actions change the selected page without going through the
 * navigation handler: closing a tab, going Home, deleting the open page, and
 * opening a source sub-file of another page. Each left `?page=<id>` in the URL,
 * and because a deep link is honoured on load, a reload then brought a page the
 * user had deliberately left back again. These cover all four.
 */
const deepLinkInUrl = (page: Page) => new URL(page.url()).searchParams.get('page')

test('closing the last tab clears the page from the URL', async ({ page, request }) => {
  const stamp = Date.now()
  const only = `CloseLast${stamp}`
  await request.post('/api/pages', { data: { title: only, pageType: 'rich', content: '' } })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, only)
  await expect(page.getByRole('tab')).toHaveCount(1)
  // Precondition: the app does name the page while it is open.
  expect(await deepLinkInUrl(page)).toBeTruthy()

  await page
    .getByRole('tab')
    .first()
    .getByRole('button', { name: /^Close tab/ })
    .click()
  await expect(page.getByRole('tab')).toHaveCount(0)
  expect(await deepLinkInUrl(page), 'the URL must not keep naming a closed page').toBeNull()

  // And a reload must not resurrect it.
  await page.reload()
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('tab')).toHaveCount(0)
})

test('going Home clears the page from the URL', async ({ page, request }) => {
  const stamp = Date.now()
  const title = `GoHome${stamp}`
  await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, title)
  await expect(page.getByRole('tab')).toHaveCount(1)
  expect(await deepLinkInUrl(page)).toBeTruthy()

  await page.locator('nav[aria-label="RTWiki"] button[aria-label="Home"]').click()
  await expect(page.getByText('Pages', { exact: true }).first()).toBeVisible()
  expect(await deepLinkInUrl(page), 'Home is not a page, so the URL must not name one').toBeNull()

  // Going Home does NOT close your tabs - that is deliberate and matches a
  // browser, so the tab is still there after a reload and the restore makes it
  // the active one, which is correct for a workspace holding a single tab. What
  // must not survive is the URL naming a page, because that is what used to
  // drag a page back as a deep link.
  await page.reload()
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  expect(await deepLinkInUrl(page), 'a reload must not reintroduce the deep link').toBeNull()
  await expect(page.getByRole('tab')).toHaveCount(1)
})

test('closing a background tab leaves the URL and the active tab alone', async ({
  page,
  request
}) => {
  const stamp = Date.now()
  const first = `BgA${stamp}`
  const second = `BgB${stamp}`
  for (const title of [first, second]) {
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
  await openByRow(page, first)
  await openByRow(page, second)
  await expect(page.getByRole('tab')).toHaveCount(2)

  const urlBefore = await deepLinkInUrl(page)
  // Close the first tab while the second is active.
  await page
    .getByRole('tab')
    .first()
    .getByRole('button', { name: /^Close tab/ })
    .click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  expect(await deepLinkInUrl(page), 'a background close is not a navigation').toBe(urlBefore)
  await expect(page.getByRole('tab').filter({ hasText: second })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})
