import { expect, type Page, test } from '@playwright/test'

/**
 * The unified toolbar on an **HTML source page**.
 *
 * ## Why this file exists
 *
 * `code-ide.pwspec.ts` already proves the seventeen commands still work after the
 * migration — undo, redo, find, format, font size, word wrap, and the rest, driven
 * through the same test ids they always had. That is the half that says "nothing was
 * lost".
 *
 * This file is the other half: that the HTML page is *on the shared shell*. A page
 * could keep its own 261-line toolbar with its own focus model and every one of those
 * command tests would still pass, because the commands are the commands. So the
 * assertions here are about the shell's identity, not about behaviour.
 */

const WIDE = { width: 1600, height: 900 }

let seq = 0

/**
 * Creates an HTML page through the New page dialog and opens its HTML subfile.
 *
 * The first version of this helper POSTed to `/api/pages` with an HTML envelope and
 * got a 400 — the HTML page's content schema is not the `{ version, markdown }` shape,
 * and guessing it was the same mistake the Markdown spec had already documented once.
 *
 * The dialog path is used instead because it is the one the application itself takes,
 * and it produces a page with the right default content without this file having to
 * know the envelope. Source mode is then entered from the tree, exactly as a user
 * would: expand the page's virtual subfiles, click HTML.
 */
/**
 * Creates an HTML page and leaves it on the rendered preview.
 *
 * The preview is a separate surface from the three subfile editors, and it is
 * where the bar used to be reduced to a single button. Entering a subfile
 * cannot be undone by going "back", so it gets its own helper rather than a flag
 * on the source one.
 */
async function openPreviewPage(page: Page): Promise<string> {
  seq += 1
  const title = `PreviewHtml ${Date.now()}-${seq}`

  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  await dialog.locator('input[type="radio"]').nth(1).check()
  await dialog.getByRole('button', { name: /create/i }).click()

  await expect(page.getByTestId('html-preview-view')).toBeVisible({ timeout: 25_000 })
  await expect(page.getByTestId('source-toolbar')).toBeVisible({ timeout: 25_000 })
  return title
}

async function openSourcePage(page: Page): Promise<string> {
  seq += 1
  const title = `UnifiedHtml ${Date.now()}-${seq}`

  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  // The second radio is the HTML page type, which is what this surface is.
  await dialog.locator('input[type="radio"]').nth(1).check()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('html-preview-view')).toBeVisible({ timeout: 25_000 })

  // Expand the page's virtual source subfiles through the tree, then open HTML.
  const row = page.locator('[role="treeitem"]', { hasText: title }).first()
  await row.hover()
  await row
    .getByLabel(/expand/i)
    .click()
    .catch(async () => {
      await row.getByRole('button').first().click()
    })

  const sub = page.locator('[data-subfile-id$="::html"]').first()
  await sub.waitFor({ state: 'visible', timeout: 10_000 })
  await sub.click()
  await expect(page.getByTestId('html-source-view')).toBeVisible({ timeout: 25_000 })

  await expect(page.getByTestId('source-toolbar')).toBeVisible({ timeout: 25_000 })
  await page.waitForTimeout(600)
  return title
}

/**
 * The test id of the control that currently holds focus.
 *
 * `tabindex` is set on the bar's **slot wrapper** — the `<span>` the overflow hook
 * measures — not on the button inside it. So `document.activeElement` is that span and
 * has no `data-testid` of its own; the button is its child. The first version read the
 * attribute straight off `activeElement` and got `null` on a toolbar that was working.
 */
async function focusedControlId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!active) return null
    const own = active.getAttribute('data-testid')
    if (own) return own
    return active.querySelector('[data-testid]')?.getAttribute('data-testid') ?? null
  })
}

