import { expect, test } from '@playwright/test'

/**
 * Node labels must actually appear in the rendered diagram.
 *
 * This exists because of a defect that every other test missed. Mermaid emits
 * HTML labels inside `<foreignObject>` by default, and `sanitizeDiagramSvg`
 * removes `foreignObject` as defence in depth. The result was that every diagram
 * in RTWiki rendered as shapes and connectors with no text at all — on every
 * page, for every diagram type — while the existing suite passed, because every
 * assertion was "an `<svg>` appeared".
 *
 * So the assertion here is deliberately about the label text, not the SVG.
 */

const LABELS = ['Start', 'End']

async function openDiagram(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(`Labels ${Date.now()}`)
  await dialog.getByTestId('new-page-type-diagram').click()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('diagram-workspace')).toBeVisible()
  await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
}

/** Every label the diagram was asked to show, and how each was rendered. */
async function labelReport(page: import('@playwright/test').Page): Promise<{
  svgText: string
  foreignObjects: number
  textNodes: number
  found: string[]
}> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="diagram-rendered"] svg')
    return {
      svgText: svg?.textContent ?? '',
      foreignObjects: svg?.querySelectorAll('foreignObject').length ?? 0,
      textNodes: svg?.querySelectorAll('text').length ?? 0,
      found: []
    }
  })
}

test.describe('diagram labels', () => {
  test('the default diagram shows its node labels', async ({ page }) => {
    await openDiagram(page)
    const report = await labelReport(page)

    // The labels are in the document, not merely laid out for.
    for (const label of LABELS) {
      expect(report.svgText, `"${label}" must be rendered`).toContain(label)
    }
  })

  test('labels are SVG text, so the sanitiser has nothing to strip', async ({ page }) => {
    await openDiagram(page)
    const report = await labelReport(page)

    expect(report.textNodes, 'labels must be <text> elements').toBeGreaterThan(0)
    // `sanitizeDiagramSvg` deletes every foreignObject. If Mermaid ever emits
    // HTML labels again the labels vanish silently, which is the whole defect.
    expect(report.foreignObjects, 'no HTML labels may reach the sanitiser').toBe(0)
  })

  test('the rendered diagram is readable in both colour schemes', async ({ page }) => {
    // The theme is applied per render, so each scheme is checked on its own.
    // Light emits a dark label colour; dark emits a light one. Asserted against
    // Mermaid's own generated stylesheet, which is what actually paints the text.
    const labelColour = async (): Promise<string> => {
      const style = await page
        .locator('[data-testid="diagram-rendered"] svg style')
        .first()
        .textContent()
      return style ?? ''
    }

    await page.emulateMedia({ colorScheme: 'light' })
    await openDiagram(page)
    const light = await labelColour()
    expect(light, 'light scheme must use a dark label colour').toMatch(
      /\.label\{[^}]*color:\s*#(?!fff)/i
    )

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
    await expect(page.getByTestId('diagram-rendered').locator('svg')).toBeVisible()
    const dark = await labelColour()
    expect(dark, 'dark scheme must use a light label colour').toMatch(
      /\.label\{[^}]*color:\s*#(eee|ccc|f9f)/i
    )
  })
})
