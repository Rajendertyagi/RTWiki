import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * HTML-page workspace coverage under the managed-source-subfiles model:
 * - Opening an HTML page shows ONLY the rendered sandboxed preview.
 * - The tree exposes virtual HTML/CSS/JavaScript subfiles; opening one shows
 *   exactly that field's CodeMirror editor with an explicit return action.
 * - All persistence writes canonical v2 JSON through the shared autosave
 *   controller; all rendering flows through the unchanged secure builder.
 */

const PREVIEW_VIEW = '[data-testid="html-preview-view"]'
const SOURCE_VIEW = '[data-testid="html-source-view"]'
const PREVIEW_FRAME = '[data-testid="preview-iframe"]'
const JS_TOGGLE = '[data-testid="js-enabled-toggle"]'

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

interface SeedOptions {
  content: string
}

async function seedHtmlPage(
  request: APIRequestContext,
  title: string,
  options: SeedOptions
): Promise<void> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'html', content: options.content }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
}

async function readStoredContent(
  request: APIRequestContext,
  title: string
): Promise<string | undefined> {
  const res = await request.get('/api/pages')
  const list = (await res.json()) as { pages: Array<{ title: string; content: string }> }
  return list.pages.find((p) => p.title === title)?.content
}

/** Opens the page and lands on the rendered parent view. */
async function openPreview(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator(PREVIEW_VIEW)).toBeVisible()
}

/** Expands the page's tree row and opens one virtual source subfile. */
async function openSource(
  page: Page,
  title: string,
  field: 'html' | 'css' | 'javascript'
): Promise<void> {
  await openPreview(page, title)
  const row = page.locator('[role="treeitem"]').filter({ hasText: title })
  const expand = row.locator('[aria-label="Expand"]')
  if ((await expand.count()) > 0) {
    await expand.click()
  }
  await page
    .locator(`[role="treeitem"][data-subfile-id$="::${field}"]`)
    .waitFor({ state: 'visible' })
  await page.locator(`[role="treeitem"][data-subfile-id$="::${field}"]`).click()
  await expect(page.locator(SOURCE_VIEW)).toBeVisible()
  await expect(page.locator('[data-testid^="code-editor-"]').first()).toBeVisible()
}

/** Types text into the single CodeMirror pane of the source view. */
async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid^="code-editor-"] .cm-content').click()
  await page.keyboard.type(text)
}

async function expectSaved(page: Page): Promise<void> {
  // The header also relabels its Save button to "Saved" once clean, so the
  // assertion must target the aria-live status paragraph specifically.
  await expect(page.locator('p[aria-live="polite"]').filter({ hasText: 'Saved' })).toBeVisible({
    timeout: 10_000
  })
}

/**
 * Waits for the next page-content PATCH and returns request/response truth.
 * UI status text alone cannot distinguish a real save from a stale label —
 * this is the authoritative persistence signal.
 */
function nextSave(page: Page): {
  done: Promise<{ ok: boolean; status: number; payload: string }>
} {
  let resolve: (v: { ok: boolean; status: number; payload: string }) => void
  const done = new Promise<{ ok: boolean; status: number; payload: string }>((res) => {
    resolve = res
  })
  void page
    .waitForEvent('request', {
      predicate: (req) => req.method() === 'PATCH' && req.url().includes('/api/pages/'),
      timeout: 15_000
    })
    .then((req) => {
      // The wire format is the API envelope { content: "<canonical JSON>" };
      // unwrap it so assertions match the document actually being saved.
      let payload = req.postData() ?? ''
      try {
        const envelope = JSON.parse(payload) as { content?: string }
        if (typeof envelope.content === 'string') {
          payload = envelope.content
        }
      } catch {
        // Non-envelope bodies fail the payload assertions below.
      }
      void req.response().then((resp) => {
        if (!resp) {
          resolve({ ok: false, status: 0, payload })
          return
        }
        resolve({ ok: resp.ok(), status: resp.status(), payload })
      })
    })
  return { done }
}

