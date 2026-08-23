import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Core-only drag-and-drop proof of concept (pragmatic-drag-and-drop).
 *
 * Drags are performed with real pointer events so Chromium's native HTML5
 * drag pipeline fires, which is what pragmatic-drag-and-drop listens to.
 * Vertical drop position inside a row selects the hand-maintained edge
 * geometry: top third = before, middle = inside, bottom third = after.
 *
 * Every hierarchy assertion reads server truth from the API; the UI is
 * only used to perform drags and observe indicators/focus.
 */

interface SeededPage {
  id: string
  title: string
}

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  parentId: string | null = null
): Promise<SeededPage> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: '', parentId }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: SeededPage }
  return body.page
}

async function listPages(
  request: APIRequestContext
): Promise<Array<{ id: string; title: string; parentId: string | null; position: number }>> {
  const res = await request.get('/api/pages')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as {
    pages: Array<{ id: string; title: string; parentId: string | null; position: number }>
  }
  return body.pages
}

function rowLocator(page: Page, pageId: string) {
  return page.locator(`[role="treeitem"][data-page-id="${pageId}"]`)
}

/**
 * Drags the source row onto the target row at the given vertical fraction
 * of the target's height (0.1 = before, 0.5 = inside, 0.9 = after).
 */
async function dragRowOnto(
  page: Page,
  sourceId: string,
  targetId: string,
  fractionY: number
): Promise<void> {
  const source = rowLocator(page, sourceId)
  const target = rowLocator(page, targetId)
  await target.scrollIntoViewIfNeeded()
  // Vertical fraction maps onto the hand-maintained edge geometry
  // (top third = before, middle = inside, bottom third = after).
  const box = await target.boundingBox()
  if (!box) {
    throw new Error('target row is not visible')
  }
  await source.dragTo(target, {
    targetPosition: {
      x: Math.round(box.width / 2),
      y: Math.max(2, Math.round(box.height * fractionY))
    }
  })
}

/** Expands a collapsed parent row so its children become visible. */
async function expandRow(page: Page, pageId: string): Promise<void> {
  const row = rowLocator(page, pageId)
  await row.scrollIntoViewIfNeeded()
  const expand = row.locator('[aria-label="Expand"]')
  if ((await expand.count()) > 0) {
    await expand.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}

async function waitForServerOrder(
  request: APIRequestContext,
  expectedIds: string[]
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await listPages(request))
          .filter((page) => expectedIds.includes(page.id))
          .sort((x, y) => x.position - y.position)
          .map((page) => page.id),
      { timeout: 10_000 }
    )
    .toEqual(expectedIds)
}

/** Asserts the full server page list is byte-identical to the snapshot. */
async function expectUnchanged(request: APIRequestContext, snapshot: string): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
    .toBe(snapshot)
}

