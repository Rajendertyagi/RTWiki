import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

const editorRoot = '[data-testid="rich-editor"]'
const editable = '.bn-editor .ProseMirror'
const toolbar = '.bn-formatting-toolbar'

// Shared across the ordered scenarios: the note created through the UI flow.
let savedTitle = ''

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  pageType: 'rich' | 'html',
  content: string
): Promise<string> {
  const res = await request.post('/api/pages', {
    data: { title, pageType, content }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page.id
}

async function openNote(page: Page, title: string): Promise<void> {
  // The sidebar renders a NavLink (<a>) and the dashboard a <button> with the
  // same accessible name; role=button uniquely targets the dashboard card.
  await page.getByRole('button', { name: `Open ${title}` }).click()
}

async function goHome(page: Page): Promise<void> {
  await page.locator('[aria-label="Back to pages"]').click()
  await expect(page.locator(editorRoot)).toHaveCount(0)
}

async function expectNotBlank(page: Page): Promise<void> {
  const children = await page.locator('#root > *').count()
  expect(children, 'application root must not be blank').toBeGreaterThan(0)
}

const VALID_DOC = JSON.stringify([
  { type: 'paragraph', content: [{ type: 'text', text: 'Existing note body', styles: {} }] }
])

test.describe('Rich Note lifecycle (real application)', () => {
  let pageErrors: Error[] = []

  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('dashboard renders with a non-blank root', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
    await expectNotBlank(page)
  })

  test('clicking an existing Rich Note shows the editor, not a blank page', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Existing note')
    await seedPage(request, title, 'rich', VALID_DOC)
    await page.goto('/')
    await openNote(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    await expect(page.locator('.bn-editor')).toBeVisible()
    await expect(page.locator(editable)).toContainText('Existing note body')
    await expectNotBlank(page)
  })

  test('creating a new Rich Note shows the editor, not a blank page', async ({ page }) => {
    const title = uniqueTitle('Created note')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    await page.getByLabel('Title').fill(title)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.locator(editorRoot)).toBeVisible()
    await expect(page.locator('.bn-editor')).toBeVisible()
    await expectNotBlank(page)

    // Formatting toolbar appears when text is selected.
    await page.locator(editable).click()
    await page.keyboard.type('Toolbar probe text')
    await page.keyboard.press('ControlOrMeta+a')
    await expect(page.locator(toolbar)).toBeVisible()

    // Autosave reaches the Saved state after the debounce window.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
    savedTitle = title
  })

  test('manual Save persists typed content', async ({ page }) => {
    await page.goto('/')
    await openNote(page, savedTitle)
    await page.locator(editable).click()
    await page.keyboard.type(' Manual save line.')
    await page.getByLabel('Save note').click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Reload reproduces the saved content.
    await page.reload()
    await openNote(page, savedTitle)
    await expect(page.locator(editable)).toContainText('Manual save line.')
  })

  test('returning home and reopening reproduces saved content', async ({ page }) => {
    await page.goto('/')
    await openNote(page, savedTitle)
    await expect(page.locator(editable)).toContainText('Manual save line.')
    await goHome(page)
    await openNote(page, savedTitle)
    await expect(page.locator(editable)).toContainText('Manual save line.')
  })

  test('switching pages while a save is pending flushes without data loss', async ({ page }) => {
    await page.goto('/')
    await openNote(page, savedTitle)
    await page.locator(editable).click()
    await page.keyboard.type(' Pending flush line.')
    // Leave before the 2000 ms autosave debounce fires; navigation must flush.
    await goHome(page)
    await expect(page.getByText('unsaved changes')).toHaveCount(0)
    await openNote(page, savedTitle)
    await expect(page.locator(editable)).toContainText('Pending flush line.')
  })

  test('dark theme restyles the editor surface', async ({ page, request }) => {
    const title = uniqueTitle('Theme probe')
    await seedPage(request, title, 'rich', VALID_DOC)
    await page.goto('/')
    await openNote(page, title)
    const surface = page.locator('.bn-container')
    const lightBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.locator('[aria-label="Toggle color scheme"]').click()
    await expect(page.locator('html[data-mantine-color-scheme="dark"]')).toHaveCount(1)
    const darkBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(darkBg).not.toBe(lightBg)
    expect(darkBg).not.toBe('rgb(255, 255, 255)')
    await page.locator('[aria-label="Toggle color scheme"]').click()
  })

  test('HTML pages show their placeholder and never mount BlockNote', async ({ page, request }) => {
    const title = uniqueTitle('Static HTML page')
    await seedPage(request, title, 'html', '')
    await page.goto('/')
    await openNote(page, title)
    await expect(page.getByText('HTML / CSS / JavaScript editor')).toBeVisible()
    await expect(page.locator(editorRoot)).toHaveCount(0)
    await expect(page.locator('.bn-editor')).toHaveCount(0)
  })

  test('malformed stored content shows recovery UI instead of blanking', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Broken note')
    await seedPage(request, title, 'rich', '{ not valid json')
    await page.goto('/')
    await openNote(page, title)
    await expect(page.getByText('could not be loaded')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reset document' })).toBeVisible()
    await expectNotBlank(page)

    // Recovery resets to a valid empty document without destroying stored data
    // until the owner confirms; after reset the editor mounts cleanly.
    await page.getByRole('button', { name: 'Reset document' }).click()
    await page.getByRole('button', { name: 'Confirm reset' }).click()
    await expect(page.locator(editorRoot)).toBeVisible()
    await expect(page.locator('.bn-editor')).toBeVisible()
  })
})

test.describe('frontend diagnostics reporting', () => {
  test('a controlled window error is reported and its id reaches rtwiki.log', async ({ page }) => {
    await page.goto('/')
    const reportPromise = page.waitForRequest(
      (req) => req.url().includes('/api/client-errors') && req.method() === 'POST'
    )
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('Controlled probe') }))
    })
    const request = await reportPromise
    const body = request.postDataJSON() as Record<string, unknown>
    const correlationId = String(body.correlationId)
    expect(correlationId).toMatch(/^[0-9a-f]{8}$/)
    // Canned message only — the raw error text must never be transmitted.
    expect(JSON.stringify(body)).not.toContain('Controlled probe')

    // The correlation id must appear in the persistent server-side log.
    const logPath = resolve('logs', 'rtwiki.log')
    await expect
      .poll(async () => (await readFile(logPath, 'utf8').catch(() => '')).includes(correlationId))
      .toBe(true)
  })

  test('an unhandled rejection is reported through the same channel', async ({ page }) => {
    await page.goto('/')
    const reportPromise = page.waitForRequest(
      (req) => req.url().includes('/api/client-errors') && req.method() === 'POST'
    )
    await page.evaluate(() => {
      // Synthetic rejection event: deterministic, and it cannot surface as a
      // late uncaught exception in the afterEach pageerror guard.
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          reason: new RangeError('Controlled rejection'),
          promise: Promise.resolve()
        })
      )
    })
    const request = await reportPromise
    const body = request.postDataJSON() as Record<string, unknown>
    expect(body.event).toBe('unhandled_rejection')
  })
})
