import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Unified toolbar: the controls actually do something.
 *
 * ## Why this file exists and why it is a browser test
 *
 * The first attempt shipped a Markdown toolbar whose buttons did nothing, and
 * the unit suite passed. The string transforms were correct and were tested;
 * what was never tested was the path from a rendered control, through a
 * capability, into a real editor. Three buttons returned their handler instead
 * of calling it, which no test of a pure function could ever catch.
 *
 * So every test here presses a real button and reads the document back. A
 * control wired to nothing, or wired to the wrong capability, fails here.
 *
 * It has to be a browser test: a CodeMirror `EditorView` constructs DOM in its
 * constructor, so there is no such thing as a headless one under `bun:test`.
 * That was measured — 28 of 29 tests failed with `document is not defined`
 * before this was moved here, rather than being quietly skipped.
 */

const WIDE = { width: 1600, height: 900 }

let seq = 0

async function openMarkdownNote(
  page: Page,
  request: APIRequestContext,
  markdown: string
): Promise<string> {
  seq += 1
  const title = `ToolbarProbe ${Date.now()}-${seq}`
  const res = await request.post('/api/pages', {
    // The envelope, not raw text: a Markdown page's stored content is
    // `{ version, markdown }`, and the API answers 400 for anything else. Sending
    // the bare string produced a 400 on every test here before this was fixed,
    // which is a test bug and not a product one.
    data: { title, pageType: 'markdown', content: JSON.stringify({ version: 1, markdown }) }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page?: { id: string }; id?: string }
  const id = body.page?.id ?? body.id
  if (!id) throw new Error('the created page had no id')
  await page.goto(`/?page=${id}`)
  // The editor must be in Edit mode for a caret to exist; Preview is the default.
  await expect(page.getByTestId('markdown-workspace')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('markdown-edit-button').click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(300)
  return id
}

/** The document text, read from the live CodeMirror instance. */
async function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const content = document.querySelector('.cm-content') as HTMLElement | null
    return content?.innerText ?? ''
  })
}

/** Presses a toolbar control by its accessible name. */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole('toolbar').getByRole('button', { name, exact: false }).first().click()
  await page.waitForTimeout(200)
}

test.describe('unified toolbar is one bar, on every surface', () => {
  test('a Markdown page gets the same toolbar row a Rich Note does', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, '# Title\n\nSome text.')

    const bars = page.getByRole('toolbar')
    await expect(bars).toHaveCount(1)

    /*
     * The arrangement being fixed: the Markdown bar used to render as a row of
     * its own, below the header, so the window had two bars.
     *
     * Asserted against the **row**, not the inner `[role="toolbar"]` element. The
     * row is the 40px band that owns the chrome — surface, hairline, padding —
     * and the role element is the control strip inside it, vertically centred
     * within that band. Comparing the tab strip's bottom edge to the *inner*
     * element's top edge reads a 6px difference that is the centring, not a gap,
     * and the earlier version of this test failed on exactly that while the
     * layout was already correct. Measured ancestor chain: tablist bottom 40,
     * row top 40, row height 40.
     */
    const order = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]') as HTMLElement | null
      const row = document.querySelector(
        '[data-testid="markdown-toolbar-row"]'
      ) as HTMLElement | null
      const editor = document.querySelector('.cm-content') as HTMLElement | null
      if (!tablist || !row || !editor) return null
      return {
        tabBottom: Math.round(tablist.getBoundingClientRect().bottom),
        rowTop: Math.round(row.getBoundingClientRect().top),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        rowBottom: Math.round(row.getBoundingClientRect().bottom),
        editorTop: Math.round(editor.getBoundingClientRect().top)
      }
    })
    expect(order).not.toBeNull()
    // The row begins exactly where the tab strip ends: no other bar between.
    expect(order?.rowTop).toBe(order?.tabBottom)
    // One row's worth of height, from the shared token.
    expect(order?.rowHeight).toBe(40)
    // And the document sits below it.
    expect(order?.editorTop).toBeGreaterThan(order?.rowBottom ?? 0)
  })

  test('the Markdown bar shows the full control set, not a reduced one', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')

    // The same 35 commands plus the overflow button. Asserted as a floor rather
    // than an exact count so adding a control later does not fail this test; the
    // exact figure is asserted in the model unit test.
    const count = await page.getByRole('toolbar').getByRole('button').count()
    expect(count).toBeGreaterThanOrEqual(36)
  })
})

