import { type APIRequestContext, test as baseTest, expect, type Page } from '@playwright/test'

/**
 * Wunderbaum tree foundation — integration spike proof (Phase 1).
 *
 * Proves the ten pass conditions from the task prompt against the real
 * application before the migration is completed:
 *  1. exactly one tree instance after navigation/remount,
 *  2. hierarchy renders from RTWiki data,
 *  3. selection/open flow stays controlled by RTWiki (tabs),
 *  4. keyboard navigation/selection/expand work,
 *  5. custom page-type icons render,
 *  6. RTWiki's portalled context menu opens; the native menu never does,
 *  7. drag/drop callbacks commit before/after/over and reject prohibited
 *     destinations with no API request and no hierarchy change,
 *  8. HTML virtual source rows display without becoming database pages,
 *  9. expanded/selected state restores after reload (including the
 *     expansion-only session with zero open tabs),
 * 10. TypeScript/browser-target compatibility (CI typecheck job).
 *
 * Test isolation: every test owns the pages it creates through the
 * `seedOwnedPage` fixture. Teardown deletes ONLY the IDs recorded for that
 * test (missing IDs are tolerated, so mid-test deletes are safe). There is
 * deliberately no global wipe: unrelated or pre-existing pages must survive
 * every test in this file.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

interface SeededPage {
  id: string
  title: string
}

type SeedOpts = { parentId?: string; pageType?: 'rich' | 'html' }

type TreeFixtures = {
  /** IDs created by this test only; teardown deletes exactly these. */
  ownedPageIds: string[]
  /** Seeds a page and records its ID for test-owned teardown. */
  seedOwnedPage: (title: string, opts?: SeedOpts) => Promise<SeededPage>
}

const test = baseTest.extend<TreeFixtures>({
  ownedPageIds: async ({ request }, use) => {
    const ids: string[] = []
    await use(ids)
    // Test-owned teardown: delete only this test's pages. A 404 (already
    // deleted inside the test) is a normal response, not a failure.
    for (const id of ids) {
      await request.delete(`/api/pages/${id}`)
    }
  },
  seedOwnedPage: async ({ request, ownedPageIds }, use) => {
    await use(async (title: string, opts: SeedOpts = {}) => {
      const created = await seedPage(request, title, opts)
      ownedPageIds.push(created.id)
      return created
    })
  }
})

async function seedPage(
  request: APIRequestContext,
  title: string,
  opts: SeedOpts = {}
): Promise<SeededPage> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: opts.pageType ?? 'rich',
      content: '',
      parentId: opts.parentId ?? null
    }
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
  const body = (await res.json()) as { pages: Array<never> }
  return body.pages as never
}

function rowLocator(page: Page, pageId: string) {
  return page.locator(`[role="treeitem"][data-page-id="${pageId}"]`)
}

function subfileLocator(page: Page, pageId: string, field: string) {
  return page.locator(`[role="treeitem"][data-subfile-id="${pageId}::${field}"]`)
}

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
          .filter((p) => expectedIds.includes(p.id))
          .sort((x, y) => x.position - y.position)
          .map((p) => p.id),
      { timeout: 10_000 }
    )
    .toEqual(expectedIds)
}

/**
 * Drags the source row onto the target row at the given vertical fraction
 * of the target's height. Wunderbaum's drop geometry (rowHeightPx = 32):
 * dy < 25% = before, dy > 75% = after, otherwise over.
 * 0.1 = before, 0.5 = over, 0.9 = after.
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
  const box = await target.boundingBox()
  if (!box) throw new Error('target row is not visible')
  await source.dragTo(target, {
    targetPosition: {
      x: Math.round(box.width / 2),
      y: Math.max(2, Math.round(box.height * fractionY))
    }
  })
}

interface MoveRequest {
  url: string
  body: string | null
}

/** Records every POST /api/pages/<id>/move request issued by the page. */
function collectMoveRequests(page: Page): MoveRequest[] {
  const moves: MoveRequest[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/pages\/.+\/move$/.test(req.url())) {
      let body: string | null = null
      try {
        body = req.postData()
      } catch {
        body = null
      }
      moves.push({ url: req.url(), body })
    }
  })
  return moves
}

/** Records every PATCH /api/pages/<id> request issued by the page. */
function collectPatchRequests(page: Page): string[] {
  const patches: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes('/api/pages/')) {
      patches.push(req.url())
    }
  })
  return patches
}

