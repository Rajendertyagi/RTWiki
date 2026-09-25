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
  const res = await request.post('/api/pages', {
    data: { title, pageType, content }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page?: { id: string }; id?: string }
  const id = body.page?.id ?? body.id
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
})
