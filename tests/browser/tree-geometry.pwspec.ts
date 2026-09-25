import { mkdirSync } from 'node:fs'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

const OUT = '.superpowers/sdd/desktop-chrome-fix/audit'

/**
 * Tree geometry.
 *
 * Wunderbaum computes a node's title offset in JavaScript using a hard-coded
 * ICON_WIDTH of 20, and the app renders the indent cell from
 * `--wb-icon-outer-width`. When those two disagree, every nesting level drifts
 * by the difference and the title's ellipsis width is computed against the
 * wrong figure. These tests pin the rendered grid so the two cannot separate
 * again.
 */

/** The library's internal per-level indent, from `const ICON_WIDTH = 20`. */
const LIBRARY_INDENT_PX = 20

let seq = 0
function uniqueTitle(base: string): string {
  seq += 1
  return `${base} ${Date.now()}-${seq}`
}

async function makeHierarchy(request: APIRequestContext, depth: number, prefix: string) {
  const root = await request.post('/api/pages', {
    data: { title: `${prefix}-L0`, pageType: 'rich', content: '' }
  })
  const rootBody = (await root.json()) as { page?: { id: string } }
  let parentId = rootBody.page?.id
  for (let level = 1; level < depth; level += 1) {
    const res = await request.post('/api/pages', {
      data: { title: `${prefix}-L${level}`, pageType: 'rich', content: '', parentId }
    })
    const body = (await res.json()) as { page?: { id: string } }
    parentId = body.page?.id
  }
  return rootBody.page?.id
}

