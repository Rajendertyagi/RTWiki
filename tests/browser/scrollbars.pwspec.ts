/*
 * RTWiki's two scrollbar mechanisms, verified by behaviour rather than by class
 * names.
 *
 * The distinction these tests protect is ownership, which is the whole point of the
 * design: an RTWiki-owned container is a Mantine `ScrollArea`, and a container a
 * library owns stays exactly the element it was. A test that only checked a class
 * would pass even if the wrong element ended up scrolling.
 *
 * ## Measuring thickness in this harness
 *
 * Playwright's Chromium draws *overlay* scrollbars, so the gutter is always 0:
 * `offsetWidth - clientWidth` is 0 on a genuinely scrolling element and therefore
 * proves nothing about thickness. That much is true.
 *
 * It used to follow from this file that thickness was unverifiable here and had to be
 * checked by eye. That was wrong, and the correction is what `readThickness` below
 * relies on. The bar's *declared* geometry is still readable, by two different
 * routes depending on the mechanism:
 *
 * - A native-restyled scrollbar resolves its vendor pseudo-element, so
 *   `getComputedStyle(el, '::-webkit-scrollbar').width` reads back the length the
 *   browser was told to paint. Measured: `6px`.
 * - A Mantine `ScrollArea` draws its own bar as a real element carrying that
 *   thickness as its layout width. Measured: `offsetWidth` of
 *   `.mantine-ScrollArea-scrollbar` is `6`.
 *
 * So thickness IS asserted here, per surface, and not merely eyeballed. What is still
 * only visible to the eye is the *rendered* result — the painted capsule and its
 * contrast — which no DOM measurement describes.
 */
import { expect, test } from '@playwright/test'

/** The element that actually scrolls for a given selector, measured by scrolling it. */
async function scrollOwner(
  page: import('@playwright/test').Page,
  selector: string
): Promise<{ moved: boolean; scrollTop: number; scrollHeight: number; clientHeight: number }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { moved: false, scrollTop: -1, scrollHeight: -1, clientHeight: -1 }
    const before = el.scrollTop
    el.scrollTop = 99999
    const after = el.scrollTop
    // Put it back, so a failed assertion cannot leave the page mid-scroll.
    el.scrollTop = before
    return {
      moved: after > 0,
      scrollTop: after,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    }
  }, selector)
}

const newPageOfType = async (
  page: import('@playwright/test').Page,
  radio: number,
  title: string
) => {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  await dialog.locator('input[type="radio"]').nth(radio).check()
  await dialog.getByRole('button', { name: /create/i }).click()
  await page.waitForTimeout(2500)
}

test.describe('scrollbar tokens are published once and resolve', () => {
  test('the thickness token resolves to a real length, and one source feeds both paths', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForTimeout(1200)

    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      const size = cs.getPropertyValue('--rtwiki-scrollbar-size').trim()
      const thumb = cs.getPropertyValue('--rtwiki-scrollbar-thumb').trim()
      const panel = cs.getPropertyValue('--rtwiki-panel-max-height').trim()
      return { size, thumb, panel }
    })

    // Published from LAYOUT by the theme resolver, so a value can be neither missing
    // nor a different number from the one the ScrollArea components are given.
    expect(tokens.size, 'scrollbar thickness token must resolve').toMatch(/^\d+(\.\d+)?px$/)
    expect(Number.parseFloat(tokens.size), 'thickness must be the 6px design value').toBe(6)
    expect(tokens.thumb, 'thumb colour must be theme-derived, not empty').not.toBe('')
    expect(tokens.panel, 'panel cap token must resolve').toMatch(/^\d+px$/)

    // And the ScrollArea path reads the same number rather than its own.
    const saSize = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--scrollarea-scrollbar-size')
        .trim()
    )
    // Absent until a ScrollArea mounts; when present it must agree.
    if (saSize !== '') {
      expect(Number.parseFloat(saSize)).toBe(Number.parseFloat(tokens.size))
    }
  })

  test('the vendor scrollbar branch is the active one, not a dead declaration', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
    /*
     * The reason the standard and vendor declarations are split at all: a Chromium
     * that sees a non-`auto` `scrollbar-width` ignores `::-webkit-scrollbar`. If the
     * `@supports` guard were wrong the rules would never apply and the app would
     * silently keep its thick bar, which is exactly the defect this system removes.
     */
    const vendorSupported = await page.evaluate(
      () => typeof CSS !== 'undefined' && CSS.supports('selector(::-webkit-scrollbar)')
    )
    expect(vendorSupported, 'the vendor branch must be reachable in this browser').toBe(true)

    const applied = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'rtwiki-scroll'
      document.body.appendChild(el)
      const cs = getComputedStyle(el)
      const out = { scrollbarWidth: cs.scrollbarWidth, scrollbarColor: cs.scrollbarColor }
      el.remove()
      return out
    })
    // `auto` is the reset that lets the vendor rules through; `thin` would disable them.
    expect(applied.scrollbarWidth).toBe('auto')
    /*
     * Asserted on the *resolved* colour, not on the token's name: `getComputedStyle`
     * substitutes custom properties, so this reads back an actual colour. Checking for
     * `--rtwiki-scrollbar-thumb` here would pass on an unresolved declaration and
     * fail on a correctly working one, which is backwards.
     */
    expect(applied.scrollbarColor, 'the thumb token must resolve to a real colour').toMatch(
      /^(color|rgba)\(/
    )
    // 26% of the text colour, which is the thumb mix this design uses.
    const alpha = Number.parseFloat(
      applied.scrollbarColor.replace(/^.*\/\s*/, '').replace(/\)$/, '')
    )
    expect(alpha, 'the thumb must be the 26% text mix').toBeCloseTo(0.26, 2)
  })
})

