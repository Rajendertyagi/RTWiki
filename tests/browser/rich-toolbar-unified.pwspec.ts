import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * The unified toolbar on a **Rich Note** — the surface that most needed migrating.
 *
 * ## What makes this file different from the Markdown one
 *
 * The Markdown tests proved the shell works. These prove the Rich Note is *on that
 * shell*. A Rich Note could keep its own 879-line toolbar and every Markdown test
 * would still pass, so the assertions here are about the shell's identity as much
 * as about behaviour: one toolbar, the right controls, the menus working, and the
 * old component's markup gone.
 *
 * ## Selectors
 *
 * `.bn-editor` and `[data-content-type="…"]` are the selectors the existing
 * `toolbar-controls.pwspec.ts` uses, and they are used here for the same reason:
 * a new selector convention would be a second thing to learn and a second thing to
 * fix. The first version of this file guessed `.bn-content` and every command
 * assertion failed against a toolbar that was working correctly.
 */

const WIDE = { width: 1600, height: 900 }
const EDITABLE = '.bn-editor'

let seq = 0

/** A single paragraph block, which every control can act on. */
const ONE_PARAGRAPH = [
  {
    type: 'paragraph',
    props: { textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text: 'hello', styles: {} }]
  }
]

async function openRichNote(
  page: Page,
  request: APIRequestContext,
  blocks: unknown[]
): Promise<string> {
  seq += 1
  const title = `RichToolbarProbe ${Date.now()}-${seq}`
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify(blocks) }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page?: { id: string }; id?: string }
  const id = body.page?.id ?? body.id
  if (!id) throw new Error('the created page had no id')
  await page.goto(`/?page=${id}`)
  await expect(page.getByRole('toolbar')).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(600)
  return id
}

/**
 * A control on the toolbar, by exact accessible name.
 *
 * The `getByLabel` fallback is the same one the existing `toolbar-controls` spec
 * uses, and it is needed for the same reason: a greyed control's accessible name
 * gains an " (unavailable)" suffix, so a strict role-name match misses it. The
 * first version of this helper had no fallback and every greyed-control
 * assertion timed out on a toolbar that was working.
 */
function control(page: Page, name: string) {
  return page
    .getByRole('toolbar')
    .getByRole('button', { name, exact: true })
    .or(page.getByRole('toolbar').getByLabel(name, { exact: true }))
}

/** Presses a control, tolerating the "(unavailable)" suffix on greyed ones. */
function press(page: Page, name: string): Promise<void> {
  return page.getByRole('toolbar').getByRole('button', { name, exact: false }).first().click()
}

/**
 * Puts the caret in the document and selects everything in it.
 *
 * The click targets the first paragraph block, not `.bn-editor`. Clicking the
 * editor's container can land on its padding rather than on the text, which leaves
 * the editor unfocused — and then `Ctrl+A` selects the page instead of the block.
 * The command still ran and the mark still appeared, but `aria-pressed` stayed
 * `false` because there was no editor selection for it to describe.
 *
 * `[data-content-type="paragraph"]` is the selector the existing
 * `toolbar-controls` spec uses, for the same reason.
 */
async function selectAllInDocument(page: Page): Promise<void> {
  await page.locator(`${EDITABLE} [data-content-type="paragraph"]`).first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.waitForTimeout(200)
}

