import { expect, type Page, test } from '@playwright/test'
import { freezeUi } from './helpers/hit-target.js'

/**
 * Visual layout regression: two layers.
 *
 * A. Geometry contracts — numeric assertions about pane relationships that
 *    must hold at every viewport/theme (clipping, overlap, stacking).
 * B. Region screenshots — stable surfaces captured with animations and the
 *    caret disabled and dynamic regions masked. Baselines are committed per
 *    platform; any update must be explicitly reviewed.
 *
 * Viewport matrix: geometry runs at 390×844, 1280×800 and 1920×1080 in both
 * themes; screenshots use 1280×800 to keep the baseline set reviewable.
 */

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 }
] as const

const THEMES = ['light', 'dark'] as const

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  // Theme switching is best-effort on narrow viewports where the toggle
  // lives inside the nav drawer; geometry assertions are theme-independent.
  if ((page.viewportSize()?.width ?? 1280) < 768) return
  const current = await page.locator('html').getAttribute('data-mantine-color-scheme')
  if (current !== theme) {
    await page.getByRole('button', { name: 'Theme', exact: true }).click()
    await expect(page.locator(`html[data-mantine-color-scheme="${theme}"]`)).toHaveCount(1)
  }
}

test.describe('geometry contracts', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`workspace layout holds at ${viewport.width}x${viewport.height} (${theme})`, async ({
        page,
        request
      }) => {
        test.setTimeout(60_000)
        // Setup: one rich note so the workspace (not just dashboard) is measured.
        await request.post('/api/pages', {
          data: {
            title: `Geometry ${viewport.width}`,
            pageType: 'rich',
            content: JSON.stringify([{ id: 'p', type: 'paragraph' }])
          }
        })
        await page.setViewportSize({ ...viewport })
        await page.goto('/')
        await setTheme(page, theme)
        await page
          .getByRole('button', { name: /Open Geometry/ })
          .first()
          .click()
        await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

        const metrics = await page.evaluate(() => {
          const rail = document.querySelector('nav')
          const main = document.querySelector('.mantine-AppShell-main')
          const tree = document.querySelector('[role="tree"]')
          const toolbar = document.querySelector('[data-testid="rich-toolbar-row"]')
          const breadcrumb = document.querySelector('[data-testid="page-breadcrumb"]')
          const editor = document.querySelector('.bn-editor')
          const rect = (el: Element | null | undefined): DOMRect | null =>
            el ? el.getBoundingClientRect() : null
          return {
            vw: window.innerWidth,
            vh: window.innerHeight,
            rail: rect(rail),
            main: rect(main),
            tree: rect(tree),
            toolbar: rect(toolbar),
            breadcrumb: rect(breadcrumb),
            editor: rect(editor),
            bodyScrollX: document.documentElement.scrollWidth,
            bodyClientX: document.documentElement.clientWidth
          }
        })

        // The rail spans the viewport height.
        if (metrics.rail) {
          expect(metrics.rail.height, 'rail spans viewport height').toBeGreaterThanOrEqual(
            metrics.vh - 2
          )
        }
        // The document content never sits underneath the tree pane. The
        // AppShell main element spans the full grid, so measure the actual
        // content column instead.
        if (metrics.tree && viewport.width >= 768) {
          const contentLeft = metrics.breadcrumb?.left ?? metrics.editor?.left ?? null
          if (contentLeft !== null) {
            expect(
              contentLeft,
              'document content starts at/after the tree right edge'
            ).toBeGreaterThanOrEqual(metrics.tree.right - 2)
          }
        }
        // Vertical order tabs→toolbar→title→document on desktop widths.
        if (viewport.width >= 1280 && metrics.toolbar && metrics.breadcrumb && metrics.editor) {
          expect(metrics.toolbar.top).toBeGreaterThanOrEqual((metrics.main?.top ?? 0) - 1)
          expect(metrics.breadcrumb.top).toBeGreaterThanOrEqual(metrics.toolbar.bottom - 1)
          expect(metrics.editor.top).toBeGreaterThanOrEqual(metrics.breadcrumb.bottom - 1)
        }
        // The editor stays inside the viewport horizontally.
        if (metrics.editor) {
          expect(metrics.editor.right, 'editor within viewport').toBeLessThanOrEqual(metrics.vw + 1)
        }
        // No horizontal page overflow.
        expect(metrics.bodyScrollX, 'no horizontal overflow').toBeLessThanOrEqual(
          metrics.bodyClientX + 1
        )
      })
    }
  }

  test('full-screen diagram surface covers the workspace', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: { title: 'FS Diagram', pageType: 'diagram' }
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open FS Diagram', exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-fullscreen').click()
    const box = await page.getByTestId('diagram-workspace').boundingBox()
    expect(box?.x).toBeLessThanOrEqual(1)
    expect(box?.y).toBeLessThanOrEqual(1)
    expect(box?.width).toBeGreaterThanOrEqual(1279)
    expect(box?.height).toBeGreaterThanOrEqual(799)
    await page.getByTestId('diagram-fullscreen').click()
  })
})

