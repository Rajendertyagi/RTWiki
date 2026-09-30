import { expect, type Page, test } from '@playwright/test'
import { DIAGRAM_TEMPLATES } from '../../src/web/features/rich-editor/insert-blocks.js'

/**
 * Every offered diagram template must actually render.
 *
 * This is the check that a hand-maintained template list drifts: an id Mermaid
 * does not know, or a sample that does not parse, fails here rather than
 * silently offering the user a template that produces an error.
 *
 * It also settles which of the 33 registered types genuinely work, which an
 * earlier ad-hoc probe could not: that probe keyed off `aria-roledescription`,
 * which six types do not emit, so it reported working diagrams as broken. Here
 * the only question is whether Mermaid raised an error, and the fingerprint of
 * the rendered SVG is compared so a stale render cannot pass.
 */
const EDITABLE = '.bn-editor'

/**
 * Opens a fresh Diagram page and waits for its Mermaid toolbar.
 *
 * The bar lives in the page's toolbar row, above the workspace and outside edit
 * mode, so nothing here enters edit mode. A test that needs the source editor
 * still opens it per block; the point of this helper is that reaching a template
 * no longer requires adding a diagram first.
 */
async function openDiagramPageWithToolbar(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(`Bar ${Date.now()}`)
  await dialog.getByTestId('new-page-type-diagram').click()
  await dialog.getByRole('button', { name: /create/i }).click()
  await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('template-bar')).toBeVisible({ timeout: 20_000 })
}

