import { expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Persistent Rich Document toolbar: every implemented control is exercised
 * through real clicks, with active-state and document-effect assertions.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

const EDITABLE = '.bn-editor'

async function newRichNote(page: Page): Promise<void> {
  const title = uniqueTitle('Toolbar')
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.locator(EDITABLE)).toBeVisible()
  // Seed a word to format.
  await page.keyboard.type('formatting target text')
  await page.keyboard.press('ControlOrMeta+a')
}

const toolbarButton = (page: Page, label: string) =>
  page
    .getByRole('toolbar')
    .getByRole('button', { name: label, exact: true })
    .or(page.getByRole('toolbar').getByLabel(label, { exact: true }))

test.describe('Rich Note toolbar controls', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })
  let consoleErrors: string[] = []

  test.beforeEach(({ page }) => {
    consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
  })

  test.afterEach(({ page }) => {
    void page
    expect(consoleErrors, 'no unexpected console errors').toEqual([])
  })

  test('bold applies, shows active state, and clear formatting removes it', async ({ page }) => {
    await newRichNote(page)
    const bold = toolbarButton(page, 'Bold')
    await bold.click()
    await expect(page.locator(`${EDITABLE} strong`)).toBeVisible()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')

    await toolbarButton(page, 'Clear formatting').click()
    await expect(page.locator(`${EDITABLE} strong`)).toHaveCount(0)
  })

  test('italic and underline apply', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Italic').click()
    await expect(page.locator(`${EDITABLE} em`)).toBeVisible()
    await toolbarButton(page, 'Underline').click()
    await expect(page.locator(`${EDITABLE} u`).first()).toBeVisible()
  })

  test('strikethrough applies', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Strikethrough').click()
    await expect(page.locator(`${EDITABLE} s`).first()).toBeVisible()
  })

  test('headings switch the block type with active state', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Heading 2').click()
    await expect(page.locator(`${EDITABLE} h2`)).toBeVisible()
    await expect(toolbarButton(page, 'Heading 2')).toHaveAttribute('aria-pressed', 'true')
    await toolbarButton(page, 'Paragraph').click()
    await expect(page.locator(`${EDITABLE} h2`)).toHaveCount(0)
  })

  test('bullet, numbered and checklist lists apply', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Bulleted list').click()
    // BlockNote renders lists as attributed block divs, not semantic ul/ol.
    await expect(
      page.locator(`${EDITABLE} [data-content-type="bulletListItem"]`).first()
    ).toBeVisible()
    await toolbarButton(page, 'Numbered list').click()
    await expect(
      page.locator(`${EDITABLE} [data-content-type="numberedListItem"]`).first()
    ).toBeVisible()
    await toolbarButton(page, 'Checklist').click()
    await expect(
      page.locator(`${EDITABLE} [data-content-type="checkListItem"]`).first()
    ).toBeVisible()
  })

  test('alignment updates the block', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Align centre').click()
    await expect(page.locator(`${EDITABLE} [data-text-alignment="center"]`).first()).toBeVisible()
    await expect(toolbarButton(page, 'Align centre')).toHaveAttribute('aria-pressed', 'true')
  })

  test('indent requires a nestable block; nesting works in lists', async ({ page }) => {
    await newRichNote(page)
    // On a plain paragraph at the root, outdent is unavailable.
    await expect(toolbarButton(page, 'Outdent')).toBeDisabled()
    await toolbarButton(page, 'Bulleted list').click()
    // Two items: nesting needs a preceding list sibling to nest under.
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await expect(toolbarButton(page, 'Indent')).toBeEnabled()
    await toolbarButton(page, 'Indent').click()
    // Nesting renders as a block group INSIDE the parent list item's group.
    await expect(
      page.locator('.bn-editor [data-node-type="blockGroup"] [data-node-type="blockGroup"]')
    ).toBeVisible()
  })

  test('quote and code blocks apply via the Insert menu', async ({ page }) => {
    await newRichNote(page)
    // Quote/code/table now live behind the single Insert control.
    const openInsert = async (): Promise<void> => {
      await page.getByTestId('insert-menu-button').click()
      await expect(page.getByTestId('insert-menu')).toBeVisible()
    }
    await openInsert()
    await page.getByTestId('insert-quote').click()
    await expect(page.locator(`${EDITABLE} blockquote`).first()).toBeVisible()
    await openInsert()
    await page.getByTestId('insert-code-block').click()
    await expect(page.locator(`${EDITABLE} pre`).first()).toBeVisible()
  })

  test('table insertion creates a table via the Insert menu', async ({ page }) => {
    await newRichNote(page)
    await page.getByTestId('insert-menu-button').click()
    await page.getByTestId('insert-table').click()
    await expect(page.locator(`${EDITABLE} table`).first()).toBeVisible()
    await expect(page.locator(`${EDITABLE} table td`).first()).toBeVisible()
  })

  test('text colour applies an inline colour style', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Text colour').click()
    await page.getByRole('menuitemradio', { name: /red/i }).first().click()
    await expect(
      page.locator(`${EDITABLE} [data-style-type="textColor"][data-value="red"]`).first()
    ).toBeVisible()
  })

  test('highlight applies a background style', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Highlight').click()
    await page
      .getByRole('menuitemradio', { name: /yellow/i })
      .first()
      .click()
    await expect(
      page.locator(`${EDITABLE} [data-style-type="backgroundColor"][data-value="yellow"]`).first()
    ).toBeVisible()
  })

  test('link popover applies a link', async ({ page }) => {
    await newRichNote(page)
    await toolbarButton(page, 'Link').click()
    await page.getByTestId('link-url-input').fill('https://example.com')
    await page.getByRole('button', { name: 'Apply link' }).click()
    await expect(page.locator(`${EDITABLE} a[href="https://example.com"]`)).toBeVisible()
  })

  test('undo reverts typed text and redo restores it', async ({ page }) => {
    await newRichNote(page)
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('v2')
    await expect(page.locator(EDITABLE)).toContainText('v2')
    await toolbarButton(page, 'Undo').click()
    await expect(page.locator(EDITABLE)).not.toContainText('v2')
    await toolbarButton(page, 'Redo').click()
    await expect(page.locator(EDITABLE)).toContainText('v2')
  })
  test('the toolbar scrolls horizontally on narrow screens without wrapping', async ({ page }) => {
    const title = uniqueTitle('Narrow')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator(EDITABLE)).toBeVisible()
    // Shrink AFTER creation: below the navbar breakpoint the creation rail
    // hides, so the note must exist first.
    await page.setViewportSize({ width: 640, height: 800 })
    const bar = page.getByRole('toolbar')
    const metrics = await bar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      height: el.getBoundingClientRect().height,
      overflowX: getComputedStyle(el).overflowX
    }))
    expect(metrics.overflowX).toBe('auto')
    if (metrics.scrollWidth > metrics.clientWidth) {
      // Overflowing content must scroll, never wrap into rows.
      expect(metrics.height).toBeLessThan(80)
    }
  })
})
