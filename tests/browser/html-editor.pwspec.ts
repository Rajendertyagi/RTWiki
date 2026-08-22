import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * Phase 4B browser suite — editable HTML workspace.
 *
 * Covers the CodeMirror tabs, autosave/manual save states, reload and
 * page-switch persistence, keyboard shortcuts, responsive split view, and
 * the per-page JavaScript toggle (disabled by default; v1 compatibility).
 * Security enforcement itself remains covered by html-preview.pwspec.ts;
 * this suite spot-checks that editing does not weaken it.
 */

const EDITOR_ROOT = '[data-testid="html-editor"]'
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

async function openHtmlPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator(EDITOR_ROOT)).toBeVisible()
  await expect(page.locator(PREVIEW_FRAME)).toBeVisible()
}

/** Types text into the active CodeMirror pane. */
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
  let pageErrors: Error[] = []

  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test.afterEach(() => {
    expect(pageErrors, 'no uncaught exceptions in the application').toEqual([])
  })

  test('editor opens with tabs, JS off by default and live preview', async ({ page, request }) => {
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
    await openHtmlPage(page, title)

    await expect(page.getByRole('tab', { name: 'HTML' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'CSS' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'JavaScript' })).toBeVisible()
    await expect(page.locator(JS_TOGGLE)).not.toBeChecked()

    // HTML/CSS preview works while JavaScript is disabled.
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#open-marker')).toBeVisible()
  })

  test('typing updates the live preview after the centralized debounce', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Live Preview')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openHtmlPage(page, title)

    await typeIntoEditor(page, '<p id="typed-marker">typed body</p>')
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
    await openHtmlPage(page, title)

    const save = nextSave(page)
    await typeIntoEditor(page, '<p id="persist-marker">reload me</p>')
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('reload me')
    await expectSaved(page)

    await page.reload()
    await openHtmlPage(page, title)
    await expect(page.locator('[data-testid="code-editor-html"] .cm-content')).toContainText(
      'reload me'
    )
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('#persist-marker')).toBeVisible()
  })

  test('Mod-S performs a manual save without opening the browser dialog', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Manual Save')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"","css":"","javascript":"","jsEnabled":false}'
    })
    await openHtmlPage(page, title)

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
    await openHtmlPage(page, title)

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
    // The header owns the Retry action.
    const save = nextSave(page)
    await page.getByRole('button', { name: 'Retry' }).click()
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
    await openHtmlPage(page, title)

    await typeIntoEditor(page, '<p id="flush-marker">flushed</p>')
    // Leave immediately — before the autosave debounce fires.
    await page.locator('[aria-label="Back to pages"]').click()
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()

    await openHtmlPage(page, title)
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
    await openHtmlPage(page, title)

    await expect(page.locator(JS_TOGGLE)).not.toBeChecked()
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
    await openHtmlPage(page, title)

    const save = nextSave(page)
    await page.locator(JS_TOGGLE).click()
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('"jsEnabled":true')

    // After the debounced rebuild the pane executes with the flag on.
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
    await openHtmlPage(page, title)

    const save = nextSave(page)
    await page.locator(JS_TOGGLE).click()
    const result = await save.done
    expect(result.ok, `PATCH failed: ${result.status}`).toBe(true)
    expect(result.payload).toContain('"jsEnabled":true')
    await expectSaved(page)

    await page.reload()
    await openHtmlPage(page, title)
    await expect(page.locator(JS_TOGGLE)).toBeChecked()

    await page.locator('[aria-label="Back to pages"]').click()
    await openHtmlPage(page, title)
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
    await openHtmlPage(page, title)

    // Loads with JavaScript disabled by normalization.
    await expect(page.locator(JS_TOGGLE)).not.toBeChecked()
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('text=legacy body')).toBeVisible()

    // An edit re-serializes as v2 with jsEnabled false — stored bytes upgrade
    // only through an actual save, never silently.
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
    await openHtmlPage(page, title)

    await typeIntoEditor(page, '<p>ok</p><script>window.__injected = true;</script>')
    const frame = page.frameLocator(PREVIEW_FRAME)
    await expect(frame.locator('text=ok')).toBeVisible()
    await expect(frame.locator('script:not([nonce])')).toHaveCount(0)
  })

  test('split view stacks vertically at mobile viewport', async ({ page, request }) => {
    const title = uniqueTitle('Mobile Stack')
    await seedHtmlPage(request, title, {
      content: '{"version":2,"html":"<p>m</p>","css":"","javascript":"","jsEnabled":false}'
    })
    await page.setViewportSize({ width: 480, height: 900 })
    await openHtmlPage(page, title)

    const boxes = await page.evaluate(() => {
      const editor = document
        .querySelector('[data-testid^="code-editor-"]')
        ?.getBoundingClientRect()
      const preview = document
        .querySelector('[data-testid="live-preview"]')
        ?.getBoundingClientRect()
      if (!editor || !preview) return null
      return { editorBottom: editor.bottom, previewTop: preview.top }
    })
    if (!boxes) {
      throw new Error('layout probe failed: panes not found')
    }
    expect(boxes.previewTop).toBeGreaterThanOrEqual(boxes.editorBottom - 1)
  })
})
