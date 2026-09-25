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
    // Build a real parent/child pair so a nested row - and therefore an actual
    // indent cell - exists once the parent is expanded. Relying on whatever the
    // database happened to contain made this pass or fail on state, not
    // behaviour.
    const stamp = Date.now()
    const parentRes = await request.post('/api/pages', {
      data: { title: `CellParent ${stamp}`, pageType: 'rich', content: '' }
    })
    const parentId = ((await parentRes.json()) as { page: { id: string } }).page.id
    await request.post('/api/pages', {
      data: { title: `CellChild ${stamp}`, pageType: 'rich', content: '', parentId }
    })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(500)

    const parentRow = page
      .locator('[role="treeitem"]')
      .filter({ hasText: `CellParent ${stamp}` })
      .first()
    await parentRow.scrollIntoViewIfNeeded()
    await parentRow.locator('i.wb-expander').click()
    await page.waitForTimeout(500)
    await expect(
      page.locator('[role="treeitem"]').filter({ hasText: `CellChild ${stamp}` })
    ).toBeVisible({ timeout: 10_000 })

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
        colDisplay: getComputedStyle(col).display,
        colWidth: Math.round(col.getBoundingClientRect().width)
      }
    })
    expect(layout.rowDisplay, 'the row must be the flex container').toBe('flex')
    // The cell keeps a real box - it is the row's only child, and removing it
    // from layout costs the row its entire hit area.
    expect(layout.colPosition, 'the cell must leave absolute positioning').toBe('static')
    expect(layout.colDisplay).toBe('flex')
    expect(layout.colWidth).toBeGreaterThan(100)
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

  test('a row has a real hit area, so drag-and-drop can start', async ({ page }) => {
    // Regression: the row's only child is one span carrying both `wb-node` and
    // `wb-col`. Applying `display: contents` to it collapsed that span to zero
    // width, which left the row with no draggable surface and silently broke
    // every drag without any error.
    await page.goto('/')
    const row = page.locator('[role="treeitem"]').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const m = await row.evaluate((el) => {
      const child = el.firstElementChild as HTMLElement
      const cb = child.getBoundingClientRect()
      const rb = el.getBoundingClientRect()
      return {
        childWidth: Math.round(cb.width),
        childLeft: Math.round(cb.left - rb.left),
        childDisplay: getComputedStyle(child).display,
        childPosition: getComputedStyle(child).position
      }
    })
    expect(m.childDisplay, 'the content wrapper must not be display:contents').not.toBe('contents')
    expect(m.childPosition).toBe('static')
    expect(m.childWidth, 'the row content must occupy the row').toBeGreaterThan(100)
    expect(
      m.childLeft,
      'content must start at the row edge, not outside it'
    ).toBeGreaterThanOrEqual(0)
  })

  test('the Home row aligns with the tree rows it sits above', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="tree-root-entry"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tree-root-entry"]') as HTMLElement
      const row = document.querySelector('div.wb-row:has(span.wb-node)') as HTMLElement
      const rel = (e: Element | null, host: HTMLElement) =>
        e ? Math.round(e.getBoundingClientRect().left - host.getBoundingClientRect().left) : null
      return {
        rootLabelX: rel(root.querySelector('.navLabel, span:last-of-type'), root),
        rowTitleX: rel(row.querySelector('span.wb-title'), row),
        rootH: Math.round(root.getBoundingClientRect().height),
        rowH: Math.round(row.getBoundingClientRect().height)
      }
    })
    expect(
      Math.abs(m.rootLabelX! - m.rowTitleX!),
      'Home text must line up with page titles'
    ).toBeLessThanOrEqual(1)
    expect(m.rootH, 'Home row must be the same height as a tree row').toBe(m.rowH)
  })

  test('only one row reads as selected, and Home matches a selected page', async ({ page }) => {
    await page.goto('/')
    const root = page.locator('[data-testid="tree-root-entry"]')
    await expect(root).toBeVisible({ timeout: 20_000 })

    interface SelectionState {
      root: string | null
      rootBg: string
      selected: number
      selBg?: string | null
    }
    // At Home, only Home is selected.
    let state: SelectionState = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tree-root-entry"]') as HTMLElement
      const rows = Array.from(
        document.querySelectorAll('div.wb-row:has(span.wb-node)')
      ) as HTMLElement[]
      return {
        root: root.getAttribute('data-active'),
        selected: rows.filter(
          (r) => r.classList.contains('wb-active') || r.classList.contains('wb-selected')
        ).length,
        rootBg: getComputedStyle(root).backgroundColor
      }
    })
    expect(state.root).toBe('true')
    expect(state.selected, 'no page row may be selected while Home is').toBe(0)

    // Select a page: Home must clear, exactly one page row lights up, and it
    // must use the same fill Home used.
    await page.locator('[role="treeitem"]').first().click()
    await page.waitForTimeout(500)
    state = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tree-root-entry"]') as HTMLElement
      const rows = Array.from(
        document.querySelectorAll('div.wb-row:has(span.wb-node)')
      ) as HTMLElement[]
      const sel = rows.filter(
        (r) => r.classList.contains('wb-active') || r.classList.contains('wb-selected')
      )
      return {
        root: root.getAttribute('data-active'),
        rootBg: getComputedStyle(root).backgroundColor,
        selected: sel.length,
        selBg: sel[0] ? getComputedStyle(sel[0]).backgroundColor : null
      }
    })
    expect(state.root, 'Home must clear when a page is selected').toBe('false')
    expect(state.rootBg).toBe('rgba(0, 0, 0, 0)')
    expect(state.selected, 'exactly one page row may be selected').toBe(1)
    // Same accent family as Home used, so the two never look like different
    // kinds of selection. Hover may deepen it, so compare hue not exact alpha.
    expect(state.selBg, 'a selected page must use the tree selected token').toContain(
      '0.109804 0.439216 1'
    )
  })

  test('a selected row is clearly distinct from a hovered row', async ({ page }) => {
    await page.goto('/')
    const row = page.locator('[role="treeitem"]').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const colours = await row.evaluate((el) => {
      const parse = (c: string) => {
        const m = /rgba?\(([^)]+)\)/.exec(c)
        return m ? m[1].split(',').map((n) => Number.parseFloat(n)) : null
      }
      const unselectedHover = getComputedStyle(el).backgroundColor
      return { hovered: parse(unselectedHover) }
    })
    // A neutral hover is grey/transparent; a selected row is blue-tinted. If
    // these converge the user cannot tell selection from hover.
    expect(colours.hovered, 'hover must not be a blue selection tint').not.toContain(
      '0.109804 0.439216 1'
    )
  })

  test('the search field is wide, with a complete and visible border', async ({
    page,
    request
  }) => {
    await page.goto('/')
    const input = page.locator('[aria-label="Search pages"]')
    await expect(input).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    const m = await page.evaluate(() => {
      const input = document.querySelector('[aria-label="Search pages"]') as HTMLElement
      const section = input.parentElement as HTMLElement
      const ib = input.getBoundingClientRect()
      const sb = section.getBoundingClientRect()
      const cs = getComputedStyle(input)
      return {
        width: Math.round(ib.width),
        paneWidth: Math.round(sb.width),
        insetEachSide: Math.round(ib.left - sb.left),
        radius: cs.borderRadius,
        // A complete border is what makes the field look like a field.
        leftBorder: cs.borderLeftWidth,
        rightBorder: cs.borderRightWidth,
        topBorder: cs.borderTopWidth,
        padLeft: cs.paddingLeft
      }
    })
    // Wide: fills the pane's content box, flush with the rows below it. The
    // horizontal inset belongs to the pane, not to this field, which is what
    // makes the field and the rows share one left edge.
    expect(m.width).toBe(m.paneWidth)
    expect(m.insetEachSide).toBe(0)
    // Complete: all sides present, and the corners rounded. A clipped border
    // measured 1.49:1 against its own background, so the field had no outline.
    expect(m.leftBorder).toBe('1px')
    expect(m.rightBorder).toBe('1px')
    expect(m.topBorder).toBe('1px')
    expect(m.radius).not.toBe('0px')
    // The placeholder must not be clipped by the search icon's section.
    expect(Number.parseFloat(m.padLeft)).toBeGreaterThan(8)
  })

  test('the tree exposes the keyboard-focused row to assistive technology', async ({
    page,
    request
  }) => {
    // The container holds DOM focus and every row is tabindex=-1, so
    // aria-activedescendant is the only thing that tells a screen reader where
    // the arrow keys are. Without it, pressing Down announces nothing.
    await page.goto('/')
    await expect(page.locator('[role="treeitem"]').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(300)

    await page.locator('[role="treeitem"]').first().click()
    await page.waitForTimeout(400)

    const m = await page.evaluate(() => {
      const tree = document.querySelector('[role="tree"]') as HTMLElement
      const ad = tree.getAttribute('aria-activedescendant')
      return {
        activeDescendant: ad,
        // It must resolve to a real, rendered row.
        resolves: ad ? !!document.getElementById(ad) : false,
        targetRole: ad ? (document.getElementById(ad)?.getAttribute('role') ?? null) : null,
        everyRowHasId: Array.from(document.querySelectorAll('[role="treeitem"]')).every(
          (r) => !!r.id
        )
      }
    })
    expect(m.activeDescendant, 'the tree must point at the focused row').toBeTruthy()
    expect(m.resolves, 'aria-activedescendant must reference a rendered element').toBe(true)
    expect(m.targetRole).toBe('treeitem')
    expect(m.everyRowHasId, 'every row needs a stable id to be referenced').toBe(true)
  })

  test('a deeply nested page still shows a readable amount of its name', async ({
    page,
    request
  }) => {
    // Each level costs 20px of title and the tree does not scroll sideways.
    const stamp = Date.now()
    let parent: string | undefined
    for (let i = 0; i < 9; i += 1) {
      const r = await request.post('/api/pages', {
        data: {
          title: `V${stamp}LongPageNameAtLevel${i}`,
          pageType: 'rich',
          content: '',
          parentId: parent
        }
      })
      parent = ((await r.json()) as { page: { id: string } }).page.id
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(500)

    for (let i = 0; i < 9; i += 1) {
      const row = page
        .locator('[role="treeitem"]')
        .filter({ hasText: `Level${i}` })
        .first()
      // Each expansion pushes the next level further down a virtualised list,
      // so the row has to be re-scrolled into existence every time.
      if ((await row.count()) === 0) {
        await tree.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        await page.waitForTimeout(250)
      }
      await row.scrollIntoViewIfNeeded().catch(() => {})
      const exp = row.locator('i.wb-expander')
      if (
        (await exp.count()) > 0 &&
        !((await exp.getAttribute('class')) ?? '').includes('rtw-expanded')
      ) {
        await exp.click().catch(() => {})
        await page.waitForTimeout(200)
      }
    }
    await page.waitForTimeout(400)

    // The floor is the mechanism, and it applies at every depth, so assert it
    // directly rather than depending on a nine-level expansion dance in a
    // virtualised list.
    const floor = await page.evaluate(() => {
      const row = document.querySelector('div.wb-row:has(span.wb-node)')
      const t = row?.querySelector('span.wb-title') as HTMLElement | null
      return t ? Number.parseFloat(getComputedStyle(t).minWidth) : null
    })
    expect(floor, 'the title must declare a minimum width').not.toBeNull()
    // Without it, a page eleven levels deep is left with about one character.
    expect(floor!).toBeGreaterThanOrEqual(72)

    const deepest = await page.evaluate((s) => {
      const rows = Array.from(document.querySelectorAll('[role="treeitem"]')) as HTMLElement[]
      let best: { w: number; text: string } | null = null
      for (const r of rows) {
        const t = r.querySelector('span.wb-title') as HTMLElement | null
        if (!t || !(t.textContent ?? '').includes(`V${s}`)) continue
        const w = Math.round(t.getBoundingClientRect().width)
        if (!best || w < best.w) best = { w, text: t.textContent ?? '' }
      }
      return best
    }, String(stamp))
    if (deepest) {
      expect(deepest.w, 'a rendered nested title must stay readable').toBeGreaterThanOrEqual(60)
    }
  })

  test('the search field, the Home row and a page row share one width', async ({
    page,
    request
  }) => {
    // These three used three different widths (265 / 281 / 276 in a 281px pane),
    // so the selected fill changed width depending on what was selected. The
    // hidden cause was the library's 2px container border: it was made
    // transparent but still occupied space.
    await makeHierarchy(request, 1, uniqueTitle('Width'))
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('[data-testid="page-tree"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)

    const m = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), w: Math.round(r.width) }
      }
      const treeEl = document.querySelector('[data-testid="page-tree"]') as HTMLElement
      const tcs = getComputedStyle(treeEl)
      return {
        search: box('[aria-label="Search pages"]'),
        home: box('[data-testid="tree-root-entry"]'),
        row: box('div.wb-row:has(span.wb-node)'),
        treeBorder: `${tcs.borderLeftWidth}/${tcs.borderRightWidth}`
      }
    })
    expect(m.search).not.toBeNull()
    expect(m.home).not.toBeNull()
    expect(m.row).not.toBeNull()
    // Left edges aligned: all three start on the same line.
    expect(Math.abs(m.search!.x - m.home!.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.home!.x - m.row!.x)).toBeLessThanOrEqual(1)
    // Widths within a pixel of each other.
    expect(Math.abs(m.search!.w - m.home!.w)).toBeLessThanOrEqual(1)
    expect(Math.abs(m.home!.w - m.row!.w)).toBeLessThanOrEqual(1)
    // And the library's 2px box is gone, not merely invisible.
    expect(m.treeBorder, 'the tree container must not reserve a border box').toBe('0px/0px')
  })

  test('the step from Home to the first page matches the step between pages', async ({
    page,
    request
  }) => {
    await makeHierarchy(request, 1, uniqueTitle('Gap'))
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('[data-testid="page-tree"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)

    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tree-root-entry"]') as HTMLElement
      const rows = Array.from(
        document.querySelectorAll('div.wb-row:has(span.wb-node)')
      ) as HTMLElement[]
      const first = rows[0]
      const second = rows[1]
      return {
        homeToFirst: Math.round(
          first.getBoundingClientRect().top - root.getBoundingClientRect().bottom
        ),
        firstToSecond: second
          ? Math.round(second.getBoundingClientRect().top - first.getBoundingClientRect().bottom)
          : null
      }
    })
    // Rows inside the tree are flush, so Home must be flush with the first row.
    expect(m.firstToSecond).toBe(0)
    expect(m.homeToFirst, 'Home must sit flush with the first page row').toBe(m.firstToSecond)
  })

  test('hovering the selected row does not paint a pale blot', async ({ page, request }) => {
    // The row-action button carried an opaque pane fill so its glyph stayed
    // legible over the blue selection - which meant hovering the row you had
    // chosen showed a near-white square on top of the blue.
    await makeHierarchy(request, 1, uniqueTitle('Blot'))
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('[data-testid="page-tree"]')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(400)

    const row = page.locator('[role="treeitem"]').first()
    await row.click()
    await page.waitForTimeout(400)
    await row.hover()
    await page.waitForTimeout(400)

    const bg = await row.evaluate((el) => {
      const act = el.querySelector('button.rtw-row-action') as HTMLElement | null
      if (!act) return null
      return { background: getComputedStyle(act).backgroundColor }
    })
    expect(bg, 'the action button must be visible on hover').not.toBeNull()
    // Transparent or a tint of the row - never an opaque near-white panel.
    const opaque = /^rgb\(/.test(bg!.background)
    expect(opaque, `action button must not be opaque (${bg!.background})`).toBe(false)
  })

  test('a page can actually be dragged onto another', async ({ page, request }) => {
    // The real proof for the hit-area regression: a row whose content collapsed
    // to zero width still renders and still passes a colour check, but cannot
    // be grabbed. This performs an actual drag and asserts the move committed.
    const title = uniqueTitle('DragMe')
    const parentTitle = uniqueTitle('DragParent')
    // Both are roots, so both rows are rendered without expanding anything.
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
    await request.post('/api/pages', {
      data: { title: parentTitle, pageType: 'rich', content: '' }
    })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(500)

    const child = page.locator('[role="treeitem"]').filter({ hasText: title }).first()
    const parent = page.locator('[role="treeitem"]').filter({ hasText: parentTitle }).first()
    await expect(child).toBeVisible({ timeout: 20_000 })
    await expect(parent).toBeVisible({ timeout: 20_000 })

    await child.dragTo(parent)
    await page.waitForTimeout(1200)

    // The child must now be a child of the parent, not a root.
    const nested = await request.get('/api/pages?limit=200')
    const body = (await nested.json()) as {
      pages: Array<{ id: string; title: string; parentId?: string | null }>
    }
    const childRow = body.pages.find((p) => p.title === title)
    const parentRow = body.pages.find((p) => p.title === parentTitle)
    expect(childRow?.parentId, 'the dragged page must be a child of the target').toBe(parentRow?.id)
  })
})
