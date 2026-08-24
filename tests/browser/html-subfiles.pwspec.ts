import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * HTML pages are presented through three managed virtual source subfiles
 * (HTML/CSS/JavaScript) backed by the parent's canonical v2 fields:
 * - exactly three ordered subfiles per HTML page, existing or new;
 * - the parent opens as rendered preview only;
 * - each subfile opens only its own editor; edits persist to the parent;
 * - subfiles have no lifecycle of their own and never leak into the
 *   dashboard or page APIs.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedHtmlPage(
  request: APIRequestContext,
  title: string,
  content: Record<string, unknown>
): Promise<void> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'html', content: JSON.stringify({ version: 2, ...content }) }
  })
  expect(res.status()).toBe(201)
}

async function openTree(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('page-tree').waitFor()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Targets the row whose visible label starts with the exact title (row text
 * is "<title> <type label>"), so "X - Copy" never matches "X".
 */
function pageRow(page: Page, title: string) {
  const pattern = new RegExp(`^${escapeRegExp(title)}\\s*(Rich Note|HTML Page)`)
  return page.locator('[role="treeitem"]').filter({ hasText: pattern }).first()
}

async function expandAndShowSubfiles(page: Page, title: string): Promise<void> {
  // A background refetch can remount the tree (clearing expansion) between
  // our click and the wait, so retry the expand until the subfiles show.
  await expect(async () => {
    const row = pageRow(page, title)
    if ((await row.count()) === 0) throw new Error('page row not rendered yet')
    const expand = row.locator('[aria-label="Expand"]')
    if ((await expand.count()) > 0) await expand.click()
    await page
      .locator('[role="treeitem"][data-subfile-id$="::html"]')
      .waitFor({ state: 'visible', timeout: 1500 })
  }).toPass({ timeout: 20_000 })
}

test.describe('HTML source subfiles', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })
  test('a new HTML page exposes exactly three ordered subfiles', async ({ page, request }) => {
    const title = uniqueTitle('Sub New')
    const res = await request.post('/api/pages', {
      data: { title, pageType: 'html', content: '' }
    })
    expect(res.status()).toBe(201)
    await openTree(page)
    await expandAndShowSubfiles(page, title)

    const subs = page.locator('[role="treeitem"][data-subfile-id]')
    await expect(subs).toHaveCount(3)
    await expect(subs.nth(0)).toContainText('HTML')
    await expect(subs.nth(1)).toContainText('CSS')
    await expect(subs.nth(2)).toContainText('JavaScript')
    // Typed identities cannot collide with real page ids (UUIDs).
    const ids = await subs.evaluateAll((els) => els.map((e) => e.getAttribute('data-subfile-id')))
    for (const id of ids) expect(id).toContain('::')
  })

  test('an existing seeded page exposes the same subtree without migration', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sub Existing')
    await seedHtmlPage(request, title, {
      html: '<p>body</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)
    await expect(page.locator('[role="treeitem"][data-subfile-id]')).toHaveCount(3)
  })

  test('parent click renders preview only; each child opens only its editor', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sub Views')
    await seedHtmlPage(request, title, {
      html: '<p id="view-marker">rendered</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    // Parent click (normal left click on the row label).
    await pageRow(page, title).click()
    await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()
    await expect(page.locator('[data-testid^="code-editor-"]')).toHaveCount(0)

    await expandAndShowSubfiles(page, title)
    await page.locator('[role="treeitem"][data-subfile-id$="::css"]').click()
    await expect(page.locator('[data-testid="code-editor-css"]')).toBeVisible()
    await expect(page.locator('[data-testid="code-editor-html"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="live-preview"]')).toHaveCount(0)
  })

  test('editing a subfile persists to the parent and return-to-preview renders it', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sub Persist')
    await seedHtmlPage(request, title, {
      html: '<p id="persist-marker">base</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)
    await page.locator('[role="treeitem"][data-subfile-id$="::css"]').click()
    await page.locator('[data-testid="code-editor-css"] .cm-content').click()
    await page.keyboard.type('#persist-marker { color: red; }')

    // Return-to-preview flushes pending edits before switching views.
    await page.getByTestId('return-to-preview').click()
    await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()

    const res = await request.get('/api/pages')
    const list = (await res.json()) as { pages: Array<{ title: string; content: string }> }
    const stored = list.pages.find((p) => p.title === title)?.content ?? ''
    expect(stored).toContain('#persist-marker')

    const frame = page.frameLocator('[data-testid="preview-iframe"]')
    await expect(frame.locator('#persist-marker')).toBeVisible()
  })

  test('subfiles never appear as dashboard cards', async ({ page, request }) => {
    const title = uniqueTitle('Sub Cards')
    await seedHtmlPage(request, title, {
      html: '<p>x</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)
    await page.getByRole('button', { name: 'Home' }).click()

    const cards = page.locator('.mantine-Card-root')
    // No card's TITLE may be a bare subfile label (the shared server holds
    // many unrelated pages whose bodies legitimately mention these words).
    const badTitles = await cards.evaluateAll((els) =>
      els.map((el) => el.querySelector('button span')?.textContent?.trim() ?? '')
    )
    expect(
      badTitles.filter((t) => ['HTML', 'CSS', 'JavaScript'].includes(t)),
      'subfile labels must never become card titles'
    ).toEqual([])
  })

  test('subfile rows carry no drag identity and no context menu', async ({ page, request }) => {
    const title = uniqueTitle('Sub Inert')
    await seedHtmlPage(request, title, {
      html: '<p>x</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)

    const sub = page.locator('[role="treeitem"][data-subfile-id$="::html"]')
    // No real-page drag identity: pragmatic-drag-and-drop never registers it.
    expect(await sub.getAttribute('data-page-id')).toBeNull()
    await sub.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeHidden()
  })

  test('duplicating the parent duplicates the whole source subtree', async ({ page, request }) => {
    const title = uniqueTitle('Sub Dup')
    await seedHtmlPage(request, title, {
      html: '<p>dup</p>',
      css: 'p{}',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)

    const row = pageRow(page, title)
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()

    const res = await request.get('/api/pages')
    const list = (await res.json()) as {
      pages: Array<{ id: string; title: string; content: string }>
    }
    const copies = list.pages.filter((p) => p.title === `${title} - Copy`)
    expect(copies.length).toBe(1)
    const copy = copies[0]
    if (!copy) throw new Error('duplicate was not created')
    expect(copy.content).toContain('dup')
    // The duplicate is a real page with its own virtual subfiles — no extra rows.
    await page.reload()
    await expandAndShowSubfiles(page, copy.title)
    await expect(page.locator('[role="treeitem"][data-subfile-id]')).toHaveCount(3)
  })

  test('deleting the parent removes its subfiles from the tree', async ({ page, request }) => {
    const title = uniqueTitle('Sub Del')
    await seedHtmlPage(request, title, {
      html: '<p>x</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)

    const row = pageRow(page, title)
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    // Confirm in the modal.
    await page
      .getByRole('button', { name: /delete/i })
      .last()
      .click()

    await expect(page.locator(`[role="treeitem"][data-subfile-id$="::${title}"]`)).toHaveCount(0)
    await expect(page.locator('[role="treeitem"][data-subfile-id]')).toHaveCount(0)
  })

  test('keyboard focus moves through subfiles and Enter opens the editor', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sub Kbd')
    await seedHtmlPage(request, title, {
      html: '<p>k</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await openTree(page)
    await expandAndShowSubfiles(page, title)

    const parentRow = pageRow(page, title)
    await parentRow.click()
    await page.keyboard.press('ArrowDown') // first subfile (HTML)
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="code-editor-html"]')).toBeVisible()
    // The controller's active page remains the real parent.
    await expect(pageRow(page, title)).toHaveAttribute('aria-selected', 'true')
  })
})