test.describe('the Rich Note is on the unified toolbar', () => {
  test('exactly one toolbar, and it is the shared shell', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)

    // One toolbar. A duplicate here is the specific failure the migration could
    // have produced by adding the shell without removing the old bar.
    await expect(page.getByRole('toolbar')).toHaveCount(1)

    /*
     * The only greyed controls are the two that genuinely cannot act.
     *
     * The first version of this asserted **zero** greyed controls and failed
     * against a toolbar that was working correctly. Outdent and indent report
     * themselves unavailable on a top-level paragraph, because there is nothing
     * there to nest — and that answer comes from BlockNote's `canUnnestBlock()` /
     * `canNestBlock()`, not from a guess. Asserting the exact pair is what
     * distinguishes "on the shared shell" from "a Rich Note with its own
     * controls", and it would catch a surface that greyed something it should not.
     */
    const greyed = await page
      .getByRole('toolbar')
      .locator('button[data-disabled]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    expect(greyed.sort()).toEqual(['Indent', 'Outdent'])

    // The shell's roving focus: exactly one tab stop for the whole bar. The old
    // toolbar had one per control.
    await expect(page.getByRole('toolbar').locator('[tabindex="0"]')).toHaveCount(1)
  })

  test('tabs are above the toolbar and the status bar below', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)

    const order = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]') as HTMLElement | null
      const row = document.querySelector('[data-testid="rich-toolbar-row"]') as HTMLElement | null
      if (!tablist || !row) return null
      return {
        tabBottom: Math.round(tablist.getBoundingClientRect().bottom),
        rowTop: Math.round(row.getBoundingClientRect().top),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        rowBottom: Math.round(row.getBoundingClientRect().bottom),
        // The status bar is the AppShell footer: the shell root's last child,
        // which is stable, rather than a Mantine class hash.
        statusTop: (() => {
          const shell = document.querySelector('[class*="mantine-AppShell-root"]')
          const last = shell?.lastElementChild as HTMLElement | null
          return last ? Math.round(last.getBoundingClientRect().top) : null
        })()
      }
    })
    expect(order).not.toBeNull()
    // Tabs sit directly above the toolbar row, with nothing between them.
    expect(order?.rowTop).toBe(order?.tabBottom)
    // One row's worth of height, from the shared token.
    expect(order?.rowHeight).toBe(40)
    // The status bar region is below the toolbar, not above it.
    if (order?.statusTop != null) {
      expect(order.statusTop).toBeGreaterThanOrEqual(order.rowBottom ?? 0)
    }
  })
})

