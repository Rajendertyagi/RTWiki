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

/**
 * Clicks a toolbar control wherever it currently lives.
 *
 * The bar holds 28 controls and its own row is about 920px, so the tail of it -
 * code block, quote, the callouts and Clear formatting - does not fit and moves
 * into a trailing "more" menu. That is the designed behaviour, measured rather
 * than assumed: opening the menu shows all eight, still labelled.
 *
 * These tests predate that change and looked for every control on the bar
 * itself, so four of them failed on a control that had not gone missing - it had
 * moved. Rather than pick a side, this helper uses the real arrangement and the
 * assertions stay about *what the control does*, not where it is filed.
 */
async function useControl(page: Page, testId: string): Promise<void> {
  // Scope the on-bar lookup to the toolbar. An unscoped `getByTestId` also
  // matches a menu item that is portalled outside the toolbar — and, worse,
  // matches one that is still present while the menu animates closed. Both
  // mistakes end in a click on a detached element.
  const onBar = page.getByRole('toolbar').getByTestId(testId)
  if ((await onBar.count()) > 0) {
    await onBar.click()
    return
  }
  const more = page.getByTestId('toolbar-more')
  await more.click()
  const inMenu = page.getByTestId(testId)
  await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
  await inMenu.click()
  // The menu closes itself when one of its controls is used, so wait for that
  // to settle. Without this, the next helper call can find the control in the
  // DOM during the dismissal and click it as it detaches.
  await expect(more).toHaveAttribute('aria-expanded', 'false')
}

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

    await useControl(page, 'clear-formatting')
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
    await useControl(page, 'insert-quote')
    await expect(page.locator(`${EDITABLE} blockquote`).first()).toBeVisible()
    await useControl(page, 'insert-code-block')
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
    // Every control must exist and be usable - on the bar, or in the more menu
    // when the row has run out of width. Asserting "on the bar" is what these
    // tests used to do, and it is why four of them failed against a deliberate
    // change rather than a fault.
    await page.getByTestId('toolbar-more').click()
    await page.waitForTimeout(400)
    for (const key of keys) {
      const control = page.getByTestId(key)
      await expect(control, `${key} must be reachable`).toBeVisible()
      await expect(control, `${key} must be enabled`).toBeEnabled()
    }
    // The former Insert dropdown is gone.
    await expect(page.getByTestId('insert-menu-button')).toHaveCount(0)
  })

  test('the more menu closes when one of its controls is used', async ({ page }) => {
    await newRichNote(page)
    const more = page.getByTestId('toolbar-more')
    await expect(more).toBeVisible()
    await expect(more).toHaveAttribute('aria-expanded', 'false')

    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')

    // Use a control that lives inside the menu. Mantine only auto-closes a menu
    // for its own `Menu.Item` children, and these controls are moved in whole as
    // bare `ActionIcon`s, so nothing closed it. Left open, the next click
    // anywhere was consumed dismissing the menu and DOM focus was handed back to
    // the trigger button — which is why typing into a just-inserted callout went
    // nowhere. The menu closing is the whole contract, so assert it directly.
    const inMenu = page.getByTestId('insert-code-block')
    await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
    await inMenu.click()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
  })

  test('the overflow panel is reachable by keyboard', async ({ page }) => {
    // Known bug: the overflow was a Mantine `Menu`, which renders role="menu" and
    // moves focus by querying `[data-menu-item]`. The controls moved into it are
    // bare `ActionIcon`s carrying neither, so a keyboard user could not get into
    // the panel at all. It is a `Popover` now, so Tab reaches the controls the
    // ordinary way, and the panel says what it is instead of claiming to be a menu.
    await newRichNote(page)
    const more = page.getByTestId('toolbar-more')
    await expect(more).toBeVisible()
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')

    const panel = page.getByTestId('toolbar-overflow-panel')
    await expect(panel).toBeVisible()
    // The panel is a dialog, not a menu: its contents are ordinary controls with
    // no `menuitem` role, and Mantine no longer claims otherwise.
    await expect(panel).toHaveAttribute('role', 'dialog')
    await expect(more).toHaveAttribute('aria-haspopup', 'dialog')

    // Opening the panel must move focus inside it. The panel is portalled, so Tab
    // from the trigger would never reach it, and Mantine leaves `trapFocus` false
    // by default - without it a keyboard user cannot get in at all.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const active = document.activeElement
            const panelNode = document.querySelector('[data-testid="toolbar-overflow-panel"]')
            return Boolean(active && panelNode && panelNode.contains(active))
          }),
        { message: 'focus must move into the panel when it opens' }
      )
      .toBe(true)

    // And Tab must then move between the controls it holds.
    await page.keyboard.press('Tab')
    const afterTab = await page.evaluate(() => {
      const active = document.activeElement
      const panelNode = document.querySelector('[data-testid="toolbar-overflow-panel"]')
      return Boolean(active && panelNode && panelNode.contains(active))
    })
    expect(afterTab, 'Tab must stay within the panel').toBe(true)
  })

  test('typing into a block inserted from the more menu lands in that block', async ({ page }) => {
    // The user-visible consequence of the menu staying open. Insert from the
    // menu, then click the block and type: with the menu still open the first
    // click was swallowed and the keystrokes went to the toolbar button.
    await newRichNote(page)
    const more = page.getByTestId('toolbar-more')
    await more.click()
    const inMenu = page.getByTestId('insert-code-block')
    await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
    await inMenu.click()

    const body = page.locator(EDITABLE)
    await body.click()
    await page.keyboard.type('CODEFENCE')
    await expect(page.locator(`${EDITABLE} code`).first()).toContainText('CODEFENCE')
  })

  test('typing straight after inserting from the more menu lands in the block', async ({
    page
  }) => {
    // The focus theft itself, with no intervening click to mask it. The menu is a
    // Popover with `returnFocus` raised to true, so unmounting the dropdown handed
    // DOM focus back to the trigger button *after* the browser's own focus step.
    // No `focusin` ever reached ProseMirror, so every keystroke went to the button
    // and the block the menu had just inserted ignored all of them. A test that
    // clicks the block first cannot see this.
    await newRichNote(page)
    await page.getByTestId('toolbar-more').click()
    const inMenu = page.getByTestId('insert-callout-info')
    await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
    await inMenu.click()
    // No click in between: the keystrokes must reach the block the menu just made.
    await page.keyboard.type('ZZNOCLICK')
    await expect(page.locator(EDITABLE)).toContainText('ZZNOCLICK')
  })

  test('overlay-owning controls still work from inside the more menu', async ({ page }) => {
    // Colour and link pickers carry their own floating overlay. Closing the menu
    // on a click inside one unmounts that control, which tears down the popover it
    // just opened — and at narrow widths these controls have overflowed into the
    // menu, so the picker flashes and vanishes instead of opening. The trigger
    // keeps the menu open; the *next* click, inside the portalled dropdown, has no
    // marked DOM ancestor and closes the menu, which is the outcome that was
    // actually wanted.
    await newRichNote(page)
    await page.setViewportSize({ width: 420, height: 900 })
    await page.waitForTimeout(600)
    const more = page.getByTestId('toolbar-more')
    await more.click()
    // `toolbarButton()` scopes to the bar, so it can never match a portalled panel
    // child; the panel is addressed directly. It used to be found by
    // `[data-menu-dropdown]`, which is a Mantine `Menu` attribute; the panel is a
    // `Popover`, which carries no data attribute, hence the testid.
    const inMenu = page.getByTestId('toolbar-overflow-panel')
    await inMenu.getByLabel('Highlight', { exact: true }).click()
    // The menu must survive the click. Without the guard the control is torn down
    // with it: measured, the grid was still in the DOM for a few milliseconds —
    // long enough for a fast click to pick a swatch — and then vanished, which is
    // the race that made this read as a control that half works. Assert the
    // settled state, not the first frame of it.
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(500)
    await expect(page.getByTestId('highlight-grid')).toBeVisible()
    await page
      .getByRole('menuitemradio', { name: /yellow/i })
      .first()
      .click()
    await expect(
      page.locator(`${EDITABLE} [data-style-type="backgroundColor"][data-value="yellow"]`).first()
    ).toBeVisible()
    // Using the picker is not a reason to keep the menu open: the swatch lives in
    // a portal, so it has no marked DOM ancestor and the menu closes on it.
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await inMenu.getByLabel('Link', { exact: true }).click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(500)
    await expect(page.getByTestId('link-url-input')).toBeVisible()
    await page.getByTestId('link-url-input').fill('https://example.com/narrow')
    await page.getByRole('button', { name: 'Apply link' }).click()
    await expect(
      page.locator(`${EDITABLE} a[href="https://example.com/narrow"]`).first()
    ).toBeVisible()
  })

  for (const width of [1280, 900, 480, 420]) {
    test(`the bar never overflows at ${width}px`, async ({ page }) => {
      // Cheap insurance against the rejected alternative creeping back: pinning
      // the three overlay-owning controls onto the bar overflows the row at every
      // width (measured 1021 vs 920 at 1280) because the overflow budget knows
      // nothing about pinned controls. Everything that does not fit belongs in the
      // menu, at every width.
      await newRichNote(page)
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(600)
      const m = await page.getByRole('toolbar').evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth
      }))
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth + 1)
    })
  }

  test('every insertion control stays reachable at narrow width', async ({ page }) => {
    const title = uniqueTitle('NarrowInsert')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator(EDITABLE)).toBeVisible()
    await page.setViewportSize({ width: 480, height: 800 })
    // The bar must not scroll or wrap; what does not fit goes to the more menu.
    const bar = page.getByRole('toolbar')
    const metrics = await bar.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      height: el.getBoundingClientRect().height
    }))
    expect(metrics.overflowX).toBe('hidden')
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    expect(metrics.height, 'the bar must stay one row').toBeLessThan(80)

    // Everything that did not fit is still reachable through the more menu.
    const keys = ['insert-formula', 'insert-diagram', 'insert-mind-map', 'insert-callout-danger']
    await page.getByTestId('toolbar-more').click()
    await page.waitForTimeout(400)
    for (const key of keys) {
      await expect(page.getByTestId(key), `${key} must stay reachable`).toBeVisible()
    }
    await expect(page.getByTestId('insert-menu-button')).toHaveCount(0)
    // Narrow screens scroll the row; controls stay usable.
    await useControl(page, 'insert-quote')
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