test.describe('RTWiki-owned containers use ScrollArea', () => {
  test('the diagram chooser is a ScrollArea that really scrolls', async ({ page }) => {
    await newPageOfType(page, 0, `ScrollChooser ${Date.now()}`)
    await page.locator('.bn-container').first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByTestId('insert-diagram').click()
    const panel = page.getByTestId('insert-diagram-submenu')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(900)

    const viewport = page.locator('[data-scrollarea-viewport]').first()
    await expect(viewport, 'the chooser must own its scrolling through a ScrollArea').toBeVisible()

    /*
     * Scoped to the chooser's own popover. A Rich Note also has a `ScrollArea` in its
     * right sidebar, so a document-wide lookup for the first viewport would measure
     * that one instead — which is how this test first failed while the chooser was
     * in fact correct.
     */
    const result = await page.evaluate(() => {
      const popover = document.querySelector('.mantine-Popover-dropdown')
      const el = popover?.querySelector('[data-scrollarea-viewport]')
      if (!el) return { moved: false, top: -1, over: false }
      el.scrollTop = 99999
      const top = el.scrollTop
      const over = el.scrollHeight > el.clientHeight + 1
      el.scrollTop = 0
      return { moved: top > 0, top, over }
    })
    expect(result.over, 'the chooser must overflow its cap, so the scrollbar is meaningful').toBe(
      true
    )
    expect(result.moved, 'the chooser must actually scroll').toBe(true)

    // And the frame owns the inset alone: no second padding stacked on the dropdown's.
    const pads = await page.evaluate(() => {
      const frame = document.querySelector('.mantine-Popover-dropdown')
      const panelEl = document.querySelector('[data-testid="insert-diagram-submenu"]')
      if (!frame || !panelEl) return null
      return {
        frame: Number.parseFloat(getComputedStyle(frame).paddingLeft),
        panel: Number.parseFloat(getComputedStyle(panelEl).paddingLeft)
      }
    })
    expect(pads, 'both the frame and the panel must be measurable').not.toBeNull()
    expect(pads?.frame, 'the frame keeps its inset').toBeGreaterThan(0)
    expect(pads?.panel, 'the panel must add no padding of its own').toBe(0)
  })

  test('the dashboard scroll region is a ScrollArea and still scrolls', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1200)
    const region = page.getByTestId('dashboard-scroll')
    await expect(region).toBeVisible()

    const isScrollArea = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dashboard-scroll"]')
      return el?.className.toString().includes('ScrollArea') ?? false
    })
    expect(isScrollArea, 'the dashboard region must be a ScrollArea').toBe(true)

    /*
     * The ScrollArea *root* is `overflow: hidden` by Mantine's own design — that is
     * how it clips its floating scrollbar, and it is what makes the bar sit on top of
     * the content rather than in the flow. What matters is that the root is not itself
     * a scroller: the axis belongs to the viewport inside it.
     */
    const axes = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dashboard-scroll"]')
      if (!el) return { root: '', viewport: null as string | null }
      const viewport = el.querySelector('[data-scrollarea-viewport]')
      return {
        root: getComputedStyle(el).overflowY,
        viewport: viewport ? getComputedStyle(viewport).overflowY : null
      }
    })
    expect(axes.viewport, 'the dashboard must have a ScrollArea viewport').not.toBeNull()
    expect(axes.root, 'the root must not scroll; the viewport owns the axis').not.toMatch(
      /auto|scroll/
    )
    expect(axes.viewport, 'the viewport must be the scroll container').toMatch(/auto|scroll/)
  })
})