test.describe('Rich Note commands reach BlockNote', () => {
  test('bold toggles and the editor reports it active', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)

    const bold = control(page, 'Bold')
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
    await bold.click()
    // The mark in the document, then the state reaching the toolbar. Both halves
    // matter: the first proves the command ran on the editor, the second that
    // `useEditorState` fed the shell rather than a React copy of it.
    await expect(page.locator(`${EDITABLE} strong`)).toBeVisible()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
  })

  test('a heading control changes the block type', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await page
      .locator(EDITABLE + ' [data-content-type="paragraph"]')
      .first()
      .click()
    await press(page, 'Heading 2')
    await page.waitForTimeout(400)
    await expect(control(page, 'Heading 2')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator(`${EDITABLE} [data-content-type="heading"]`)).toHaveCount(1)
  })

  test('alignment is applied and the control reports itself active', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await page
      .locator(EDITABLE + ' [data-content-type="paragraph"]')
      .first()
      .click()
    const centre = control(page, 'Align centre')
    await centre.click()
    await page.waitForTimeout(400)
    await expect(centre).toHaveAttribute('aria-pressed', 'true')
  })

  test('a list control changes the block type', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await page
      .locator(EDITABLE + ' [data-content-type="paragraph"]')
      .first()
      .click()
    await press(page, 'Bulleted list')
    await page.waitForTimeout(400)
    await expect(page.locator(`${EDITABLE} [data-content-type="bulletListItem"]`)).toHaveCount(1)
  })

  test('undo reverses a formatting command', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)
    const bold = control(page, 'Bold')
    await bold.click()
    await expect(page.locator(`${EDITABLE} strong`)).toBeVisible()
    await expect(bold).toHaveAttribute('aria-pressed', 'true')
    await press(page, 'Undo')
    await page.waitForTimeout(600)
    // Undo must remove the mark from the document, not merely flip the button.
    // Asserting only the button would pass if the state were a React copy that
    // had been reset without the editor being.
    await expect(page.locator(`${EDITABLE} strong`)).toHaveCount(0)
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('the menu seam, proven on the real surface', () => {
  test('text colour opens a panel, a choice applies, and the panel closes', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)

    const trigger = control(page, 'Text colour')
    // The trigger declares that it opens a menu, and says whether it is open.
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()
    const panel = page.getByTestId('text-color-grid')
    await expect(panel).toBeVisible()
    // The panel keeps the promise `aria-haspopup="menu"` makes: Mantine's
    // Popover.Dropdown is a `dialog`, so the menu role comes from the component
    // that actually holds the items.
    await expect(panel).toHaveAttribute('role', 'menu')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Choose a colour and prove it reached BlockNote rather than merely closing
    // a panel: the control reports itself active, read from `getActiveStyles()`.
    await panel.getByRole('menuitemradio', { name: 'Text colour: red' }).click()
    await page.waitForTimeout(500)

    // The panel dismissed itself, which it could only do through the close
    // callback the seam hands it.
    await expect(panel).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveAttribute('aria-pressed', 'true')
  })

  test('highlight opens its own panel with a distinct set of swatches', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)

    await press(page, 'Highlight')
    const panel = page.getByTestId('highlight-grid')
    await expect(panel).toBeVisible()
    // Named for highlight, not text colour: the two panels share an
    // implementation but must not share an identity.
    await expect(panel).toHaveAttribute('aria-label', /Highlight/i)
  })

  test('the link panel applies a URL through the editor', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)

    await press(page, 'Link')
    const input = page.getByTestId('link-url-input')
    await expect(input).toBeVisible()
    await input.fill('https://example.com')
    await page.getByTestId('link-apply').click()
    await page.waitForTimeout(500)

    // The link is in the document, and the panel closed after applying.
    await expect(page.locator(`${EDITABLE} a[href="https://example.com"]`)).toHaveCount(1)
    await expect(input).toBeHidden()
  })

  test('the colour panel is one tab stop with arrow and Home/End navigation', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    await selectAllInDocument(page)

    await press(page, 'Text colour')
    const grid = page.getByTestId('text-color-grid')
    const items = grid.getByRole('menuitemradio')
    await expect(items).toHaveCount(10)

    // One tab stop inside the panel, which is what makes it a menu rather than
    // ten tab stops.
    await expect(grid.locator('[tabindex="0"]')).toHaveCount(1)

    const focusedIndex = () =>
      page.evaluate(() => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
        return all.findIndex((el) => el === document.activeElement)
      })

    await grid.locator('[tabindex="0"]').focus()
    expect(await focusedIndex()).toBe(0)

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    expect(await focusedIndex()).toBe(1)

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(200)
    expect(await focusedIndex()).toBe(2)

    await page.keyboard.press('End')
    await page.waitForTimeout(200)
    expect(await focusedIndex()).toBe(9)

    await page.keyboard.press('Home')
    await page.waitForTimeout(200)
    expect(await focusedIndex()).toBe(0)
  })
})

test.describe('the old Rich toolbar is gone', () => {
  test('every control in the bar belongs to the shared shell', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)

    const bar = page.getByRole('toolbar')
    const buttons = await bar.getByRole('button').count()
    // Every control the shell renders carries `data-toolbar-item`, because that is
    // what the roving focus moves between. The old toolbar's controls had no such
    // attribute — it had no roving focus — so a control without one would be a
    // leftover. The overflow button is the single exception.
    const ours = await bar.locator('button[data-toolbar-item]').count()
    expect(buttons - ours).toBeLessThanOrEqual(1)
    expect(ours).toBeGreaterThan(20)
  })

  test('BlockNote renders no formatting toolbar of its own', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openRichNote(page, request, ONE_PARAGRAPH)
    // `BlockNoteView` is mounted with `formattingToolbar={false}`; this asserts
    // the consequence, which is that exactly one toolbar exists at all.
    await expect(page.getByRole('toolbar')).toHaveCount(1)
  })
})
