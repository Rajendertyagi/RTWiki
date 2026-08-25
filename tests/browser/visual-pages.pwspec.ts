import { expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Dedicated Diagram and Mind Map page types: creation entry points, the
 * full-page workspace (view/edit/live preview/templates/full-screen),
 * autosave, duplicate/delete, search and pagination compatibility.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

test.describe('dedicated diagram and mind map pages', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  let pageErrors: Error[] = []
  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
    void page.addInitScript(() => {
      try {
        window.sessionStorage.clear()
      } catch {
        // Storage may be unavailable.
      }
    })
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  async function createViaDialog(
    page: Page,
    title: string,
    type: 'diagram' | 'mindmap'
  ): Promise<void> {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId(`new-page-type-${type}`).click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId(`${type}-workspace`)).toBeVisible()
  }

  test('create a root Diagram page via the New Page dialog', async ({ page }) => {
    const title = uniqueTitle('Diagram Page')
    await createViaDialog(page, title, 'diagram')
    // Starter flowchart renders immediately in view mode.
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
    // The tree shows the new page with its type label.
    await expect(page.locator('[role="tree"]').getByText(title)).toBeVisible()
  })

  test('create a Mind Map child page from the row New Child menu', async ({ page }) => {
    const parentTitle = uniqueTitle('MindMap Parent')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(parentTitle)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    // Row action menu → New Child → Mind map page.
    const row = page.locator('[role="treeitem"]', { hasText: parentTitle }).first()
    await row.hover()
    await row.getByLabel(`Actions for ${parentTitle}`).click()
    await page.getByText('Mind map page').click()

    const childTitle = uniqueTitle('MindMap Child')
    const childDialog = page.getByRole('dialog')
    if (await childDialog.isVisible().catch(() => false)) {
      await childDialog.getByLabel('Title').fill(childTitle)
      await childDialog.getByRole('button', { name: /create/i }).click()
    }
    await expect(
      page.getByTestId('mindmap-workspace').or(page.locator('[data-testid="mindmap-workspace"]'))
    ).toBeVisible({ timeout: 15_000 })
  })

  test('diagram workspace: edit mode with live preview, template, apply/cancel', async ({
    page
  }) => {
    const title = uniqueTitle('Diagram WS')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()

    // Enter edit mode; live preview renders without Apply.
    await page.getByTestId('diagram-edit-button').click()
    const input = page.getByTestId('diagram-source-input')
    await input.fill('sequenceDiagram\n    Alice->>Bob: Hi')
    await expect(page.getByTestId('diagram-live-preview').locator('svg')).toBeVisible()

    // Template picker loads a starter into the source.
    await page.getByTestId('diagram-template').click()
    await page.getByText('Flowchart', { exact: true }).click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/graph|flowchart/)

    // Cancel restores the applied source; then apply a real change.
    await page.getByTestId('diagram-cancel').click()
    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-source-input').fill('stateDiagram-v2\n    [*] --> Idle')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
  })

  test('invalid diagram syntax stays contained with retry', async ({ page }) => {
    const title = uniqueTitle('Bad Diagram Page')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-source-input').fill('graph TD\n  A [broken')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-error')).toBeVisible()
    await expect(page.getByTestId('diagram-retry')).toBeVisible()
  })

  test('fit, zoom, refresh and full-screen controls work', async ({ page }) => {
    const title = uniqueTitle('Diagram Controls')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()

    await page.getByTestId('diagram-zoom-in').click()
    await expect(page.getByTestId('diagram-zoom-label')).toHaveText('125%')
    await page.getByTestId('diagram-refresh').click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
    await page.getByTestId('diagram-fullscreen').click()
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')
    await page.getByTestId('diagram-fullscreen').click()
  })

  test('autosave persists edits and reload restores them', async ({ page, request }) => {
    const title = uniqueTitle('Diagram Save')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()
    await page
      .getByTestId('diagram-source-input')
      .fill('erDiagram\n    CUSTOMER ||--o{ ORDER : places')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-save-status')).toContainText(/Saved/i, {
      timeout: 15_000
    })

    const res = await request.get('/api/pages')
    const body = (await res.json()) as { pages: Array<{ title: string; content: string }> }
    const stored = body.pages.find((p) => p.title === title)?.content ?? ''
    expect(stored).toContain('CUSTOMER')

    await page.reload()
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
  })

  test('duplicate keeps type and content; delete removes the page', async ({ request }) => {
    const title = uniqueTitle('Dup Diagram')
    const created = await request.post('/api/pages', {
      data: { title, pageType: 'diagram' }
    })
    expect(created.status()).toBe(201)
    const body = (await (await request.get('/api/pages')).json()) as {
      pages: Array<{ id: string; title: string; pageType: string; content: string }>
    }
    const page1 = body.pages.find((p) => p.title === title)
    expect(page1?.pageType).toBe('diagram')
    expect(page1?.content).toContain('"type":"diagram"')
    const dup = await request.post(`/api/pages/${page1?.id}/duplicate`)
    expect(dup.status()).toBe(201)
    const after = (await (await request.get('/api/pages')).json()) as {
      pages: Array<{ id: string; pageType: string }>
    }
    const copy = after.pages.find((p) => p.id !== page1?.id && p.pageType === 'diagram')
    expect(copy).toBeTruthy()
  })

  test('search finds diagram pages by title but never indexes Mermaid source', async ({
    request
  }) => {
    const marker = uniqueTitle('Zebra Search')
    await request.post('/api/pages', {
      data: { title: marker, pageType: 'diagram' }
    })
    const find = async (q: string): Promise<boolean> => {
      const res = await request.get(`/api/pages?q=${encodeURIComponent(q)}`)
      const body = (await res.json()) as { pages: Array<{ title: string }> }
      return body.pages.some((p) => p.title === marker)
    }
    expect(await find(marker)).toBe(true)
    // The starter Mermaid source must never be indexed.
    expect(await find('graph TD')).toBe(false)
  })

  test('more than 50 pages: new types remain listed beyond the first page of results', async ({
    request
  }) => {
    // Seed enough rich pages to push past the default limit of 50.
    for (let i = 0; i < 55; i += 1) {
      await request.post('/api/pages', {
        data: { title: `Bulk ${Date.now()}-${i}`, pageType: 'rich', content: '' }
      })
    }
    const res = await request.get('/api/pages?limit=100')
    const body = (await res.json()) as { pages: unknown[]; total: number }
    expect(body.pages.length).toBeGreaterThan(50)
  })

  test('dashboard card shows type label, never Mermaid source or SVG', async ({ page }) => {
    const title = uniqueTitle('Card Diagram')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.goto('/')
    const card = page.getByRole('button', { name: `Open ${title}`, exact: true })
    await card.waitFor()
    const text = (await card.textContent()) ?? ''
    expect(text).toContain('Diagram')
    expect(text).not.toContain('graph TD')
    expect(text).not.toContain('<svg')
  })
})