test.describe('library-owned containers keep their own scrolling', () => {
  test('Wunderbaum still owns the tree scroll and is not wrapped in a viewport', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForTimeout(1200)
    /*
     * Enough pages for the tree to be taller than its pane, so "it still scrolls" is
     * actually measured. A fresh database fits inside the viewport, and asserting
     * scrollability against a list that does not overflow passes for the wrong reason
     * — which is what the first version of this test did.
     */
    for (let i = 0; i < 30; i += 1) {
      await page.locator('[aria-label="New page"]').first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Title').fill(`TreeScroll ${Date.now()}-${i}`)
      await dialog.getByRole('button', { name: /create/i }).click()
      await page.waitForTimeout(110)
    }
    await page.waitForTimeout(2500)

    const tree = page.getByTestId('page-tree')
    await expect(tree).toBeVisible()

    /*
     * The library's element must still be the scroller, and there must be no
     * `ScrollArea` viewport between it and the document. `wb-tree-host.ts` reads and
     * pins `tree.element.scrollTop`; a wrapper would move that element's scroll and
     * break drag autoscroll and the virtualised rows along with it.
     */
    const ownership = await page.evaluate(() => {
      const treeEl = document.querySelector('[data-testid="page-tree"]')
      if (!treeEl) return null
      const scrolls = getComputedStyle(treeEl).overflowY
      let ancestor = treeEl.parentElement
      let viewports = 0
      while (ancestor) {
        if (ancestor.hasAttribute('data-scrollarea-viewport')) viewports += 1
        ancestor = ancestor.parentElement
      }
      return {
        scrolls,
        viewports,
        classes: treeEl.className.toString(),
        isWunderbaum: !!treeEl.closest('div.wunderbaum') || treeEl.className.includes('wunderbaum')
      }
    })

    expect(ownership, 'the tree element must be measurable').not.toBeNull()
    expect(ownership?.scrolls, 'Wunderbaum must still be the scroll container').toMatch(
      /auto|scroll/
    )
    expect(ownership?.viewports, 'no ScrollArea viewport may wrap the tree').toBe(0)
    // It carries the shared scrollbar class, which is restyling, not replacement.
    expect(ownership?.classes, 'the tree must carry the shared scrollbar class').toContain(
      'rtwiki-scroll'
    )

    // And it genuinely scrolls: the tree has rows and a bounded height.
    const scrolled = await scrollOwner(page, '[data-testid="page-tree"]')
    expect(scrolled.scrollHeight, 'the tree must have scrollable content').toBeGreaterThan(
      scrolled.clientHeight
    )
  })

  test('BlockNote keeps a single scroll viewport and the caret still scrolls into view', async ({
    page
  }) => {
    await newPageOfType(page, 0, `ScrollRich ${Date.now()}`)
    const editor = page.locator('.bn-container').first()
    await editor.waitFor({ state: 'visible', timeout: 30_000 })
    await editor.click()
    /*
     * A modest amount of real typing, tuned rather than guessed.
     *
     * Two measurements shaped this. A single large `insertText` collapses into one
     * BlockNote paragraph, leaving the document exactly as tall as the pane — measured
     * `scrollHeight` 572 against `clientHeight` 572 — so "the editor scrolls" was
     * being asserted against content that did not overflow. And typing 150 lines one
     * keystroke at a time sent thousands of events and exhausted the 30s budget first.
     * Forty Enter-separated lines overflows the pane and still leaves room for the
     * assertions that follow.
     */
    await page.keyboard.type('scroll audit line\n'.repeat(40))
    await page.waitForTimeout(2000)

    const wrapper = await page.evaluate(() => {
      const el = document.querySelector('[class*="blockNoteWrapper"]')
      if (!el) return null
      const scrolls = getComputedStyle(el).overflowY
      let ancestor: Element | null = el.parentElement
      let viewportsInside = 0
      while (ancestor) {
        if (ancestor.hasAttribute('data-scrollarea-viewport')) viewportsInside += 1
        ancestor = ancestor.parentElement
      }
      return { scrolls, viewportsInside, classes: el.className.toString() }
    })

    expect(wrapper, 'the editor wrapper must be measurable').not.toBeNull()
    expect(
      wrapper?.viewportsInside,
      'no ScrollArea may sit between the editor and the document'
    ).toBe(0)
    expect(wrapper?.scrolls, 'the wrapper must remain the editor scroll owner').toMatch(
      /auto|scroll/
    )
    expect(wrapper?.classes).toContain('rtwiki-scroll')

    const moved = await scrollOwner(page, '[class*="blockNoteWrapper"]')
    expect(
      moved.scrollHeight,
      'the document must actually be taller than the pane, or "it scrolls" proves nothing'
    ).toBeGreaterThan(moved.clientHeight)
    expect(moved.moved, 'the editor must still scroll').toBe(true)

    /*
     * Caret scrolling, which is the behaviour a wrapper would have broken. Put the
     * caret at the very end of a long document and confirm the wrapper scrolled to
     * follow it.
     */
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(1200)
    const followed = await page.evaluate(() => {
      const el = document.querySelector('[class*="blockNoteWrapper"]')
      return el ? el.scrollTop > 0 : false
    })
    expect(followed, 'the editor must scroll the caret into view').toBe(true)
  })

  test('the sandboxed HTML preview carries the scrollbar in its own document', async ({ page }) => {
    await newPageOfType(page, 1, `ScrollHtml ${Date.now()}`)
    await page.getByTestId('html-preview-view').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByTestId('html-field-html').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByTestId('html-field-html').click()
    await page.getByTestId('code-editor-html').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByTestId('code-editor-html').click()
    await page.keyboard.insertText('<p>tall</p>\n'.repeat(300))
    await page.waitForTimeout(1500)
    await page.getByTestId('html-field-preview').click()
    await page.getByTestId('html-preview-view').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(2500)

    /*
     * The preview's scroller is the srcdoc document, not anything in the app tree, so
     * it is inspected through Playwright's frame API. `contentDocument` is null by
     * design here: the frame is `sandbox="allow-scripts"` with no
     * `allow-same-origin`.
     */
    const frame = page.frames().find((f) => f !== page.mainFrame())
    expect(frame, 'the preview frame must exist').toBeDefined()

    const inside = await frame?.evaluate(() => {
      const cs = getComputedStyle(document.documentElement)
      return {
        scrollbarWidth: cs.scrollbarWidth,
        scrollbarColor: cs.scrollbarColor,
        scrolls: cs.overflowY,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight
      }
    })

    expect(inside, 'the preview document must be readable').toBeDefined()
    // `auto` is the reset that keeps the vendor rules effective inside the frame.
    expect(inside?.scrollbarWidth, 'the preview must not disable its vendor rules').toBe('auto')
    /*
     * Resolved, like the token check above: `getComputedStyle` substitutes
     * `currentColor`, so the computed value is a colour rather than the keyword. The
     * alpha is what proves the thumb is the 32% mix the preview declares, and that it
     * is derived from the document's own text colour rather than a hardcoded grey.
     */
    expect(inside?.scrollbarColor, 'the preview thumb must resolve to a real colour').toMatch(
      /^(color|rgba)\(/
    )
    const previewAlpha = Number.parseFloat(
      (inside?.scrollbarColor ?? '').replace(/^.*\/\s*/, '').replace(/\)$/, '')
    )
    expect(previewAlpha, 'the preview thumb must be the 32% currentColor mix').toBeCloseTo(0.32, 2)
    expect(
      inside!.scrollHeight,
      'the preview content must actually be taller than the frame'
    ).toBeGreaterThan(inside!.clientHeight)
  })
})

