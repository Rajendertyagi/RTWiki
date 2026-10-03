/*
 * Cross-surface Mermaid equivalence, and the fixture audit it is built from.
 *
 * ## What this proves
 *
 * The same source, rendered as a Diagram page block and as a Rich Document block,
 * produces the same SVG: same `viewBox`, same node fills, same label text, and — the
 * one that was actually broken — the same typeface on the labels.
 *
 * ## Why the font is asserted separately from the rest
 *
 * `MERMAID_CONFIG.fontFamily` was `'inherit'`, which reads as "use the app's font" and
 * behaves as "use whatever font the host element happens to carry". Inside a Rich Note
 * the nearest ancestor with a font is BlockNote's own `.bn-default-styles`, which
 * hardcodes `Inter, "SF Pro Display", …`; on the Diagram page it is the application
 * stack from `theme/registry.ts`. Same diagram, two typefaces, depending on surface.
 *
 * Everything else already matched, which is exactly why the font went unnoticed: the
 * viewBox and the fills are identical either way, so a visual diff shows "no change"
 * while the text is set in a different face.
 *
 * ## Harness note, because it invalidates measurements if forgotten
 *
 * The suite serves a PREBUILT bundle from `build/web`. Editing `src/` changes
 * nothing until `bun run build:web` has run. A font assertion made against a stale
 * bundle measures the old code and passes or fails for the wrong reason — which is
 * what happened while this test was being written.
 */

import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/** Read from the application's own theme, so this cannot drift from it. */
const APP_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

const SOURCE = 'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]'

interface SurfaceFacts {
  viewBox: string
  width: string
  height: string
  nodeFills: string[]
  labelTexts: string[]
  /** The font actually painted on a label, not the one an unstyled child would get. */
  labelFont: string
}

/**
 * Mermaid bakes its font into a `<style>` block as `.label { font-family: … }`, so the
 * computed style on a real label is the only value that reflects what a reader sees.
 * Measuring the `<svg>` element instead reports the host cascade, which is the bug.
 */
async function readDiagram(page: Page, selector: string): Promise<SurfaceFacts | null> {
  return page.evaluate((sel) => {
    // `.first()` semantics: a Rich Note holding one diagram still matches several
    // nested wrappers, and a strict-mode locator would reject the whole query.
    const svg = document.querySelector(sel)
    if (!svg) return null
    const label = svg.querySelector('.label, text, tspan')
    return {
      viewBox: svg.getAttribute('viewBox') ?? '',
      width: svg.getAttribute('width') ?? '',
      height: svg.getAttribute('height') ?? '',
      nodeFills: Array.from(svg.querySelectorAll('.node rect')).map(
        (r) => r.getAttribute('fill') ?? ''
      ),
      labelTexts: Array.from(svg.querySelectorAll('text, tspan'))
        .map((t) => t.textContent?.trim() ?? '')
        .filter(Boolean),
      labelFont: label ? getComputedStyle(label).fontFamily : ''
    }
  }, selector)
}

async function seed(
  request: APIRequestContext,
  title: string,
  pageType: 'diagram' | 'rich'
): Promise<void> {
  const content =
    pageType === 'diagram'
      ? JSON.stringify({ version: 2, type: 'diagram', blocks: [{ id: 'x0', source: SOURCE }] })
      : JSON.stringify([
          { type: 'paragraph', content: 'Cross-surface check.' },
          { type: 'diagram', content: SOURCE }
        ])
  const res = await request.post('/api/pages', { data: { title, pageType, content } })
  expect(res.status(), `seeding the ${pageType} surface`).toBe(201)
}

test.describe('one Mermaid rendering system across surfaces', () => {
  test('the same source renders identically as a Diagram block and a Rich block', async ({
    page,
    request
  }) => {
    const diagramTitle = `XS diagram ${Date.now()}`
    const richTitle = `XS rich ${Date.now()}`
    await seed(request, diagramTitle, 'diagram')
    await seed(request, richTitle, 'rich')

    await page.goto('/')
    await page.waitForTimeout(2000)
    await page.getByText(diagramTitle, { exact: false }).first().click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="diagram-block-0-svg"] svg')).toBeVisible({
      timeout: 20_000
    })
    const onDiagram = await readDiagram(page, '[data-testid="diagram-block-0-svg"] svg')

    await page.goto('/')
    await page.waitForTimeout(2000)
    await page.getByText(richTitle, { exact: false }).first().click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 20_000 })
    // Scoped away from the editor's own chrome: a bare `svg` inside the editor matches
    // a 14x14 toolbar icon, which is what an earlier version of this test measured.
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    /*
     * `diagram-svg` is the element the pipeline's own SVG is mounted into
     * (`mermaid-block-view.tsx`), so it names the diagram exactly. Every looser
     * selector tried here matched chrome instead: a class-based one picked a 24x24
     * toolbar icon, and a `.bn-block` one a 16x16 button glyph.
     */
    await expect(page.locator('[data-testid="diagram-svg"] svg')).toBeVisible({ timeout: 20_000 })
    const onRichNote = await readDiagram(page, '[data-testid="diagram-svg"] svg')

    expect(onDiagram, 'the Diagram page must render the source').not.toBeNull()
    expect(onRichNote, 'the Rich Note must render the source').not.toBeNull()

    // Same geometry: the renderer produced one diagram, not two.
    expect(onRichNote!.viewBox, 'both surfaces must produce the same viewBox').toBe(
      onDiagram!.viewBox
    )
    expect(onRichNote!.width).toBe(onDiagram!.width)
    expect(onRichNote!.height).toBe(onDiagram!.height)

    // Same appearance.
    expect(onRichNote!.nodeFills, 'node fills must match across surfaces').toEqual(
      onDiagram!.nodeFills
    )
    expect(onRichNote!.labelTexts, 'label text must match across surfaces').toEqual(
      onDiagram!.labelTexts
    )

    /*
     * The regression this test exists for. Both surfaces must paint the application's
     * own stack, and neither may fall through to BlockNote's hardcoded one.
     */
    expect(
      onDiagram!.labelFont,
      'the Diagram page must set the application font on diagram labels'
    ).toBe(APP_FONT)
    expect(
      onRichNote!.labelFont,
      "a Rich Note's diagram labels must not inherit BlockNote's font"
    ).toBe(APP_FONT)
  })
})