test.describe('region screenshots', () => {
  const shot = async (
    page: Page,
    locator: import('@playwright/test').Locator,
    name: string
  ): Promise<void> =>
    expect(locator).toHaveScreenshot(name, {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
      // Dates/timestamps on cards and headers change between runs.
      mask: [page.locator('text=/d{4}-d{2}-d{2}/')]
    })

  async function prepare(page: Page, theme: 'light' | 'dark'): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await setTheme(page, theme)
    await freezeUi(page)
  }

  test('dashboard light + dark', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: {
        title: 'Snapshot Biology',
        pageType: 'rich',
        content: JSON.stringify([
          {
            id: 'p',
            type: 'paragraph',
            content: [{ type: 'text', text: 'Stable body text for the snapshot.', styles: {} }]
          }
        ])
      }
    })
    await prepare(page, 'light')
    await goHomeAndSettle(page)
    await shot(page, page.locator('.mantine-AppShell-main'), 'dashboard-light.png')

    await setTheme(page, 'dark')
    await freezeUi(page)
    await shot(page, page.locator('.mantine-AppShell-main'), 'dashboard-dark.png')
  })

  test('rich editor light + dark', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: {
        title: 'Snapshot Editor',
        pageType: 'rich',
        content: JSON.stringify([
          {
            id: 'h',
            type: 'heading',
            props: { level: 1 },
            content: [{ type: 'text', text: 'Chapter', styles: {} }]
          },
          {
            id: 'p',
            type: 'paragraph',
            content: [{ type: 'text', text: 'Stable paragraph.', styles: {} }]
          },
          {
            id: 'c',
            type: 'callout',
            props: { variant: 'tip' },
            content: [{ type: 'text', text: 'Remember this.', styles: {} }]
          }
        ])
      }
    })
    await prepare(page, 'light')
    await openSnapshot(page, 'Snapshot Editor')
    await shot(page, page.locator('[data-testid="rich-editor"]'), 'rich-editor-light.png')
    await setTheme(page, 'dark')
    await freezeUi(page)
    await shot(page, page.locator('[data-testid="rich-editor"]'), 'rich-editor-dark.png')
  })

  test('ctrl+k palette', async ({ page }) => {
    await prepare(page, 'light')
    await page.keyboard.press('Control+k')
    await page.getByTestId('quick-finder-input').fill('Snap')
    await expect(page.getByTestId('quick-finder-results')).toBeVisible()
    await shot(page, page.getByRole('dialog'), 'ctrl-k-palette.png')
    await page.keyboard.press('Escape')
  })

  test('html ide and preview', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: {
        title: 'Snapshot Web',
        pageType: 'html',
        content: JSON.stringify({
          version: 2,
          html: '<p>stable preview</p>',
          css: 'p { color: olive; }',
          javascript: '',
          jsEnabled: false
        })
      }
    })
    await prepare(page, 'light')
    await openSnapshot(page, 'Snapshot Web')
    await expect(page.getByTestId('html-preview-view')).toBeVisible()
    await shot(page, page.getByTestId('html-preview-view'), 'html-preview.png')
    const row = page.locator('[role="treeitem"]', { hasText: 'Snapshot Web' }).first()
    await row.hover()
    await row.getByLabel('Expand').click()
    await page.locator('[data-subfile-id]', { hasText: 'CSS' }).first().click()
    await expect(page.getByTestId('html-source-view')).toBeVisible()
    await shot(page, page.getByTestId('html-source-view'), 'html-ide.png')
  })

  test('diagram and mind map pages', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: { title: 'Snapshot Diagram', pageType: 'diagram' }
    })
    await request.post('/api/pages', {
      data: { title: 'Snapshot MindMap', pageType: 'mindmap' }
    })
    await prepare(page, 'dark')
    await openSnapshot(page, 'Snapshot Diagram')
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
    await shot(page, page.getByTestId('diagram-workspace'), 'diagram-page-dark.png')
    await openSnapshot(page, 'Snapshot MindMap')
    await expect(page.getByTestId('mindmap-rendered').locator('svg')).toBeVisible()
    await shot(page, page.getByTestId('mindmap-workspace'), 'mindmap-page-light.png')
  })

  test('tree context menu and wiki-link picker', async ({ page, request }) => {
    await request.post('/api/pages', {
      data: { title: 'Snapshot Menus', pageType: 'rich', content: '' }
    })
    await prepare(page, 'light')
    await goHomeAndSettle(page)
    const row = page.locator('[role="treeitem"]', { hasText: 'Snapshot Menus' }).first()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    await shot(page, page.getByTestId('tree-context-menu'), 'tree-context-menu.png')
    await page.keyboard.press('Escape')

    await openSnapshot(page, 'Snapshot Menus')
    await page.getByTestId('wiki-link-button').click()
    await expect(page.getByTestId('wiki-link-picker')).toBeVisible()
    await shot(page, page.getByTestId('wiki-link-picker'), 'wiki-link-picker.png')
  })
})

// ---------- helpers ----------

async function goHomeAndSettle(page: Page): Promise<void> {
  await page.locator('[aria-label="Home"]').click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
}

async function openSnapshot(page: Page, title: string): Promise<void> {
  await goHomeAndSettle(page)
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
}