test.describe('HTML editor workspace (real Chromium)', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })
  let pageErrors: Error[] = []

  test.beforeEach(async ({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
    // This suite exercises per-navigation dashboard semantics. Workspace
    // restoration (tested in stability-regressions) would otherwise auto-
    // reopen the previous page on goto/reload, so every fresh load starts
    // with an empty session.
    await page.addInitScript(() => {
      try {
        window.sessionStorage.clear()
      } catch {
        // Storage may be unavailable; nothing to reset.
      }
    })
  })

  test.afterEach(() => {
    expect(pageErrors, 'no uncaught exceptions in the application').toEqual([])
  })

  test('parent opens as rendered preview only — the JS gate lives in the JavaScript subfile', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Editor Open')
    await seedHtmlPage(request, title, {
      content: JSON.stringify({
        version: 2,
        html: '<p id="open-marker">hello</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
    })
    await openPreview(page, title)

    // Rendered content only: no source editors and no developer controls.
    await expect(page.locator(PREVIEW_FRAME)).toBeVisible()
    await expect(page.locator('[data-testid^="code-editor-"]')).toHaveCount(0)
    await expect(page.locator(JS_TOGGLE)).toHaveCount(0)

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#open-marker')).toBeVisible()
  })

  test('empty HTML page shows a simple empty state instead of a frame', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Empty Page')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openPreview(page, title)

    await expect(page.getByText(/no content yet/i)).toBeVisible()
    await expect(page.locator(PREVIEW_FRAME)).toHaveCount(0)
  })

  test('editing HTML updates the rendered preview after returning', async ({ page, request }) => {
    const title = uniqueTitle('Live Preview')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    const save = nextSave(page)
    await typeIntoEditor(page, '<p id="typed-marker">typed body</p>')
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)

    // Return to the parent's rendered view; the typed body appears.
    await page.getByTestId('return-to-preview').click()
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#typed-marker')).toHaveText('typed body')
  })

  test('autosave reaches Saved and a reload shows the persisted edit', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Autosave Reload')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    const save = nextSave(page)
    await typeIntoEditor(page, '<p id="persist-marker">reload me</p>')
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('reload me')
    await expectSaved(page)

    await page.reload()
    await openSource(page, title, 'html')
    await expect(page.locator('[data-testid="code-editor-html"] .cm-content')).toContainText(
      'reload me'
    )
  })

  test('Mod-S performs a manual save without opening the browser dialog', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Manual Save')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    const save = nextSave(page)
    await typeIntoEditor(page, '<p id="manual-marker">manual</p>')
    await page.keyboard.press('Control+s')
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('manual-marker')

    const stored = await readStoredContent(request, title)
    expect(stored).toContain('manual-marker')
  })

  test('failed saves surface Retry and recover', async ({ page, request }) => {
    const title = uniqueTitle('Failed Save')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    let failNextPatch = true
    await page.route('**/api/pages/*', async (route) => {
      if (route.request().method() === 'PATCH' && failNextPatch) {
        failNextPatch = false
        await route.fulfill({ status: 500, body: '{"error":"boom"}' })
        return
      }
      await route.continue()
    })

    await typeIntoEditor(page, '<p id="retry-marker">retry me</p>')
    await expect(page.getByText('Save failed')).toBeVisible({ timeout: 10_000 })
    // The editor's own Retry control drains the pending content save.
    const save = nextSave(page)
    await page.getByTestId('html-editor-retry').click()
    const result = await save.done
    expect(result.ok, `PATCH failed after retry: ${result.status}`).toBe(true)
    expect(result.payload).toContain('retry-marker')
    await expectSaved(page)

    const stored = await readStoredContent(request, title)
    expect(stored).toContain('retry-marker')
  })

  test('switching pages flushes pending edits without loss', async ({ page, request }) => {
    const title = uniqueTitle('Switch Flush')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    await typeIntoEditor(page, '<p id="flush-marker">flushed</p>')
    // Leave immediately — before the autosave debounce fires.
    await page.locator('[aria-label="Home"]').click()
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()

    await openSource(page, title, 'html')
    await expect(page.locator('[data-testid="code-editor-html"] .cm-content')).toContainText(
      'flushed'
    )
  })

  test('JavaScript is disabled by default and seeded code does not execute', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('JS Default Off')
    await seedHtmlPage(request, title, {
      content: JSON.stringify({
        version: 2,
        html: '<p id="static-marker">static</p>',
        css: '',
        javascript: 'document.documentElement.setAttribute("data-probe", "ran")',
        jsEnabled: false
      })
    })
    await openPreview(page, title)

    // The gate is inspected from its new home: the JavaScript subfile.
    await openSource(page, title, 'javascript')
    await expect(page.locator(JS_TOGGLE)).not.toBeChecked()
    await page.getByTestId('return-to-preview').click()
    await expect(page.locator(PREVIEW_VIEW)).toBeVisible()

    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#static-marker')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(frame.locator('html[data-probe="ran"]')).toHaveCount(0)
  })

  test('enabling JavaScript executes the pane after rebuild', async ({ page, request }) => {
    const title = uniqueTitle('JS Enable')
    await seedHtmlPage(request, title, {
      content: JSON.stringify({
        version: 2,
        html: '',
        css: '',
        javascript: 'document.documentElement.setAttribute("data-probe", "ran")',
        jsEnabled: false
      })
    })
    await openPreview(page, title)

    // Enable the gate inside the JavaScript subfile, then return to preview.
    await openSource(page, title, 'javascript')
    const save = nextSave(page)
    await page.locator(JS_TOGGLE).click()
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('"jsEnabled":true')

    await page.getByTestId('return-to-preview').click()
    await expect(page.locator(PREVIEW_VIEW)).toBeVisible()
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('html[data-probe="ran"]')).toBeAttached({ timeout: 10_000 })
  })

  test('the toggle persists across reload and page switching', async ({ page, request }) => {
    const title = uniqueTitle('Toggle Persist')
    // Non-throwing probe: this scenario targets persistence, not error
    // containment (covered by the security suite).
    await seedHtmlPage(request, title, {
      content:
        '{"version":2,"html":"","css":"","javascript":"document.documentElement.setAttribute(\\"data-probe\\", \\"ran\\")","jsEnabled":false}'
    })
    await openPreview(page, title)

    await openSource(page, title, 'javascript')
    const save = nextSave(page)
    await page.locator(JS_TOGGLE).click()
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('"jsEnabled":true')
    await expectSaved(page)

    await page.reload()
    await openPreview(page, title)
    await openSource(page, title, 'javascript')
    await expect(page.locator(JS_TOGGLE)).toBeChecked()

    await page.locator('[aria-label="Home"]').click()
    await openPreview(page, title)
    await openSource(page, title, 'javascript')
    await expect(page.locator(JS_TOGGLE)).toBeChecked()
  })

  test('legacy schema-v1 documents load safely and normalize on first save', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('V1 Compat')
    await seedHtmlPage(request, title, {
      content: '{"version":1,"html":"<b>legacy body</b>","css":"b{}","javascript":"v1fn()"}'
    })
    await openPreview(page, title)

    // Loads with JavaScript disabled by normalization (asserted through the
    // stored bytes after the next save below); the gate itself lives in the
    // JavaScript subfile.
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('text=legacy body')).toBeVisible()

    // An edit re-serializes as v2 with jsEnabled false — stored bytes upgrade
    // only through an actual save, never silently.
    await openSource(page, title, 'html')
    const save = nextSave(page)
    await typeIntoEditor(page, '<i> appended</i>')
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('"version":2')
    expect(result.payload).toContain('"jsEnabled":false')
    await expectSaved(page)
    const stored = await readStoredContent(request, title)
    expect(stored).toContain('"version":2')
    expect(stored).toContain('"jsEnabled":false')
    expect(stored).toContain('legacy body')
  })

  test('editing never weakens normalization: scripts typed into HTML stay inert', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Edit Security')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'html')

    await typeIntoEditor(page, '<p>ok</p><script>window.__injected = true;</script>')
    // Returning to the preview flushes first; the sanitized output renders.
    await page.getByTestId('return-to-preview').click()
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('text=ok')).toBeVisible()
    await expect(frame.locator('script:not([nonce])')).toHaveCount(0)
  })

  test('CSS and JavaScript subfiles each open their own editor only', async ({ page, request }) => {
    const title = uniqueTitle('Subfile Isolation')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openSource(page, title, 'css')
    await expect(page.locator('[data-testid="code-editor-css"]')).toBeVisible()
    await expect(page.locator('[data-testid="code-editor-html"]')).toHaveCount(0)

    await page.getByTestId('return-to-preview').click()
    await openSource(page, title, 'javascript')
    await expect(page.locator('[data-testid="code-editor-javascript"]')).toBeVisible()
    await expect(page.locator('[data-testid="code-editor-css"]')).toHaveCount(0)
  })

  test('preview fills the central area at a mobile viewport', async ({ page, request }) => {
    const title = uniqueTitle('Mobile Preview')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"<p>m</p>","css":"","javascript":"","jsEnabled":false}'
    })
    await page.setViewportSize({ width: 480, height: 900 })
    await openPreview(page, title)

    const boxes = await page.evaluate(() => {
      const preview = document
        .querySelector('[data-testid="live-preview"]')
        ?.getBoundingClientRect()
      const workspace = document.querySelector('[data-testid="html-preview-view"]')
      const ws = workspace?.getBoundingClientRect()
      if (!preview || !ws) return null
      return { previewWidth: preview.width, workspaceWidth: ws.width }
    })
    if (!boxes) throw new Error('layout probe failed: preview not found')
    // Single-pane preview uses effectively the whole central width.
    expect(boxes.previewWidth).toBeGreaterThan(boxes.workspaceWidth * 0.8)
  })
})