/**
 * The thickness of a native-restyled scrollbar, read from its vendor
 * pseudo-element. Returns `null` when the element is absent.
 *
 * This is the measurement that was previously assumed impossible here. It works
 * because the overlay gutter is a *layout* fact (0) while the declared bar width is
 * a *style* fact, and only the first is unavailable in this harness.
 */
async function readThickness(
  page: import('@playwright/test').Page,
  selector: string
): Promise<string | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    try {
      return getComputedStyle(el, '::-webkit-scrollbar').width || null
    } catch {
      return null
    }
  }, selector)
}

/**
 * The thickness of a Mantine `ScrollArea`'s own bar, which the component draws as a
 * real element rather than delegating to the platform.
 */
async function readMantineBarWidth(
  page: import('@playwright/test').Page,
  rootSelector: string
): Promise<number | null> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) return null
    // Typed as HTMLElement on both branches: a `??` fallback to a bare `root` would
    // widen the union to `Element`, which has no `offsetWidth`.
    const inner = root.querySelector<HTMLElement>('[class*="mantine-ScrollArea-scrollbar"]')
    const bar: HTMLElement | null =
      inner ??
      (root instanceof HTMLElement && root.classList.contains('mantine-ScrollArea-scrollbar')
        ? root
        : null)
    return bar ? bar.offsetWidth : null
  }, rootSelector)
}