test.describe('pressing a control changes the document', () => {
  test('bold wraps the selection', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'hello')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Bold')
    expect(await docText(page)).toContain('**hello**')
  })

  test('italic wraps the selection', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'hello')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Italic')
    expect(await docText(page)).toContain('*hello*')
  })

  test('strikethrough wraps the selection', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'hello')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Strikethrough')
    expect(await docText(page)).toContain('~~hello~~')
  })

  test('a heading control prefixes the line', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'Title')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Heading 2')
    expect(await docText(page)).toContain('## Title')
  })

  test('bullet list prefixes the line', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'Item')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Bulleted list')
    expect(await docText(page)).toContain('- Item')
  })

  test('quote prefixes the line', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'Quoted')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Quote block')
    expect(await docText(page)).toContain('> Quoted')
  })

  test('the table control inserts a table', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    // A document with a line in it, not an empty one. The table control is a
    // whole-line construct: it replaces the selected lines with the table, so on
    // an empty document there is nothing to replace and the command is correct to
    // do nothing. The callout controls, which insert at the caret, are the ones
    // that work on an empty document, and they are tested that way below.
    await openMarkdownNote(page, request, 'Items')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Insert table')
    expect(await docText(page)).toContain('| Column 1 | Column 2 |')
  })

  test('each callout control inserts its own directive', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    /*
     * A paragraph of real content, not `''`.
     *
     * The first version of this test seeded an empty document, and it failed for a
     * reason outside the toolbar: `parseMarkdownPageContent`
     * (`src/shared/schemas/markdown-content.ts:70`) returns `{ ok: false }` for
     * empty stored content, so the workspace renders its `parseFailed` branch and
     * never mounts an editor or publishes capabilities. That is a pre-existing
     * product decision in shared schema code this work does not touch.
     *
     * The empty-document case did surface one real toolbar defect on the way here,
     * which is fixed and recorded at `wholeLineSelection` in `codemirror-capabilities.ts`:
     * the live-state reader asked CodeMirror for the line at a selection position past
     * the end of a zero-length document, `lineAt` threw, and the entire toolbar row
     * failed to render.
     */
    await openMarkdownNote(page, request, 'notes')
    await page.locator('.cm-content').click()
    await press(page, 'Danger callout')
    expect(await docText(page)).toContain(':::danger')
  })

  test('undo reverses a formatting command', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'hello')
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+a')
    await press(page, 'Bold')
    expect(await docText(page)).toContain('**hello**')
    await press(page, 'Undo')
    expect(await docText(page)).not.toContain('**hello**')
  })
})

test.describe('a greyed control explains itself', () => {
  test('every unavailable control carries a reason', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')

    const reasons = await page
      .getByRole('toolbar')
      .locator('button[data-disabled]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-unavailable-reason')))
    // Markdown genuinely lacks several of these, so there must be some.
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) {
      expect(reason).toBeTruthy()
      expect((reason ?? '').length).toBeGreaterThan(0)
    }
  })

  test('hovering a greyed control opens a tooltip carrying the reason', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')

    const target = page.getByRole('toolbar').locator('button[data-disabled]').first()
    await target.hover()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible({ timeout: 5_000 })
    // The reason is in the tooltip text, not only in an attribute.
    expect((await tooltip.innerText()).length).toBeGreaterThan(3)
  })

  test('a greyed control does not change the document when pressed', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')
    const before = await docText(page)
    const target = page.getByRole('toolbar').locator('button[data-disabled]').first()
    // Force the click: a disabled control swallows a real one, and this asserts
    // there is no handler behind it either.
    await target.dispatchEvent('click')
    await page.waitForTimeout(150)
    expect(await docText(page)).toBe(before)
  })
})