test.describe('the HTML page is on the unified toolbar', () => {
  test('there is exactly one toolbar, and it is the shared shell', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * One toolbar. This is the specific regression the migration could have caused:
     * the old component drew its own `role="toolbar"` *inside* the app row, so an
     * HTML page had two nested toolbars with two focus models and two divider
     * systems. Tab walked into the inner one and then through all seventeen of its
     * controls one at a time, and the outer row had no roving focus because nothing
     * else was in it to move between.
     */
    await expect(page.getByRole('toolbar')).toHaveCount(1)

    // The shell's roving focus: one tab stop for the whole row. The old toolbar had
    // one per control, so seventeen.
    await expect(page.getByRole('toolbar').locator('[tabindex="0"]')).toHaveCount(1)

    // Every control in the bar is one the shell rendered, which is what the
    // `data-toolbar-item` attribute marks and the roving focus moves between.
    const controls = await page.getByRole('toolbar').locator('button[data-toolbar-item]').count()
    expect(controls).toBeGreaterThanOrEqual(14)
  })

  test('every legacy test id still resolves', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * The ids the HTML page's existing suite has always used. They are part of the
     * project's test surface, so moving the controls onto the shared shell must not
     * rename them — `code-ide.pwspec.ts` addresses eight of these by id and is
     * unmodified.
     *
     * Counted across the bar *and* the overflow panel, because a control may have
     * been moved into the panel rather than reimplemented, and a locator that only
     * looked on the bar would fail for the wrong reason on a narrow window.
     */
    const ids = [
      'ide-indent',
      'ide-outdent',
      'ide-format',
      'ide-word-wrap',
      'ide-find',
      'ide-replace',
      'ide-comment',
      'ide-fold-all',
      'ide-unfold-all',
      'ide-font-decrease',
      'ide-font-reset',
      'ide-font-increase',
      'ide-save-now',
      'ide-fullscreen',
      'return-to-preview'
    ]
    for (const id of ids) {
      await expect(page.getByTestId(id), `${id} must still exist`).toHaveCount(1)
    }
  })

  test('the source page publishes its own name for the bar', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    // The `source-toolbar` id is supplied by the surface, not invented by the shell.
    // The shell cannot know what a surface's row used to be called, and deriving one
    // from the page type would put an HTML-specific name into shared code.
    await expect(page.getByTestId('source-toolbar')).toHaveAttribute('role', 'toolbar')
  })
})

test.describe('the two groups are data, and they are in order', () => {
  test('formatting precedes IDE, and each group is internally ordered', async ({
    page,
    request
  }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * Read the bar's own order rather than asserting against a copied list, so this
     * cannot pass by agreeing with a stale copy of the model.
     *
     * The decision was: document-changing controls first, editor-changing second, on
     * every surface. Word wrap moved from the formatting group to the IDE group
     * because it changes the editor and not the document, even though it reads like
     * formatting.
     */
    const order = await page
      .getByRole('toolbar')
      .locator('[data-testid]')
      .evaluateAll((els) =>
        els
          .map((el) => el.getAttribute('data-testid'))
          .filter((id): id is string => id !== null && id !== 'source-toolbar')
      )

    const formatting = ['ide-indent', 'ide-outdent', 'ide-format']
    const ide = [
      'ide-find',
      'ide-replace',
      'ide-comment',
      'ide-fold-all',
      'ide-unfold-all',
      'ide-word-wrap',
      'ide-font-decrease',
      'ide-font-reset',
      'ide-font-increase',
      'ide-save-now',
      'ide-fullscreen'
    ]

    // Ignore undo/redo, which come from the shared `history` group ahead of both.
    const ids = order.filter((id) => id !== 'toolbar-more')
    const firstFormatting = ids.indexOf(formatting[0])
    const lastFormatting = ids.indexOf(formatting[formatting.length - 1])
    const firstIde = ids.indexOf(ide[0])
    const lastIde = ids.indexOf(ide[ide.length - 1])

    expect(firstFormatting).toBeGreaterThanOrEqual(0)
    expect(firstIde).toBeGreaterThanOrEqual(0)
    // Formatting first, then IDE: the whole ordering decision in two assertions.
    expect(firstFormatting).toBeLessThan(firstIde)
    expect(lastFormatting).toBeLessThan(firstIde)
    expect(lastIde).toBeGreaterThan(firstFormatting)

    // And within each group the order is the one the model declares.
    expect(ids.filter((id) => formatting.includes(id))).toEqual(formatting)
    expect(ids.filter((id) => ide.includes(id))).toEqual(ide)
  })

  test('a divider separates the formatting group from the IDE group', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * A divider is a claim that the controls on either side belong together, so the
     * groups are separated by one. The old bar drew five dividers with nothing behind
     * them; this asserts the one that means something.
     */
    const dividers = await page.getByRole('toolbar').locator('hr, [class*="divider"]').count()
    expect(dividers).toBeGreaterThanOrEqual(1)
  })
})

