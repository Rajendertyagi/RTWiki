import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'

/**
 * Phase 1 — New Page dialog redesign: layout, responsiveness and keyboard
 * accessibility in a real browser.
 *
 * The dialog used to wrap its four page-type radios 3+1 in a `<Group>`, clip
 * "Revision Sheet" in a full-width `SegmentedControl`, and have no responsive
 * sizing. This spec drives the real UI at four viewports and asserts the
 * replacement 2x2 grids, the responsive modal, and the keyboard contract.
 *
 * Appearance is set through `PUT /api/settings/appearance` and the page is
 * reloaded, matching the API-driven setup used by theme-universal.pwspec.ts.
 */

const PREFIX = 'NewPageLayout'
let seq = 0

function uniqueTitle(caseName: string): string {
  seq += 1
  return `${PREFIX}-${caseName}-${Date.now()}-${seq}`
}

const SCREENSHOT_DIR = 'D:/Coding/OpenCode/user/tmp/opencode/screenshots/dialog-redesign'

interface ViewportCase {
  width: number
  height: number
  name: string
  createType: (typeof PAGE_TYPE_VALUES)[number]
  createTemplate?: (typeof TEMPLATE_KEYS)[number]
}

const VIEWPORTS: ViewportCase[] = [
  { width: 1440, height: 900, name: '1440x900', createType: 'rich', createTemplate: 'revision' },
  { width: 1280, height: 800, name: '1280x800', createType: 'html' },
  { width: 800, height: 528, name: '800x528', createType: 'diagram' },
  { width: 390, height: 844, name: '390x844', createType: 'markdown' }
]

const PAGE_TYPE_LABELS = {
  rich: 'Rich Note',
  html: 'HTML Page',
  diagram: 'Diagram',
  markdown: 'Markdown Page'
} as const

const PAGE_TYPE_VALUES = ['rich', 'html', 'diagram', 'markdown'] as const

const TEMPLATE_KEYS = ['blank', 'subject', 'chapter', 'revision'] as const

const TEMPLATE_LABELS = {
  blank: 'Blank Note',
  subject: 'Subject',
  chapter: 'Chapter / Topic',
  revision: 'Revision Sheet'
} as const

const THEMES = ['default', 'pastel-dreams', 'catppuccin', 'vercel'] as const

interface Appearance {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  contrast: number
  glassOpacity: number
}

interface FocusInfo {
  tag: string
  type: string | null
  ariaLabel: string | null
  testId: string | null
  text: string
  value: string | null
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// API / navigation helpers
// ---------------------------------------------------------------------------

async function setAppearance(
  request: APIRequestContext,
  patch: Partial<Appearance>
): Promise<void> {
  const res = await request.put('/api/settings/appearance', { data: patch })
  expect(res.status(), `PUT /api/settings/appearance ${JSON.stringify(patch)}`).toBe(200)
}

async function openApp(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  // The page tree only mounts once a page exists; the dashboard's create
  // button is always present, so it is the reliable readiness signal.
  await expect(page.getByRole('button', { name: 'Create Rich Note' })).toBeVisible({
    timeout: 20_000
  })
}

async function openDialog(page: Page): Promise<Locator> {
  // The utility-rail "New page" button lives in the sidebar, which becomes an
  // off-viewport drawer at narrow widths. The dashboard's "Create Rich Note"
  // button opens the same dialog and is always visible in the main surface.
  await page.getByRole('button', { name: 'Create Rich Note' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Mantine's modal opens with a ~200ms scale/translate transition. A full-screen
  // dialog starts a few pixels above the viewport mid-transition, so let it
  // settle before any geometry is measured.
  await page.waitForTimeout(300)
  return dialog
}

async function countPagesWithTitle(request: APIRequestContext, title: string): Promise<number> {
  const res = await request.get(`/api/pages?q=${encodeURIComponent(title)}&limit=100`)
  expect(res.ok()).toBe(true)
  const body = (await res.json()) as { pages: Array<{ title: string }> }
  return body.pages.filter((p) => p.title === title).length
}

// ---------------------------------------------------------------------------
// Browser-side measurement helpers
// ---------------------------------------------------------------------------

async function boxesOf(items: Locator): Promise<Box[]> {
  return items.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
  )
}

/** Asserts four items sit in two rows of two (4px y tolerance for sub-pixel alignment). */
function assertTwoByTwo(boxes: Box[], label: string): void {
  expect(boxes, `${label}: four items`).toHaveLength(4)
  const rows: Array<{ y: number; count: number }> = []
  for (const box of boxes) {
    const row = rows.find((candidate) => Math.abs(candidate.y - box.y) <= 4)
    if (row) row.count += 1
    else rows.push({ y: box.y, count: 1 })
  }
  expect(rows, `${label}: two distinct rows`).toHaveLength(2)
  for (const row of rows) {
    expect(row.count, `${label}: two items per row (y=${Math.round(row.y)})`).toBe(2)
  }
}

async function focusedInfo(page: Page): Promise<FocusInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) {
      return { tag: '', type: null, ariaLabel: null, testId: null, text: '', value: null }
    }
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      ariaLabel: el.getAttribute('aria-label'),
      testId: el.getAttribute('data-testid'),
      text: (el.textContent ?? '').trim(),
      value: el instanceof HTMLInputElement ? el.value : null
    }
  })
}

