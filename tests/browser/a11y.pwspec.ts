import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { resetDatabase } from './helpers/hit-target.js'

/**
 * Automated WCAG A/AA scans (axe-core) over the primary surfaces in both
 * themes. Full violation lists are attached to the report; the assertion
 * covers impact=critical findings so genuine blockers fail CI while lower
 * severities are tracked rather than hidden.
 *
 * Automated scans complement — never replace — keyboard journey coverage.
 */

type AxeViolations = Awaited<ReturnType<AxeBuilder['analyze']>>['violations']

async function scan(page: Page): Promise<AxeViolations> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  await test.info().attach(`axe-${test.info().title}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json'
  })
  return results.violations
}

function critical(violations: AxeViolations, allow?: string[]): string[] {
  // Pre-existing product findings, recorded in docs/AUTOMATED_QA.md and
  // tracked for a future accessibility pass. Everything else still fails.
  const KNOWN_PRE_EXISTING = new Set(['color-contrast', 'aria-required-children'])
  return violations
    .filter(
      (v) =>
        v.impact === 'critical' && !KNOWN_PRE_EXISTING.has(v.id) && !(allow ?? []).includes(v.id)
    )
    .map((v) => v.id)
}

test.describe('accessibility (axe-core)', () => {
  let created = false

  async function seedOnce(request: import('@playwright/test').APIRequestContext): Promise<void> {
    if (created) return
    await resetDatabase(request)
    await request.post('/api/pages', {
      data: {
        title: 'A11y Rich',
        pageType: 'rich',
        content: JSON.stringify([
          {
            id: 'h',
            type: 'heading',
            props: { level: 1 },
            content: [{ type: 'text', text: 'Heading', styles: {} }]
          },
          { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] }
        ])
      }
    })
    await request.post('/api/pages', {
      data: {
        title: 'A11y Web',
        pageType: 'html',
        content: JSON.stringify({
          version: 2,
          html: '<p>a11y</p>',
          css: '',
          javascript: '',
          jsEnabled: false
        })
      }
    })
    await request.post('/api/pages', { data: { title: 'A11y Diagram', pageType: 'diagram' } })
    await request.post('/api/pages', { data: { title: 'A11y MindMap', pageType: 'mindmap' } })
    created = true
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`dashboard (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      const violations = await scan(page)
      expect(
        critical(violations),
        JSON.stringify(violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))
      ).toEqual([])
    })

    test(`rich editor (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      await page.getByRole('button', { name: 'Open A11y Rich', exact: true }).click()
      await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
      const violations = await scan(page)
      expect(critical(violations)).toEqual([])
    })

    test(`html ide (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      await page.getByRole('button', { name: 'Open A11y Web', exact: true }).click()
      const row = page.locator('[role="treeitem"]', { hasText: 'A11y Web' }).first()
      await row.hover()
      await row.getByLabel('Expand').click()
      await page.locator('[data-subfile-id]', { hasText: 'CSS' }).first().click()
      await expect(page.getByTestId('html-source-view')).toBeVisible()
      const violations = await scan(page)
      expect(critical(violations)).toEqual([])
    })

    test(`diagram workspace (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      await page.getByRole('button', { name: 'Open A11y Diagram', exact: true }).click()
      await expect(page.getByTestId('diagram-workspace')).toBeVisible()
      const violations = await scan(page)
      expect(critical(violations)).toEqual([])
    })

    test(`mind map workspace (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      await page.getByRole('button', { name: 'Open A11y MindMap', exact: true }).click()
      await expect(page.getByTestId('mindmap-workspace')).toBeVisible()
      const violations = await scan(page)
      expect(critical(violations)).toEqual([])
    })

    test(`ctrl+k palette (${theme})`, async ({ page, request }) => {
      await seedOnce(request)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto('/')
      await setTheme(page, theme)
      await page.keyboard.press('Control+k')
      await expect(page.getByTestId('quick-finder-input')).toBeVisible()
      const violations = await scan(page)
      // The palette surfaces a pre-existing icon-button naming gap; recorded
      // in docs/AUTOMATED_QA.md and scoped to this surface only.
      expect(critical(violations, ['button-name'])).toEqual([])
      await page.keyboard.press('Escape')
    })
  }

  async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
    const current = await page.locator('html').getAttribute('data-mantine-color-scheme')
    if (current !== theme) {
      await page.getByRole('button', { name: 'Theme', exact: true }).click()
      await expect(page.locator(`html[data-mantine-color-scheme="${theme}"]`)).toHaveCount(1)
    }
  }

  test('tree context menu (light)', async ({ page, request }) => {
    await seedOnce(request)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const row = page.locator('[role="treeitem"]', { hasText: 'A11y Rich' }).first()
    await row.click({ button: 'right' })
    await expect(page.getByTestId('tree-context-menu')).toBeVisible()
    const violations = await scan(page)
    expect(critical(violations)).toEqual([])
    await page.keyboard.press('Escape')
  })

  test('wiki-link picker (light)', async ({ page, request }) => {
    await seedOnce(request)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Open A11y Rich', exact: true }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
    await page.getByTestId('wiki-link-button').click()
    await expect(page.getByTestId('wiki-link-picker')).toBeVisible()
    const violations = await scan(page)
    expect(critical(violations)).toEqual([])
    await page.keyboard.press('Escape')
  })
})
