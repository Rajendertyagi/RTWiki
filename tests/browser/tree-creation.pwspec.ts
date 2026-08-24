import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Tree creation menus (Trilium-pattern): right-click on empty tree space
 * offers root creation; right-click on a row offers child creation plus the
 * lifecycle actions. Menus open at the pointer, close on Escape/outside
 * click, and are reachable with the keyboard ContextMenu key / Shift+F10.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  pageType: 'rich' | 'html' = 'rich'
): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType, content: '' }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

async function listPages(
  request: APIRequestContext
): Promise<Array<{ id: string; title: string; parentId: string | null; pageType: string }>> {
  const res = await request.get('/api/pages')
  return ((await res.json()) as { pages: Array<never> }).pages as never
}

async function openTree(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('page-tree').waitFor()
}

test.beforeAll(async ({ request }) => {
  await purgeUntitledPages(request)
})

test.afterEach(async ({ request }) => {
  // Creation tests intentionally make 'Untitled' pages; remove them so the
  // shared server never starves other suites' getByLabel('Title') lookups.
  await purgeUntitledPages(request)
})

test.describe('Sidebar creation menus', () => {
  test('empty-space right-click creates a root Rich Note', async ({ page, request }) => {
    await openTree(page)
    const tree = page.getByTestId('page-tree')
    // Dispatch on the container itself: with long page lists the tree fills
    // (and scrolls beneath) the viewport, so a physical empty-space click is
    // not reliably addressable; the handler contract is what we assert.
    await tree.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: Math.min(rect.top + rect.height, window.innerHeight) - 6
        })
      )
    })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'New Rich Note' }).click()

    await expect(page.getByRole('tab', { name: /Untitled/i })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const pages = await listPages(request)
    const created = pages.find((p) => p.title.startsWith('Untitled') && p.parentId === null)
    expect(created?.pageType).toBe('rich')
  })

  test('empty-space right-click creates a root HTML Page', async ({ page, request }) => {
    await openTree(page)
    const tree = page.getByTestId('page-tree')
    await tree.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: Math.min(rect.top + rect.height, window.innerHeight) - 6
        })
      )
    })
    await page.getByRole('menuitem', { name: 'New HTML Page' }).click()

    const pages = await listPages(request)
    const created = pages.find((p) => p.title.startsWith('Untitled') && p.pageType === 'html')
    expect(created).toBeDefined()
  })

  test('row right-click creates a child Rich Note that appears immediately', async ({
    page,
    request
  }) => {
    const parentTitle = uniqueTitle('CtxParent')
    const parent = await seedPage(request, parentTitle, 'rich')
    await openTree(page)

    const row = page.locator('[role="treeitem"]').filter({ hasText: parentTitle })
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'New child Rich Note' }).click()

    const pages = await listPages(request)
    const child = pages.find((p) => p.parentId === parent.id)
    expect(child?.pageType).toBe('rich')

    // Appears immediately: the parent auto-expanded, so the child row shows.
    const childRow = page
      .locator('[role="treeitem"][data-page-id]')
      .filter({ hasText: /^Untitled/ })
      .first()
    await expect(childRow).toBeVisible()
  })

  test('row right-click offers New child HTML Page', async ({ page, request }) => {
    const parentTitle = uniqueTitle('CtxHtmlParent')
    const parent = await seedPage(request, parentTitle, 'rich')
    await openTree(page)

    const row = page.locator('[role="treeitem"]').filter({ hasText: parentTitle })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'New child HTML Page' }).click()

    // Creation is async relative to the menu click: poll until it lands.
    let childId: string | undefined
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/pages')
          const list = (await res.json()) as {
            pages: Array<{ id: string; parentId: string | null }>
          }
          childId = list.pages.find((p) => p.parentId === parent.id)?.id
          return childId ?? null
        },
        { timeout: 10_000 }
      )
      .not.toBeNull()
    const childIdString: string = childId ?? ''
    expect(childIdString, 'child page should have been created').not.toBe('')
    const detail = await request.get(`/api/pages/${childIdString}`)
    const body = (await detail.json()) as { page?: { pageType?: string }; pageType?: string }
    const pageType = 'page' in body ? body.page?.pageType : body.pageType
    expect(pageType).toBe('html')
  })

  test('Escape closes the context menu without acting', async ({ page, request }) => {
    const before = (await listPages(request)).length
    await openTree(page)
    const tree = page.getByTestId('page-tree')
    await tree.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: Math.min(rect.top + rect.height, window.innerHeight) - 6
        })
      )
    })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('tree-context-menu')).toBeHidden()
    expect((await listPages(request)).length).toBe(before)
  })

  test('outside click closes the context menu without acting', async ({ page, request }) => {
    const before = (await listPages(request)).length
    await openTree(page)
    const tree = page.getByTestId('page-tree')
    await tree.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: Math.min(rect.top + rect.height, window.innerHeight) - 6
        })
      )
    })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.locator('h4, [data-testid="page-tree"]').first().click()
    await expect(page.getByTestId('tree-context-menu')).toBeHidden()
    expect((await listPages(request)).length).toBe(before)
  })

  test('the keyboard ContextMenu key opens the row menu', async ({ page, request }) => {
    const parentTitle = uniqueTitle('KbdMenu')
    await seedPage(request, parentTitle, 'rich')
    await openTree(page)

    const row = page.locator('[role="treeitem"]').filter({ hasText: parentTitle })
    await row.click()
    await page.keyboard.press('ContextMenu')
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New child Rich Note' })).toBeVisible()
  })

  test('Shift+F10 opens the row menu', async ({ page, request }) => {
    const parentTitle = uniqueTitle('ShiftF10')
    await seedPage(request, parentTitle, 'rich')
    await openTree(page)

    const row = page.locator('[role="treeitem"]').filter({ hasText: parentTitle })
    await row.click()
    await page.keyboard.press('Shift+F10')
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
  })

  test('right-clicking a subfile row opens no menu', async ({ page, request }) => {
    const parentTitle = uniqueTitle('SubNoMenu')
    await seedPage(request, parentTitle, 'html')
    await openTree(page)

    const row = page.locator('[role="treeitem"]').filter({ hasText: parentTitle })
    await row.locator('[aria-label="Expand"]').click()
    const sub = page.locator('[role="treeitem"][data-subfile-id$="::html"]')
    await sub.waitFor()
    await sub.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeHidden()
  })
})
