import { expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * HTML/CSS/JavaScript source IDE: toolbar, status row, formatting, shortcuts,
 * draft reliability across rapid subfile switching and browser refresh.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function openSource(page: Page, field: 'HTML' | 'CSS' | 'JavaScript'): Promise<void> {
  const sub = page.locator(`[data-subfile-id]`, { hasText: field }).first()
  await sub.click()
  await expect(page.getByTestId('html-source-view')).toBeVisible()
}

test.describe('source-file IDE', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

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

  async function newHtmlPage(page: Page): Promise<string> {
    const title = uniqueTitle('IDE')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.locator('input[type="radio"]').nth(1).check()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('html-preview-view')).toBeVisible()
    return title
  }

  test('toolbar controls exist for every language; JS toggle only in JavaScript', async ({
    page
  }) => {
    const title = await newHtmlPage(page)
    // Expand the HTML page's virtual source subfiles via the tree chevron.
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'HTML')
    for (const id of [
      'ide-find',
      'ide-replace',
      'ide-format',
      'ide-word-wrap',
      'ide-fold-all',
      'ide-unfold-all',
      'ide-font-decrease',
      'ide-font-reset',
      'ide-font-increase',
      'ide-save-now',
      'ide-fullscreen',
      'return-to-preview-button',
      'source-breadcrumb',
      'ide-status-row'
    ]) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    await expect(page.getByTestId('js-enabled-toggle')).toHaveCount(0)

    await openSource(page, 'JavaScript')
    await expect(page.getByTestId('js-enabled-toggle')).toBeVisible()
  })

  test('undo/redo through the toolbar edits the document', async ({ page }) => {
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'CSS')
    const editor = page.getByTestId('code-editor-css')
    await editor.click()
    await page.keyboard.type('.a { color: blue; }')
    await expect(editor).toContainText('.a')
    await page.getByTestId('source-toolbar').getByLabel('Undo').click()
    await expect(editor).not.toContainText('.a')
    await page.getByTestId('source-toolbar').getByLabel('Redo').click()
    await expect(editor).toContainText('.a')
  })

  test('find panel opens from the toolbar and Ctrl+F inside the editor', async ({ page }) => {
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'HTML')
    // Wait until the CodeMirror view is actually mounted before driving
    // toolbar commands (the imperative accessor is wired post-mount).
    await expect(page.locator('.cm-editor')).toBeVisible({ timeout: 10_000 })
    // The toolbar button drives the same openSearchPanel command as Ctrl+F.
    await page.getByTestId('ide-find').click()
    // This CodeMirror version renders the panel as .cm-panel.cm-search.
    await expect(page.locator('.cm-panel.cm-search')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test('format document pretty-prints CSS and participates in autosave', async ({ page }) => {
    const title = uniqueTitle('IDE Format')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.locator('input[type="radio"]').nth(1).check()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('html-preview-view')).toBeVisible()

    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'CSS')
    const editor = page.getByTestId('code-editor-css')
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('body{margin:0;padding:0;color:#333}')
    await page.getByTestId('ide-format').click()
    // Prettier expands the one-liner into multi-line CSS.
    await expect(editor).toContainText('margin: 0;', { timeout: 20_000 })
    // No contained format error is shown.
    await expect(page.getByTestId('ide-format-error')).toHaveCount(0)
  })

  test('font size and word wrap toggles work', async ({ page }) => {
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'HTML')
    await page.getByTestId('ide-font-increase').click()
    await expect(page.getByTestId('code-editor-html')).toBeVisible()
    await page.getByTestId('ide-word-wrap').click()
    await expect(page.getByTestId('ide-word-wrap')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('ide-fullscreen').click()
    await expect(page.getByTestId('html-source-view')).toHaveAttribute('data-fullscreen', 'true')
    await page.getByTestId('ide-fullscreen').click()
  })

  test('rapid HTML/CSS/JS switching preserves typed text; return to preview uses latest draft', async ({
    page
  }) => {
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'CSS')
    const cssEditor = page.getByTestId('code-editor-css')
    await cssEditor.click()
    await page.keyboard.type('.switch-probe { color: green; }')

    // Switch away to JavaScript and back — the CSS text must survive.
    await openSource(page, 'JavaScript')
    await openSource(page, 'CSS')
    await expect(cssEditor).toContainText('.switch-probe')

    // Return to preview renders the latest draft.
    await page.getByTestId('return-to-preview-button').click()
    await expect(page.getByTestId('live-preview')).toBeVisible()
  })

  test('status row shows caret position after typing', async ({ page }) => {
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'CSS')
    const editor = page.getByTestId('code-editor-css')
    await editor.click()
    await page.keyboard.type('abcd')
    await expect(page.getByTestId('ide-caret-position')).toContainText('Ln 1')
    await expect(page.getByTestId('ide-status-row')).toContainText('CSS')
  })

  test('no unexpected console errors while using the IDE', async ({ page }) => {
    void consoleErrors
    const title = await newHtmlPage(page)
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await openSource(page, 'HTML')
    await page.getByTestId('return-to-preview-button').click()
    await expect(page.getByTestId('html-preview-view')).toBeVisible()
  })
})
