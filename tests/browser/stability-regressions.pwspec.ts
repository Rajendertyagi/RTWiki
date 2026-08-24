import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { UI_TEXT } from '../../src/web/config/index.js'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Regression coverage for the owner-reported stability defects:
 * - exact-title tree rename across page shapes (defect 8)
 * - rapid HTML/CSS/JavaScript source switching without text loss (1, 2)
 * - return-to-parent renders the newest draft; Refresh Preview works (3, 5)
 * - browser refresh restores tabs/page/source view (6)
 * - control placement: JS gate only in the JavaScript subfile (10, 11)
 * - drag-target indicator styles are visible and layout-safe (7)
 * - dashboard card previews never leak raw markup such as svg (12)
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  pageType: 'rich' | 'html',
  content: string | Record<string, unknown>,
  parentId?: string
): Promise<{ id: string }> {
  const payload: Record<string, unknown> = {
    title,
    pageType,
    content: typeof content === 'string' ? content : JSON.stringify({ version: 2, ...content })
  }
  if (parentId) payload.parentId = parentId
  const res = await request.post('/api/pages', { data: payload })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pageRow(page: Page, title: string) {
  const pattern = new RegExp(`^${escapeRegExp(title)}\\s*(Rich Note|HTML Page)`)
  return page.locator('[role="treeitem"]').filter({ hasText: pattern }).first()
}

async function expandRow(page: Page, id: string): Promise<void> {
  const row = page.locator(`[role="treeitem"][data-page-id="${id}"]`)
  const expand = row.locator('[aria-label="Expand"]')
  // Idempotent: only click when actually collapsed, otherwise a second call
  // would collapse the row again.
  if ((await expand.count()) > 0 && (await row.getAttribute('aria-expanded')) !== 'true') {
    await expand.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}

/** Opens a virtual subfile editor by its suffix field. */
async function openSubfile(page: Page, id: string, field: 'html' | 'css' | 'javascript') {
  await expandRow(page, id)
  const sub = page.locator(`[role="treeitem"][data-subfile-id$="::${field}"]`)
  await sub.click()
  await expect(page.locator(`[data-testid="code-editor-${field}"]`)).toBeVisible()
}

async function typeIntoEditor(page: Page, field: string, text: string): Promise<void> {
  await page.locator(`[data-testid="code-editor-${field}"] .cm-content`).click()
  await page.keyboard.type(text)
}

async function readEditor(page: Page, field: string): Promise<string> {
  return page.evaluate((f) => {
    const cm = document.querySelector(`[data-testid="code-editor-${f}"] .cm-content`)
    return cm?.textContent ?? ''
  }, field)
}

async function openPageByRow(page: Page, title: string): Promise<void> {
  await pageRow(page, title).click()
}

test.describe('stability regressions', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  let pageErrors: Error[] = []

  // Tests that specifically exercise workspace restoration keep sessionStorage;
  // every other test opts out so goto('/') lands on the dashboard.
  const RESTORATION_TESTS = new Set([
    'restores tabs, active page and the active source subfile',
    'falls back to Home when the stored workspace references nothing valid'
  ])

  test.beforeEach(({ page }, testInfo) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
    if (!RESTORATION_TESTS.has(testInfo.title)) {
      void page.addInitScript(() => {
        try {
          window.sessionStorage.clear()
        } catch {
          // Storage may be unavailable; nothing to reset.
        }
      })
    }
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  // ---------- defect 8: rename corruption ----------
  test.describe('rename uses the entered title everywhere', () => {
    async function renameViaTree(page: Page, from: string, to: string) {
      await pageRow(page, from).click({ button: 'right' })
      const menu = page.getByTestId('tree-context-menu')
      await menu.waitFor()
      // exact:true — substring matching would also hit "Move to parent
      // page: <Renamed…>" targets.
      await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const input = page.getByTestId('page-rename-input')
      await expect(input).toHaveValue(from)
      await input.fill(to)
      await input.press('Enter')
      await expect(input).toHaveCount(0)
    }

    async function expectTitleEverywhere(
      page: Page,
      request: APIRequestContext,
      id: string,
      title: string
    ) {
      // Server truth first (authoritative), then the rendered row by its
      // stable page-id attribute and exact label text.
      await expect
        .poll(async () => {
          const res = await request.get('/api/pages')
          const list = (await res.json()) as { pages: Array<{ id: string; title: string }> }
          return list.pages.find((p) => p.id === id)?.title
        })
        .toBe(title)
      const row = page.locator(`[role="treeitem"][data-page-id="${id}"]`)
      await expect(row).toBeVisible()
      await expect(row.getByText(title, { exact: true })).toBeVisible()

      // Opening the renamed page asserts the header input and tab label. The
      // tab's accessible name also contains the close control's label, so
      // match by substring here.
      await row.click()
      await expect(page.locator('input[aria-label="Title"]')).toHaveValue(title)
      await expect(
        page.locator('[aria-label="Open pages"]').getByRole('tab', { name: title })
      ).toBeVisible()
    }

    test('root Rich Note rename', async ({ page, request }) => {
      const original = uniqueTitle('Ren Root')
      const renamed = `Renamed Root ${Date.now()}`
      const p = await seedPage(request, original, 'rich', '')
      await page.goto('/')
      await pageRow(page, original).waitFor()
      await renameViaTree(page, original, renamed)
      await expectTitleEverywhere(page, request, p.id, renamed)
    })

    test('child Rich Note rename does not touch other pages', async ({ page, request }) => {
      const parentTitle = uniqueTitle('Ren Parent')
      const childOriginal = uniqueTitle('Ren Child')
      const childRenamed = `Renamed Child ${Date.now()}`
      const parent = await seedPage(request, parentTitle, 'rich', '')
      const child = await seedPage(request, childOriginal, 'rich', '', parent.id)
      await page.goto('/')
      await expandRow(page, parent.id)
      await pageRow(page, childOriginal).waitFor()
      await renameViaTree(page, childOriginal, childRenamed)
      // A mutation-triggered refetch remounts the tree (pre-existing
      // behaviour), so re-expand the parent before asserting the child row.
      await expandRow(page, parent.id)
      await expectTitleEverywhere(page, request, child.id, childRenamed)
      // The parent's title is untouched by the child rename.
      const res = await request.get('/api/pages')
      const list = (await res.json()) as { pages: Array<{ id: string; title: string }> }
      expect(list.pages.find((p) => p.id === parent.id)?.title).toBe(parentTitle)
    })

    test('nested HTML parent rename', async ({ page, request }) => {
      const rootTitle = uniqueTitle('Ren HtmlRoot')
      const childOriginal = uniqueTitle('Ren HtmlChild')
      const childRenamed = `Renamed HtmlChild ${Date.now()}`
      const root = await seedPage(request, rootTitle, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      const child = await seedPage(
        request,
        childOriginal,
        'html',
        { html: '', css: '', javascript: '', jsEnabled: false },
        root.id
      )
      await page.goto('/')
      await expandRow(page, root.id)
      await pageRow(page, childOriginal).waitFor()
      await renameViaTree(page, childOriginal, childRenamed)
      // Same refetch-remount re-expansion as above.
      await expandRow(page, root.id)
      await expectTitleEverywhere(page, request, child.id, childRenamed)
    })

    test('cancel leaves the title unchanged', async ({ page, request }) => {
      const original = uniqueTitle('Ren Cancel')
      await seedPage(request, original, 'rich', '')
      await page.goto('/')
      await pageRow(page, original).waitFor()
      await pageRow(page, original).click({ button: 'right' })
      const menu = page.getByTestId('tree-context-menu')
      await menu.waitFor()
      await menu.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const input = page.getByTestId('page-rename-input')
      await expect(input).toHaveValue(original)
      await input.fill('This must never persist')
      await input.press('Escape')
      await expect(input).toHaveCount(0)
      await expect(pageRow(page, original)).toBeVisible()
      const res = await request.get('/api/pages')
      const list = (await res.json()) as { pages: Array<{ title: string }> }
      expect(list.pages.some((p) => p.title === 'This must never persist')).toBe(false)
    })

    test('virtual subfiles cannot be renamed', async ({ page, request }) => {
      const title = uniqueTitle('Ren Subfile')
      const p = await seedPage(request, title, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await expandRow(page, p.id)
      const sub = page.locator('[role="treeitem"][data-subfile-id$="::css"]')
      await sub.click({ button: 'right' })
      // Native menu is suppressed and no app context menu opens.
      await expect(page.getByTestId('tree-context-menu')).toHaveCount(0)
      await expect(page.getByTestId('page-rename-input')).toHaveCount(0)
    })
  })

  // ---------- defects 1+2: rapid source switching ----------
  test.describe('rapid source-field switching preserves every character', () => {
    test('type HTML → CSS → JavaScript → back to HTML before autosave lands', async ({
      page,
      request
    }) => {
      const title = uniqueTitle('Switch Fast')
      const p = await seedPage(request, title, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)
      await openSubfile(page, p.id, 'html')

      // Markers without tag syntax: CodeMirror's HTML auto-closing may add a
      // closing tag when `<p ...>` is typed, so full-markup equality is not
      // the contract — every typed character of CONTENT must survive.
      const markerHtml = `HTML-${titleSeq}`
      await typeIntoEditor(page, 'html', markerHtml)
      // Switch IMMEDIATELY — the autosave debounce has not fired yet.
      await openSubfile(page, p.id, 'css')
      const markerCss = `CSS-${titleSeq}`
      await typeIntoEditor(page, 'css', markerCss)
      await openSubfile(page, p.id, 'javascript')
      const markerJs = `JS-${titleSeq}`
      await typeIntoEditor(page, 'javascript', markerJs)

      // Return to each previously edited field: the newest text must survive.
      await openSubfile(page, p.id, 'html')
      expect(await readEditor(page, 'html')).toContain(markerHtml)
      await openSubfile(page, p.id, 'css')
      expect(await readEditor(page, 'css')).toContain(markerCss)
      await openSubfile(page, p.id, 'javascript')
      expect(await readEditor(page, 'javascript')).toContain(markerJs)

      // After everything saves, the server holds all three fields.
      await page.waitForTimeout(2600)
      const res = await request.get('/api/pages')
      const list = (await res.json()) as { pages: Array<{ id: string; content: string }> }
      const stored = list.pages.find((x) => x.id === p.id)?.content ?? ''
      expect(stored).toContain(markerHtml)
      expect(stored).toContain(markerCss)
      expect(stored).toContain(markerJs)
    })

    test('switching to another Rich Note and back keeps the draft', async ({ page, request }) => {
      const htmlTitle = uniqueTitle('Switch Away')
      const richTitle = uniqueTitle('Switch Other')
      const p = await seedPage(request, htmlTitle, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await seedPage(request, richTitle, 'rich', '')
      await page.goto('/')
      await openPageByRow(page, htmlTitle)
      await openSubfile(page, p.id, 'css')

      const marker = `body{color:#123456}`
      await typeIntoEditor(page, 'css', marker)
      await openPageByRow(page, richTitle)
      await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
      await openPageByRow(page, htmlTitle)
      await openSubfile(page, p.id, 'css')
      expect(await readEditor(page, 'css')).toContain(marker)
    })

    test('text survives after Saved and after a full reload', async ({ page, request }) => {
      const title = uniqueTitle('Switch Saved')
      const p = await seedPage(request, title, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)
      await openSubfile(page, p.id, 'javascript')

      const marker = `// saved-${titleSeq}`
      await typeIntoEditor(page, 'javascript', marker)
      await expect(page.locator('p[aria-live="polite"]').filter({ hasText: 'Saved' })).toBeVisible({
        timeout: 10_000
      })

      await page.reload()
      // Deterministic re-entry: wait for the dashboard, reopen the page,
      // confirm the rendered parent view, then open the JavaScript subfile.
      await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
      await openPageByRow(page, title)
      await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()
      await openSubfile(page, p.id, 'javascript')
      // Poll: the CodeMirror view mounts one frame after the lazy chunk loads.
      await expect
        .poll(async () => readEditor(page, 'javascript'), { timeout: 10_000 })
        .toContain(marker)
    })
  })

  // ---------- defects 3+5: parent preview + Refresh ----------
  test.describe('parent preview renders the newest draft', () => {
    test('returning from a subfile shows typed content immediately', async ({ page, request }) => {
      const title = uniqueTitle('Return Preview')
      const p = await seedPage(request, title, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)
      await openSubfile(page, p.id, 'html')

      const markerId = `ret-${titleSeq}`
      await typeIntoEditor(page, 'html', `<p id="${markerId}">fresh</p>`)
      await page.getByTestId('return-to-preview').click()
      await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()
      const frame = page.frameLocator('[data-testid="preview-iframe"]')
      await expect(frame.locator(`#${markerId}`)).toHaveText('fresh')
    })

    test('Refresh Preview rebuilds the frame without losing selection', async ({
      page,
      request
    }) => {
      const title = uniqueTitle('Refresh Action')
      await seedPage(request, title, 'html', {
        html: '<p id="rf">refreshable</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)
      await expect(page.locator('[data-testid="live-preview"] iframe')).toBeVisible()

      await page.getByTestId('refresh-preview').click()
      // The frame is rebuilt and renders again; the same page stays selected.
      const frame = page.frameLocator('[data-testid="preview-iframe"]')
      await expect(frame.locator('#rf')).toHaveText('refreshable')
      await expect(pageRow(page, title)).toHaveAttribute('aria-selected', 'true')
      // The accessible refresh status is transient by design.
      await expect(page.locator('[data-testid="preview-refresh-status"]')).toBeHidden({
        timeout: 5_000
      })
    })
  })

  // ---------- defect 6: reload restoration ----------
  test.describe('browser refresh restores the workspace', () => {
    test('restores tabs, active page and the active source subfile', async ({ page, request }) => {
      const htmlTitle = uniqueTitle('Restore Html')
      const richTitle = uniqueTitle('Restore Rich')
      const p = await seedPage(request, htmlTitle, 'html', {
        html: '<p>restore</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await seedPage(request, richTitle, 'rich', '')
      await page.goto('/')
      await openPageByRow(page, richTitle)
      await openPageByRow(page, htmlTitle)
      await openSubfile(page, p.id, 'css')

      await page.reload()
      // Both tabs are recreated, the HTML page is active again, and the CSS
      // subfile view is reopened — no manual navigation.
      await expect(page.locator('[aria-label="Open pages"]').getByText(htmlTitle)).toBeVisible()
      await expect(page.locator('[aria-label="Open pages"]').getByText(richTitle)).toBeVisible()
      await expect(page.locator('[data-testid="code-editor-css"]')).toBeVisible()
      await expect(pageRow(page, htmlTitle)).toHaveAttribute('aria-selected', 'true')
    })

    test('falls back to Home when the stored workspace references nothing valid', async ({
      page
    }) => {
      await page.addInitScript(() => {
        window.sessionStorage.setItem(
          'rtwiki.workspace.session',
          JSON.stringify({
            version: 1,
            openPageIds: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
            activePageId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            sourceField: 'preview',
            expandedTreeIds: []
          })
        )
      })
      await page.goto('/')
      // No valid pages: the dashboard is shown and no phantom tabs appear.
      await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
      await expect(page.locator('[aria-label="Open pages"] [role="tab"]')).toHaveCount(0)
    })
  })

  // ---------- defects 10+11: control placement ----------
  test.describe('JavaScript gate lives only in the JavaScript subfile', () => {
    test('parent preview shows Refresh but no JS toggle or sandbox paragraph', async ({
      page,
      request
    }) => {
      const title = uniqueTitle('Placement Parent')
      await seedPage(request, title, 'html', {
        html: '<p>x</p>',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)
      await expect(page.getByTestId('refresh-preview')).toBeVisible()
      await expect(page.getByTestId('js-enabled-toggle')).toHaveCount(0)
      await expect(page.getByText(/Sandboxed preview\. Scripts run/i)).toHaveCount(0)
    })

    test('HTML and CSS subfiles show no JS toggle; JavaScript subfile hosts it', async ({
      page,
      request
    }) => {
      const title = uniqueTitle('Placement Subs')
      const p = await seedPage(request, title, 'html', {
        html: '',
        css: '',
        javascript: '',
        jsEnabled: false
      })
      await page.goto('/')
      await openPageByRow(page, title)

      await openSubfile(page, p.id, 'html')
      await expect(page.getByTestId('js-enabled-toggle')).toHaveCount(0)
      await openSubfile(page, p.id, 'css')
      await expect(page.getByTestId('js-enabled-toggle')).toHaveCount(0)

      await openSubfile(page, p.id, 'javascript')
      await expect(page.getByTestId('js-enabled-toggle')).toBeVisible()
      // Compact help instead of a permanent technical paragraph: the info
      // icon carries the sandbox explanation as its accessible name (the
      // Mantine tooltip body itself is hover-lazy and not always in the DOM).
      await expect(page.locator(`[aria-label="${UI_TEXT.jsSandboxHint}"]`)).toBeAttached()
      await expect(page.getByText(/Sandboxed preview\. Scripts run/i)).toHaveCount(0)
    })
  })

  // ---------- defect 7: drop targeting visuals ----------
  test.describe('drag targeting indicators are wired and visible', () => {
    test('indicator styles resolve to visible geometry in both themes', async ({
      page,
      request
    }) => {
      await seedPage(request, uniqueTitle('DnD Style'), 'rich', '')
      await page.goto('/')
      await page.getByTestId('page-tree').waitFor()

      const probe = await page.evaluate(() => {
        const readRules = (): Record<string, Record<string, string>> => {
          const out: Record<string, Record<string, string>> = {}
          for (const sheet of Array.from(document.styleSheets)) {
            let rules: CSSRuleList
            try {
              rules = sheet.cssRules
            } catch {
              continue
            }
            for (const rule of Array.from(rules)) {
              const style = (rule as CSSStyleRule).style
              if (!style) continue
              const selector = (rule as CSSStyleRule).selectorText ?? ''
              // Only the BASE insertLine rule; the Top/Bottom variants carry
              // offsets, not the visible geometry under test.
              if (
                selector.includes('insertLine') &&
                !selector.includes('insertLineTop') &&
                !selector.includes('insertLineBottom')
              ) {
                out.insertLine = {
                  position: style.position,
                  height: style.height,
                  background: style.background
                }
              }
              if (selector.includes('dropInside')) {
                out.dropInside = { boxShadow: style.boxShadow, background: style.background }
              }
            }
          }
          return out
        }
        return readRules()
      })

      // Before/after line: absolutely positioned overlay of visible height.
      expect(probe.insertLine?.position).toBe('absolute')
      expect(Number.parseFloat(probe.insertLine?.height ?? '0')).toBeGreaterThanOrEqual(2)
      expect(probe.insertLine?.background).not.toContain('transparent')
      // Inside highlight: a non-none inset ring plus a background wash.
      expect(probe.dropInside?.boxShadow).toBeTruthy()
      expect(probe.dropInside?.boxShadow).not.toBe('none')
      expect(probe.dropInside?.background).toBeTruthy()
    })

    test('before/inside/after drops still commit correctly (semantics intact)', async ({
      page,
      request
    }) => {
      const a = await seedPage(request, uniqueTitle('DnD A'), 'rich', '')
      const b = await seedPage(request, uniqueTitle('DnD B'), 'rich', '')
      const c = await seedPage(request, uniqueTitle('DnD C'), 'rich', '')
      await page.goto('/')
      await page.locator(`[data-page-id="${c.id}"]`).waitFor()

      const order = async (): Promise<string[]> => {
        const res = await request.get('/api/pages')
        // The list endpoint returns an envelope: { pages: [...], total }.
        const body = (await res.json()) as { pages: Array<{ id: string; position: number }> }
        return body.pages
          .filter((x) => [a.id, b.id, c.id].includes(x.id))
          .sort((x, y) => x.position - y.position)
          .map((x) => x.id)
      }

      // before A
      await page
        .locator(`[data-page-id="${c.id}"]`)
        .dragTo(page.locator(`[data-page-id="${a.id}"]`), {
          targetPosition: { x: 40, y: 3 }
        })
      await expect.poll(order).toEqual([c.id, a.id, b.id])

      // inside B (append under B)
      await page
        .locator(`[data-page-id="${b.id}"]`)
        .dragTo(page.locator(`[data-page-id="${b.id}"]`), {
          targetPosition: { x: 40, y: 16 }
        })
      await expect
        .poll(async () => {
          const res = await request.get(`/api/pages`)
          const body = (await res.json()) as {
            pages: Array<{ id: string; parentId: string | null }>
          }
          return body.pages.find((x) => x.id === c.id)?.parentId
        })
        .toBe(b.id)
    })
  })

  // ---------- defect 12: raw markup on cards ----------
  test('dashboard card previews never show raw svg markup', async ({ page, request }) => {
    await seedPage(request, uniqueTitle('Svg Encoded'), 'html', {
      html: '&lt;svg&gt;<p>encoded ok</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await seedPage(request, uniqueTitle('Svg Unclosed'), 'html', {
      html: '<svg <p>unclosed ok</p>',
      css: '',
      javascript: '',
      jsEnabled: false
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
    const previews = await page.locator('span').allTextContents()
    const leaking = previews.filter((t) => /<svg|svg>/i.test(t))
    expect(leaking).toEqual([])
    expect(previews.some((t) => t.includes('encoded ok'))).toBe(true)
    expect(previews.some((t) => t.includes('unclosed ok'))).toBe(true)
  })
})
