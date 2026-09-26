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

    // Every template is reachable: on the row, or in the trailing dropdown.
    const ids = Object.keys(DIAGRAM_TEMPLATES)
    const onRow = await bar.locator('[data-testid^="template-"]').count()
    expect(onRow).toBeGreaterThan(0)

    if ((await page.getByTestId('template-more').count()) > 0) {
      await page.getByTestId('template-more').click()
      await expect(page.getByTestId('template-more')).toHaveAttribute('aria-expanded', 'true')
      for (const id of ids) {
        await expect(page.getByTestId(`template-${id}`), `${id} must be reachable`).toBeVisible()
      }
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

    // A type that is always near the front of the row, so this does not depend
    // on how the split falls at the current width.
    await page.getByTestId('template-flowchart').click()
    await expect(page.getByTestId('diagram-source-input')).toHaveValue(/flowchart/i)
  })

  test('the template list has no duplicate labels', async () => {
    const labels = Object.values(DIAGRAM_TEMPLATES).map((d) => d.label)
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i)
    expect(dupes, `duplicate template labels: ${dupes.join(', ')}`).toEqual([])
    expect(EDITABLE).toBeTruthy()
  })
})