test.describe('every scroll surface is the design thickness', () => {
  /**
   * Seeds one page of each type up front, so each surface below can be *navigated to*
   * rather than measured on whatever the dashboard happens to be showing. A selector
   * for the Rich Document does not match until a Rich Document is open, and asserting
   * on `null` there would fail for the wrong reason.
   */
  const titles = { rich: '', diagram: '' }

  test.beforeAll(async ({ request }) => {
    const stamp = Date.now()
    titles.rich = `Thickness rich ${stamp}`
    titles.diagram = `Thickness diagram ${stamp}`

    const rich = await request.post('/api/pages', {
      data: {
        title: titles.rich,
        pageType: 'rich',
        content: JSON.stringify([
          { type: 'paragraph', content: 'A note measured for its scrollbar.' },
          {
            type: 'diagram',
            content:
              'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]'
          }
        ])
      }
    })
    expect(rich.status(), 'the Rich Document seed page must be created').toBe(201)

    const diagram = await request.post('/api/pages', {
      data: {
        title: titles.diagram,
        pageType: 'diagram',
        content: JSON.stringify({
          version: 2,
          type: 'diagram',
          blocks: Array.from({ length: 6 }, (_, i) => ({
            id: `b${i}`,
            source:
              'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]\n  B -->|no| D[Skip]'
          }))
        })
      }
    })
    expect(diagram.status(), 'the Diagram seed page must be created').toBe(201)
  })

  /** The shared thickness, read from the token the whole system is driven by. */
  async function expectedThickness(page: import('@playwright/test').Page): Promise<string> {
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--rtwiki-scrollbar-size').trim()
    )
    expect(value, 'the thickness token must resolve').toMatch(/^\d+(\.\d+)?px$/)
    return value
  }

  test('the page tree paints the shared thickness', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('page-tree')).toBeVisible({ timeout: 20_000 })
    const expected = await expectedThickness(page)
    const width = await readThickness(page, '[data-testid="page-tree"]')
    expect(width, 'the tree must exist to be measured').not.toBeNull()
    expect(width, 'Wunderbaum must paint the shared thickness, not the browser default').toBe(
      expected
    )
  })

  test('the Rich Document paints the shared thickness', async ({ page }) => {
    await page.goto('/')
    await page.getByText(titles.rich, { exact: false }).first().click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 20_000 })
    const expected = await expectedThickness(page)
    const width = await readThickness(
      page,
      '[data-testid="rich-editor"] [class*="blockNoteWrapper"]'
    )
    expect(width, 'the BlockNote wrapper must exist to be measured').not.toBeNull()
    expect(width, 'BlockNote must paint the shared thickness, not the browser default').toBe(
      expected
    )
  })

  test('the Diagram page paints the shared thickness', async ({ page }) => {
    await page.goto('/')
    await page.getByText(titles.diagram, { exact: false }).first().click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    const expected = await expectedThickness(page)
    const width = await readThickness(
      page,
      '[data-testid="diagram-workspace"] [class*="blockList"]'
    )
    expect(width, 'the Diagram block list must exist to be measured').not.toBeNull()
    expect(width, 'the Diagram page must paint the shared thickness, not the browser default').toBe(
      expected
    )
  })

  test('a Mantine ScrollArea draws the shared thickness as a real element', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2500)
    const width = await readMantineBarWidth(page, '[data-testid="dashboard-scroll"]')
    expect(width, 'the dashboard ScrollArea must render a bar').not.toBeNull()
    expect(
      width,
      "Mantine's bar must be as thin as the native ones, or the app shows two thicknesses"
    ).toBe(EXPECTED_THICKNESS_PX)
  })
})

/** The design value, asserted rather than read, so a silent change is caught. */
const EXPECTED_THICKNESS_PX = 6