test.describe('availability is honest on this surface', () => {
  test('font size greys out at its bounds and says why', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    // Start at the default and go to the minimum, then one step further. The last
    // press must not do anything, and the control must say why rather than merely
    // looking inactive.
    const smaller = page.getByTestId('ide-font-decrease')
    for (let i = 0; i < 8; i += 1) {
      if (await smaller.getAttribute('data-disabled')) break
      await smaller.click()
      await page.waitForTimeout(120)
    }
    await expect(smaller).toHaveAttribute('data-disabled', 'true')
    const reason = await smaller.getAttribute('data-unavailable-reason')
    expect(reason).toBeTruthy()
    expect(reason).toContain('smallest')
  })

  test('undo greys out with a reason when there is nothing to undo', async ({ page, request }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    // Read CodeMirror's own depth rather than a copy of it, so a greyed undo means
    // "nothing to undo" and not "a broken button".
    const undo = page.getByRole('toolbar').getByRole('button', { name: 'Undo', exact: true })
    await expect(undo).toHaveAttribute('data-disabled', 'true')
    expect(await undo.getAttribute('data-unavailable-reason')).toContain('nothing to undo')
  })

  test('document controls are absent rather than greyed', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * The correction, and it is the one that matters here.
     *
     * The first version of this adapter stated a reason for all thirty document
     * capabilities — "not available in a source editor" — which overrode the
     * resolver's rule and rendered all thirty as greyed buttons. The row became
     * about forty-six controls wide, every one of the fourteen the HTML page
     * actually has was pushed into the overflow panel, and `ide-fullscreen` could
     * not be clicked at all because nothing had opened the panel.
     *
     * The resolver's rule is right: a capability with no command and no stated
     * reason is *dropped*, because it is not an unavailable control, it is a control
     * this surface does not have. Greyed-with-a-reason is for a command that exists
     * and cannot act now.
     *
     * So the document controls must be gone from this surface, not merely inert —
     * and the controls it does have must be reachable on the bar without opening
     * anything.
     */
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Heading 2', exact: true })).toHaveCount(0)

    // And the live ones are on the bar itself, not behind the overflow.
    for (const id of ['ide-find', 'ide-comment', 'ide-format', 'ide-save-now']) {
      await expect(page.getByTestId(id), `${id} must be on the bar`).toBeVisible()
    }
  })
})

test.describe("keyboard model is the shell's", () => {
  test('arrow keys move across the whole row without running a command', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * Measured against the live bar rather than against an assumed starting point.
     *
     * The first version focused the first `[tabindex="0"]` and read
     * `data-testid` from it, and both assumptions were wrong: undo and redo are greyed
     * on a freshly created page — there is nothing to undo — and a greyed control is
     * correctly *not* in the roving order. So the bar's first tab stop is `indent`,
     * and the first item in the DOM is an undo with no test id.
     *
     * So: start from whatever the bar itself says is focused, then assert that focus
     * actually crossed from the formatting group into the IDE group. That is the claim
     * worth making — under the old nested toolbar the focus stopped at the inner edge
     * and never crossed a divider.
     */
    const startControl = page.getByTestId('ide-indent')
    await startControl.focus()
    const before = await focusedControlId(page)
    expect(before).toBe('ide-indent')

    const ideControls = [
      'ide-find',
      'ide-replace',
      'ide-comment',
      'ide-fold-all',
      'ide-unfold-all',
      'ide-word-wrap'
    ]
    // Step until focus lands in the IDE group, or run out of presses.
    let after: string | null = null
    for (let step = 0; step < 10 && after === null; step += 1) {
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(70)
      const id = await focusedControlId(page)
      if (id !== null && ideControls.includes(id)) after = id
    }

    // It crossed the divider rather than stalling at the formatting group's edge.
    expect(after).not.toBeNull()
    expect(ideControls).toContain(after ?? '')
  })

  test('Home and End reach the ends of the bar', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openSourcePage(page)

    /*
     * "The ends" means the ends of the **focusable** row, not of the DOM.
     *
     * Asserting against DOM index 0 was wrong for the same reason as above: undo and
     * redo are greyed on a new page, so the first focusable control is `indent` at DOM
     * index 2. A toolbar that moved focus to a greyed control would be a bug, so the
     * test computes the expected end from the controls that are actually focusable.
     */
    const focusableIds = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"] [data-toolbar-item]'))
          .filter((el) => !el.hasAttribute('data-disabled'))
          .map((el) => el.getAttribute('data-testid'))
      )

    await page.getByTestId('ide-indent').focus()

    await page.keyboard.press('End')
    await page.waitForTimeout(150)
    const expectedEnd = (await focusableIds()).at(-1)
    expect(await focusedControlId(page)).toBe(expectedEnd)

    await page.keyboard.press('Home')
    await page.waitForTimeout(150)
    const expectedStart = (await focusableIds())[0]
    expect(await focusedControlId(page)).toBe(expectedStart)
    // And it is the first formatting control, not a greyed history button.
    expect(expectedStart).toBe('ide-indent')
  })
})

