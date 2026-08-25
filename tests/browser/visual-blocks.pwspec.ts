import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Visual knowledge blocks (Formula, Diagram, Mind Map, Callouts) in the
 * Rich Document editor: insertion through the toolbar Insert menu,
 * preview-first rendering, contained errors, autosave/reload/duplicate
 * compatibility, search/preview readability, theme and narrow-width smoke.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedRich(
  request: APIRequestContext,
  title: string,
  blocks: Array<Record<string, unknown>>
): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify(blocks) }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

async function getStoredContent(
  request: APIRequestContext,
  id: string
): Promise<string | undefined> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; content: string }> }
  return body.pages.find((p) => p.id === id)?.content
}

/** Opens a Rich Note from the dashboard card. */
async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

/** Inserts a block through the toolbar Insert menu. */
async function insertViaMenu(page: Page, key: string): Promise<void> {
  await page.getByTestId('insert-menu-button').click()
  await page.getByTestId(key).click()
}

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
      let payload = req.postData() ?? ''
      try {
        const envelope = JSON.parse(payload) as { content?: string }
        if (typeof envelope.content === 'string') payload = envelope.content
      } catch {
        // Non-envelope bodies fail payload assertions below.
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

test.describe('visual knowledge blocks', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  let pageErrors: Error[] = []
  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
    // Surface page-side warnings (e.g. bounded mermaid phase diagnostics).
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`PAGECONSOLE [${msg.type()}] ${msg.text().slice(0, 160)}`)
      }
    })
    // Dashboard-first semantics unless a test specifically reloads.
    void page.addInitScript(() => {
      try {
        window.sessionStorage.clear()
      } catch {
        // Storage may be unavailable.
      }
    })
  })

  /** Asserts a Mermaid block reached the rendered state, surfacing which
   * state it actually reached when it did not. */
  async function expectRendered(page: Page, blockType: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const svg = await page.locator(`[data-testid="${blockType}-svg"] svg`).count()
          const error = await page.locator(`[data-testid="${blockType}-error"]`).count()
          if (svg > 0) return 'svg'
          if (error > 0) return 'error'
          return 'pending'
        },
        { timeout: 20_000 }
      )
      .toBe('svg')
  }
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('formula: insert via menu → renders → autosaves canonical JSON', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB Formula')
    await seedRich(request, title, [])
    await openNote(page, title)

    const save = nextSave(page)
    await insertViaMenu(page, 'insert-formula')
    const result = await save.done
    expect(result.ok).toBe(true)
    // Starter LaTeX is stored as plain block content (canonical BlockNote JSON).
    expect(result.payload).toContain('"type":"mathBlock"')
    expect(result.payload).toContain('x^2 + y^2 = z^2')
    // The rendered formula appears as MathML in the preview.
    await expect(page.locator('[data-testid="rich-editor"] math').first()).toBeVisible()
  })

  test('invalid formula is contained with the friendly error state', async ({ page, request }) => {
    const title = uniqueTitle('VB BadFormula')
    await seedRich(request, title, [
      {
        id: 'bad-math',
        type: 'mathBlock',
        content: '\\frac{'
      },
      {
        id: 'after',
        type: 'paragraph',
        content: [{ type: 'text', text: 'still here', styles: {} }]
      }
    ])
    await openNote(page, title)
    // Friendly contained error, and the rest of the document still renders.
    await expect(page.getByText(/Invalid equation/i)).toBeVisible()
    await expect(page.getByText('still here')).toBeVisible()
  })

  test('flowchart: insert → render → edit source → save → reload', async ({ page, request }) => {
    const title = uniqueTitle('VB Flow')
    const p = await seedRich(request, title, [])
    await openNote(page, title)

    const save = nextSave(page)
    await insertViaMenu(page, 'insert-diagram')
    const result = await save.done
    expect(result.ok).toBe(true)
    expect(result.payload).toContain('"type":"diagram"')
    expect(result.payload).toContain('graph TD')

    // Rendered SVG appears inside the sanitized host.
    await expectRendered(page, 'diagram')

    // Edit the source through the block's own Edit action.
    await page.getByTestId('diagram-edit-button').click()
    const input = page.getByTestId('diagram-source-input')
    await expect(input).toBeVisible()
    await input.fill('graph TD\n    A[Start] --> B[End] --> C[Done]')
    const applySave = nextSave(page)
    await page.getByTestId('diagram-apply').click()
    const applied = await applySave.done
    expect(applied.ok).toBe(true)
    expect(applied.payload).toContain('C[Done]')
    await expectRendered(page, 'diagram')

    // Reload: persisted source re-renders.
    await page.reload()
    await openNote(page, title)
    await expectRendered(page, 'diagram')
    const stored = await getStoredContent(request, p.id)
    expect(stored).toContain('C[Done]')
  })

  test('sequence diagram inserts and renders', async ({ page, request }) => {
    const title = uniqueTitle('VB Sequence')
    await seedRich(request, title, [
      {
        id: 'seq',
        type: 'diagram',
        content: 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi'
      }
    ])
    await openNote(page, title)
    await expectRendered(page, 'diagram')
  })

  test('mind map: insert → render → edit → reload', async ({ page, request }) => {
    const title = uniqueTitle('VB MindMap')
    const p = await seedRich(request, title, [])
    await openNote(page, title)

    const save = nextSave(page)
    await insertViaMenu(page, 'insert-mind-map')
    const result = await save.done
    expect(result.ok).toBe(true)
    expect(result.payload).toContain('"type":"mindMap"')
    await expectRendered(page, 'mindMap')

    await page.getByTestId('mindMap-edit-button').click()
    const input = page.getByTestId('mindMap-source-input')
    await input.fill('mindmap\n  root((Root))\n    Alpha\n    Beta')
    const applySave = nextSave(page)
    await page.getByTestId('mindMap-apply').click()
    const applied = await applySave.done
    expect(applied.ok).toBe(true)
    expect(applied.payload).toContain('Beta')

    await page.reload()
    await openNote(page, title)
    await expectRendered(page, 'mindMap')
    const stored = await getStoredContent(request, p.id)
    expect(stored).toContain('Beta')
  })

  test('invalid Mermaid stays contained and recovers after correction', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB BadMermaid')
    const p = await seedRich(request, title, [
      { id: 'broken', type: 'diagram', content: 'graph TD\n  A [unclosed' },
      {
        id: 'after',
        type: 'paragraph',
        content: [{ type: 'text', text: 'paragraph survives', styles: {} }]
      }
    ])
    await openNote(page, title)
    await expect(page.getByTestId('diagram-error')).toBeVisible()
    await expect(page.getByText('paragraph survives')).toBeVisible()

    // Correct the source via the error state's Edit action.
    await page.getByTestId('diagram-edit-button').last().click()
    const input = page.getByTestId('diagram-source-input')
    await input.fill('graph TD\n  A[Fixed] --> B[Ok]')
    const applySave = nextSave(page)
    await page.getByTestId('diagram-apply').click()
    const applied = await applySave.done
    expect(applied.ok).toBe(true)
    await expectRendered(page, 'diagram')
    const stored = await getStoredContent(request, p.id)
    expect(stored).toContain('A[Fixed]')
  })

  test('unsafe Mermaid directives and markup are neutralized', async ({ page, request }) => {
    const title = uniqueTitle('VB UnsafeMermaid')
    await seedRich(request, title, [
      {
        id: 'evil',
        type: 'diagram',
        content:
          "%%{init: {'securityLevel':'loose', 'startOnLoad':true}}%%\ngraph TD\n  A[\"<img src=x onerror=window.__pwned=true>\"] -->|click me callback| B"
      }
    ])
    await openNote(page, title)
    // Either a contained render or a contained error — never execution.
    const rendered = await page.locator('[data-testid="diagram-svg"]').count()
    if (rendered > 0) {
      const host = page.locator('[data-testid="diagram-svg"]').first()
      await expect(host.locator('script')).toHaveCount(0)
      await expect(host.locator('img').first()).toHaveCount(0)
      const attrs = await host.evaluate((el) => el.innerHTML.toLowerCase())
      expect(attrs).not.toContain('onerror')
      expect(attrs).not.toContain('onclick')
      expect(attrs).not.toContain('javascript:')
    } else {
      await expect(page.getByTestId('diagram-error')).toBeVisible()
    }
    expect(
      await page.evaluate(() => (window as never as { __pwned?: boolean }).__pwned)
    ).toBeFalsy()
  })

  for (const variant of ['info', 'note', 'tip', 'warning', 'danger'] as const) {
    test(`callout ${variant}: insert, edit rich text, autosave`, async ({ page, request }) => {
      const title = uniqueTitle(`VB Callout ${variant}`)
      const p = await seedRich(request, title, [])
      await openNote(page, title)

      const save = nextSave(page)
      await insertViaMenu(page, `insert-callout-${variant}`)
      const result = await save.done
      expect(result.ok).toBe(true)
      expect(result.payload).toContain(`"variant":"${variant}"`)

      // Type into the callout's own editable inline content, prove the text
      // exists in the document DOM, then verify persisted state.
      const calloutBody = page
        .locator(`[data-variant="${variant}"] [contenteditable="true"]`)
        .first()
      await calloutBody.click()
      await page.keyboard.type(`Callout ${variant} text`)
      await expect(calloutBody).toContainText(`Callout ${variant} text`)
      await expect
        .poll(async () => (await getStoredContent(request, p.id)) ?? '', { timeout: 15_000 })
        .toContain(`Callout ${variant} text`)
      await expect(page.locator(`[data-variant="${variant}"]`).first()).toBeVisible()
    })
  }

  test('dashboard preview shows callout text, never serialized JSON', async ({ page, request }) => {
    const title = uniqueTitle('VB Preview')
    await seedRich(request, title, [
      {
        id: 'c1',
        type: 'callout',
        props: { variant: 'tip' },
        content: [{ type: 'text', text: 'Readable tip sentence', styles: {} }]
      },
      { id: 'd1', type: 'diagram', content: 'graph TD\n  A-->B' }
    ])
    await page.goto('/')
    const card = page.getByRole('button', { name: `Open ${title}`, exact: true })
    await card.waitFor()
    const cardText = (await card.textContent()) ?? ''
    expect(cardText).toContain('Readable tip sentence')
    expect(cardText).not.toContain('graph TD')
    expect(cardText).not.toContain('{')
  })

  test('duplicate preserves every visual block', async ({ page, request }) => {
    const title = uniqueTitle('VB Duplicate')
    const original = await seedRich(request, title, [
      { id: 'm', type: 'mathBlock', content: 'a^2+b^2=c^2' },
      { id: 'd', type: 'diagram', content: 'graph TD\n  X-->Y' },
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'warning' },
        content: [{ type: 'text', text: 'careful', styles: {} }]
      }
    ])
    const res = await request.post(`/api/pages/${original.id}/duplicate`)
    expect(res.status()).toBe(201)
    const listRes = await request.get('/api/pages')
    const body = (await listRes.json()) as { pages: Array<{ id: string; content: string }> }
    const copy = body.pages.find((x) => x.id !== original.id && x.content.includes('mathBlock'))
    expect(copy).toBeTruthy()
    expect(copy?.content).toContain('a^2+b^2=c^2')
    expect(copy?.content).toContain('X-->Y')
    expect(copy?.content).toContain('"variant":"warning"')
    expect(copy?.content).toContain('careful')
  })

  test('rapid tab/page switching does not lose block changes', async ({ page, request }) => {
    const htmlTitle = uniqueTitle('VB Switch HTML')
    const richTitle = uniqueTitle('VB Switch Rich')
    const rich = await seedRich(request, richTitle, [])
    const htmlRes = await request.post('/api/pages', {
      data: {
        title: htmlTitle,
        pageType: 'html',
        content: JSON.stringify({ version: 2, html: '', css: '', javascript: '', jsEnabled: false })
      }
    })
    expect(htmlRes.status()).toBe(201)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${richTitle}`, exact: true }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    const save = nextSave(page)
    await insertViaMenu(page, 'insert-callout-note')
    const inserted = await save.done
    expect(inserted.ok).toBe(true)

    // Switch away immediately (before autosave of further edits would land).
    await page.getByRole('button', { name: `Open ${htmlTitle}`, exact: true }).click()
    await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()
    await page.getByRole('button', { name: `Open ${richTitle}`, exact: true }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await expect(page.locator('[data-variant="note"]').first()).toBeVisible()

    const stored = await getStoredContent(request, rich.id)
    expect(stored).toContain('"type":"callout"')
  })

  test('browser reload restores the page and rendered blocks', async ({ page, request }) => {
    const title = uniqueTitle('VB Reload')
    await seedRich(request, title, [
      { id: 'd', type: 'diagram', content: 'graph TD\n  R[Reload] --> S[Stay]' }
    ])
    await openNote(page, title)
    await expect(page.locator('[data-testid="diagram-svg"] svg')).toBeVisible()
    await page.reload()
    await openNote(page, title)
    await expect(page.locator('[data-testid="diagram-svg"] svg')).toBeVisible()
  })

  test('dark theme keeps diagrams readable (render succeeds both schemes)', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB Theme')
    await seedRich(request, title, [
      { id: 'd', type: 'diagram', content: 'graph TD\n  L[Light] --> D[Dark]' }
    ])
    await openNote(page, title)
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible()
    await page.locator('[aria-label="Toggle color scheme"]').click()
    // Re-render in dark: the SVG is rebuilt (host persists, drawing refreshes).
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible()
    await page.locator('[aria-label="Toggle color scheme"]').click()
  })

  test('narrow width scrolls the diagram without overflowing the workspace', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB Narrow')
    await seedRich(request, title, [
      {
        id: 'd',
        type: 'diagram',
        content:
          'graph LR\n  A[Alpha] --> B[Beta] --> C[Gamma] --> D[Delta] --> E[Epsilon] --> F[Zeta]'
      }
    ])
    await page.setViewportSize({ width: 480, height: 900 })
    await openNote(page, title)
    await expectRendered(page, 'diagram')
    await expect
      .poll(async () => {
        const overflow = await page.evaluate(() => {
          const workspace = document.querySelector('[data-testid="rich-editor"]')
          if (!workspace) return null
          return { scroll: workspace.scrollWidth, client: workspace.clientWidth }
        })
        if (overflow === null) return 'missing'
        // The workspace itself must not overflow; the diagram pane scrolls inside.
        return overflow.scroll <= overflow.client + 2 ? 'contained' : 'overflowing'
      })
      .toBe('contained')
  })
})
