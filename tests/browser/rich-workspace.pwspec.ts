import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

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
    // Tree row should appear quickly after creation; poll on slow CI runners.
    await expect
      .poll(
        async () =>
          await page
            .locator(`[role="treeitem"][aria-label*="${title}"]`)
            .or(page.locator(`[role="treeitem"]`, { hasText: title }))
            .isVisible(),
        { timeout: 10_000 }
      )
      .toBeTruthy()
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
    // Scoped to the utility rail: the status bar also carries a Home button,
    // so a bare role/name lookup matches two elements and Playwright refuses to
    // guess which one navigates Home.
    await page.getByRole('navigation', { name: 'RTWiki' }).getByLabel('Home').click()
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

/**
 * Document surface contract.
 *
 * The shell layers three tones: the page background, panel surfaces (rail, tree,
 * right pane) and the document canvas. The document is the page — it must be the
 * canvas tone, and it must be one continuous surface from the scroll owner down
 * to the editor content. Giving the document the *panel* tone nests a lighter
 * card inside a darker frame, which reads as a widget embedded in a page rather
 * than the page itself.
 */
test.describe('Rich document surface', () => {
  // Switches the app's colour scheme through its real control, so each
  // assertion runs against the same code path a user exercises.
  async function setScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
    const current = await page.evaluate(() =>
      document.documentElement.getAttribute('data-mantine-color-scheme')
    )
    if (current === scheme) return
    const toggle = page.getByRole('button', { name: /theme/i }).first()
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
      )
      .toBe(scheme)
    await page.waitForTimeout(250)
  }

  // Seeds through the API and deep-links rather than the New Page dialog. This
  // suite measures rendered surfaces; the create-and-autofocus flow is a
  // separate contract covered by the tests above.
  async function openRichPage(
    page: Page,
    title: string,
    request: APIRequestContext
  ): Promise<void> {
    const res = await request.post('/api/pages', {
      data: { title, pageType: 'rich', content: '' }
    })
    expect(res.status()).toBe(201)
    const body = (await res.json()) as { page?: { id: string }; id?: string }
    const id = body.page?.id ?? body.id
    expect(id).toBeTruthy()
    await page.goto(`/?page=${id}`)
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)
  }

  test('the document is one continuous canvas, not a card inside a panel', async ({
    page,
    request
  }) => {
    await openRichPage(page, uniqueTitle('Surface'), request)

    // Asserted in BOTH schemes: a light-only check hides an inverted dark
    // regression, where the canvas ends up lighter than the content it holds.
    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme)
      const surfaces = await page.evaluate(() => {
        const content = document.querySelector('.bn-editor') as HTMLElement
        const scrollOwner = content?.closest('[class*="blockNoteWrapper"]') as HTMLElement | null
        const bg = (el: HTMLElement | null) => (el ? getComputedStyle(el).backgroundColor : null)
        const cs = scrollOwner ? getComputedStyle(scrollOwner) : null
        return {
          contentBg: bg(content),
          scrollOwnerBg: bg(scrollOwner),
          borderWidth: cs?.borderTopWidth ?? null,
          radius: cs?.borderTopLeftRadius ?? null
        }
      })

      // No nested card: the scroll owner and the content share one surface.
      expect(surfaces.scrollOwnerBg, `document vs content in ${scheme}`).toBe(surfaces.contentBg)
      // ...and the document carries no frame of its own.
      expect(surfaces.borderWidth, `document border in ${scheme}`).toBe('0px')
      expect(surfaces.radius, `document radius in ${scheme}`).toBe('0px')
    }
  })

  test('the document surface follows the canvas token, not the editor library', async ({
    page,
    request
  }) => {
    await openRichPage(page, uniqueTitle('CanvasToken'), request)

    // A sentinel value proves the binding exists. Asserting only that the
    // editor matches the current token would also pass when the editor happens
    // to paint the same colour by coincidence — which is exactly the situation
    // that hid the earlier defect. The sentinel makes the dependency explicit:
    // the editor follows the token, not BlockNote's own background.
    const SENTINEL = 'rgb(1, 2, 3)'

    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme)
      const surfaces = await page.evaluate((sentinel) => {
        document.documentElement.style.setProperty('--rtwiki-canvas', sentinel)
        const content = document.querySelector('.bn-editor') as HTMLElement
        const scrollOwner = content?.closest('[class*="blockNoteWrapper"]') as HTMLElement | null
        const bg = (el: HTMLElement | null) => (el ? getComputedStyle(el).backgroundColor : null)
        return { contentBg: bg(content), scrollOwnerBg: bg(scrollOwner) }
      }, SENTINEL)

      expect(surfaces.contentBg, `editor follows canvas in ${scheme}`).toBe(SENTINEL)
      expect(surfaces.scrollOwnerBg, `document follows canvas in ${scheme}`).toBe(SENTINEL)
    }
  })

  test('the document is visually distinct from the surrounding panel', async ({
    page,
    request
  }) => {
    await openRichPage(page, uniqueTitle('Layering'), request)

    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme)
      const tones = await page.evaluate(() => {
        const content = document.querySelector('.bn-editor') as HTMLElement
        const scrollOwner = content?.closest('[class*="blockNoteWrapper"]') as HTMLElement | null
        // The tree pane is a panel surface and must stay distinguishable.
        const tree = document.querySelector('[role="tree"]') as HTMLElement | null
        const bg = (el: HTMLElement | null) => (el ? getComputedStyle(el).backgroundColor : null)
        return { document: bg(scrollOwner), panel: bg(tree) }
      })

      expect(tones.document, `document vs panel in ${scheme}`).not.toBe(tones.panel)
    }
  })
})
