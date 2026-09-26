import { expect, test } from '@playwright/test'
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
      await page.getByTestId('diagram-edit-button').click()
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
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Bar ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()

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

  test('picking a template loads its source into the editor', async ({ page }) => {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Pick ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()

    // A type with no variants loads on one click.
    await page.getByTestId('template-sequence').click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/sequenceDiagram/i)

    // A type WITH variants opens its menu instead, and picking a variant loads it.
    // Flowchart is the case that matters: Mermaid offers it in four directions.
    await page.getByTestId('template-flowchart').click()
    await expect(page.getByTestId('template-variant-flowchart-Left-to-right')).toBeVisible()
    await page.getByTestId('template-variant-flowchart-Left-to-right').click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/^flowchart LR/)
  })

  test('a template that offers variants opens them; one that does not, loads', async ({ page }) => {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Variants ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()

    // Flowchart: four directions, each a real source.
    await page.getByTestId('template-flowchart').click()
    for (const dir of ['Top-to-bottom', 'Bottom-to-top', 'Right-to-left', 'Left-to-right']) {
      await expect(
        page.getByTestId(`template-variant-flowchart-${dir}`),
        `${dir} must be offered`
      ).toBeVisible()
    }
    await page.keyboard.press('Escape')

    // Each direction really is that direction.
    for (const [dir, expected] of [
      ['Top-to-bottom', 'flowchart TD'],
      ['Left-to-right', 'flowchart LR']
    ] as const) {
      await page.getByTestId('template-flowchart').click()
      await page.getByTestId(`template-variant-flowchart-${dir}`).click()
      await expect(page.getByTestId('diagram-source-input')).toHaveValue(
        new RegExp(`^${expected.replace(' ', '\\s')}`)
      )
    }
  })

  test('a template in the overflow dropdown still opens its variants', async ({ page }) => {
    // The reported fault: a template pushed into the trailing "more" dropdown had a
    // submenu that would not open, because a Menu nested inside a Menu.Dropdown
    // is not how Mantine does nesting. Mantine documents Menu.Sub for this, and
    // rendering real menu rows also makes the dropdown keyboard-reachable.
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Overflow ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()

    // A variant-bearing type is the only thing that can prove this, and the bar is
    // ordered by family, so those types sit at the front and only reach the
    // dropdown when the bar is genuinely starved. Shrinking the window does not
    // do it: the page layout clamps its own minimum, so the bar keeps its width.
    // Constrain the bar itself instead - this is the component's overflow
    // behaviour under test, and the product code is untouched.
    const bar = page.getByTestId('template-bar')
    await bar.evaluate((el) => {
      el.style.width = '120px'
    })
    await page.waitForTimeout(400)

    const more = page.getByTestId('template-more')
    await expect(more, 'the bar must overflow at 120px').toBeVisible()
    await more.click()

    // Flowchart leads the row, so with room for one control it is the next family
    // member - state - that has to move into the dropdown.
    const id = 'state'
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
    const sub = page.getByTestId(`template-variant-${id}-State-diagram`)
    await expect(sub, `${id} in the dropdown must offer its variants`).toBeVisible({
      timeout: 5_000
    })
    await sub.click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/^stateDiagram-v2/)
  })

  test('the overflow dropdown is reachable by keyboard', async ({ page }) => {
    // Known bug: the dropdown used to hold loose ActionIcons, so arrow keys did
    // nothing and the rows were not menu items. Real Menu.Items fix both.
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`Keyboard ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await page.getByTestId('diagram-edit-button').click()

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

  test('the template list has no duplicate labels', async () => {
    const labels = Object.values(DIAGRAM_TEMPLATES).map((d) => d.label)
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
    expect(dupes, `duplicate template labels: ${dupes.join(', ')}`).toEqual([])
    expect(EDITABLE).toBeTruthy()
  })
})
