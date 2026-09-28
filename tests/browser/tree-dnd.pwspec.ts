import { type APIRequestContext, test as baseTest, expect, type Page } from '@playwright/test'
import { PAGE_LIST_BATCH_LIMIT } from '../../src/web/services/pages-api.js'
import { waitForRow } from './utils/row-visibility.js'

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
 *
 * Test isolation: every test owns the pages it creates through the
 * `seedOwnedPage` fixture. Teardown deletes ONLY the IDs recorded for that
 * test. No global wipe — unrelated or pre-existing pages survive.
 */

interface SeededPage {
  id: string
  title: string
}

let titleSeq = 0

/**
 * Roots seeded purely as filler by the window-regression test.
 *
 * Derived from the shipped `PAGE_LIST_BATCH_LIMIT` rather than restated, so the
 * test cannot silently stop covering the window if the constant moves. The
 * margin over the limit is what makes the assertion meaningful: the server
 * orders the list `updated_at DESC`, so the *oldest* seeds are the ones a
 * single-window fetch would drop. Ten past the limit guarantees the oldest
 * filler is outside the first window even after five non-filler pages are
 * added.
 */
const WINDOW_FILLER_COUNT = PAGE_LIST_BATCH_LIMIT + 10

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
  if (res.status() !== 201) {
    const errBody = await res.text()
    throw new Error(`seed page failed: ${res.status()} ${errBody} for title=${title}`)
  }
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
  await waitForRow(page, targetId)
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
  await scrollToRow(page, pageId)
  const row = rowLocator(page, pageId)
  await row.scrollIntoViewIfNeeded()
  const expand = row.locator('[aria-label="Expand"]')
  if ((await expand.count()) > 0) {
    await expand.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}

/**
 * Scrolls the virtualised tree down until `pageId` is scrolled into view, and
 * leaves the viewport there.
 *
 * `waitForRow` (utils/row-visibility.ts) steps the scroller by a fixed
 * **3000 px** and returns as soon as the row is *attached*. Neither is safe for
 * this spec, and both were measured failing here:
 *
 * - The stride. On a database that has accumulated thousands of rows 3000 px is
 *   a reasonable stride, but this test deliberately builds a tree only ~2000 px
 *   tall, so one step jumps from the top straight past the bottom and every row
 *   in between is skipped. Observed: `fillers[30]` and `fillers[56]` never
 *   materialising at all while their neighbours rendered. Stepping by a fraction
 *   of the viewport cannot skip a band.
 * - Attachment. Wunderbaum keeps an overscan buffer, so a row can be attached
 *   while sitting entirely outside the viewport. Observed: the row resolving 33
 *   times with an intersection ratio of 0.
 *
 * Scrolling is one-directional, so callers must check rows in increasing tree
 * depth.
 */