test.describe('the toolbar is one tab stop', () => {
  test('exactly one control in the bar is a tab stop', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')

    // The defect this guards: `role="toolbar"` with no roving tabindex, which
    // gave seventeen separate tab stops in one bar.
    //
    // Asserted as "exactly one element in the bar has tabindex=0", and nothing
    // more. The earlier version also asserted that element carried
    // `data-toolbar-item`, and that was wrong: the roving tabindex is on the
    // measuring wrapper, while `data-toolbar-item` is on the button inside it.
    // Requiring both on one element would have failed a correct implementation.
    const stops = await page
      .getByRole('toolbar')
      .locator('[tabindex="0"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          holdsControl: el.querySelector('[data-toolbar-item]') !== null
        }))
      )
    expect(stops.length).toBe(1)
    // And it must actually wrap a control, or the bar is focusable at a point
    // where there is nothing to activate.
    expect(stops[0]?.holdsControl).toBe(true)

    // The rest are removed from the tab order entirely.
    const total = await page.getByRole('toolbar').locator('span[class*="slot"]').count()
    expect(total).toBeGreaterThan(10)
  })

  test('arrow keys move focus without running the command', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')
    const before = await docText(page)

    await page.getByRole('toolbar').locator('[tabindex="0"]').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)

    // Focus moved...
    const focusedIsInBar = await page.evaluate(
      () => document.activeElement?.closest('[role="toolbar"]') !== null
    )
    expect(focusedIsInBar).toBe(true)
    // ...and nothing was formatted on the way. Arrowing across a toolbar must
    // never act on the document.
    expect(await docText(page)).toBe(before)
  })

  test('Home and End move to the ends', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openMarkdownNote(page, request, 'text')
    await page.getByRole('toolbar').locator('[tabindex="0"]').focus()
    await page.keyboard.press('End')
    await page.waitForTimeout(120)
    const atEnd = await page.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"]') as HTMLElement
      const items = bar.querySelectorAll<HTMLElement>('[data-toolbar-item]')
      return document.activeElement === items[items.length - 1]
    })
    expect(atEnd).toBe(true)
  })
})

test.describe('the bar is one row, always', () => {
  test('a narrow window overflows rather than wrapping to a second row', async ({
    page,
    request
  }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await openMarkdownNote(page, request, 'text')

    const geometry = await page.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"]') as HTMLElement
      const row = bar.closest('[data-testid$="toolbar-row"]') as HTMLElement | null
      // The last *visible* slot, and the right edge of the bar. The assertion
      // that matters is that nothing is painted past the bar's own right edge:
      // `scrollWidth` cannot be used for that, because the overflow panel is
      // portalled into the body and its children still count toward the bar's
      // scrollable overflow in Chromium. Measured: a correct split reported
      // scrollWidth 702 against a clientWidth of 540 while the visible slots
      // summed to exactly 540, so the original assertion here was wrong and
      // would have failed a working toolbar.
      const slots = Array.from(bar.querySelectorAll<HTMLElement>('span[class*="slot"]'))
      const lastSlot = slots[slots.length - 1]
      return {
        barHeight: Math.round(bar.getBoundingClientRect().height),
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
        barRight: Math.round(bar.getBoundingClientRect().right),
        lastSlotRight: lastSlot ? Math.round(lastSlot.getBoundingClientRect().right) : null,
        slotCount: slots.length
      }
    })

    // One row, at the same height as a wide window...
    expect(geometry.barHeight).toBeLessThanOrEqual(48)
    expect(geometry.rowHeight).toBeLessThanOrEqual(48)
    // ...and no control painted past the bar's right edge.
    expect(geometry.lastSlotRight).toBeLessThanOrEqual(geometry.barRight)
    // A split happened: fewer controls on the bar than the model declares.
    expect(geometry.slotCount).toBeLessThan(36)
  })

  test('the overflow button appears when controls do not fit', async ({ page, request }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await openMarkdownNote(page, request, 'text')
    await expect(
      page.getByRole('toolbar').getByRole('button', { name: /More formatting/i })
    ).toBeVisible({ timeout: 5_000 })
  })
})
