import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import {
  assertHitTarget,
  physicalClick,
  physicalClickCorner,
  resetDatabase
} from './helpers/hit-target.js'

/**
 * Automated Owner Journeys.
 *
 * These tests behave like a real person: roles/visible labels, real mouse
 * coordinates on important click surfaces, no internal function calls, and
 * APIs used only for controlled setup or persistence verification — never
 * to perform the interaction under test.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${titleSeq}`
}

async function createFromRail(
  page: Page,
  title: string,
  type: 'Rich Note' | 'HTML Page' | 'Diagram' | 'Mind map'
): Promise<void> {
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  if (type !== 'Rich Note') {
    await dialog.getByLabel(type, { exact: true }).check()
  }
  await dialog.getByRole('button', { name: /create/i }).click()
}

async function goHome(page: Page): Promise<void> {
  await page.locator('[aria-label="Home"]').click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
}

async function openCard(page: Page, title: string): Promise<void> {
  await goHome(page)
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
}

test.describe('owner journeys', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetDatabase(request)
    await page.goto('/')
    await expect(page.locator('[aria-label="New page"]').first()).toBeVisible()
  })

  let pageErrors: Error[] = []
  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('Journey A: rich note lifecycle with blocks, formatting and restart persistence', async ({
    page,
    request
  }) => {
    test.setTimeout(240_000)
    const title = uniqueTitle('Biology')

    // 1-2. Create from the rail; 3. type immediately (focus is claimed).
    await createFromRail(page, title, 'Rich Note')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    const biologyPage = await seedLookup(request, title)
    await page.keyboard.type('Cell theory states')
    // 4. Multiple paragraphs via Enter.
    await page.keyboard.press('Enter')
    await page.keyboard.type('Mitochondria produce ATP')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Formatting target')

    // 5. Toolbar formatting through real coordinates.
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    const bold = page.getByRole('toolbar').getByRole('button', { name: 'Bold', exact: true })
    await physicalClick(page, bold)
    await expect(page.locator('.bn-editor strong').first()).toBeVisible()

    // 6. Insert Formula, Diagram, Mind Map, Callout, Table via toolbar.
    for (const key of [
      'insert-formula',
      'insert-diagram',
      'insert-mind-map',
      'insert-callout-info',
      'insert-table'
    ]) {
      await physicalClick(page, page.getByTestId(key))
      // Move below the inserted block so the next insert lands after it.
      await page.locator('.bn-editor').click()
      await page.keyboard.press('Control+End')
      await page.keyboard.press('Enter')
    }

    // 7. Move the callout block up via its drag-handle menu.
    // Hover any content block so the side menu (with the drag handle) shows.
    await page.locator('.bn-block-content').last().hover()
    const handle = page.locator('[data-test="dragHandle"]').first()
    await handle.waitFor({ state: 'visible' })
    await handle.click()
    await page.getByTestId('move-up').click()

    // 8. Resize the diagram block via its handle (real pointer drag).
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    const resize = page.getByTestId('diagram-resize-handle')
    const rbox = await resize.boundingBox()
    if (rbox) {
      await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2)
      await page.mouse.down()
      await page.mouse.move(rbox.x + 60, rbox.y + 40, { steps: 6 })
      await page.mouse.up()
    }
    const widthBeforeReload = await container.getAttribute('data-width')

    // 9. Wait for Saved, then verify SERVER truth so any later loss is
    //    attributable to the restart rather than the save path.
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => getStoredContent(request, biologyPage as string), { timeout: 15_000 })
      .toContain('Cell theory states')

    // 10. Open another page and come back.
    const other = uniqueTitle('Scratch')
    await createFromRail(page, other, 'Rich Note')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await openCard(page, title)
    await expect(page.getByText('Cell theory states')).toBeVisible()

    // 11-12. Restart the real application server, then verify persistence.
    await restartApp(page)
    await openCard(page, title)
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await expect(page.getByText('Cell theory states')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Mitochondria produce ATP')).toBeVisible()
    await expect(page.locator('.bn-editor strong').first()).toBeVisible()
    await expect(page.getByTestId('diagram-container')).toBeVisible()
    const widthAfter = await page.getByTestId('diagram-container').getAttribute('data-width')
    expect(widthAfter).toBe(widthBeforeReload)
  })

  test('Journey B: dashboard cards, tree navigation, rename and drag indicators', async ({
    page,
    request
  }) => {
    test.setTimeout(240_000)
    const parent = uniqueTitle('Physics')
    const child = uniqueTitle('Mechanics')

    await createFromRail(page, parent, 'Rich Note')
    // Child via the tree context menu (proven flow).
    const row = page.locator('[role="treeitem"]', { hasText: parent }).first()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await page.getByRole('menuitem', { name: 'New child Rich Note' }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    // Context-menu creation uses the default title; rename via the header.
    const childTitleInput = page.locator('input[aria-label="Title"]')
    await childTitleInput.fill(child)
    await childTitleInput.press('Enter')
    // The parent may be collapsed in the tree; an owner expands it to see
    // the renamed child.
    const parentRowB = page.locator('[role="treeitem"]', { hasText: parent }).first()
    const expanderB = parentRowB.getByLabel('Expand')
    if ((await expanderB.count()) > 0) {
      await expanderB.click().catch(() => {})
    }
    await expect(page.locator('[role="treeitem"]', { hasText: child }).first()).toBeVisible()

    // 2-3. Open card by centre and corners; the card MENU must not navigate.
    await goHome(page)
    const card = page.getByRole('button', { name: `Open ${child}`, exact: true })
    await card.waitFor()
    await assertHitTarget(page, card, { corners: true, minWidth: 200, label: 'card' })
    await physicalClickCorner(page, card, 'top-left')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await goHome(page)
    await physicalClickCorner(page, card, 'bottom-right')
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    // Card action menu opens without navigating away from the dashboard.
    await goHome(page)
    const cardMenu = page.locator(`[aria-label="Actions for ${child}"]`).first()
    await physicalClick(page, cardMenu)
    await expect(page.getByRole('menu').or(page.getByTestId('tree-context-menu'))).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()

    // 4-5. Open from tree row; rename from header.
    await goHome(page)
    await page.locator('[role="treeitem"]', { hasText: child }).first().click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    const renamed = uniqueTitle('Kinematics')
    const titleInput = page.locator('input[aria-label="Title"]')
    await titleInput.fill(renamed)
    await titleInput.blur()
    await expect(page.locator('[role="treeitem"]', { hasText: renamed }).first()).toBeVisible()

    // 6-7. Expand/collapse hierarchy; drag child before parent root row.
    const expander = page
      .locator('[role="treeitem"]', { hasText: parent })
      .first()
      .getByLabel('Expand')
    await expander.click()
    await expect(page.locator('[role="treeitem"]', { hasText: renamed })).toBeVisible()
    await expander.click()

    const sourceRow = page.locator(`[role="treeitem"][data-page-id]`, { hasText: renamed }).first()
    const targetRow = page.locator('[role="treeitem"]', { hasText: parent }).first()
    await sourceRow.dragTo(targetRow, { targetPosition: { x: 40, y: 3 } })
    // Child becomes a root positioned before the parent.
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/pages')
          const body = (await res.json()) as {
            pages: Array<{ id: string; title: string; parentId: string | null; position: number }>
          }
          const c = body.pages.find((p) => p.title === renamed)
          const p = body.pages.find((x) => x.title === parent)
          return c && p && c.parentId === null && c.position < p.position ? 'ok' : 'pending'
        },
        { timeout: 15_000 }
      )
      .toBe('ok')

    // 9-10. Collapse the tree; workspace clicks must still land.
    await page
      .locator('[aria-label="Toggle navigation"]')
      .click()
      .catch(async () => {
        await page.locator('button[aria-label*="avigation"]').first().click()
      })
    await openCard(page, renamed)
    await page.locator('.bn-editor').click()
    await page.keyboard.type('typed with tree collapsed')
    await expect(page.locator('[data-testid="rich-editor"]')).toContainText(
      'typed with tree collapsed'
    )
  })

  test('Journey C: HTML workspace rapid switching, format, preview and restore', async ({
    page
  }) => {
    test.setTimeout(240_000)
    const title = uniqueTitle('Web Notes')
    await createFromRail(page, title, 'HTML Page')
    await expect(page.getByTestId('html-preview-view')).toBeVisible()

    // Expand virtual children and open HTML source.
    const row = page.locator('[role="treeitem"]', { hasText: title }).first()
    await row.hover()
    await row.getByLabel('Expand').click()
    await page.locator('[data-subfile-id]', { hasText: 'HTML' }).first().click()
    await expect(page.getByTestId('html-source-view')).toBeVisible()
    await expect(page.locator('.cm-editor')).toBeVisible()

    // 3. Type rapidly while switching fields — drafts must survive.
    const htmlEditor = page.getByTestId('code-editor-html')
    await htmlEditor.click()
    await page.keyboard.type('<p>alpha</p>')
    await page.locator('[data-subfile-id]', { hasText: 'CSS' }).first().click()
    const cssEditor = page.getByTestId('code-editor-css')
    await cssEditor.click()
    await page.keyboard.type('p { color: teal; }')
    await page.locator('[data-subfile-id]', { hasText: 'JavaScript' }).first().click()
    await page.getByTestId('code-editor-javascript').click()
    await page.keyboard.type('console.log(1)')
    await page.locator('[data-subfile-id]', { hasText: 'CSS' }).first().click()
    await expect(cssEditor).toContainText('teal')
    await page.locator('[data-subfile-id]', { hasText: 'HTML' }).first().click()
    await expect(htmlEditor).toContainText('alpha')

    // 4. Format each source.
    for (const field of ['CSS', 'HTML', 'JavaScript']) {
      await page.locator('[data-subfile-id]', { hasText: field }).first().click()
      await page.getByTestId('ide-format').click()
      await expect(page.getByTestId('ide-format-error')).toHaveCount(0, { timeout: 20_000 })
    }

    // 5-6. Return to preview; latest draft renders.
    await page.getByTestId('return-to-preview-button').click()
    await expect(page.getByTestId('live-preview')).toBeVisible()
    const frame = page.frameLocator('[data-testid="live-preview"] iframe')
    await expect(frame.locator('p', { hasText: 'alpha' })).toContainText('alpha')

    // 7. Refresh Preview.
    await page.getByTestId('refresh-preview').click()
    await expect(frame.locator('p', { hasText: 'alpha' })).toContainText('alpha')

    // 8-9. Reload restores tab + active source field per session model.
    await page.locator('[data-subfile-id]', { hasText: 'CSS' }).first().click()
    await page.reload()
    await expect(page.getByTestId('html-source-view')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('code-editor-css')).toBeVisible()

    // 10. JS toggle only in JavaScript view.
    await expect(page.getByTestId('js-enabled-toggle')).toHaveCount(0)
    await page.locator('[data-subfile-id]', { hasText: 'JavaScript' }).first().click()
    await expect(page.getByTestId('js-enabled-toggle')).toBeVisible()
  })

  test('Journey D: dedicated visual pages edit, apply/cancel, zoom, full-screen', async ({
    page
  }) => {
    test.setTimeout(240_000)
    const diag = uniqueTitle('Cycle Diagram')
    await createFromRail(page, diag, 'Diagram')
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()

    // Edit with live preview; Cancel keeps applied source; Apply commits.
    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-source-input').fill('sequenceDiagram\n    A->>B: hello')
    await expect(page.getByTestId('diagram-live-preview').locator('svg')).toBeVisible()
    await page.getByTestId('diagram-cancel').click()
    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-source-input').fill('stateDiagram-v2\n    [*] --> Idle')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()

    // Zoom + full-screen round trip.
    await page.getByTestId('diagram-zoom-in').click()
    await expect(page.getByTestId('diagram-zoom-label')).toHaveText('125%')
    await page.getByTestId('diagram-fullscreen').click()
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')
    await page.getByTestId('diagram-fullscreen').click()

    // Contained error stays editable.
    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-source-input').fill('graph TD\n  broken [')
    await page.getByTestId('diagram-apply').click()
    await expect(page.getByTestId('diagram-error')).toBeVisible()
    await page.getByTestId('diagram-retry').click()
    await page.getByTestId('diagram-edit-button').click()
    await expect(page.getByTestId('diagram-source-input')).toBeVisible()

    // Mind Map page mirrors the same contract.
    const mind = uniqueTitle('Topics Map')
    await createFromRail(page, mind, 'Mind map')
    await expect(page.getByTestId('mindmap-workspace')).toBeVisible()
    await page.getByTestId('mindmap-edit-button').click()
    await page.getByTestId('mindmap-source-input').fill('mindmap\n  root((Root))\n    One\n    Two')
    await page.getByTestId('mindmap-apply').click()
    await expect(page.getByTestId('mindmap-rendered').locator('svg')).toBeVisible()

    // Reload persists both dedicated pages.
    await page.reload()
    await openCard(page, diag)
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
    await openCard(page, mind)
    await expect(page.getByTestId('mindmap-rendered').locator('svg')).toBeVisible()
  })

  test('Journey E: links, backlinks, broken targets, Ctrl+K everywhere, recents', async ({
    page,
    request
  }) => {
    test.setTimeout(150_000)
    const alpha = uniqueTitle('Alpha Topic')
    const beta = uniqueTitle('Beta Topic')
    const gamma = uniqueTitle('Gamma Topic')
    const alphaPage = await seedRich(request, alpha)
    const betaPage = await seedRich(request, beta)
    await seedRich(request, gamma)

    // Insert link via [[ picker.
    await openNote(page, alpha)
    await page.locator('.bn-editor').click()
    await page.keyboard.type('See ')
    await page.keyboard.type('[[')
    const menu = page.locator('.bn-suggestion-menu')
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await page.keyboard.type('Beta')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    // Flush the link to storage before any navigation can discard it.
    const alphaId = alphaPage.id
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${alphaId}`)
          return ((await res.json()) as { page: { content: string } }).page.content
        },
        { timeout: 15_000 }
      )
      .toContain('#/page/')

    // Insert link via toolbar picker into Beta → Alpha.
    await openNote(page, beta)
    await page.getByTestId('wiki-link-button').click()
    await page.getByTestId('wiki-link-search').fill(alpha)
    await page.getByRole('option').first().click()
    const betaId = betaPage.id
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${betaId}`)
          return ((await res.json()) as { page: { content: string } }).page.content
        },
        { timeout: 15_000 }
      )
      .toContain('#/page/')

    // Rename target; stored ID keeps working. Open by the NEW title.
    await renameViaApi(request, alphaPage.id, 'Alpha Renamed')
    await openNote(page, 'Alpha Renamed')
    await expect(page.locator('input[aria-label="Title"]')).toHaveValue('Alpha Renamed')

    // Backlinks on Beta point at Alpha (wait out the autosave debounce).
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${betaPage.id}/backlinks`)
          const body = (await res.json()) as { backlinks: Array<{ title: string }> }
          return body.backlinks.map((b) => b.title).join(',')
        },
        { timeout: 15_000 }
      )
      .toContain('Alpha')
    await openNote(page, beta)
    await expect(page.getByTestId('backlink-entry').first()).toContainText('Alpha')

    // Delete Gamma? Not linked. Instead delete ALPHA (a target of Beta).
    await request.delete(`/api/pages/${alphaPage.id}`)
    await openNote(page, beta)
    const anchor = page.locator('a[href^="#/page/"]').first()
    await expect(anchor).toHaveClass(/rtwiki-broken-link/)
    await anchor.click()
    await expect(page.getByTestId('broken-link-notice')).toBeVisible()

    // Ctrl+K from rich note, then keyboard-only navigation.
    await page.keyboard.press('Control+k')
    const finderInput = page.getByTestId('quick-finder-input')
    await expect(finderInput).toBeVisible()
    await finderInput.fill('Gamma')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(page.locator('input[aria-label="Title"]')).toHaveValue(gamma)

    // Restart the app; recents persist and still resolve.
    await restartApp(page)
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-results')).toContainText(gamma)
    await page.keyboard.press('Escape')
  })
})

// ---------- helpers ----------

async function seedRich(request: APIRequestContext, title: string): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify([{ id: 'p', type: 'paragraph' }]) }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

async function renameViaApi(request: APIRequestContext, id: string, title: string): Promise<void> {
  const res = await request.patch(`/api/pages/${id}`, { data: { title } })
  expect(res.status()).toBe(200)
}

async function getStoredContent(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; content: string }> }
  return body.pages.find((p) => p.id === id)?.content ?? ''
}

async function seedLookup(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  const found = body.pages.find((p) => p.title === title)?.id
  if (!found) throw new Error(`page not found: ${title}`)
  return found
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.locator('[aria-label="Home"]').click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

/**
 * Restarts the real application server between journey steps.
 *
 * The Playwright webServer owns the process, so instead of killing it we
 * exercise the app's own shutdown endpoint (the same path the portable exe
 * uses) and wait for the server to come back. Playwright retries requests
 * against the same base URL; the health endpoint gates readiness.
 */
async function restartApp(page: Page): Promise<void> {
  // Fetch the shutdown token the same way the in-app stop control does.
  const tokenRes = await page.request.get('/api/shutdown/token')
  expect(tokenRes.status()).toBe(200)
  const { token } = (await tokenRes.json()) as { token: string }
  const stopRes = await page.request.post('/api/shutdown', {
    headers: { 'x-rtwiki-shutdown-token': token }
  })
  expect([200, 202]).toContain(stopRes.status())
  // The webServer supervisor restarts on exit? It does NOT — so instead of
  // relying on it, poll until healthy again (supervisor = bun --hot style
  // reload is not active here). If the server does not recover within the
  // window, the journey fails loudly rather than asserting against a zombie.
  let healthy = false
  for (let i = 0; i < 60 && !healthy; i++) {
    await page.waitForTimeout(500)
    try {
      const res = await page.request.get('/health')
      healthy = res.ok()
    } catch {
      healthy = false
    }
  }
  expect(healthy, 'application should come back after restart').toBe(true)
  // The still-open SPA was talking to the old process; reload so the UI is
  // connected to the restarted server before any further interaction.
  await page.reload()
  await expect(page.locator('[aria-label="New page"]').first()).toBeVisible({
    timeout: 20_000
  })
}