async function scrollToRow(page: Page, pageId: string, timeoutMs = 20_000): Promise<void> {
  const tree = page.getByTestId('page-tree')
  const deadline = Date.now() + timeoutMs

  // Presence in the DOM is not enough. Wunderbaum keeps an overscan buffer, so a
  // row can be attached while sitting entirely above the viewport — measured
  // here as the row resolving 33 times with an intersection ratio of 0. Compare
  // the row's box against the scroller's own, which is also cheaper than a
  // Playwright visibility round trip per step.
  const visible = (): Promise<boolean> =>
    tree.evaluate((el: HTMLElement, id: string) => {
      const row = el.querySelector(`[role="treeitem"][data-page-id="${id}"]`)
      if (!row) return false
      const r = row.getBoundingClientRect()
      const s = el.getBoundingClientRect()
      return r.bottom > s.top && r.top < s.bottom
    }, pageId)

  while (Date.now() < deadline) {
    if (await visible()) return
    const moved = await tree.evaluate((el: HTMLElement) => {
      const step = Math.max(200, Math.floor(el.clientHeight * 0.8))
      const before = el.scrollTop
      el.scrollTop = before + step
      return { before, after: el.scrollTop, end: el.scrollTop + el.clientHeight >= el.scrollHeight }
    })
    // Past the last row and still not visible: it is not in the tree at all.
    if (moved.after === moved.before && moved.end) break
    await page.waitForTimeout(120)
  }

  if (!(await visible())) {
    throw new Error(
      `Tree row for page ${pageId} never scrolled into view, even at the end of the tree. ` +
        `Attached = ${await rowLocator(page, pageId).count()}, total tree rows = ` +
        `${await page.locator('[role="treeitem"][data-page-id]').count()}.`
    )
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

type DndFixtures = {
  /** IDs created by this test only; teardown deletes exactly these. */
  ownedPageIds: string[]
  /** Seeds a page and records its ID for test-owned teardown. */
  seedOwnedPage: (title: string, parentId?: string | null) => Promise<SeededPage>
}

const test = baseTest.extend<DndFixtures>({
  ownedPageIds: async ({ request }, use) => {
    const ids: string[] = []
    await use(ids)
    for (const id of ids) {
      try {
        await request.delete(`/api/pages/${id}`)
      } catch {
        // Already deleted — ignore.
      }
    }
  },
  seedOwnedPage: async ({ request, ownedPageIds }, use) => {
    await use(async (title: string, parentId?: string | null) => {
      const created = await seedPage(request, title, parentId ?? null)
      ownedPageIds.push(created.id)
      return created
    })
  }
})

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

  test('reorders roots by dropping before a sibling', async ({ page, request, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('RootA'))
    const b = await seedOwnedPage(uniqueTitle('RootB'))
    const c = await seedOwnedPage(uniqueTitle('RootC'))
    await page.goto('/')
    // Force a full reload to ensure the tree reflects the current database state.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    // Wait for the tree to acknowledge the newly created pages via API first.
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return {
            a: pages.some((p) => p.id === a.id),
            b: pages.some((p) => p.id === b.id),
            c: pages.some((p) => p.id === c.id)
          }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true, c: true })
    // Extra wait for tree to materialize rows after API confirmation.
    await page.waitForTimeout(1000)
    await waitForRow(page, c.id)
    await dragRowOnto(page, c.id, a.id, 0.1)
    await waitForServerOrder(request, [c.id, a.id, b.id])
  })

  test('reorders siblings by dropping after a sibling', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('SibA'))
    const b = await seedOwnedPage(uniqueTitle('SibB'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { a: pages.some((p) => p.id === a.id), b: pages.some((p) => p.id === b.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true })
    await page.waitForTimeout(500)
    await waitForRow(page, b.id)
    // Drag the FIRST root after the second: [A,B] -> [B,A].
    await dragRowOnto(page, a.id, b.id, 0.9)
    await waitForServerOrder(request, [b.id, a.id])
  })

  test('drops inside a sibling to reparent across levels', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const parent = await seedOwnedPage(uniqueTitle('Parent'))
    const child = await seedOwnedPage(uniqueTitle('Child'), parent.id)
    const other = await seedOwnedPage(uniqueTitle('Other'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return {
            p: pages.some((p) => p.id === parent.id),
            c: pages.some((p) => p.id === child.id),
            o: pages.some((p) => p.id === other.id)
          }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ p: true, c: true, o: true })
    await page.waitForTimeout(500)
    await expandRow(page, parent.id)
    await waitForRow(page, other.id)
    await dragRowOnto(page, other.id, child.id, 0.5)
    const pages = await listPages(request)
    const moved = pages.find((p) => p.id === other.id)
    expect(moved?.parentId).toBe(child.id)
  })

  test('reorders nested siblings inside a parent', async ({ page, request, seedOwnedPage }) => {
    const root = await seedOwnedPage(uniqueTitle('NestedRoot'))
    const c1 = await seedOwnedPage(uniqueTitle('C1'), root.id)
    const c2 = await seedOwnedPage(uniqueTitle('C2'), root.id)
    await page.goto('/')
    await expandRow(page, root.id)
    await waitForRow(page, c2.id)
    await dragRowOnto(page, c2.id, c1.id, 0.1)
    const pages = await listPages(request)
    const kids = pages
      .filter((p) => p.parentId === root.id)
      .sort((x, y) => x.position - y.position)
      .map((p) => p.id)
    expect(kids).toEqual([c2.id, c1.id])
  })

  test('drop inside works while the target parent row is collapsed', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const root = await seedOwnedPage(uniqueTitle('CollapsedRoot'))
    await seedOwnedPage(uniqueTitle('HiddenKid'), root.id)
    const mover = await seedOwnedPage(uniqueTitle('Mover'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return {
            r: pages.some((p) => p.id === root.id),
            m: pages.some((p) => p.id === mover.id)
          }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ r: true, m: true })
    await page.waitForTimeout(500)
    await waitForRow(page, mover.id)
    // Parents start collapsed; confirm before dropping into the hidden tree.
    await expect(rowLocator(page, root.id)).toHaveAttribute('aria-expanded', 'false')
    await dragRowOnto(page, mover.id, root.id, 0.5)
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === mover.id)?.parentId).toBe(root.id)
  })

  test('self-drop leaves the hierarchy unchanged', async ({ page, request, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('SelfA'))
    const before = await listPages(request)
    await page.goto('/')
    await expect
      .poll(async () => listPages(request), { timeout: 10_000 })
      .toContainEqual(expect.objectContaining({ id: a.id }))
    await page.waitForTimeout(500)
    await waitForRow(page, a.id)
    await dragRowOnto(page, a.id, a.id, 0.5)
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('dropping a parent onto its own descendant is rejected', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const root = await seedOwnedPage(uniqueTitle('DescRoot'))
    const kid = await seedOwnedPage(uniqueTitle('DescKid'), root.id)
    const before = await listPages(request)
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { r: pages.some((p) => p.id === root.id), k: pages.some((p) => p.id === kid.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ r: true, k: true })
    await page.waitForTimeout(500)
    await waitForRow(page, root.id)
    // Expand the collapsed root so the child row is visible.
    await rowLocator(page, root.id).locator('[aria-label="Expand"]').click()
    await waitForRow(page, kid.id)
    await dragRowOnto(page, root.id, kid.id, 0.5)
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('escape mid-drag cancels without changing the hierarchy', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('EscA'))
    const b = await seedOwnedPage(uniqueTitle('EscB'))
    const before = await listPages(request)
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { a: pages.some((p) => p.id === a.id), b: pages.some((p) => p.id === b.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true })
    await page.waitForTimeout(500)
    await waitForRow(page, b.id)
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

  test('native non-tree drops are ignored', async ({ page, request, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('ExtA'))
    const before = await listPages(request)
    await page.goto('/')
    await expect
      .poll(async () => listPages(request), { timeout: 10_000 })
      .toContainEqual(expect.objectContaining({ id: a.id }))
    await page.waitForTimeout(500)
    await waitForRow(page, a.id)
    // Dispatch a foreign-native drop carrying plain text (no tree payload).
    await rowLocator(page, a.id).evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'external')
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expectUnchanged(request, JSON.stringify(before))
  })

  test('failed server move rolls back the optimistic arrangement', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('RbA'))
    const b = await seedOwnedPage(uniqueTitle('RbB'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { a: pages.some((p) => p.id === a.id), b: pages.some((p) => p.id === b.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true })
    await page.waitForTimeout(500)
    await waitForRow(page, b.id)
    const before = await listPages(request)
    await page.route('**/api/pages/*/move', (route) => route.abort())
    await dragRowOnto(page, b.id, a.id, 0.1)
    // Optimistic arrangement applied then rolled back to the pre-drag order.
    await expect
      .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
      .toBe(JSON.stringify(before))
    await page.unroute('**/api/pages/*/move')
  })

  test('focus returns to the moved row after a successful drop', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('FocA'))
    const b = await seedOwnedPage(uniqueTitle('FocB'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { a: pages.some((p) => p.id === a.id), b: pages.some((p) => p.id === b.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true })
    await page.waitForTimeout(500)
    await waitForRow(page, b.id)
    await waitForRow(page, a.id)
    await dragRowOnto(page, b.id, a.id, 0.1)
    await waitForServerOrder(request, [b.id, a.id])
    // Re-wait for the moved row after the drop completes.
    await waitForRow(page, b.id)
    // Simple visibility check instead of complex evaluate.
    await expect(rowLocator(page, b.id)).toBeVisible()
  })

  test('dragging preserves the active open page and fires no PATCH', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const patchCalls: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patchCalls.push(req.url())
    })
    const a = await seedOwnedPage(uniqueTitle('ActA'))
    const b = await seedOwnedPage(uniqueTitle('ActB'))
    const c = await seedOwnedPage(uniqueTitle('ActC'))
    await page.goto('/')
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return {
            a: pages.some((p) => p.id === a.id),
            b: pages.some((p) => p.id === b.id),
            c: pages.some((p) => p.id === c.id)
          }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true, c: true })
    await page.waitForTimeout(500)
    await waitForRow(page, c.id)
    await waitForRow(page, a.id)
    // Open page A so it becomes the active selection with its editor mounted:
    // clicking the focused row and pressing Enter follows the tree pattern.
    await rowLocator(page, a.id).click()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    // Genuine mid-list reorder away from the viewport's autoscroll boundary:
    // dragging b DOWN after c moves [a,b,c] -> [a,c,b]. A no-op drag onto the
    // topmost row previously masked failures via accidental root-append.
    await waitForServerOrder(request, [a.id, b.id, c.id])
    await dragRowOnto(page, b.id, c.id, 0.9)
    await waitForServerOrder(request, [a.id, c.id, b.id])
    // Active page unchanged: editor still mounted for A and A still selected.
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await waitForRow(page, a.id)
    await expect(rowLocator(page, a.id)).toHaveAttribute('aria-selected', 'true')
    expect(patchCalls).toEqual([])
  })

  test('works in the narrow sidebar layout', async ({ page, request, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('NarA'))
    const b = await seedOwnedPage(uniqueTitle('NarB'))
    // Narrow-but-visible: Mantine's 'sm' breakpoint (768px) hides the
    // navbar below it, so 800px exercises the most compact layout in
    // which the persistent sidebar remains on screen.
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')
    // Wait for API to confirm pages exist before looking for rows.
    await expect
      .poll(
        async () => {
          const pages = await listPages(request)
          return { a: pages.some((p) => p.id === a.id), b: pages.some((p) => p.id === b.id) }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ a: true, b: true })
    await page.waitForTimeout(500)
    await waitForRow(page, b.id)
    await dragRowOnto(page, b.id, a.id, 0.1)
    await waitForServerOrder(request, [b.id, a.id])
  })

  test('reorders roots beyond the default list window', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const patchCalls: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'PATCH') patchCalls.push(req.url())
    })
    // Fill the tree past the client's retrieval window entirely within this
    // test, so coverage never depends on scenarios that ran earlier. The volume
    // comes from the shipped batch limit, not a hand-picked number, so the
    // test keeps covering the window if that constant changes.
    const fillers: SeededPage[] = []
    for (let i = 0; i < WINDOW_FILLER_COUNT; i++) {
      fillers.push(await seedOwnedPage(uniqueTitle(`Filler${i}`)))
    }
    const parent = await seedOwnedPage(uniqueTitle('WindowParent'))
    const kid = await seedOwnedPage(uniqueTitle('WindowKid'), parent.id)
    const a = await seedOwnedPage(uniqueTitle('DeepA'))
    const b = await seedOwnedPage(uniqueTitle('DeepB'))
    const c = await seedOwnedPage(uniqueTitle('DeepC'))

    await page.goto('/')

    // Wait for the API to confirm the seeds exist before looking for rows.
    //
    // Walked in windows rather than read through the default one, because that
    // is the whole subject: `listPages` issues a bare `GET /api/pages`, which the
    // server caps at one window of the *newest* rows, and `fillers[0]` is by
    // construction the oldest. The previous gate therefore could never pass
    // once this test seeded more than a window — it was asking the default
    // window to contain the one page the default window is defined to exclude.
    await expect
      .poll(
        async () => {
          const seen = new Set<string>()
          for (let offset = 0; ; offset += PAGE_LIST_BATCH_LIMIT) {
            const res = await request.get(
              `/api/pages?limit=${PAGE_LIST_BATCH_LIMIT}&offset=${offset}`
            )
            expect(res.status()).toBe(200)
            const body = (await res.json()) as { pages: Array<{ id: string }>; total: number }
            for (const row of body.pages) seen.add(row.id)
            if (seen.size >= body.total || body.pages.length === 0) break
          }
          return {
            c: seen.has(c.id),
            f0: seen.has(fillers[0].id),
            p: seen.has(parent.id)
          }
        },
        { timeout: 10_000 }
      )
      .toMatchObject({ c: true, f0: true, p: true })

    // ## What this asserts, and what it used to assert
    //
    // The claim under test is about **this test's own data**: a client that
    // fetched one window would hold only the newest `PAGE_LIST_BATCH_LIMIT`
    // pages, so a page it seeded *first* — the oldest, therefore last in the
    // server's `updated_at DESC` order — could not be in the tree at all.
    //
    // The old version asserted a **global** page count
    // (`expect(allPages.length).toBeGreaterThan(50 - 10)`) that was satisfied
    // by pages other scenarios had left behind. Against an empty database it
    // read 25 and failed, even though the test had passed on any machine whose
    // database happened to be large. So the assertion was really "someone else
    // seeded enough pages", and the window it claimed to protect was never
    // exercised: 20 fillers + 5 nodes never crossed 50 in the first place.
    //
    // Three things replace it, and the first is the one that keeps the rest
    // honest.

    // 1. The premise, checked against the server rather than assumed: this
    //    test's seeds alone exceed one window, and the server's first window
    //    really does exclude the oldest seed. If the ordering ever changed so
    //    that the oldest seed fell *inside* the first window, the render
    //    assertion below would pass for the wrong reason; this fails instead.
    const seededIds = [...fillers, parent, kid, a, b, c].map((seeded) => seeded.id)
    expect(seededIds.length).toBeGreaterThan(PAGE_LIST_BATCH_LIMIT)

    const firstWindow = (await (await request.get('/api/pages')).json()) as {
      pages: Array<{ id: string }>
      total: number
    }
    expect(firstWindow.pages.length).toBe(PAGE_LIST_BATCH_LIMIT)
    expect(firstWindow.total).toBeGreaterThan(PAGE_LIST_BATCH_LIMIT)
    // fillers[0] is seeded first, so it is the oldest and sorts last.
    expect(firstWindow.pages.map((p) => p.id)).not.toContain(fillers[0].id)

    // The tree is virtualised, so wait for it rather than assuming the first
    // row is attached after `goto`. The scroll container is the `page-tree`
    // element itself: Wunderbaum puts its `wunderbaum` class on that node rather
    // than on a child of it, so the measured DOM has
    // `page-tree.querySelectorAll('.wunderbaum').length === 0` and the host is
    // what carries `overflow-y: scroll`.
    const tree = page.getByTestId('page-tree')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    await tree.evaluate((el: HTMLElement) => {
      el.scrollTop = 0
    })

    // 2. The oldest seed renders anyway — proof the controller walked past the
    //    first window. It is the oldest of this test's seeds, so it is the one
    //    the first window provably cannot hold, and it is the row to look for.
    await scrollToRow(page, fillers[0].id)

    // 3. A spread across the seeded range, not every row. The tree keeps only
    //    about 25 rows in the DOM plus an overscan; a full sweep of the seeds
    //    measured 155 s with `waitForRow`, so it cannot run in a 30 s budget.
    //    The oldest seed is the load-bearing row; these two bound the middle
    //    and the far end of what this test created.
    for (const index of [Math.floor(WINDOW_FILLER_COUNT / 2), WINDOW_FILLER_COUNT - 1]) {
      await scrollToRow(page, fillers[index].id)
    }

    // A parent/child relationship spanning the window boundary survives. The
    // parent is seeded after every filler, so it sits below all of them.
    await expandRow(page, parent.id)
    await expect(rowLocator(page, kid.id)).toBeVisible()

    // Open page A so it becomes the active selection with its editor mounted.
    await scrollToRow(page, a.id)
    await rowLocator(page, a.id).click()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    // Genuine mid-list reorder deep past the window: dragging b DOWN after c
    // must compute the position against the FULL root sibling set.
    await waitForServerOrder(request, [a.id, b.id, c.id])
    await dragRowOnto(page, b.id, c.id, 0.9)
    await waitForServerOrder(request, [a.id, c.id, b.id])

    // Active page unchanged: editor still mounted for A and A still selected,
    // and the move emitted no content PATCH requests.
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await expect(rowLocator(page, a.id)).toHaveAttribute('aria-selected', 'true')
    expect(patchCalls).toEqual([])
  })
})