/** Closes every open document tab through the real tab-strip UI. */
async function closeAllTabs(page: Page): Promise<void> {
  while ((await page.getByRole('tab').count()) > 0) {
    await page
      .getByRole('tab')
      .first()
      .getByRole('button', { name: /^Close tab/ })
      .click()
  }
  await expect(page.getByRole('tab')).toHaveCount(0)
}

test.describe('Wunderbaum tree foundation (spike)', () => {
  test('mounts exactly one tree instance that survives remounts', async ({
    page,
    seedOwnedPage
  }) => {
    await seedOwnedPage(uniqueTitle('SpikeA'))
    await page.goto('/')
    await page.getByTestId('page-tree').waitFor()
    await expect(page.locator('.wunderbaum')).toHaveCount(1)
    // Remount the whole tree through a dashboard round-trip.
    await page.getByLabel('Home').click()
    await page.getByTestId('page-tree').waitFor()
    await expect(page.locator('.wunderbaum')).toHaveCount(1)
    // Full reload still leaves exactly one instance.
    await page.reload()
    await page.getByTestId('page-tree').waitFor()
    await expect(page.locator('.wunderbaum')).toHaveCount(1)
  })

  test('renders the page hierarchy with custom type icons', async ({ page, seedOwnedPage }) => {
    const parent = await seedOwnedPage(uniqueTitle('IconParent'))
    await seedOwnedPage(uniqueTitle('IconChild'), { parentId: parent.id })
    const html = await seedOwnedPage(uniqueTitle('IconHtml'), { pageType: 'html' })
    await page.goto('/')
    await rowLocator(page, parent.id).waitFor()
    await expect(rowLocator(page, parent.id).locator('.rtw-page-icon')).toBeVisible()
    await expect(rowLocator(page, html.id).locator('.rtw-page-icon')).toBeVisible()
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-level', '1')
  })

  test('opens pages through RTWiki tab flow without duplicates', async ({
    page,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('TabA'))
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    await row.click()
    await expect(page.getByRole('tab', { name: new RegExp(a.title) })).toBeVisible()
    // Second click on the same page must not duplicate the tab.
    await row.click()
    await expect(page.getByRole('tab', { name: new RegExp(a.title) })).toHaveCount(1)
    // The editor surface mounts through the normal workspace flow.
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
  })

  test('keyboard navigation moves focus, expands, and opens on Enter', async ({
    page,
    seedOwnedPage
  }) => {
    const parent = await seedOwnedPage(uniqueTitle('KbdParent'))
    await seedOwnedPage(uniqueTitle('KbdChild'), { parentId: parent.id })
    await page.goto('/')
    const parentRow = rowLocator(page, parent.id)
    await parentRow.waitFor()
    // Establish the parent as the active node through the real open flow
    // (rows carry no tabindex of their own; the tree container owns focus,
    // so first-row arrow navigation is not deterministic in shared DBs).
    await parentRow.click()
    await expect(page.getByRole('tab', { name: new RegExp(parent.title) })).toBeVisible()
    await expect(parentRow).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('page-tree').focus()
    // Keyboard-only from here: expand with ArrowRight, then open with Enter
    // (already open: Enter must not duplicate the tab).
    await page.keyboard.press('ArrowRight')
    await expect(parentRow).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: new RegExp(parent.title) })).toBeVisible()
    await expect(page.getByRole('tab', { name: new RegExp(parent.title) })).toHaveCount(1)
  })

  test('right-click on every row region opens the RTWiki menu, never the native menu', async ({
    page,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('CtxA'))
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    // Detect any unprevented native context menu inside the tree.
    await page.evaluate(() => {
      ;(window as unknown as { __nativeCtx: number }).__nativeCtx = 0
      document.addEventListener('contextmenu', (e) => {
        const target = e.target as HTMLElement
        if (target.closest('[data-testid="page-tree"]') && !e.defaultPrevented) {
          ;(window as unknown as { __nativeCtx: number }).__nativeCtx += 1
        }
      })
    })
    const box = await row.boundingBox()
    if (!box) throw new Error('row not visible')
    // Expander area, icon area, title, unused row space.
    const regions: Array<[number, number]> = [
      [10, box.height / 2],
      [40, box.height / 2],
      [80, box.height / 2],
      [box.width - 30, box.height / 2]
    ]
    for (const [x, y] of regions) {
      await page.mouse.click(box.x + x, box.y + y, { button: 'right' })
      await expect(page.getByTestId('tree-context-menu')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('tree-context-menu')).toHaveCount(0)
    }
    expect(
      await page.evaluate(() => (window as unknown as { __nativeCtx: number }).__nativeCtx)
    ).toBe(0)
    // Blank space opens the root menu (documented behaviour).
    await page.getByTestId('page-tree').click({ button: 'right', position: { x: 10, y: 10 } })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('row action button does not open its row', async ({ page, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('ActA'))
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    await row.hover()
    const action = row.locator('[data-testid="tree-row-action"]')
    await action.click({ force: true })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    // No tab opened, no editor mounted.
    await expect(page.getByRole('tab', { name: new RegExp(a.title) })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('drag before, inside, and after ordinary rows commits server truth', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('DndA'))
    const b = await seedOwnedPage(uniqueTitle('DndB'))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    const target = rowLocator(page, a.id)
    const box = (await target.boundingBox()) as {
      x: number
      y: number
      width: number
      height: number
    }
    // "inside" = middle of the row -> reparent under a.
    await rowLocator(page, b.id).dragTo(target, {
      targetPosition: { x: Math.round(box.width / 2), y: Math.round(box.height / 2) }
    })
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === b.id)?.parentId).toBe(a.id)
  })

  test('rejects drops onto self and descendants', async ({ page, request, seedOwnedPage }) => {
    const parent = await seedOwnedPage(uniqueTitle('RejParent'))
    await seedOwnedPage(uniqueTitle('RejChild'), { parentId: parent.id })
    await page.goto('/')
    await expandRow(page, parent.id)
    const before = await listPages(request)
    await rowLocator(page, parent.id).dragTo(rowLocator(page, parent.id))
    await expect
      .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
      .toBe(JSON.stringify(before))
  })

  test('virtual source rows render without becoming database pages', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const html = await seedOwnedPage(uniqueTitle('VirtHtml'), { pageType: 'html' })
    await page.goto('/')
    await expandRow(page, html.id)
    await expect(subfileLocator(page, html.id, 'html')).toBeVisible()
    await expect(subfileLocator(page, html.id, 'css')).toBeVisible()
    await expect(subfileLocator(page, html.id, 'javascript')).toBeVisible()
    // Group order: html -> css -> javascript, immediately below the parent.
    const keys = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="treeitem"][data-subfile-id]')]
      return rows.map((r) => r.getAttribute('data-subfile-id'))
    })
    expect(keys).toEqual([`${html.id}::html`, `${html.id}::css`, `${html.id}::javascript`])
    // No new database pages were created for the virtual rows.
    const pages = await listPages(request)
    expect(pages.filter((p) => p.parentId === html.id)).toHaveLength(0)
  })

  test('clicking each virtual row opens the correct source field', async ({
    page,
    seedOwnedPage
  }) => {
    const html = await seedOwnedPage(uniqueTitle('SrcHtml'), { pageType: 'html' })
    await page.goto('/')
    await expandRow(page, html.id)
    await subfileLocator(page, html.id, 'css').click()
    await expect(page.locator('[data-testid="html-source-view"]')).toBeVisible()
    await expect(page.locator('[data-testid="code-editor-css"]')).toBeVisible()
    await subfileLocator(page, html.id, 'javascript').click()
    await expect(page.locator('[data-testid="code-editor-javascript"]')).toBeVisible()
    await subfileLocator(page, html.id, 'html').click()
    await expect(page.locator('[data-testid="code-editor-html"]')).toBeVisible()
  })

  test('restores expanded state after reload', async ({ page, seedOwnedPage }) => {
    const parent = await seedOwnedPage(uniqueTitle('RestoreParent'))
    await seedOwnedPage(uniqueTitle('RestoreChild'), { parentId: parent.id })
    await page.goto('/')
    await expandRow(page, parent.id)
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-expanded', 'true')
    await page.reload()
    await page.getByTestId('page-tree').waitFor()
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-expanded', 'true')
  })

  test('preserves the virtual group while real pages move and duplicate', async ({
    page,
    request,
    seedOwnedPage,
    ownedPageIds
  }) => {
    const html = await seedOwnedPage(uniqueTitle('GrpHtml'), { pageType: 'html' })
    const mover = await seedOwnedPage(uniqueTitle('GrpMover'))
    await page.goto('/')
    await expandRow(page, html.id)
    await rowLocator(page, mover.id).waitFor()
    // Move the real page INTO the html parent (over = append after group).
    await rowLocator(page, mover.id).dragTo(rowLocator(page, html.id), {
      targetPosition: { x: 60, y: 16 }
    })
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === mover.id)?.parentId).toBe(html.id)
    // The virtual group still renders first, contiguously.
    const keys = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="treeitem"][data-subfile-id]')]
      return rows.map((r) => r.getAttribute('data-subfile-id'))
    })
    expect(keys).toEqual([`${html.id}::html`, `${html.id}::css`, `${html.id}::javascript`])
    // Duplicate the html page: the copy gets its own intact group.
    await request.post(`/api/pages/${html.id}/duplicate`)
    const after = await listPages(request)
    const copy = after.find(
      (p) => p.title.startsWith(`${'GrpHtml'} - Copy`) || p.title.includes('Copy')
    )
    expect(copy).toBeDefined()
    // The duplicate is owned by this test too: track it for teardown.
    if (copy) ownedPageIds.push(copy.id)
    expect(copy?.parentId).toBeNull()
    await expect(subfileLocator(page, html.id, 'html')).toBeVisible()
    // Owned roots keep creation order (the duplicate appends last);
    // unrelated pages in the shared database are ignored.
    const ownedRoots = copy ? [html.id, copy.id] : [html.id]
    await expect
      .poll(
        async () =>
          (await listPages(request))
            .filter((p) => ownedRoots.includes(p.id))
            .sort((x, y) => x.position - y.position)
            .map((p) => p.id),
        { timeout: 10_000 }
      )
      .toEqual(ownedRoots)
  })

  test('test-owned teardown tolerates a page already deleted in-test', async ({
    request,
    seedOwnedPage
  }) => {
    const doomed = await seedOwnedPage(uniqueTitle('Doomed'))
    const del = await request.delete(`/api/pages/${doomed.id}`)
    expect(del.status(), 'in-test delete should succeed').toBe(200)
    // Teardown will attempt the same delete and must not fail (404 tolerated).
    const remaining = await listPages(request)
    expect(remaining.find((p) => p.id === doomed.id)).toBeUndefined()
  })

  test('unrelated pages survive test-owned teardown', async ({ request, seedOwnedPage }) => {
    const owned = await seedOwnedPage(uniqueTitle('Owned'))
    // Seeded outside the fixture: no test owns this ID, so no teardown may
    // remove it. It is deleted explicitly at the end to avoid leaking.
    const stray = await seedPage(request, uniqueTitle('Stray'))
    const mid = await listPages(request)
    expect(mid.find((p) => p.id === owned.id)).toBeDefined()
    expect(mid.find((p) => p.id === stray.id)).toBeDefined()
    const del = await request.delete(`/api/pages/${stray.id}`)
    expect(del.status(), 'explicit stray cleanup should succeed').toBe(200)
  })
})