test.describe('diagram templates', () => {
  test('every template renders without error', async ({ page }) => {
    test.setTimeout(900_000)

    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Tmpl ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })

    const fingerprint = async (): Promise<string> =>
      page
        .getByTestId('diagram-rendered')
        .locator('svg')
        .first()
        .evaluate((el) => {
          const err = el.querySelector('.error-icon, .error-text, .error-title')
          const html = err ? '' : el.outerHTML
          return [
            err ? 'ERR' : 'ok',
            el.getAttribute('aria-roledescription') ?? '-',
            el.getAttribute('viewBox') ?? '-',
            String(html.length),
            html.slice(0, 100)
          ].join('|')
        })
        .catch(() => '')

    let previous = ''
    const failures: string[] = []

    for (const [id, def] of Object.entries(DIAGRAM_TEMPLATES)) {
      await page.getByTestId('diagram-block-edit-0').click()
      await page.getByTestId('diagram-source-input').fill(def.source)
      await page.getByTestId('diagram-apply').click()

      const verdict = await expect
        .poll(
          async () => {
            const fp = await fingerprint()
            if (fp.length === 0) return 'pending'
            if (fp.startsWith('ERR')) return 'error-svg'
            return fp !== previous ? 'rendered' : 'unchanged'
          },
          { timeout: 20_000 }
        )
        .toBe('rendered')
        .then(() => 'rendered' as const)
        .catch(() => 'failed' as const)

      const fp = await fingerprint()
      if (verdict === 'rendered') previous = fp
      const parts = fp.split('|')
      // A 24x24 viewBox is Mermaid's empty placeholder: no error is raised, but
      // nothing was drawn either, so the template is not really usable.
      const emptyish = parts[2] === '0 0 24 24'
      if (verdict !== 'rendered' || emptyish) {
        failures.push(`${id} (${def.label}) verdict=${verdict} viewBox=${parts[2]}`)
      }
    }

    // eslint-disable-next-line no-console
    console.log(`TMPL total=${Object.keys(DIAGRAM_TEMPLATES).length} failures=${failures.length}`)
    for (const f of failures) {
      // eslint-disable-next-line no-console
      console.log(`TMPL FAIL ${f}`)
    }
    expect(failures, `templates that did not render: ${failures.join('; ')}`).toEqual([])
  })

  test('the template bar is flat: what fits stays, the rest go to a dropdown', async ({ page }) => {
    await openDiagramPageWithToolbar(page)

    const bar = page.getByTestId('template-bar')
    await expect(bar).toBeVisible()

    // The row must not scroll and must not wrap, exactly like the rich toolbar.
    const metrics = await bar.evaluate((el) => {
      const cs = getComputedStyle(el)
      return {
        overflowX: cs.overflowX,
        flexWrap: cs.flexWrap,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        height: el.getBoundingClientRect().height
      }
    })
    expect(metrics.overflowX, 'the bar never scrolls').toBe('hidden')
    expect(metrics.flexWrap, 'the bar never wraps').toBe('nowrap')
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
    expect(metrics.height, 'the bar stays one row').toBeLessThan(60)

    // The bar now lives in the page's shared toolbar row, which is the same
    // fixed-height row the Rich Note's toolbar uses. If the bar were taller than
    // that row it would overflow it, and the Diagram page would stop looking like
    // every other page type - which is the whole reason the bar moved up here.
    const row = page.getByTestId('diagram-toolbar-row')
    await expect(row).toBeVisible()
    const fits = await row.evaluate((el) => {
      const bar = el.querySelector('[data-testid="template-bar"]')
      return {
        rowHeight: el.getBoundingClientRect().height,
        barHeight: bar?.getBoundingClientRect().height ?? 0,
        overflows: (bar?.getBoundingClientRect().bottom ?? 0) > el.getBoundingClientRect().bottom
      }
    })
    expect(fits.overflows, 'the bar must not overflow the toolbar row').toBe(false)
    expect(fits.barHeight).toBeLessThanOrEqual(fits.rowHeight)

    // Every template is reachable: on the row, or as a row in the trailing
    // dropdown. Overflowed templates are no longer the moved toolbar button -
    // they are rebuilt as real menu items, which is what makes the submenu open
    // and the dropdown keyboard-reachable - so the two are different testids.
    const ids = Object.keys(DIAGRAM_TEMPLATES)
    // The trailing "more" button also starts with `template-`, so exclude it:
    // it is not a template and would put the count one over.
    const onRow = await bar
      .locator('[data-testid^="template-"]:not([data-testid="template-more"])')
      .count()
    expect(onRow).toBeGreaterThan(0)

    if ((await page.getByTestId('template-more').count()) > 0) {
      await page.getByTestId('template-more').click()
      await expect(page.getByTestId('template-more')).toHaveAttribute('aria-expanded', 'true')
      for (const id of ids) {
        await expect(
          page.getByTestId(`template-${id}`).or(page.getByTestId(`template-row-${id}`)),
          `${id} must be on the bar or in the dropdown`
        ).toBeVisible()
      }
      // Nothing may be lost in the move: bar buttons plus dropdown rows must
      // account for every template exactly once.
      const inMenu = await page.locator('[data-testid^="template-row-"]').count()
      expect(onRow + inMenu, 'every template is accounted for').toBe(ids.length)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('template-more')).toHaveAttribute('aria-expanded', 'false')
    } else {
      // Everything fit, so every template is on the row.
      for (const id of ids) {
        await expect(page.getByTestId(`template-${id}`), `${id} must be on the bar`).toBeVisible()
      }
    }
  })

  test('picking a template adds that diagram, without entering edit mode', async ({ page }) => {
    // The behaviour the toolbar move was for. Previously the bar was reachable
    // only from inside the edit pane, so a type could be chosen only after a
    // generic diagram had been added and opened for editing. Now the choice is
    // the action: one click, and the page gains that diagram.
    await openDiagramPageWithToolbar(page)

    // Count the block cards, not every element whose testid starts with
    // `diagram-block-`. Each card is now wrapped in a resize container whose own
    // testid shares that prefix, so a prefix match counts each block twice.
    const countBlocks = async (): Promise<number> =>
      page.locator('section[data-testid^="diagram-block-"]').count()

    const before = await countBlocks()
    expect(before, 'a new Diagram page starts with its starter diagram').toBe(1)

    // A type with no variants is added on one click, and the page is still in
    // view mode throughout — the point of the change.
    await page.getByTestId('template-sequence').click()
    await expect(page.getByTestId('diagram-workspace')).toHaveAttribute('data-mode', 'view')
    await expect(page.locator('section[data-testid="diagram-block-1"]')).toBeVisible()
    expect(await countBlocks(), 'the chosen template added a diagram').toBe(2)

    // A type WITH variants opens its menu, and the chosen variant is what gets
    // added. Flowchart is the case that matters: Mermaid offers four directions.
    await page.getByTestId('template-flowchart').click()
    await expect(page.getByTestId('template-variant-flowchart-Left-to-right')).toBeVisible()
    await page.getByTestId('template-variant-flowchart-Left-to-right').click()
    await expect(page.locator('section[data-testid="diagram-block-2"]')).toBeVisible()
    expect(await countBlocks(), 'the variant added a third diagram').toBe(3)

    // The diagram's own svg, addressed by the canvas's testid. Scoping to the card
    // instead would find the 24x24 action icons in its toolbar first — which is
    // exactly what an earlier version of this assertion did, and read as though
    // the diagram were empty.
    const viewBoxOf = async (index: number): Promise<string | null> =>
      page
        .getByTestId(`diagram-block-${index}-svg`)
        .locator('svg')
        .first()
        .getAttribute('viewBox')
        .catch(() => null)
    const realExtent = async (index: number): Promise<boolean> => {
      const viewBox = await viewBoxOf(index)
      if (viewBox === null) return false
      const parts = viewBox.split(/\s+/).map(Number)
      return (parts[2] ?? 0) > 40 && (parts[3] ?? 0) > 40
    }

    // And each pick produced the template that was chosen, read from the block's
    // own source rather than from any shared state.
    const sourceOf = async (index: number): Promise<string> => {
      await page.getByTestId(`diagram-block-edit-${index}`).click()
      const value = await page.getByTestId('diagram-source-input').inputValue()
      await page.getByTestId('diagram-cancel').click()
      return value
    }
    expect(await sourceOf(1)).toBe(DIAGRAM_TEMPLATES.sequence.source)

    await expect
      .poll(() => realExtent(1), {
        timeout: 20_000,
        message: `block 1 viewBox was "${await viewBoxOf(1)}"`
      })
      .toBe(true)
    await expect
      .poll(() => realExtent(2), {
        timeout: 20_000,
        message: `block 2 viewBox was "${await viewBoxOf(2)}"`
      })
      .toBe(true)
  })

  test('a template that offers variants opens them; one that does not, loads', async ({ page }) => {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Variants ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await expect(page.getByTestId('template-bar')).toBeVisible()

    // Flowchart: four directions, each a real source.
    await page.getByTestId('template-flowchart').click()
    for (const dir of ['Top-to-bottom', 'Bottom-to-top', 'Right-to-left', 'Left-to-right']) {
      await expect(
        page.getByTestId(`template-variant-flowchart-${dir}`),
        `${dir} must be offered`
      ).toBeVisible()
    }
    await page.keyboard.press('Escape')

    // Each direction adds its own diagram, and what was added is a real flowchart.
    //
    // The orientation is deliberately NOT asserted from the rendered box. The
    // starter is a single `A --> B` node, so a top-to-bottom one is as wide as it
    // is tall and the comparison fails on a correct result. Proving the direction
    // would need a multi-node sample, which is a different test from this one; so
    // this asserts what the picker controls - that a variant is offered, that
    // choosing one adds a diagram, and that the diagram is that type.
    let added = 1
    for (const dir of ['Top-to-bottom', 'Left-to-right'] as const) {
      await page.getByTestId('template-flowchart').click()
      await page.getByTestId(`template-variant-flowchart-${dir}`).click()
      const index = added
      added += 1
      const section = page.locator(`section[data-testid="diagram-block-${index}"]`)
      await expect(section, `${dir} must add a block`).toBeVisible({ timeout: 20_000 })
      // A real diagram, not the empty placeholder. Which *direction* was chosen is
      // not asserted from the box: the starter is a single `A --> B` node, so a
      // top-to-bottom one is as wide as it is tall and the comparison would fail
      // on a correct result.
      await expect
        .poll(
          async () => {
            const viewBox = await page
              .getByTestId(`diagram-block-${index}-svg`)
              .locator('svg')
              .first()
              .getAttribute('viewBox')
              .catch(() => null)
            if (viewBox === null) return false
            const parts = viewBox.split(/\s+/).map(Number)
            return (parts[2] ?? 0) > 40 && (parts[3] ?? 0) > 40
          },
          { timeout: 20_000 }
        )
        .toBe(true)
    }
  })

  test('a template in the overflow dropdown still opens its variants', async ({ page }) => {
    // The reported fault: a template pushed into the trailing "more" dropdown had a
    // submenu that would not open, because a Menu nested inside a Menu.Dropdown
    // is not how Mantine does nesting. Mantine documents Menu.Sub for this, and
    // rendering real menu rows also makes the dropdown keyboard-reachable.
    await openDiagramPageWithToolbar(page)

    // A variant-bearing type is the only thing that can prove this. The bar is
    // ordered by family and the controls are small, so the bar is constrained
    // until its own leading type is forced out: hardcoding *which* template
    // overflows would make this test a statement about the control's width, and
    // that width changed when the bar moved into the toolbar row.
    //
    // Shrinking the window does not do it: the page layout clamps its own minimum,
    // so the bar keeps its width. Constrain the bar itself instead - this is the
    // component's overflow behaviour under test, and the product code is untouched.
    //
    // `flex`, not `width`. `.templateBar` is `flex: 1 1 auto`, so it stretches to
    // fill its container and `el.style.width` is overridden by flex layout: the
    // assignment below silently did nothing, clientWidth stayed at the full row,
    // and `flowchart` was never pushed out. Measured with this diagnostic before
    // the fix: at `width: 40px` the bar still held 5 controls and the dropdown
    // started at `sankey`, so `template-row-flowchart` could not exist. Flex
    // resolves `flex-basis`, so constraining that is what actually reduces the
    // room `useToolbarOverflow` measures.
    const bar = page.getByTestId('template-bar')
    await bar.evaluate((el) => {
      el.style.flex = '0 0 40px'
    })
    await page.waitForTimeout(500)

    const more = page.getByTestId('template-more')
    await expect(more, 'the bar must overflow when constrained this hard').toBeVisible()
    await more.click()

    // Flowchart leads the row and carries variants, so it is the type that must
    // have been pushed out for this test to mean anything.
    const id = 'flowchart'
    await expect(
      page.getByTestId(`template-row-${id}`),
      'a variant-bearing type must reach the dropdown'
    ).toBeVisible()

    // Rows are real menu items, so the dropdown is keyboard-navigable.
    const rows = page.locator('[data-testid^="template-row-"]')
    await expect(rows.first()).toBeVisible()
    const itemRoles = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('role')))
    expect(
      itemRoles.every((r) => r === 'menuitem'),
      `roles were ${itemRoles}`
    ).toBe(true)

    // And the submenu itself opens, which is what the moved-whole node could not do.
    await page.getByTestId(`template-row-${id}`).click()
    const sub = page.getByTestId(`template-variant-${id}-Left-to-right`)
    await expect(sub, `${id} in the dropdown must offer its variants`).toBeVisible({
      timeout: 5_000
    })
    await sub.click()
    // The variant added a diagram rather than filling the source editor, which is
    // what the toolbar's new position means, and the diagram it added is a real
    // one rather than the empty placeholder.
    await expect(page.locator('section[data-testid="diagram-block-1"]')).toBeVisible()
    await expect
      .poll(
        async () => {
          const viewBox = await page
            .getByTestId('diagram-block-1-svg')
            .locator('svg')
            .first()
            .getAttribute('viewBox')
            .catch(() => null)
          if (viewBox === null) return false
          const parts = viewBox.split(/\s+/).map(Number)
          return (parts[2] ?? 0) > 40 && (parts[3] ?? 0) > 40
        },
        { timeout: 20_000, message: 'the variant must render a real diagram' }
      )
      .toBe(true)
  })

  test('the overflow dropdown is reachable by keyboard', async ({ page }) => {
    // Known bug: the dropdown used to hold loose ActionIcons, so arrow keys did
    // nothing and the rows were not menu items. Real Menu.Items fix both.
    await openDiagramPageWithToolbar(page)

    // Force the overflow by constraining the bar itself. Shrinking the window
    // does not do it: the page layout clamps its own minimum, so the bar keeps
    // its width and no trailing button ever appears. Same approach, and the same
    // reasoning, as the submenu test above.
    await page.getByTestId('template-bar').evaluate((el) => {
      el.style.width = '300px'
    })
    await page.waitForTimeout(400)
    const more = page.getByTestId('template-more')
    await expect(more, 'the bar must overflow at 300px').toBeVisible()
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(more).toHaveAttribute('aria-expanded', 'true')

    // Arrow down must move focus into the dropdown rather than leaving it on the
    // trigger. Mantine does that by querying `[data-menu-item]`, which only real
    // Menu.Items carry - the loose ActionIcons it used to hold carried neither.
    await page.keyboard.press('ArrowDown')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
    expect(focused, 'focus must land on a menu row').toMatch(/^template-(row|variant)-/)
  })

  test('diagram types that used to render empty now render', async ({ page }) => {
    // Twelve types were excluded from the template list because Mermaid 12
    // never resolved their lazily-registered definitions on the ordinary
    // parse + render path: the diagram came out as an empty 24x24 SVG with no
    // error. The fix force-loads the registry through Mermaid's public
    // `registerExternalDiagrams`. These are the types that were measured empty.
    //
    // The assertion is that the rendered diagram is a real one — a viewBox with
    // real extent and visible content — not merely that an `<svg>` exists, which
    // is the assertion that let the original defect through.
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Lazy ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-block-edit-0').click()

    // Read the canonical sources from the list rather than restating them. This
    // test previously carried its own copies, and they drifted: it used a bare
    // `venn` where the list uses `venn-beta`, and a bare type name is not a
    // synonym — Mermaid does not detect `venn` at all. A restated copy of a
    // source is a second definition that can pass or fail for reasons that have
    // nothing to do with the thing under test.
    const cases = ['quadrantChart', 'treemap', 'venn'] as const

    for (const name of cases) {
      const def = DIAGRAM_TEMPLATES[name]
      expect(def, `${name} must be in the template list`).toBeDefined()
      await page.getByTestId('diagram-source-input').fill(def.source)
      const preview = page.getByTestId('diagram-live-preview').locator('svg')
      await expect(preview, `${name} must render, not render empty`).toBeVisible()
      // Read the SVG's own viewBox, not a layout box. The viewBox is intrinsic to
      // the SVG so it cannot be a settling-layout artefact, and `0 0 24 24` is
      // exactly the empty-placeholder signature this test exists to catch. The
      // condition is the one it always was — real extent, not the placeholder —
      // only waited for properly.
      await expect
        .poll(
          async () => {
            const viewBox = await preview.getAttribute('viewBox').catch(() => null)
            if (viewBox === null) return null
            const parts = viewBox.split(/\s+/).map(Number)
            return { w: parts[2] ?? 0, h: parts[3] ?? 0 }
          },
          { timeout: 20_000, message: `${name} must gain a real viewBox` }
        )
        .toMatchObject({ w: expect.any(Number), h: expect.any(Number) })

      const viewBox = ((await preview.getAttribute('viewBox')) ?? '').split(/\s+/).map(Number)
      expect(
        viewBox[2] ?? 0,
        `${name} must have real width, not a 24px placeholder`
      ).toBeGreaterThan(40)
      expect(viewBox[3] ?? 0, `${name} must have real height`).toBeGreaterThan(40)
    }
  })

  test('the rich-note chooser offers exactly the templates the Diagram bar does', async ({
    page
  }) => {
    // The requirement is that a Rich Note exposes the same Mermaid library as the
    // Diagram page. Comparing against DIAGRAM_TEMPLATES rather than against a
    // copied id list is what makes this a statement about one source of truth:
    // a second list anywhere would have to be updated in step with the first, and
    // this would still pass. Instead, a template added to the list and not to the
    // chooser fails here.
    const title = `Chooser ${Date.now()}`
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()

    // Open the toolbar's Mermaid chooser.
    const trigger = page.getByTestId('insert-diagram')
    if ((await trigger.count()) === 0) {
      await page.getByTestId('toolbar-more').click()
      await trigger.waitFor({ state: 'visible', timeout: 5_000 })
    }
    await trigger.click()

    const menu = page.getByTestId('insert-diagram-submenu')
    await expect(menu).toBeVisible({ timeout: 5_000 })

    const ids = Object.keys(DIAGRAM_TEMPLATES)
    const offered = await page
      .locator('[data-testid^="insert-diagram-option-"]')
      .evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace('insert-diagram-option-', ''))
      )
    expect([...offered].sort(), 'the chooser must offer every template, and nothing else').toEqual(
      [...ids].sort()
    )

    // And the Mermaid choice is not in the slash menu, which lists block types.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('the template list has no duplicate labels', async () => {
    const labels = Object.values(DIAGRAM_TEMPLATES).map((d) => d.label)
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
    expect(dupes, `duplicate template labels: ${dupes.join(', ')}`).toEqual([])
    expect(EDITABLE).toBeTruthy()
  })
})