async function assertFocusRing(page: Page, label: string): Promise<void> {
  const style = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return null
    const cs = getComputedStyle(el)
    return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow }
  })
  if (style === null) throw new Error(`${label}: a focused element must exist`)
  const hasOutline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
  const hasShadow = style.boxShadow !== 'none' && style.boxShadow !== ''
  expect(hasOutline || hasShadow, `${label}: focus indicator must be visible`).toBe(true)
}

// ---------------------------------------------------------------------------
// Layout assertions
// ---------------------------------------------------------------------------

async function assertLayout(page: Page, dialog: Locator, label: string): Promise<void> {
  // Four page-type radios in a balanced 2x2 grid.
  const radios = dialog.getByRole('radio')
  await expect(radios, `${label}: four radios`).toHaveCount(4)
  assertTwoByTwo(await boxesOf(radios), `${label} page-type radios`)

  // Four template buttons in a balanced 2x2 grid, each label fully visible.
  const templates = dialog.locator('[data-testid^="new-page-template-"]')
  await expect(templates, `${label}: four templates`).toHaveCount(4)
  assertTwoByTwo(await boxesOf(templates), `${label} templates`)

  for (const key of TEMPLATE_KEYS) {
    const button = dialog.getByTestId(`new-page-template-${key}`)
    await expect(button, `${label}: ${key} label`).toHaveText(TEMPLATE_LABELS[key])
    const metrics = await button.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth
    }))
    expect(
      metrics.scrollWidth,
      `${label}: "${TEMPLATE_LABELS[key]}" must not be clipped (scrollWidth <= clientWidth)`
    ).toBeLessThanOrEqual(metrics.clientWidth)
  }

  // No horizontal overflow inside the dialog.
  const overflow = await dialog.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth
  }))
  expect(
    overflow.scrollWidth,
    `${label}: dialog must not overflow horizontally`
  ).toBeLessThanOrEqual(overflow.clientWidth)

  // The modal fits the viewport (Mantine gives its body internal overflow-y:auto).
  const box = await dialog.boundingBox()
  if (box === null) throw new Error(`${label}: dialog must have a bounding box`)
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error(`${label}: viewport size`)
  expect(box.x, `${label}: dialog left edge`).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width, `${label}: dialog right edge`).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y, `${label}: dialog top edge`).toBeGreaterThanOrEqual(-1)
  expect(box.y + box.height, `${label}: dialog bottom edge`).toBeLessThanOrEqual(
    viewport.height + 1
  )
}

// ---------------------------------------------------------------------------
// Keyboard / accessibility assertions
// ---------------------------------------------------------------------------

async function assertKeyboardContract(page: Page, dialog: Locator, label: string): Promise<void> {
  // The title owns initial focus via data-autofocus + autoFocus.
  await expect
    .poll(() => focusedInfo(page), { message: `${label}: title must own initial focus` })
    .toMatchObject({ tag: 'input', ariaLabel: 'Title' })

  // Tab from the title enters the page-type radio group at the checked radio.
  await page.keyboard.press('Tab')
  let focus = await focusedInfo(page)
  expect(focus.type, `${label}: Tab from title must land on a radio`).toBe('radio')

  // Native radio groups expose one tab stop; arrow keys reach all four options.
  for (const [index, value] of PAGE_TYPE_VALUES.entries()) {
    if (index > 0) await page.keyboard.press('ArrowRight')
    focus = await focusedInfo(page)
    expect(focus.value, `${label}: arrow key must focus ${value}`).toBe(value)
    await expect(
      dialog.getByRole('radio', { name: PAGE_TYPE_LABELS[value] }),
      `${label}: ${value} must be selected`
    ).toBeChecked()
  }
  await assertFocusRing(page, `${label} focused radio`)

  // Return to Rich Note so the template grid is present, then Tab into it.
  // ArrowLeft is used rather than Home because Mantine's Radio.Group does not
  // implement Home/End; three left arrows reverse the three right arrows above.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowLeft')
  focus = await focusedInfo(page)
  expect(focus.value, `${label}: ArrowLeft must return to rich`).toBe('rich')

  await page.keyboard.press('Tab')
  focus = await focusedInfo(page)
  expect(focus.testId, `${label}: Tab must enter the template grid`).toBe('new-page-template-blank')
  await assertFocusRing(page, `${label} focused template button`)

  for (const key of TEMPLATE_KEYS.slice(1)) {
    await page.keyboard.press('Tab')
    focus = await focusedInfo(page)
    expect(focus.testId, `${label}: Tab must reach template ${key}`).toBe(
      `new-page-template-${key}`
    )
  }

  // Tab leaves the grid to Cancel, then Create.
  await page.keyboard.press('Tab')
  focus = await focusedInfo(page)
  expect(focus.text, `${label}: Tab must reach Cancel`).toBe('Cancel')

  await page.keyboard.press('Tab')
  focus = await focusedInfo(page)
  expect(focus.text, `${label}: Tab must reach Create`).toBe('Create')
}