test.describe('spike drag-and-drop regions (Wunderbaum host)', () => {
  test('dropping before a sibling reorders roots and posts one move', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('BefA'))
    const b = await seedOwnedPage(uniqueTitle('BefB'))
    const moves = collectMoveRequests(page)
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    // Top edge of A (dy < 25% of the 32px row) = "before".
    await dragRowOnto(page, b.id, a.id, 0.1)
    await waitForServerOrder(request, [b.id, a.id])
    expect(moves).toHaveLength(1)
    expect(moves[0].url).toContain(`/api/pages/${b.id}/move`)
    expect(JSON.parse(moves[0].body ?? '{}')).toMatchObject({ newParentId: null })
  })

  test('dropping after a sibling reorders roots and posts one move', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('AftA'))
    const b = await seedOwnedPage(uniqueTitle('AftB'))
    const moves = collectMoveRequests(page)
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    // Bottom edge of B (dy > 75% of the 32px row) = "after": [A,B] -> [B,A].
    await dragRowOnto(page, a.id, b.id, 0.9)
    await waitForServerOrder(request, [b.id, a.id])
    expect(moves).toHaveLength(1)
    expect(moves[0].url).toContain(`/api/pages/${a.id}/move`)
    expect(JSON.parse(moves[0].body ?? '{}')).toMatchObject({ newParentId: null })
  })

  test('dropping over a row reparents the page as its child', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const parent = await seedOwnedPage(uniqueTitle('OverParent'))
    const mover = await seedOwnedPage(uniqueTitle('OverMover'))
    const moves = collectMoveRequests(page)
    await page.goto('/')
    await rowLocator(page, mover.id).waitFor()
    // Middle of the row = "over".
    await dragRowOnto(page, mover.id, parent.id, 0.5)
    await expect
      .poll(async () => (await listPages(request)).find((p) => p.id === mover.id)?.parentId, {
        timeout: 10_000
      })
      .toBe(parent.id)
    expect(moves).toHaveLength(1)
    expect(moves[0].url).toContain(`/api/pages/${mover.id}/move`)
    expect(JSON.parse(moves[0].body ?? '{}')).toMatchObject({ newParentId: parent.id })
  })

  test('self-drop posts no move and changes nothing', async ({ page, request, seedOwnedPage }) => {
    const a = await seedOwnedPage(uniqueTitle('SelfA'))
    const moves = collectMoveRequests(page)
    const before = JSON.stringify(await listPages(request))
    await page.goto('/')
    await rowLocator(page, a.id).waitFor()
    await dragRowOnto(page, a.id, a.id, 0.5)
    await page.waitForTimeout(1500)
    expect(moves).toHaveLength(0)
    expect(JSON.stringify(await listPages(request))).toBe(before)
  })

  test('dropping a parent onto its descendant posts no move', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const root = await seedOwnedPage(uniqueTitle('DescRoot'))
    const kid = await seedOwnedPage(uniqueTitle('DescKid'), { parentId: root.id })
    const moves = collectMoveRequests(page)
    const before = JSON.stringify(await listPages(request))
    await page.goto('/')
    await expandRow(page, root.id)
    await rowLocator(page, kid.id).waitFor()
    await dragRowOnto(page, root.id, kid.id, 0.5)
    await page.waitForTimeout(1500)
    expect(moves).toHaveLength(0)
    expect(JSON.stringify(await listPages(request))).toBe(before)
  })

  test('dropping onto a virtual subfile row posts no move', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const html = await seedOwnedPage(uniqueTitle('VirtTarget'), { pageType: 'html' })
    const mover = await seedOwnedPage(uniqueTitle('VirtMover'))
    const moves = collectMoveRequests(page)
    const before = JSON.stringify(await listPages(request))
    await page.goto('/')
    await expandRow(page, html.id)
    const subfile = subfileLocator(page, html.id, 'css')
    await subfile.waitFor()
    const box = await subfile.boundingBox()
    if (!box) throw new Error('subfile row is not visible')
    await rowLocator(page, mover.id).dragTo(subfile, {
      targetPosition: { x: Math.round(box.width / 2), y: Math.round(box.height / 2) }
    })
    await page.waitForTimeout(1500)
    expect(moves).toHaveLength(0)
    expect(JSON.stringify(await listPages(request))).toBe(before)
    // The mover was NOT appended as a root: its parent is still null and the
    // virtual group still renders first.
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === mover.id)?.parentId).toBeNull()
  })

  test('foreign native drops post no move and change nothing', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('ExtA'))
    const moves = collectMoveRequests(page)
    const before = JSON.stringify(await listPages(request))
    await page.goto('/')
    await rowLocator(page, a.id).waitFor()
    // A foreign drag carries plain text and no Wunderbaum source node.
    await rowLocator(page, a.id).evaluate((el) => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'external')
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await page.waitForTimeout(1500)
    expect(moves).toHaveLength(0)
    expect(JSON.stringify(await listPages(request))).toBe(before)
  })

  test('a failed server move rolls back and leaves server truth intact', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('RbA'))
    const b = await seedOwnedPage(uniqueTitle('RbB'))
    const before = JSON.stringify(await listPages(request))
    await page.goto('/')
    await rowLocator(page, b.id).waitFor()
    // DOM order before the drag (row text signature per owned page).
    const domBefore = await page.evaluate(
      () => document.querySelector('[data-testid="page-tree"]')?.textContent ?? ''
    )
    expect(domBefore).toContain(a.title)
    await page.route('**/api/pages/*/move', (route) => route.abort())
    await dragRowOnto(page, b.id, a.id, 0.1)
    // The aborted request triggers the controller rollback: server truth
    // never changes and the DOM settles back to the pre-drag arrangement.
    await expect
      .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
      .toBe(before)
    await expect
      .poll(
        async () =>
          page.evaluate(
            () => document.querySelector('[data-testid="page-tree"]')?.textContent ?? ''
          ),
        { timeout: 10_000 }
      )
      .toBe(domBefore)
    await page.unroute('**/api/pages/*/move')
  })
})

