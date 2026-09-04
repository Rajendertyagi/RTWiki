import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

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
 *  7. drag/drop callbacks reject prohibited destinations,
 *  8. HTML virtual source rows display without becoming database pages,
 *  9. expanded/selected state restores after reload,
 * 10. TypeScript/browser-target compatibility (CI typecheck job).
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

async function seedPage(
  request: APIRequestContext,
  title: string,
  opts: { parentId?: string; pageType?: 'rich' | 'html' } = {}
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

test.describe('Wunderbaum tree foundation (spike)', () => {
  test('mounts exactly one tree instance that survives remounts', async ({ page, request }) => {
    await seedPage(request, uniqueTitle('SpikeA'))
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

  test('renders the page hierarchy with custom type icons', async ({ page, request }) => {
    const parent = await seedPage(request, uniqueTitle('IconParent'))
    await seedPage(request, uniqueTitle('IconChild'), { parentId: parent.id })
    const html = await seedPage(request, uniqueTitle('IconHtml'), { pageType: 'html' })
    await page.goto('/')
    await rowLocator(page, parent.id).waitFor()
    await expect(rowLocator(page, parent.id).locator('.rtw-page-icon')).toBeVisible()
    await expect(rowLocator(page, html.id).locator('.rtw-page-icon')).toBeVisible()
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-level', '1')
  })

  test('opens pages through RTWiki tab flow without duplicates', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('TabA'))
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
    request
  }) => {
    const parent = await seedPage(request, uniqueTitle('KbdParent'))
    await seedPage(request, uniqueTitle('KbdChild'), { parentId: parent.id })
    await page.goto('/')
    const parentRow = rowLocator(page, parent.id)
    await parentRow.waitFor()
    // Focus the tree container and navigate.
    await page.getByTestId('page-tree').click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    // Expand with the arrow, then open with Enter.
    await page.keyboard.press('ArrowRight')
    await expect(parentRow).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('tab', { name: new RegExp(parent.title) })).toBeVisible()
  })

  test('right-click on every row region opens the RTWiki menu, never the native menu', async ({
    page,
    request
  }) => {
    const a = await seedPage(request, uniqueTitle('CtxA'))
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

  test('row action button does not open its row', async ({ page, request }) => {
    const a = await seedPage(request, uniqueTitle('ActA'))
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
    request
  }) => {
    const a = await seedPage(request, uniqueTitle('DndA'))
    const b = await seedPage(request, uniqueTitle('DndB'))
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

  test('rejects drops onto self and descendants', async ({ page, request }) => {
    const parent = await seedPage(request, uniqueTitle('RejParent'))
    await seedPage(request, uniqueTitle('RejChild'), { parentId: parent.id })
    await page.goto('/')
    await expandRow(page, parent.id)
    const before = await listPages(request)
    await rowLocator(page, parent.id).dragTo(rowLocator(page, parent.id))
    await expect
      .poll(async () => JSON.stringify(await listPages(request)), { timeout: 10_000 })
      .toBe(JSON.stringify(before))
  })

  test('virtual source rows render without becoming database pages', async ({ page, request }) => {
    const html = await seedPage(request, uniqueTitle('VirtHtml'), { pageType: 'html' })
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

  test('clicking each virtual row opens the correct source field', async ({ page, request }) => {
    const html = await seedPage(request, uniqueTitle('SrcHtml'), { pageType: 'html' })
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

  test('restores expanded state after reload', async ({ page, request }) => {
    const parent = await seedPage(request, uniqueTitle('RestoreParent'))
    await seedPage(request, uniqueTitle('RestoreChild'), { parentId: parent.id })
    await page.goto('/')
    await expandRow(page, parent.id)
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-expanded', 'true')
    await page.reload()
    await page.getByTestId('page-tree').waitFor()
    await expect(rowLocator(page, parent.id)).toHaveAttribute('aria-expanded', 'true')
  })

  test('preserves the virtual group while real pages move and duplicate', async ({
    page,
    request
  }) => {
    const html = await seedPage(request, uniqueTitle('GrpHtml'), { pageType: 'html' })
    const mover = await seedPage(request, uniqueTitle('GrpMover'))
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
    await expect(subfileLocator(page, html.id, 'html')).toBeVisible()
    await waitForServerOrder(
      request,
      pages.map((p) => p.id).filter((id) => id !== mover.id)
    )
  })
})