async function assertKeyboardSelection(page: Page, dialog: Locator, label: string): Promise<void> {
  // Space selects a focused radio.
  await dialog.getByRole('radio', { name: PAGE_TYPE_LABELS.diagram }).focus()
  await page.keyboard.press('Space')
  await expect(
    dialog.getByRole('radio', { name: PAGE_TYPE_LABELS.diagram }),
    `${label}: Space must select the Diagram radio`
  ).toBeChecked()

  // Back to Rich Note so the template buttons exist.
  await dialog.getByRole('radio', { name: PAGE_TYPE_LABELS.rich }).check()

  // Enter activates a focused template toggle button.
  const subject = dialog.getByTestId('new-page-template-subject')
  await subject.focus()
  await page.keyboard.press('Enter')
  await expect(subject, `${label}: Enter must select the Subject template`).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  // Space activates a focused template toggle button.
  const chapter = dialog.getByTestId('new-page-template-chapter')
  await chapter.focus()
  await page.keyboard.press('Space')
  await expect(chapter, `${label}: Space must select the Chapter template`).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(subject, `${label}: only one template stays selected`).toHaveAttribute(
    'aria-pressed',
    'false'
  )
}

// ---------------------------------------------------------------------------
// Creation helper
// ---------------------------------------------------------------------------

async function createPage(
  page: Page,
  request: APIRequestContext,
  title: string,
  pageType: (typeof PAGE_TYPE_VALUES)[number],
  template?: (typeof TEMPLATE_KEYS)[number]
): Promise<void> {
  const dialog = await openDialog(page)
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByRole('radio', { name: PAGE_TYPE_LABELS[pageType] }).check()
  if (pageType === 'rich' && template) {
    await dialog.getByTestId(`new-page-template-${template}`).click()
  }
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => countPagesWithTitle(request, title), { timeout: 10_000 }).toBe(1)
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.afterEach(async ({ request }) => {
  const res = await request.get(`/api/pages?q=${PREFIX}&limit=100`)
  const body = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  for (const p of body.pages) {
    if (p.title.startsWith(PREFIX)) await request.delete(`/api/pages/${p.id}`)
  }
})

// ===========================================================================
// Per-viewport layout + accessibility + screenshots + one creation
// ===========================================================================

test.describe('New Page dialog redesign', () => {
  for (const viewport of VIEWPORTS) {
    test(`layout, keyboard access and creation at ${viewport.name}`, async ({ page, request }) => {
      test.setTimeout(120_000)
      const label = viewport.name

      await setAppearance(request, {
        themeId: 'default',
        colorScheme: 'light',
        contrast: 100,
        glassOpacity: 100
      })
      await openApp(page, viewport.width, viewport.height)

      let dialog = await openDialog(page)
      await assertLayout(page, dialog, `${label} light`)
      await assertKeyboardContract(page, dialog, `${label} light`)
      await assertKeyboardSelection(page, dialog, `${label} light`)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${label}-light.png` })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // Dark scheme: same layout, captured after a reload so the pre-paint
      // bootstrap applies the new scheme exactly as on a cold start.
      await setAppearance(request, { colorScheme: 'dark' })
      await page.reload()
      await expect(page.getByRole('button', { name: 'Create Rich Note' })).toBeVisible({
        timeout: 20_000
      })
      dialog = await openDialog(page)
      await assertLayout(page, dialog, `${label} dark`)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${label}-dark.png` })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // Cycle every page type and every template at this viewport, then create
      // one page of the type assigned to this viewport. Across the four
      // viewports this covers all four types and all four templates.
      dialog = await openDialog(page)
      for (const value of PAGE_TYPE_VALUES) {
        await dialog.getByRole('radio', { name: PAGE_TYPE_LABELS[value] }).check()
        await expect(
          dialog.getByRole('radio', { name: PAGE_TYPE_LABELS[value] }),
          `${label}: ${value} selectable`
        ).toBeChecked()
      }
      await dialog.getByRole('radio', { name: PAGE_TYPE_LABELS.rich }).check()
      for (const key of TEMPLATE_KEYS) {
        const button = dialog.getByTestId(`new-page-template-${key}`)
        await button.click()
        await expect(button, `${label}: template ${key} selectable`).toHaveAttribute(
          'aria-pressed',
          'true'
        )
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      const title = uniqueTitle(viewport.name.replace('x', '-'))
      await createPage(page, request, title, viewport.createType, viewport.createTemplate)
    })
  }

  test('all four themes at 390x844', async ({ page, request }) => {
    test.setTimeout(120_000)
    await setAppearance(request, { colorScheme: 'light', contrast: 100, glassOpacity: 100 })
    for (const themeId of THEMES) {
      await setAppearance(request, { themeId })
      await openApp(page, 390, 844)
      const dialog = await openDialog(page)
      await assertLayout(page, dialog, `390x844 ${themeId}`)
      await page.screenshot({ path: `${SCREENSHOT_DIR}/390x844-theme-${themeId}.png` })
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
  })
})
