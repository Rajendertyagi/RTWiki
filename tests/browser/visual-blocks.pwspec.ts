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

/** Inserts a block through its persistent toolbar control (one compact
 * icon per entry; the former Insert dropdown was removed). */
async function insertViaMenu(page: Page, key: string): Promise<void> {
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
        .locator(`[data-variant="${variant}"] [data-testid="callout-content"]`)
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

  test('duplicate preserves every visual block', async ({ request }) => {
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

    // Switch away immediately (before autosave of further edits would land):
    // return to the dashboard first, then open the other page from its card.
    await page.locator('[aria-label="Home"]').click()
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
    await page.getByRole('button', { name: `Open ${htmlTitle}`, exact: true }).click()
    await expect(page.locator('[data-testid="html-preview-view"]')).toBeVisible()
    await page.locator('[aria-label="Home"]').click()
    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
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
    // The utility-rail theme toggle relabels with the active scheme.
    const themeToggle = page.locator('button[aria-label="Theme"]')
    await themeToggle.click()
    // Re-render in dark: the SVG is rebuilt (host persists, drawing refreshes).
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible()
    await themeToggle.click()
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

  test('diagram: live preview renders while typing (no Apply required)', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB LiveDiagram')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    await expectRendered(page, 'diagram')

    await page.getByTestId('diagram-edit-button').click()
    const input = page.getByTestId('diagram-source-input')
    await expect(input).toBeVisible()
    // Type a new diagram; the live preview pane re-renders without Apply.
    await input.fill('graph TD\n  A[One] --> B[Two] --> C[Three]')
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible()
    // Cancel keeps the previously applied source (A-->B), not the typed draft.
    await page.getByTestId('diagram-cancel').click()
    await expect(page.getByTestId('diagram-preview')).toBeVisible()
  })

  test('diagram: Cancel restores the last applied source', async ({ page, request }) => {
    const title = uniqueTitle('VB CancelDiagram')
    const p = await seedRich(request, title, [
      { id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }
    ])
    await openNote(page, title)
    await expectRendered(page, 'diagram')

    await page.getByTestId('diagram-edit-button').click()
    const input = page.getByTestId('diagram-source-input')
    await input.fill('graph TD\n  A[Changed] --> B[Changed2]')
    await page.getByTestId('diagram-cancel').click()

    // Reopen edit: source is the original applied value.
    await page.getByTestId('diagram-edit-button').click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/graph TD/)
    const stored = await getStoredContent(request, p.id)
    expect(stored).toContain('A-->B')
    expect(stored).not.toContain('Changed2')
  })

  test('diagram: template picker loads a starter source into the live preview', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('VB DiagramTemplate')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    await expectRendered(page, 'diagram')

    await page.getByTestId('diagram-edit-button').click()
    await page.getByTestId('diagram-template').click()
    await page.getByText('Sequence', { exact: true }).click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/sequenceDiagram/)
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible()
    await page.getByTestId('diagram-cancel').click()
  })

  test('mind map: live preview renders while typing', async ({ page, request }) => {
    const title = uniqueTitle('VB LiveMindMap')
    await seedRich(request, title, [
      { id: 'mm', type: 'mindMap', content: 'mindmap\n  root((R))\n    A\n    B' }
    ])
    await openNote(page, title)
    await expectRendered(page, 'mindMap')

    await page.getByTestId('mindMap-edit-button').click()
    const input = page.getByTestId('mindMap-source-input')
    await input.fill('mindmap\n  root((Root))\n    Alpha\n    Beta\n    Gamma')
    await expect(page.locator('[data-testid="mindMap-svg"] svg').first()).toBeVisible()
    await page.getByTestId('mindMap-cancel').click()
    await expect(page.getByTestId('mindMap-preview')).toBeVisible()
  })

  test('mind map: zoom controls resize the rendered map', async ({ page, request }) => {
    const title = uniqueTitle('VB ZoomMindMap')
    await seedRich(request, title, [
      { id: 'mm', type: 'mindMap', content: 'mindmap\n  root((R))\n    A\n    B' }
    ])
    await openNote(page, title)
    await expectRendered(page, 'mindMap')

    const label = page.getByTestId('mindMap-zoom-label')
    await expect(label).toHaveText('100%')
    await page.getByTestId('mindMap-zoom-in').click()
    await expect(label).toHaveText('125%')
    await page.getByTestId('mindMap-zoom-in').click()
    await expect(label).toHaveText('150%')
    await page.getByTestId('mindMap-zoom-out').click()
    await expect(label).toHaveText('125%')
    // Zoom never clips: the SVG host keeps its natural width at >100%.
    await expect(page.locator('[data-testid="mindMap-svg"] svg').first()).toBeVisible()
  })

  test('callout: switch variant after insertion preserves rich text', async ({ page, request }) => {
    const title = uniqueTitle('VB CalloutSwitch')
    const p = await seedRich(request, title, [
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'info' },
        content: [{ type: 'text', text: 'switch me', styles: {} }]
      }
    ])
    await openNote(page, title)
    await expect(page.locator('[data-variant="info"]').first()).toBeVisible()

    await page.getByTestId('callout-variant-button').click()
    await page.getByTestId('callout-variant-warning').click()
    await expect(page.locator('[data-variant="warning"]').first()).toBeVisible()
    await expect(page.locator('[data-variant="info"]')).toHaveCount(0)
    // Rich text is preserved across the variant change.
    await expect(
      page.locator('[data-variant="warning"] [data-testid="callout-content"]').first()
    ).toContainText('switch me')
    // Persisted as a variant change only (other props untouched).
    await expect
      .poll(async () => (await getStoredContent(request, p.id)) ?? '', { timeout: 15_000 })
      .toContain('"variant":"warning"')
  })

  test('inline formula renders within paragraph text', async ({ page, request }) => {
    const title = uniqueTitle('VB InlineMath')
    await seedRich(request, title, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Energy is ', styles: {} },
          { type: 'math', content: 'E = mc^2', styles: {} },
          { type: 'text', text: 'famously.', styles: {} }
        ]
      }
    ])
    await openNote(page, title)
    // Inline formula renders through KaTeX (visible .katex wrapper).
    await expect(page.locator('.katex').first()).toBeVisible()
    await expect(page.getByText('Energy is')).toBeVisible()
    await expect(page.getByText('famously.')).toBeVisible()
  })

  test('invalid formula is correctable through the editor', async ({ page, request }) => {
    const title = uniqueTitle('VB FormulaFix')
    const p = await seedRich(request, title, [{ id: 'm', type: 'mathBlock', content: '\\frac{' }])
    await openNote(page, title)
    await expect(page.getByText(/Invalid equation/i)).toBeVisible()

    // Open the formula source editor and replace the broken LaTeX.
    const mathBlock = page.locator('[data-content-type="mathBlock"]').first()
    await mathBlock.click()
    // The source editor opens in a popup; it is the active contenteditable.
    const source = page.locator('[contenteditable="true"]').first()
    await expect(source).toBeVisible()
    await source.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('c = a + b')
    // The corrected formula renders as MathML and persists.
    await expect(
      page.locator('[data-testid="rich-editor"] [data-content-type="mathBlock"] math').first()
    ).toBeVisible()
    await expect
      .poll(async () => (await getStoredContent(request, p.id)) ?? '', { timeout: 15_000 })
      .toContain('c = a + b')
  })

  test('structured search finds paragraph and callout text, never raw source', async ({
    request
  }) => {
    const title = uniqueTitle('VB Search')
    await seedRich(request, title, [
      {
        id: 'h',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Quantum Bumblebee' }]
      },
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'tip' },
        content: [{ type: 'text', text: 'Bees pollinate flowers' }]
      },
      { id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' },
      { id: 'm', type: 'mathBlock', content: 'E = mc^2' }
    ])

    const find = async (q: string): Promise<boolean> => {
      const res = await request.get(`/api/pages?q=${encodeURIComponent(q)}`)
      const body = (await res.json()) as { pages: Array<{ title: string }> }
      return body.pages.some((pg) => pg.title === title)
    }

    expect(await find('Quantum Bumblebee')).toBe(true)
    expect(await find('Bees pollinate flowers')).toBe(true)
    // Raw diagram/Formula source is intentionally NOT indexed.
    expect(await find('graph TD')).toBe(false)
    expect(await find('mc^2')).toBe(false)
  })

  test('dashboard preview never exposes source, JSON or SVG', async ({ page, request }) => {
    const title = uniqueTitle('VB PreviewSafe')
    await seedRich(request, title, [
      {
        id: 'c1',
        type: 'callout',
        props: { variant: 'warning' },
        content: [{ type: 'text', text: 'Readable warning sentence', styles: {} }]
      },
      { id: 'd1', type: 'diagram', content: 'graph TD\n  A-->B' },
      { id: 'm1', type: 'mathBlock', content: 'x^2' }
    ])
    await page.goto('/')
    const card = page.getByRole('button', { name: `Open ${title}`, exact: true })
    await card.waitFor()
    const cardText = (await card.textContent()) ?? ''
    expect(cardText).toContain('Readable warning sentence')
    expect(cardText).not.toContain('graph TD')
    expect(cardText).not.toContain('mathBlock')
    expect(cardText).not.toContain('{')
    expect(cardText).not.toContain('<svg')
  })
})
