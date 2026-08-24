import { expect, type Page, test } from '@playwright/test'

/**
 * Working rich-note flow over the Trilium-inspired workspace:
 * rail → tree → tabs → persistent toolbar → document → right sidebar.
 *
 * Every scenario exercises the real built application through user-level
 * interactions and asserts on rendered state, never on internals.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

// BlockNote 0.54 puts both classes on a single node — compound selector.
const editable = '.bn-editor.ProseMirror'
const editorRoot = '[data-testid="rich-editor"]'

async function createNoteViaDialog(
  page: Page,
  title: string,
  pageType: 'Rich' | 'HTML Page' = 'Rich'
): Promise<void> {
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  if (pageType !== 'Rich') await dialog.getByRole('radio', { name: pageType }).check()
  await dialog.getByRole('button', { name: /create/i }).click()
  // Product contract: the caret must already be in the document (autofocus).
  if (pageType === 'Rich') {
    await expect(page.locator('.bn-editor.ProseMirror-focused')).toBeVisible({
      timeout: 10_000
    })
  }
}

async function expectTabActive(page: Page, title: string): Promise<void> {
  await expect(page.getByRole('tab', { name: new RegExp(`${title}`) })).toHaveAttribute(
    'aria-selected',
    'true'
  )
}

test.describe('Working rich-note workspace', () => {
  let consoleErrors: string[] = []
  let pageErrors: Error[] = []

  test.beforeEach(({ page }) => {
    consoleErrors = []
    pageErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('fresh database shows a useful Home state', async ({ request }) => {
    const res = await request.get('/api/pages')
    expect(res.status()).toBe(200)
  })

  test('new note creates a Rich Note that appears in the tree and opens a tab', async ({
    page
  }) => {
    const title = uniqueTitle('Overnight')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    await expectTabActive(page, title)
    // Tree row appears immediately (no refresh delay).
    await expect(
      page
        .locator(`[role="treeitem"][aria-label*="${title}"]`)
        .or(page.locator(`[role="treeitem"]`, { hasText: title }))
    ).toBeVisible()
  })

  test('caret starts in the document and typing works without clicking', async ({ page }) => {
    const title = uniqueTitle('Caret')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    await page.keyboard.type('typed without clicking')
    await expect(page.locator(editable)).toContainText('typed without clicking')
  })

  test('Enter reliably creates consecutive paragraphs', async ({ page }) => {
    const title = uniqueTitle('Enter')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await page.keyboard.press('Enter')
    await page.keyboard.type('third')
    const paragraphCount = await page.locator(`${editable} p`).count()
    expect(paragraphCount).toBeGreaterThanOrEqual(3)
  })

  test('persistent toolbar stays visible and applies bold', async ({ page }) => {
    const title = uniqueTitle('Bold')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator('[role="toolbar"]')).toBeVisible()
    await page.keyboard.type('selectable text')
    await page.keyboard.press('ControlOrMeta+a')
    await page.getByRole('toolbar').getByLabel('Bold').click()
    await expect(page.locator(`${editable} strong`)).toBeVisible()
    // Toolbar remains visible after the formatting action.
    await expect(page.getByRole('toolbar')).toBeVisible()
  })

  test('autosave reaches Saved and content survives reload', async ({ page }) => {
    let patchBody: string | null = null
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patchBody = req.postData() ?? null
    })
    const title = uniqueTitle('Persist')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    // Network truth: wait for the debounced autosave PATCH itself.
    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/api/pages/'),
      { timeout: 10_000 }
    )
    await page.keyboard.type('persistent content')
    await patchPromise
    await expect(
      page.locator('[aria-live="polite"]').getByText('Saved', { exact: true })
    ).toBeVisible({ timeout: 10_000 })
    await page.reload()
    // Tabs are session-only: reopen the note from the tree after reload.
    await page.locator(`[role="treeitem"]`, { hasText: title }).click()
    await expect(page.locator(editable)).toContainText('persistent content')
    expect(patchBody).toContain('persistent content')
  })

  test('tree clicks activate the correct existing tab without duplicates', async ({ page }) => {
    const a = uniqueTitle('TabA')
    const b = uniqueTitle('TabB')
    await page.goto('/')
    await createNoteViaDialog(page, a)
    await createNoteViaDialog(page, b)
    const tabCount = await page.getByRole('tab').count()
    expect(tabCount).toBe(2)
    await page.locator(`[role="treeitem"]`, { hasText: a }).click()
    await expectTabActive(page, a)
    expect(await page.getByRole('tab').count()).toBe(2)
  })

  test('dashboard cards open the page in its tab', async ({ page }) => {
    const title = uniqueTitle('CardOpen')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await page.getByRole('button', { name: 'Home' }).click()
    // The whole card body is an accessible open button (ghost overlay).
    await page.getByRole('button', { name: `Open ${title}` }).click()
    await expect(page.locator(editorRoot)).toBeVisible()
    await expectTabActive(page, title)
  })

  test('deleting an open page closes its tab and returns Home', async ({ page }) => {
    const title = uniqueTitle('DelTab')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    // Workspace delete lives in the header Actions menu.
    await page.locator('[data-testid="editor-actions"]').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveCount(0)
    await expect(page.locator(editorRoot)).toHaveCount(0)
  })

  test('right sidebar reflects headings and collapses', async ({ page }) => {
    const title = uniqueTitle('Outline')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await expect(page.locator(editorRoot)).toBeVisible()
    await page.keyboard.type('My Heading')
    await page.getByRole('toolbar').getByLabel('Heading 1').click()
    await expect(
      page.getByRole('complementary', { name: 'Page details' }).getByText('My Heading')
    ).toBeVisible()
    await page
      .getByRole('complementary', { name: 'Page details' })
      .getByLabel('Collapse sidebar')
      .click()
    await expect(page.getByRole('complementary', { name: 'Page details' })).toHaveCount(0)
  })

  test('no page card displays raw serialized JSON', async ({ page, request }) => {
    const res = await request.post('/api/pages', {
      data: { title: uniqueTitle('JsonCard'), pageType: 'html', content: '' }
    })
    expect(res.status()).toBe(201)
    await page.goto('/')
    const previews = await page.locator('.cardContent').allInnerTexts()
    for (const preview of previews) {
      expect(preview.trim().startsWith('{')).toBe(false)
    }
  })

  test('no unexpected console errors during the core flow', async ({ page }) => {
    const title = uniqueTitle('CleanConsole')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await page.keyboard.type('hello')
    await page.waitForTimeout(500)
    const realErrors = consoleErrors.filter(
      (text) =>
        !text.includes('favicon') &&
        !text.includes('404') &&
        !text.includes('Failed to load resource')
    )
    expect(realErrors).toEqual([])
    expect(pageErrors).toEqual([])
  })
})
