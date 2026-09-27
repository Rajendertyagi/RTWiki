import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * The cross-cutting document-surface contract: rendered content is the page, not
 * a card sitting on one.
 *
 * The Rich Note already satisfies this. HTML and Markdown pages did not - the
 * HTML page nested a rounded, bordered box inside another one, and Markdown
 * framed its rendered output in the same way. Both painted that box with the
 * panel colour, so in dark mode the content was darker than the page around it
 * and read as a hole rather than as content.
 *
 * Only the *rendered* surfaces are asserted here. The Markdown editing pane is
 * deliberately left framed: a text-entry surface arguably should stay visually
 * distinct from the rendered result, and that is a design decision, not a
 * defect. It is out of scope for this contract.
 */

const HTML_PREVIEW = '[data-testid="live-preview"]'
const HTML_IFRAME = '[data-testid="preview-iframe"]'
const MARKDOWN_RENDERED = '[data-testid="markdown-rendered"]'

/**
 * HTML pages persist the managed-source envelope, not raw markup, so the seed
 * has to match the shape the workspace writes.
 */
function htmlContent(marker: string): string {
  return JSON.stringify({
    version: 2,
    html: `<h1>${marker}</h1><p>Rendered body text.</p>`,
    css: '',
    javascript: '',
    jsEnabled: false
  })
}

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  pageType: 'html' | 'markdown',
  content: string
): Promise<string> {
  /**
   * `content` is stored as a JSON **string** in a TEXT column, and each page type
   * parses it back into its own shape:
   *
   * - **Markdown** — a `{ version, markdown }` envelope. An empty string is *not*
   *   a valid envelope, which is why the original test could seed `''` and get a
   *   starter document.
   * - **HTML** — a `strictObject` requiring `version`, `html`, `css`, `javascript`
   *   and `jsEnabled`. Strict, so a partial envelope is rejected, and the field is
   *   `jsEnabled` rather than `javascriptEnabled` — guessed wrong once here and
   *   caught by the 400 rather than by a confusing render failure.
   *
   * Both used to be posted as a bare string. That happened to be accepted for an
   * empty value and rejected with a 400 for anything else, which made this helper
   * look like it worked while only ever being exercised with `''`. The envelopes
   * are built here so callers pass the source text and nothing else.
   */
  const envelope =
    pageType === 'markdown'
      ? { version: 1, markdown: content }
      : { version: 2, html: content, css: '', javascript: '', jsEnabled: false }
  const res = await request.post('/api/pages', {
    data: { title, pageType, content: JSON.stringify(envelope) }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const created = (await res.json()) as { page?: { id: string }; id?: string }
  const id = created.page?.id ?? created.id
  expect(id).toBeTruthy()
  return id as string
}

async function setScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  const current = await page.evaluate(() =>
    document.documentElement.getAttribute('data-mantine-color-scheme')
  )
  if (current === scheme) return
  const toggle = page.getByRole('button', { name: /theme/i }).first()
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
    )
    .toBe(scheme)
  await page.waitForTimeout(250)
}

interface SurfaceReading {
  borderWidth: string | null
  radius: string | null
  background: string | null
}

/**
 * Reads a surface after forcing the canvas token to a sentinel. A sentinel is
 * used rather than comparing against the live token so the assertion cannot
 * pass by coincidence when a surface happens to match today's palette.
 */
async function readSurface(page: Page, selector: string): Promise<SurfaceReading> {
  return page.evaluate((sel) => {
    const SENTINEL = 'rgb(1, 2, 3)'
    document.documentElement.style.setProperty('--rtwiki-canvas', SENTINEL)
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return { borderWidth: null, radius: null, background: null }
    const cs = getComputedStyle(el)
    return {
      borderWidth: cs.borderTopWidth,
      radius: cs.borderTopLeftRadius,
      background: cs.backgroundColor
    }
  }, selector)
}