test.describe('Tree geometry', () => {
  test('nesting levels land on an exact indent grid', async ({ page, request }) => {
    mkdirSync(OUT, { recursive: true })
    const prefix = uniqueTitle('Geo')
    await makeHierarchy(request, 4, prefix)
    await page.setViewportSize({ width: 1280, height: 800 })
    // Reload so the tree loads the newly created hierarchy from the API.
    await page.goto('/')
    await expect(page.locator('[data-testid="page-tree"]')).toBeVisible({ timeout: 20_000 })
    // The tree virtualises: a row exists in the DOM only when it is near the
    // viewport, so scroll the container before looking for it.
    const tree = page.locator('[data-testid="page-tree"]')
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(400)
    await expect(
      page
        .locator('[role="treeitem"]')
        .filter({ hasText: `${prefix}-L0` })
        .first()
    ).toBeVisible({ timeout: 20_000 })

    // Expand the chain. The tree virtualises, so a row must be scrolled into
    // view before it exists in the DOM - only rendered rows can be measured.
    let level = 0
    while (level < 4) {
      const row = page
        .locator('[role="treeitem"]')
        .filter({ hasText: `${prefix}-L${level}` })
        .first()
      await row.scrollIntoViewIfNeeded({ timeout: 10_000 })
      const expander = row.locator('i.wb-expander')
      if ((await expander.count()) === 0) break
      await expander.click()
      await page.waitForTimeout(200)
      level += 1
    }
    await page.waitForTimeout(500)

    const offsets = await page.evaluate((prefix) => {
      const rows = Array.from(document.querySelectorAll('[role="treeitem"]'))
      const out: { title: string; x: number; level: number }[] = []
      for (const row of rows) {
        const text = row.textContent ?? ''
        if (!text.includes(prefix)) continue
        const icon = row.querySelector('i.rtw-page-icon') as HTMLElement | null
        if (!icon) continue
        const rowBox = row.getBoundingClientRect()
        out.push({
          title: text.trim().slice(0, 24),
          // Icon offset relative to the row, so pane width and scroll do not matter.
          x: Math.round(icon.getBoundingClientRect().left - rowBox.left),
          level: Number(row.getAttribute('aria-level') ?? '0')
        })
      }
      return out
    }, prefix)

    expect(offsets.length, 'the hierarchy must be rendered').toBeGreaterThanOrEqual(3)

    // Each level's icon must sit exactly one library indent further right.
    const byLevel = new Map<number, number>()
    for (const o of offsets) byLevel.set(o.level, o.x)
    const levels = [...byLevel.keys()].sort((a, b) => a - b)
    for (let i = 1; i < levels.length; i += 1) {
      const step = byLevel.get(levels[i])! - byLevel.get(levels[i - 1])!
      expect(
        step,
        `level ${levels[i - 1]}->${levels[i]} must step by exactly ${LIBRARY_INDENT_PX}px, measured ${step}px (${JSON.stringify(offsets)})`
      ).toBe(LIBRARY_INDENT_PX)
    }

    await page.screenshot({ path: `${OUT}/tree-geometry.png` })
  })

  test('the rendered indent cell matches the library indent', async ({ page, request }) => {
    await makeHierarchy(request, 2, uniqueTitle('Cell'))
    await page.goto('/')
    await expect(page.locator('[data-testid="page-tree"]')).toBeVisible({ timeout: 20_000 })
    // Expand the root so a nested row - and therefore a real indent cell - exists.
    const expander = page.locator('[role="treeitem"] i.wb-expander').first()
    if ((await expander.count()) > 0) {
      await expander.click()
      await page.waitForTimeout(400)
    }

    const cell = await page.evaluate(() => {
      // The expander element also carries `wb-indent`, so it must be excluded
      // or the measurement reports the expander cell, not a nesting cell.
      const el = document.querySelector('i.wb-indent:not(.wb-expander)') as HTMLElement | null
      return el ? Math.round(el.getBoundingClientRect().width) : null
    })
    expect(cell, 'a nesting indent cell must be rendered').not.toBeNull()
    // The library lays out one cell per level at this width; if the app renders
    // a different width, icons drift and the ellipsis is miscalculated.
    expect(cell).toBe(LIBRARY_INDENT_PX)
  })

  test('rows are the flex container, not an absolutely positioned cell', async ({
    page,
    request
  }) => {
    await page.goto('/')
    await expect(page.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 20_000 })

    const layout = await page.evaluate(() => {
      // The library renders a phantom row with no node body, which the app
      // hides; measure a real one.
      const row = document.querySelector('div.wb-row:has(span.wb-node)') as HTMLElement
      const col = row.querySelector('span.wb-col') as HTMLElement
      return {
        rowDisplay: getComputedStyle(row).display,
        colPosition: getComputedStyle(col).position,
        colDisplay: getComputedStyle(col).display
      }
    })
    expect(layout.rowDisplay, 'the row must be the flex container').toBe('flex')
    expect(layout.colPosition, 'the table-cell wrapper must leave layout').toBe('static')
    expect(layout.colDisplay).toBe('contents')
  })

  test("a row's content is vertically centred", async ({ page, request }) => {
    await page.goto('/')
    const row = page.locator('[role="treeitem"]').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const drift = await row.evaluate((el) => {
      const icon = el.querySelector('i.rtw-page-icon') as HTMLElement | null
      const title = el.querySelector('span.wb-title') as HTMLElement | null
      const rowBox = el.getBoundingClientRect()
      const mid = rowBox.top + rowBox.height / 2
      const off = (node: HTMLElement | null) =>
        node
          ? Math.abs(
              node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2 - mid
            )
          : null
      return { icon: off(icon), title: off(title), rowH: rowBox.height }
    })
    expect(drift.rowH).toBeGreaterThan(20)
    // A sub-pixel centre is fine; a 5px offset was the original defect.
    expect(drift.icon!).toBeLessThanOrEqual(1.5)
    expect(drift.title!).toBeLessThanOrEqual(1.5)
  })

  test('the rendered row height matches the library layout height', async ({ page }) => {
    // ROW_HEIGHT_PX is a hand-mirrored copy of --rtwiki-tree-row-height,
    // because the library needs the number in JS for its viewport maths. If
    // the two disagree the list stops lining up - rows overlap or gap - so
    // this is asserted rather than left to a comment asking people to remember.
    await page.goto('/')
    const row = page.locator('[role="treeitem"]').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const heights = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('div.wb-row:has(span.wb-node)')
      ) as HTMLElement[]
      return rows.slice(0, 6).map((r) => Math.round(r.getBoundingClientRect().height))
    })
    expect(heights.length).toBeGreaterThan(1)
    for (const h of heights) {
      expect(h, 'every row must render at the height the library lays out').toBe(32)
    }
  })
})
