import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'

/**
 * P1 regression: a refused New Page create must NOT close the dialog or lose
 * the entered title. The old App.tsx handler swallowed the controller's
 * rejection, so `await onCreate(...)` resolved and the dialog called
 * `onClose()` unconditionally. These tests drive the real UI against the
 * throwaway server and intercept POST /api/pages to force each failure mode.
 */

const PREFIX = 'NewPageFail'
let seq = 0

function uniqueTitle(caseName: string): string {
  seq += 1
  return `${PREFIX}-${caseName}-${Date.now()}-${seq}`
}

/** The list endpoint returns a `total` independent of its page window. */
async function countPages(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/pages?limit=1')
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { total: number }
  return body.total
}

async function countPagesWithTitle(request: APIRequestContext, title: string): Promise<number> {
  const res = await request.get(`/api/pages?q=${encodeURIComponent(title)}&limit=200`)
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { pages: Array<{ title: string }> }
  return body.pages.filter((p) => p.title === title).length
}

async function openDialog(page: Page): Promise<Locator> {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

function dialogError(dialog: Locator): Locator {
  return dialog.getByRole('alert')
}

/** Asserts the three invariants every failure case shares; returns the alert. */
async function assertFailureKeepsDialog(dialog: Locator, title: string): Promise<Locator> {
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Title')).toHaveValue(title)
  const alert = dialogError(dialog)
  await expect(alert).toBeVisible()
  return alert
}

test.afterEach(async ({ request }) => {
  // Remove any page this spec managed to create so the shared throwaway DB
  // stays clean for the next file.
  const res = await request.get(`/api/pages?q=${PREFIX}&limit=200`)
  const body = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  for (const p of body.pages) {
    if (p.title.startsWith(PREFIX)) await request.delete(`/api/pages/${p.id}`)
  }
})

test.describe('New page creation failure keeps the dialog and its title', () => {
  test('HTTP 400 validation error', async ({ page, request }) => {
    const title = uniqueTitle('400')
    const before = await countPages(request)
    const dialog = await openDialog(page)
    await dialog.getByLabel('Title').fill(title)

    await page.route(
      (url) => url.pathname === '/api/pages',
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Validation failed: title rejected' })
          })
          return
        }
        await route.continue()
      }
    )

    await dialog.getByRole('button', { name: /create/i }).click()
    const alert = await assertFailureKeepsDialog(dialog, title)
    await expect(alert).toContainText('Validation failed: title rejected')
    expect(await countPages(request)).toBe(before)
    expect(await countPagesWithTitle(request, title)).toBe(0)
  })

  test('HTTP 500 server error', async ({ page, request }) => {
    const title = uniqueTitle('500')
    const before = await countPages(request)
    const dialog = await openDialog(page)
    await dialog.getByLabel('Title').fill(title)

    await page.route(
      (url) => url.pathname === '/api/pages',
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Injected server failure' })
          })
          return
        }
        await route.continue()
      }
    )

    await dialog.getByRole('button', { name: /create/i }).click()
    const alert = await assertFailureKeepsDialog(dialog, title)
    await expect(alert).toContainText('Injected server failure')
    expect(await countPages(request)).toBe(before)
    expect(await countPagesWithTitle(request, title)).toBe(0)
  })

  test('network failure (aborted request)', async ({ page, request }) => {
    const title = uniqueTitle('Net')
    const before = await countPages(request)
    const dialog = await openDialog(page)
    await dialog.getByLabel('Title').fill(title)

    await page.route(
      (url) => url.pathname === '/api/pages',
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.abort()
          return
        }
        await route.continue()
      }
    )

    await dialog.getByRole('button', { name: /create/i }).click()
    const alert = await assertFailureKeepsDialog(dialog, title)
    // No server message exists here; assert a non-empty error is shown.
    expect((await alert.textContent())?.trim().length ?? 0).toBeGreaterThan(0)
    expect(await countPages(request)).toBe(before)
    expect(await countPagesWithTitle(request, title)).toBe(0)
  })

  test('successful retry after a failure creates exactly one page', async ({ page, request }) => {
    const title = uniqueTitle('Retry')
    const before = await countPages(request)
    const dialog = await openDialog(page)
    await dialog.getByLabel('Title').fill(title)

    let failNext = true
    await page.route(
      (url) => url.pathname === '/api/pages',
      async (route) => {
        if (route.request().method() === 'POST' && failNext) {
          failNext = false
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'First attempt fails' })
          })
          return
        }
        await route.continue()
      }
    )

    await dialog.getByRole('button', { name: /create/i }).click()
    await assertFailureKeepsDialog(dialog, title)
    await expect(dialogError(dialog)).toContainText('First attempt fails')
    expect(await countPages(request)).toBe(before)

    // Retry: the route now continues to the real server.
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => countPages(request), { timeout: 10_000 }).toBe(before + 1)
    expect(await countPagesWithTitle(request, title)).toBe(1)

    // The new page is selected: its tab is active.
    const tab = page.locator('[role="tab"]').filter({ hasText: title })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  })

  test('rapid Enter presses issue exactly one create request', async ({ page }) => {
    const title = uniqueTitle('Enter')
    const dialog = await openDialog(page)
    const titleField = dialog.getByLabel('Title')
    await titleField.fill(title)

    let createRequests = 0
    await page.route(
      (url) => url.pathname === '/api/pages',
      async (route) => {
        if (route.request().method() === 'POST') {
          createRequests += 1
          // Keep the first request in flight so the second Enter lands while
          // the dialog is still submitting - the exact race the guard blocks.
          await new Promise((resolve) => setTimeout(resolve, 300))
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'slow failure' })
          })
          return
        }
        await route.continue()
      }
    )

    await titleField.press('Enter')
    await titleField.press('Enter')

    await assertFailureKeepsDialog(dialog, title)
    expect(createRequests, 'only one create request should be issued').toBe(1)
  })
})
