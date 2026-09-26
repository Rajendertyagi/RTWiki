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

  test('quote and code blocks apply via their toolbar controls', async ({ page }) => {
    await newRichNote(page)
    // Every insertion control is a direct toolbar button (no Insert dropdown).
    await page.getByTestId('insert-quote').click()
    await expect(page.locator(`${EDITABLE} blockquote`).first()).toBeVisible()
    await page.getByTestId('insert-code-block').click()
    await expect(page.locator(`${EDITABLE} pre`).first()).toBeVisible()
  })

  test('table insertion creates a table via its toolbar control', async ({ page }) => {
    await newRichNote(page)
    await page.getByTestId('insert-table').click()
    await expect(page.locator(`${EDITABLE} table`).first()).toBeVisible()
    await expect(page.locator(`${EDITABLE} table td`).first()).toBeVisible()
  })

  test('every insertion control is present and usable at desktop width', async ({ page }) => {
    await newRichNote(page)
    const keys = [
      'insert-formula',
      'insert-diagram',
      'insert-mind-map',
      'insert-callout-info',
      'insert-callout-note',
      'insert-callout-tip',
      'insert-callout-warning',
      'insert-callout-danger',
      'insert-table',
      'insert-quote',
      'insert-code-block'
    ]
    for (const key of keys) {
      const control = page.getByTestId(key)
      await expect(control).toBeVisible()
      await expect(control).toBeEnabled()
    }
    // The former Insert dropdown is gone.
    await expect(page.getByTestId('insert-menu-button')).toHaveCount(0)
  })

  test('every insertion control remains visible at narrow width (scroll, no menu)', async ({
    page
  }) => {
    const title = uniqueTitle('NarrowInsert')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator(EDITABLE)).toBeVisible()
    await page.setViewportSize({ width: 480, height: 800 })
    const keys = ['insert-formula', 'insert-diagram', 'insert-mind-map', 'insert-callout-danger']
    for (const key of keys) {
      await expect(page.getByTestId(key)).toBeVisible()
    }
    await expect(page.getByTestId('insert-menu-button')).toHaveCount(0)
    // Narrow screens scroll the row; controls stay usable.
    await page.getByTestId('insert-quote').click()
    await expect(page.locator(`${EDITABLE} blockquote`).first()).toBeVisible()
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
    // The bar no longer scrolls. It was changed so that a narrow window moves
    // the controls that do not fit into a trailing "more" menu, because a
    // scrolling row hides the fact that there is anything to scroll to. This
    // assertion used to require `overflow-x: auto` and therefore contradicted
    // that decision; it now asserts the decision.
    expect(metrics.overflowX, 'the bar must not scroll sideways').toBe('hidden')
    expect(
      metrics.scrollWidth,
      'nothing may overflow the bar: the rest moves into the more menu'
    ).toBeLessThanOrEqual(metrics.clientWidth + 1)
    // And it must never wrap into rows.
    expect(metrics.height).toBeLessThan(80)
    // The controls that did not fit are reachable through the more menu.
    await expect(page.getByTestId('toolbar-more')).toBeVisible()
  })
  // ---------- density, grouping and availability ----------

  test('the bar is grouped by separators, not one undifferentiated run', async ({ page }) => {
    await newRichNote(page)
    const bar = page.getByRole('toolbar')
    await expect(bar).toBeVisible()

    const m = await page.evaluate(() => {
      const el = document.querySelector('[role="toolbar"]') as HTMLElement
      const slots = Array.from(el.querySelectorAll('span')) as HTMLElement[]
      const dividers = slots.filter((s) => s.className.includes('divider'))
      const groups: number[] = []
      let run = 0
      for (const s of slots) {
        if (s.className.includes('divider')) {
          groups.push(run)
          run = 0
        } else if (s.querySelector('button')) run += 1
      }
      groups.push(run)
      return {
        buttons: el.querySelectorAll('button').length,
        dividers: dividers.length,
        groups,
        labelled: Array.from(el.querySelectorAll('button')).filter(
          (b) => (b.getAttribute('aria-label') ?? '').length > 0
        ).length
      }
    })

    // F6 recorded "no clear grouping". That is no longer true: the bar carries
    // separators and every icon-only control is named for assistive technology.
    expect(m.dividers, 'the bar must be split into groups').toBeGreaterThan(2)
    expect(m.groups.filter((g) => g > 0).length).toBe(m.dividers + 1)
    expect(m.labelled, 'every icon-only control needs an accessible name').toBe(m.buttons)
  })

  test('an unavailable control looks unavailable', async ({ page }) => {
    // Before this was fixed, every disabled control computed `opacity: 1` -
    // identical to every enabled one. In a row of 28 icon-only buttons there is
    // then no way to tell that clicking one will do nothing, which reads as a
    // broken button rather than an inactive one.
    await newRichNote(page)
    const bar = page.getByRole('toolbar')
    await expect(bar).toBeVisible()

    const m = await page.evaluate(() => {
      const el = document.querySelector('[role="toolbar"]') as HTMLElement
      const buttons = Array.from(el.querySelectorAll('button')) as HTMLButtonElement[]
      const isDisabled = (b: HTMLButtonElement) =>
        b.disabled || b.getAttribute('aria-disabled') === 'true'
      const disabled = buttons.filter(isDisabled)
      const enabled = buttons.filter((b) => !isDisabled(b))
      return {
        disabledCount: disabled.length,
        disabledOpacity: [...new Set(disabled.map((b) => getComputedStyle(b).opacity))],
        enabledOpacity: [...new Set(enabled.map((b) => getComputedStyle(b).opacity))]
      }
    })

    // A selection-dependent control is always inactive with nothing selected.
    expect(m.disabledCount, 'some control must be unavailable with no selection').toBeGreaterThan(0)
    for (const o of m.disabledOpacity) {
      expect(Number.parseFloat(o), `disabled control at opacity ${o}`).toBeLessThan(0.6)
    }
    for (const o of m.enabledOpacity) {
      expect(Number.parseFloat(o), `enabled control at opacity ${o}`).toBe(1)
    }
  })
})