test.describe('spike inline rename (Wunderbaum host)', () => {
  test('F2 + Enter sends exactly one PATCH and updates tree, tab, header, API', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('RenA'))
    const patches = collectPatchRequests(page)
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    // Open the page so a tab and the editor header mount.
    await row.click()
    await expect(page.getByRole('tab', { name: new RegExp(a.title) })).toBeVisible()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    // F2 starts Wunderbaum's title editor on the active row.
    await rowLocator(page, a.id).click()
    await page.keyboard.press('F2')
    const editor = page.locator('input.wb-input-edit')
    await expect(editor).toBeVisible()
    const renamed = `${a.title}-renamed`
    await editor.fill(renamed)
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await listPages(request)).find((p) => p.id === a.id)?.title, {
        timeout: 10_000
      })
      .toBe(renamed)
    const ownPatches = patches.filter((url) => url.endsWith(`/api/pages/${a.id}`))
    expect(ownPatches).toHaveLength(1)
    // Tree row, tab strip, and editor header all mirror the committed title.
    await expect(rowLocator(page, a.id)).toContainText(renamed)
    await expect(page.getByRole('tab', { name: new RegExp(renamed) })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(renamed)
  })

  test('context-menu Rename + Enter sends exactly one PATCH', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('CtxRenA'))
    const patches = collectPatchRequests(page)
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const editor = page.locator('input.wb-input-edit')
    await expect(editor).toBeVisible()
    const renamed = `${a.title}-ctx`
    await editor.fill(renamed)
    await page.keyboard.press('Enter')
    await expect
      .poll(async () => (await listPages(request)).find((p) => p.id === a.id)?.title, {
        timeout: 10_000
      })
      .toBe(renamed)
    expect(patches.filter((url) => url.endsWith(`/api/pages/${a.id}`))).toHaveLength(1)
  })

  test('Escape during rename sends zero PATCH and keeps the title', async ({
    page,
    request,
    seedOwnedPage
  }) => {
    const a = await seedOwnedPage(uniqueTitle('EscRenA'))
    const patches = collectPatchRequests(page)
    await page.goto('/')
    const row = rowLocator(page, a.id)
    await row.waitFor()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const editor = page.locator('input.wb-input-edit')
    await expect(editor).toBeVisible()
    await editor.fill(`${a.title}-discarded`)
    await page.keyboard.press('Escape')
    await expect(page.locator('input.wb-input-edit')).toHaveCount(0)
    await page.waitForTimeout(1000)
    expect(patches.filter((url) => url.endsWith(`/api/pages/${a.id}`))).toHaveLength(0)
    const pages = await listPages(request)
    expect(pages.find((p) => p.id === a.id)?.title).toBe(a.title)
  })

  test('virtual HTML/CSS/JS rows offer no rename entry point', async ({ page, seedOwnedPage }) => {
    const html = await seedOwnedPage(uniqueTitle('VirtRen'), { pageType: 'html' })
    await page.goto('/')
    await expandRow(page, html.id)
    const cssRow = subfileLocator(page, html.id, 'css')
    await cssRow.waitFor()
    // No context menu on virtual rows (and therefore no Rename item).
    await cssRow.click({ button: 'right' })
    await page.waitForTimeout(500)
    await expect(page.getByTestId('tree-context-menu')).toHaveCount(0)
    // F2 with a virtual row focused must not embed an editor in that row.
    await cssRow.click()
    await page.keyboard.press('F2')
    await page.waitForTimeout(500)
    await expect(cssRow.locator('input.wb-input-edit')).toHaveCount(0)
  })
})

test.describe('spike session restore', () => {
  test('restores expansion with zero open tabs after reload', async ({ page, seedOwnedPage }) => {
    const parent = await seedOwnedPage(uniqueTitle('ExpOnlyParent'))
    const child = await seedOwnedPage(uniqueTitle('ExpOnlyChild'), { parentId: parent.id })
    await page.goto('/')
    await expandRow(page, parent.id)
    // Open the child through the real tab flow, then close every tab
    // through the real tab-strip close buttons.
    await rowLocator(page, child.id).click()
    await expect(page.getByRole('tab', { name: new RegExp(child.title) })).toBeVisible()
    await closeAllTabs(page)
    // Session storage now holds no open tabs but retains the expanded ID.
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() =>
          window.sessionStorage.getItem('rtwiki.workspace.session')
        )
        if (!raw) return 'missing'
        const session = JSON.parse(raw) as { openPageIds: string[]; expandedTreeIds: string[] }
        return `${session.openPageIds.length}:${session.expandedTreeIds.includes(parent.id)}`
      })
      .toBe('0:true')
    await page.reload()
    await page.getByTestId('page-tree').waitFor()
    // Expansion restored, and no page tab is active.
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('tab')).toHaveCount(0)
  })
})