test.describe('Page tree drag-and-drop (core-only POC)', () => {
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

  test('reorders roots by dropping before a sibling', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('RootA'))
    const b = await seedPage(request, uniqueTitle('RootB'))
    const c = await seedPage(request, uniqueTitle('RootC'))
    await page.goto('/')
    await rowLocator(page, c.id).waitFor()
    await dragRowOnto(page, c.id, a.id, 0.1)
    await waitForServerOrder(request, [c.id, a.id, b.id])
  })

  test('reorders siblings by dropping after a sibling', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('SibA'))
    const b = await seedPage(request, uniqueTitle('SibB'))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    // Drag the FIRST root after the second: [A,B] -> [B,A].
    await dragRowOnto(page, a.id, b.id, 0.9)
    await waitForServerOrder(request, [b.id, a.id])
  })

  test('drops inside a sibling to reparent across levels', async ({ page, request }) => {
    const parent = await seedPage(request, uniqueTitle('Parent'))
    const child = await seedPage(request, uniqueTitle('Child'), parent.id)
    const other = await seedPage(request, uniqueTitle('Other'))
    await page.goto('/')
    await expandRow(page, parent.id)
    await rowLocator(page, other.id).waitFor()
    await dragRowOnto(page, other.id, child.id, 0.5)
    const pages = await listPages(request)
    const moved = pages.find((p) => p.id === other.id)
    expect(moved?.parentId).toBe(child.id)
  })

  test('reorders nested siblings inside a parent', async ({ page, request }) => {
    const root = await seedPage(request, uniqueTitle('NestedRoot'))
    const c1 = await seedPage(request, uniqueTitle('C1'), root.id)
    const c2 = await seedPage(request, uniqueTitle('C2'), root.id)
    await page.goto('/')
    await expandRow(page, root.id)
    await rowLocator(page, c2.id).waitFor()
    await dragRowOnto(page, c2.id, c1.id, 0.1)
    const pages = await listPages(request)
    const kids = pages
      .filter((p) => p.parentId === root.id)
      .sort((x, y) => x.position - y.position)
      .map((p) => p.id)
    expect(kids).toEqual([c2.id, c1.id])
  })

  test('drop inside works while the target parent row is collapsed', async ({ page, request }) => {
    const root = await seedPage(request, uniqueTitle('CollapsedRoot'))
    await seedPage(request, uniqueTitle('HiddenKid'), root.id)
    const mover = await seedPage(request, uniqueTitle('Mover'))
    await page.goto('/')
    await rowLocator(page, mover.id).waitFor()
    // Parents start collapsed; confirm before dropping into the hidden tree.
    await expect(rowLocator(page, root.id)).toHaveAttribute('aria-expanded', 'false')
    await dragRowOnto(page, mover.id, root.id, 0.5)
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === mover.id)?.parentId).toBe(root.id)
  })

  test('self-drop leaves the hierarchy unchanged', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('SelfA'))
    const before = await listPages(request)
    await page.goto('/')
    await rowLocator(page, a.id).waitFor()
    await dragRowOnto(page, a.id, a.id, 0.5)
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('dropping a parent onto its own descendant is rejected', async ({ page, request }) => {
    const root = await seedPage(request, uniqueTitle('DescRoot'))
    const kid = await seedPage(request, uniqueTitle('DescKid'), root.id)
    const before = await listPages(request)
    await page.goto('/')
    // Expand the collapsed root so the child row is visible.
    await rowLocator(page, root.id).locator('[aria-label="Expand"]').click()
    await rowLocator(page, kid.id).waitFor()
    await dragRowOnto(page, root.id, kid.id, 0.5)
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('escape mid-drag cancels without changing the hierarchy', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('EscA'))
    const b = await seedPage(request, uniqueTitle('EscB'))
    const before = await listPages(request)
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    const sourceBox = await rowLocator(page, b.id).boundingBox()
    const targetBox = await rowLocator(page, a.id).boundingBox()
    if (!sourceBox || !targetBox) {
      throw new Error('drag rows are not visible')
    }
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 10 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('native non-tree drops are ignored', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('ExtA'))
    const before = await listPages(request)
    await page.goto('/')
    await rowLocator(page, a.id).waitFor()
    // Dispatch a foreign-native drop carrying plain text (no tree payload).
    await rowLocator(page, a.id).evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'external')
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('failed server move rolls back the optimistic arrangement', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('RbA'))
    const b = await seedPage(request, uniqueTitle('RbB'))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    const before = await listPages(request)
    await page.route('**/api/pages/*/move', (route) => route.abort())
    await dragRowOnto(page, b.id, a.id, 0.1)
    // Optimistic arrangement applied then rolled back to the pre-drag order.
    await expect
      .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
      .toBe(JSON.stringify(before))
    await page.unroute('**/api/pages/*/move')
  })

  test('focus returns to the moved row after a successful drop', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('FocA'))
    const b = await seedPage(request, uniqueTitle('FocB'))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    await dragRowOnto(page, b.id, a.id, 0.1)
    await waitForServerOrder(request, [b.id, a.id])
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null
          return el?.getAttribute?.('data-page-id') ?? null
        })
      )
      .toBe(b.id)
  })

  test('dragging preserves the active open page and fires no PATCH', async ({ page, request }) => {
    const patchCalls: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patchCalls.push(req.url())
    })
    const a = await seedPage(request, uniqueTitle('ActA'))
    const b = await seedPage(request, uniqueTitle('ActB'))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    // Open page A so it becomes the active selection with its editor mounted:
    // clicking the focused row and pressing Enter follows the tree pattern.
    await rowLocator(page, a.id).click()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await dragRowOnto(page, b.id, a.id, 0.9)
    await waitForServerOrder(request, [a.id, b.id])
    // Active page unchanged: editor still mounted for A and A still selected.
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await expect(rowLocator(page, a.id)).toHaveAttribute('aria-selected', 'true')
    expect(patchCalls).toEqual([])
  })

  test('works in the narrow sidebar layout', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('NarA'))
    const b = await seedPage(request, uniqueTitle('NarB'))
    // Narrow-but-visible: Mantine's 'sm' breakpoint (768px) hides the
    // navbar below it, so 800px exercises the most compact layout in
    // which the persistent sidebar remains on screen.
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    await dragRowOnto(page, b.id, a.id, 0.1)
    await waitForServerOrder(request, [b.id, a.id])
  })
})