test.describe('Rendered content is a document, not a card', () => {
  test.beforeEach(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test.afterAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('the HTML page renders on one continuous canvas with no nested frame', async ({
    page,
    request
  }) => {
    const id = await seedPage(request, uniqueTitle('HtmlSurface'), 'html', htmlContent('Surface'))
    await page.goto(`/?page=${id}`)
    await expect(page.locator(HTML_IFRAME)).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme)

      // Outer container around the preview.
      const outer = await readSurface(page, HTML_PREVIEW)
      expect(outer.borderWidth, `html preview border in ${scheme}`).toBe('0px')
      expect(outer.radius, `html preview radius in ${scheme}`).toBe('0px')
      expect(outer.background, `html preview background in ${scheme}`).toBe('rgb(1, 2, 3)')

      // The iframe itself carries the frame class, so it is the element that
      // must lose its border and radius. Its inner document owns the content
      // background; that belongs to the page's own markup, not the shell.
      const inner = await page.evaluate((iframeSel) => {
        const SENTINEL = 'rgb(1, 2, 3)'
        document.documentElement.style.setProperty('--rtwiki-canvas', SENTINEL)
        const frame = document.querySelector(iframeSel) as HTMLElement | null
        if (!frame) return null
        const cs = getComputedStyle(frame)
        return {
          borderWidth: cs.borderTopWidth,
          radius: cs.borderTopLeftRadius,
          background: cs.backgroundColor
        }
      }, HTML_IFRAME)

      expect(inner, `html inner frame should exist in ${scheme}`).not.toBeNull()
      expect(inner?.borderWidth, `html inner border in ${scheme}`).toBe('0px')
      expect(inner?.radius, `html inner radius in ${scheme}`).toBe('0px')
      expect(inner?.background, `html inner background in ${scheme}`).toBe('rgb(1, 2, 3)')
    }
  })

  test('the Markdown preview renders on the document surface', async ({ page, request }) => {
    // Markdown content is structured, not raw text. An empty value makes the
    // server write its own starter document, which is all this test needs -
    // it asserts the surface, not the content.
    const id = await seedPage(request, uniqueTitle('MarkdownSurface'), 'markdown', '')
    await page.goto(`/?page=${id}`)
    await expect(page.locator(MARKDOWN_RENDERED)).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme)
      const surface = await readSurface(page, MARKDOWN_RENDERED)
      expect(surface.borderWidth, `markdown preview border in ${scheme}`).toBe('0px')
      expect(surface.radius, `markdown preview radius in ${scheme}`).toBe('0px')
      expect(surface.background, `markdown preview background in ${scheme}`).toBe('rgb(1, 2, 3)')
    }
  })

  test('a Markdown page renders real content, and nothing dangerous reaches the page', async ({
    page,
    request
  }) => {
    /**
     * The unit tests prove `renderMarkdown` returns the right string. This proves
     * the string reaches the browser intact, which is a different failure and the
     * one a page swap actually causes: a module that throws at import, a bundle
     * that failed to build, or a sanitiser with no DOM.
     *
     * It is here because a Markdown page that renders *nothing* still satisfies the
     * test above — that one asserts a surface exists, not that it has content. A
     * silently blank preview is the failure mode this covers.
     */
    const content = [
      '# Study notes',
      '',
      '| Term | Meaning |',
      '| - | - |',
      '| photosynthesis | plants make sugar |',
      '',
      '- [x] read the chapter',
      '- [ ] revise',
      '',
      '~~draft~~ and https://example.com',
      '',
      '<b>raw html</b>',
      '<script>window.__markdownXss = true</script>',
      '<img src="x" onerror="window.__markdownXss = true">'
    ].join('\n')
    const id = await seedPage(request, uniqueTitle('MarkdownContent'), 'markdown', content)
    await page.goto(`/?page=${id}`)

    const rendered = page.locator(MARKDOWN_RENDERED)
    await expect(rendered).toBeVisible({ timeout: 20_000 })

    // Real content, from each construct the swap had to keep working.
    await expect(rendered.getByRole('heading', { name: 'Study notes' })).toBeVisible()
    await expect(rendered.locator('table th').first()).toHaveText('Term')
    await expect(rendered.locator('li input[type="checkbox"]')).toHaveCount(2)
    await expect(rendered.locator('li input[type="checkbox"]').first()).toBeChecked()
    await expect(rendered.locator('del')).toHaveText('draft')
    await expect(rendered.getByRole('link', { name: 'https://example.com' })).toBeVisible()

    // The task-list bullet suppression depends on the `:has()` rule. Asserted
    // through the computed style, because the class the old rule selected never
    // existed and this is the assertion that would catch its replacement failing.
    const bullet = await rendered
      .locator('li:has(> input[type="checkbox"])')
      .first()
      .evaluate((el) => getComputedStyle(el).listStyleType)
    expect(bullet, 'a task-list item must not show a bullet').toBe('none')

    // Nothing dangerous survived. Raw HTML now renders as visible text, which is
    // the point of the engine swap.
    await expect(rendered.locator('script')).toHaveCount(0)
    await expect(rendered.locator('b')).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__markdownXss),
      'no script from the document may have executed'
    ).toBeUndefined()
  })

  /**
   * The visual proof. Until this ran, no one had ever seen a radical render.
   *
   * Every earlier claim about `\sqrt{2}` was inferred from markup. The inference
   * turned out to be right about the *cause* — the old sanitiser profile deleted the
   * `<math>` and the `<svg>` — but "the SVG is in the DOM" is not "a radical is drawn
   * on screen". A missing stylesheet produces a correct-looking DOM and a blank
   * glyph, which is why the screenshot is part of the deliverable rather than a
   * nicety, and why the font check below is explicit.
   */
  test('a radical, an arrow and a formula are visibly drawn in a real browser', async ({
    page,
    request
  }) => {
    const content = [
      '# Maths',
      '',
      'Radical: $\\sqrt{2}$',
      '',
      'Arrow: $\\overrightarrow{AB}$',
      '',
      'Formula: $x^2 + y^2 = z^2$'
    ].join('\n')
    const id = await seedPage(request, uniqueTitle('MarkdownMath'), 'markdown', content)
    await page.goto(`/?page=${id}`)

    const rendered = page.locator(MARKDOWN_RENDERED)
    await expect(rendered).toBeVisible({ timeout: 20_000 })

    // Three expressions rendered.
    await expect(rendered.locator('.katex')).toHaveCount(3, { timeout: 15_000 })

    /**
     * The SVG is the proof, not the `.katex` span.
     *
     * A radical is a MathML `<msqrt>` plus an SVG overlay. The span existing only
     * says the pipeline ran; the `<svg>` existing says the part the old sanitiser
     * used to delete is now present, which is the specific regression this feature
     * was blocked on.
     */
    await expect(rendered.locator('.katex .katex-html svg').first()).toBeAttached({
      timeout: 15_000
    })
    // The radical's vinculum is an SVG path in KaTeX, so a non-zero path count is a
    // real check that geometry was emitted rather than an empty shell.
    expect(
      await rendered.locator('.katex-html svg path').count(),
      'KaTeX must have drawn vector geometry'
    ).toBeGreaterThan(0)

    // The MathML subtree survives, which is what makes the maths reachable by a
    // screen reader. This is the half that used to be deleted silently.
    await expect(rendered.locator('.katex-mathml math')).toHaveCount(3)
    expect(await rendered.locator('.katex-mathml math msqrt').count(), 'the radical').toBe(1)
    expect(await rendered.locator('.katex-mathml math mover').count(), 'the arrow accent').toBe(1)

    /**
     * The fonts, checked against the families the page actually uses.
     *
     * `document.fonts.check` reports false for a family that has not been *requested*
     * yet, so checking all of KaTeX's ~20 families would fail on families this page
     * never uses — a false negative that says nothing about the product. Measured:
     * `KaTeX_Size1` reported false while `KaTeX_Main` and `KaTeX_Math` reported true.
     *
     * Note also that KaTeX draws most glyphs as **SVG paths**, not font text, so the
     * geometry assertion above is the stronger check of the two. This one is here to
     * catch a stylesheet that loaded but whose woff2 files were never emitted.
     */
    const fontsResolved = await page.evaluate(async () => {
      await document.fonts.ready
      return ['KaTeX_Main', 'KaTeX_Math'].map((f) => document.fonts.check(`16px ${f}`))
    })
    expect(
      fontsResolved.every(Boolean),
      `KaTeX fonts must resolve; got ${JSON.stringify(fontsResolved)}. A false means the ` +
        'woff2 files were not emitted or the stylesheet never loaded.'
    ).toBe(true)

    // The glyph layer occupies a real box, which a blank fallback would not.
    const box = await rendered
      .locator('.katex .katex-html')
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
    expect(box.w, 'the rendered radical must occupy width').toBeGreaterThan(4)
    expect(box.h, 'the rendered radical must occupy height').toBeGreaterThan(4)

    // Evidence, kept as an artefact rather than an assertion nobody can re-check.
    // Written outside `test-results/`, which Playwright clears at the start of a run.
    await rendered.screenshot({ path: 'docs/evidence/markdown-math-proof.png' })

    /**
     * A second, enlarged artefact, taken on the *same* page so the real stylesheet
     * and the real fonts are still in play.
     *
     * At body zoom the maths is ~16px, and at that size it is genuinely hard to
     * distinguish a real glyph from a plausible-looking fallback — which is the
     * specific doubt this evidence exists to settle. Scaling the rendered maths with
     * a transform keeps every computed style and every loaded font identical, and
     * only changes the size, so what is captured is what is really there.
     */
    const maths = rendered.locator('.katex').first()
    await maths.evaluate((el) => {
      el.style.transform = 'scale(3.5)'
      el.style.transformOrigin = 'left top'
      el.style.display = 'inline-block'
    })
    await page.waitForTimeout(300)
    await maths.screenshot({ path: 'docs/evidence/markdown-math-zoom.png' })
  })

  test('maths on a Markdown page are styled, not raw TeX', async ({ page, request }) => {
    /**
     * The lazy-chunk trap, as a test.
     *
     * `@blocknote/math-block` imports KaTeX's stylesheet, but only from the Rich
     * Note's lazily-loaded chunk. A Markdown page never mounts the rich editor, so
     * that CSS was never fetched: correct DOM, no glyphs, no error thrown. The
     * Markdown workspace now imports the same file, and this asserts the stylesheet
     * actually reaches *this* page.
     */
    const id = await seedPage(
      request,
      uniqueTitle('MarkdownMathStyled'),
      'markdown',
      'Styled: $\\sqrt{3}$'
    )
    await page.goto(`/?page=${id}`)
    const rendered = page.locator(MARKDOWN_RENDERED)
    await expect(rendered.locator('.katex').first()).toBeVisible({ timeout: 20_000 })

    // KaTeX visually hides its MathML layer and shows the HTML layer. Without the
    // stylesheet both would be visible and the raw MathML would sit beside the text.
    const mathmlHidden = await rendered
      .locator('.katex-mathml')
      .first()
      .evaluate((el) => getComputedStyle(el).position === 'absolute')
    expect(mathmlHidden, 'the MathML layer must be hidden by the stylesheet').toBe(true)

    // The glyph layer is laid out, not collapsed.
    const htmlLayer = await rendered
      .locator('.katex-html')
      .first()
      .evaluate((el) => getComputedStyle(el).display)
    expect(htmlLayer).not.toBe('none')
  })
})