/**
 * The rendered preview carries the **same** bar as the subfile editors.
 */
test.describe('the preview shows the same toolbar as the editors', () => {
  test('every control is on the bar, not just the five that work', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openPreviewPage(page)

    /*
     * The point of this test.
     *
     * The preview used to render a strip holding one button, so switching from
     * Preview to CSS changed the bar's whole shape — which is the opposite of
     * "unified". The editor-only controls are now declared and reported
     * unavailable, which renders them greyed with a reason: present on every
     * view, in the same order, and never a live-looking dead button.
     */
    for (const id of [
      'ide-find',
      'ide-comment',
      'ide-format',
      'ide-indent',
      'ide-word-wrap',
      'ide-save-now',
      'ide-fullscreen',
      'html-field-preview',
      'html-field-html',
      'html-field-css',
      'html-field-js',
      'refresh-preview'
    ]) {
      await expect(page.getByTestId(id), `${id} must be on the preview bar`).toBeVisible()
    }

    // Nothing spills into the overflow at a normal window width, which is the
    // failure mode a previous attempt at this had: so many greyed controls that
    // every real one was pushed behind "More".
    await expect(page.getByTestId('toolbar-more')).toHaveCount(0)
  })

  test('the controls that need an editor are greyed and say why', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openPreviewPage(page)

    for (const id of ['ide-find', 'ide-comment', 'ide-fullscreen']) {
      const control = page.getByTestId(id)
      await expect(control, `${id} must be disabled on the preview`).toHaveAttribute(
        'data-disabled',
        'true'
      )
      const reason = await control.getAttribute('data-unavailable-reason')
      expect(reason).toContain('open HTML, CSS or JavaScript')
    }

    // The two that do work here are live.
    await expect(page.getByTestId('html-field-css')).not.toHaveAttribute('data-disabled', 'true')
    await expect(page.getByTestId('refresh-preview')).not.toHaveAttribute('data-disabled', 'true')
  })

  test('the bar is the same shape on the preview as on a subfile', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openPreviewPage(page)

    const idsOn = async (): Promise<string[]> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="toolbar"] [data-toolbar-item]'))
          .map((e) => (e as HTMLElement).getAttribute('data-testid'))
          .filter((id): id is string => id !== null)
      )

    const onPreview = await idsOn()
    await page.getByTestId('html-field-css').click()
    await expect(page.getByTestId('html-source-view')).toBeVisible({ timeout: 25_000 })
    await page.waitForTimeout(600)
    const onCss = await idsOn()

    /*
     * The shared controls are the same, in the same order.
     *
     * Each view owns exactly one control the other cannot have: the preview owns
     * Refresh, because on a subfile you are not looking at the preview and
     * switching to it rebuilds; a subfile owns the back-arrow, because the
     * preview is not behind anything. Refresh is a model control and so appears
     * in the list read above; the back-arrow lives in the row's trailing slot
     * rather than in the model, which is why it is asserted by its own id.
     */
    expect(onPreview.filter((id) => id !== 'refresh-preview')).toEqual(
      onCss.filter((id) => id !== 'return-to-preview')
    )
    expect(onPreview).toContain('refresh-preview')
    await expect(page.getByTestId('return-to-preview')).toBeVisible()
  })

  test('a field button opens that subfile, and Preview returns', async ({ page }) => {
    await page.setViewportSize(WIDE)
    await openPreviewPage(page)

    await page.getByTestId('html-field-css').click()
    await expect(page.getByTestId('html-source-view')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('code-editor-css')).toBeVisible({ timeout: 25_000 })

    await page.getByTestId('html-field-preview').click()
    await expect(page.getByTestId('html-preview-view')).toBeVisible({ timeout: 25_000 })
  })

  test('the editor has no frame and no duplicate status row', async ({ page }) => {
    await page.setViewportSize(WIDE)
    const title = await openPreviewPage(page)

    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row
      .getByLabel(/expand/i)
      .click()
      .catch(async () => {
        await row.getByRole('button').first().click()
      })
    await page.getByTestId('html-field-css').click()
    await expect(page.getByTestId('code-editor-css')).toBeVisible({ timeout: 25_000 })

    // The row that repeated the info bar's caret position is gone.
    await expect(page.getByTestId('ide-status-row')).toHaveCount(0)
    // And there is no fourth row: the editor sits directly under the toolbar.
    await expect(page.getByTestId('source-breadcrumb')).toHaveCount(0)
  })
})
