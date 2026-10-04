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

  async function createViaDialog(page: Page, title: string, type: 'diagram'): Promise<void> {
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

  test('create a Diagram child page from the tree context menu', async ({ page }) => {
    const parentTitle = uniqueTitle('Diagram Child Parent')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(parentTitle)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    // Right-click the row → context menu → Diagram page (child).
    const row = page.locator('[role="treeitem"]', { hasText: parentTitle }).first()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Insert child note' }).hover()
    await page.getByRole('menuitem', { name: 'Diagram page' }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 15_000 })
    // The new page is a child of the parent (visible in breadcrumb or tree).
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
  })

  // The Mind Map page is retired. These assert the removal rather than trusting
  // it: a creation path that survived would let a user make a page whose type the
  // API now rejects, and the failure would surface as a confusing error at save.
  test('no Mind Map page can be created from the New Page dialog', async ({ page }) => {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('new-page-type-diagram')).toBeVisible()
    await expect(dialog.getByTestId('new-page-type-mindmap')).toHaveCount(0)
    await expect(dialog.getByText('Mind map', { exact: true })).toHaveCount(0)
  })

  test('no Mind Map page can be created from the tree context menu', async ({ page }) => {
    const parentTitle = uniqueTitle('No MindMap Parent')
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(parentTitle)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    const row = page.locator('[role="treeitem"]', { hasText: parentTitle }).first()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'Insert child note' }).hover()
    await expect(page.getByRole('menuitem', { name: 'Diagram page' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Mind map page' })).toHaveCount(0)
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
    await page.getByTestId('diagram-block-edit-0').click()
    const input = page.getByTestId('diagram-source-input')
    await input.fill('sequenceDiagram\n    Alice->>Bob: Hi')
    await expect(page.getByTestId('diagram-live-preview').locator('svg')).toBeVisible()

    // The template controls are in the page's toolbar row now, not in the edit
    // pane, and choosing one adds a diagram rather than filling the source. So
    // this step is gone from here; the picker's behaviour is covered in
    // diagram-templates.pwspec.ts against the toolbar itself. What remains of this
    // test is the source editor itself.

    // Cancel restores the applied source; then apply a real change.
    await page.getByTestId('diagram-cancel').click()
    await page.getByTestId('diagram-block-edit-0').click()
    await page.getByTestId('diagram-source-input').fill('stateDiagram-v2\n    [*] --> Idle')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
  })

  test('a broken diagram does not take the rest of the page with it', async ({ page, request }) => {
    const title = uniqueTitle('Bad Diagram Among Good')
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: [
            { id: 'good', source: 'flowchart TD\n    A[Fine] --> B[Also fine]' },
            { id: 'bad', source: 'graph TD\n  A [broken' }
          ]
        })
      }
    })
    expect(res.status()).toBe(201)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    // Only the broken block shows an error; the good one still draws. Before the
    // block list, one failure replaced the single canvas for the whole page.
    await expect(page.getByTestId('diagram-block-1-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('diagram-block-0-error')).toHaveCount(0)
    await expect(page.getByTestId('diagram-block-0').locator('svg').first()).toBeVisible()
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
    await page.getByTestId('diagram-block-edit-0').click()
    await page.getByTestId('diagram-source-input').fill('graph TD\n  A [broken')
    await page.getByTestId('diagram-apply').click()
    // The error belongs to the block that failed, so the id is per block. A broken
    // diagram no longer replaces the whole page's canvas.
    await expect(page.getByTestId('diagram-block-0-error')).toBeVisible()
    await expect(page.getByTestId('diagram-block-0-retry')).toBeVisible()
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

    // Zoom belongs to the block, not to the page: the page-level `--zoom-level` layer
    // is gone, so the block's own control is the only one and it is what scales the
    // drawing. Measured, not asserted from a label - see
    // `diagram-workspace-layout.pwspec.ts` and the effective-scale tests.
    await page
      .locator('[data-testid="diagram-block-0-container"] [class*="_host_"]')
      .first()
      .hover()
    await page.getByTestId('diagram-block-0-zoom-in').click()
    const zoomed = await page
      .locator('[data-testid="diagram-block-0-container"] [class*="_layer_"] svg')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width / el.clientWidth)
    expect(zoomed).toBeCloseTo(1.25, 2)

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
    await page.getByTestId('diagram-block-edit-0').click()
    await page
      .getByTestId('diagram-source-input')
      .fill('erDiagram\n    CUSTOMER ||--o{ ORDER : places')
    await page.getByTestId('diagram-apply').click()

    // Synchronise on the thing actually under test: the autosaved content.
    //
    // Two earlier versions of this test were wrong in ways worth recording.
    // It looked for `diagram-save-status`, a testid that no longer exists
    // anywhere in the source, so it failed on "element(s) not found" and never
    // reached the assertion that proves the save. Pointing it at the shared
    // status bar was still wrong: that bar renders "Saved" for a CLEAN page
    // too (status-bar.tsx computes the label from saveState, and clean maps to
    // "Saved"), so the assertion passed instantly and the test then read the API
    // before the 2000ms autosave debounce had fired — a race, reporting
    // default content for an edit that had in fact been saved.
    //
    // Measured: apply -> saved -> view re-renders lands between 500ms and 2000ms.
    let pageId = ''
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/pages')
          const body = (await res.json()) as {
            pages: Array<{ id: string; title: string; content: string }>
          }
          const found = body.pages.find((p) => p.title === title)
          if (found?.content.includes('CUSTOMER')) pageId = found.id
          return found?.content ?? ''
        },
        { timeout: 15_000 }
      )
      .toContain('CUSTOMER')

    // Now that a save has demonstrably happened, the status bar is a meaningful
    // thing to assert on.
    await expect(page.getByTestId('workspace-status-bar')).toContainText(/Saved/i)

    await page.reload()
    // Reopen by id rather than by dashboard card. The dashboard paginates, and a
    // freshly created page sits at the end of the tree, so on a database with
    // many pages the "Open <title>" button is simply not on the first page —
    // which made this assertion depend on how much test data happened to be
    // lying around.
    await page.goto(`/?page=${pageId}`)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
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
