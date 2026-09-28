import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * What a browser actually resolves `flex: var(--rt-cols-pane-flex, 1) 1 0%` to.
 *
 * ## Why this file exists
 *
 * A pane's share is emitted as a CSS custom property rather than an inline
 * `flex` shorthand, so that the stylesheet stays authoritative. The unit tests in
 * `markdown-columns-styles.test.ts` pin the *shape* of what ships: that the built
 * CSS references the property, that the renderer emits it, and that the two
 * cannot drift. All three are necessary. None is sufficient, because **jsdom's
 * `getComputedStyle` does not substitute `var()`** — it returns the unsubstituted
 * string. Measured, not assumed.
 *
 * So the resolved value can only be settled in a real engine, which is what this
 * file is the only place for. An inline `style` attribute always beats a
 * stylesheet rule, so a `flex` rule in `markdown-columns.css` would be silently
 * dead while every unit test stayed green — that is the exact trap the existing
 * class-name test in that file was written for, and this is the same trap one
 * level up.
 *
 * ## The decisive case
 *
 * The `, 1` fallback is load-bearing, and this file is what proves it rather
 * than asserting it. A pane that declares no width is still emitted with an
 * explicit reset by the renderer, so the CSS fallback is a backstop rather than
 * the normal path — and a backstop nobody exercises in a real engine is not a
 * backstop. The second test removes the property from the live element to reach
 * it.
 *
 * With the fallback removed, the measurement is **`0 1 auto`**, not zero width.
 * Worth stating precisely, because the natural assumption is wrong in both
 * directions: a shorthand containing an unresolved `var()` is invalid at
 * computed-value time, and each longhand then takes its *initial* value rather
 * than being dropped. So `flex-grow` is 0, and the panes stop growing to share
 * the row — they size to their content instead. That looks like columns that
 * will not fill the width, and it is easy to misread as a layout bug somewhere
 * else. A unit test cannot observe this at all, which is why it is measured here
 * and the expected value is spelled out rather than left as "not equal".
 */

const PANE = '.rt-cols__pane'
const DIVIDER_TESTID = 'rt-cols-divider'

/** `***` is the divider. `---` under text is a setext heading, not a divider. */
const EXPLICIT = ':::columns{left=40}\nLeft pane\n\n***\n\nRight pane\n:::'
const UNDECLARED = ':::columns\nLeft pane\n\n***\n\nRight pane\n:::'

/** Unique per call, so a spec run leaves no ambiguity about which page it opened. */
let titleSeq = 0
function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedMarkdown(request: APIRequestContext, title: string, markdown: string) {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'markdown', content: JSON.stringify({ version: 1, markdown }) }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * Opens a seeded page and waits for its content to have actually rendered.
 *
 * The wait is for the preview to have a rendered child, not for a pane
 * specifically. The workspace fetches the page *after* it mounts, so
 * `markdown-rendered` is visible while still empty, and any measurement taken
 * then reports nothing — which is indistinguishable from a broken layout. This
 * trap has already produced a convincing false alarm once in this repo.
 */
async function openPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  const preview = page.getByTestId('markdown-rendered')
  await expect(preview).toBeVisible()
  await expect(preview.locator(':scope > *').first()).toBeVisible()
}

const resolvedFlex = (page: Page, selector = PANE) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).flex as string)

const inlineFlex = (page: Page, selector = PANE) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => (el as HTMLElement).style.flex)

test.describe(':::columns pane sizing, resolved by a real engine', () => {
  test('a declared width resolves to that grow factor, with no inline shorthand shadowing it', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sizing explicit')
    await seedMarkdown(request, title, EXPLICIT)
    await openPage(page, title)

    const left = page.locator(`${PANE}[data-side="left"]`)
    await expect(left).toBeVisible()

    // The renderer emits the property, never the shorthand.
    const prop = await left.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue('--rt-cols-pane-flex')
    )
    expect(prop.trim()).toBe('40')
    expect(await inlineFlex(page, `${PANE}[data-side="left"]`)).toBe('')

    // And the engine agrees with the declaration rather than falling back.
    expect(await resolvedFlex(page, `${PANE}[data-side="left"]`)).toBe('40 1 0%')
    expect(await resolvedFlex(page, `${PANE}[data-side="right"]`)).toBe('60 1 0%')
  })

  test('removing the property still resolves to an equal share rather than collapsing', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Sizing fallback')
    await seedMarkdown(request, title, UNDECLARED)
    await openPage(page, title)

    const panes = page.locator(PANE)
    await expect(panes).toHaveCount(2)

    // An undeclared pane is still emitted with the renderer's own reset, so the
    // CSS fallback is not on the normal path. Remove it to reach the backstop.
    await page.locator(PANE).evaluateAll((els) => {
      for (const el of els) (el as HTMLElement).style.removeProperty('--rt-cols-pane-flex')
    })

    const resolved = await panes.evaluateAll((els) => els.map((el) => getComputedStyle(el).flex))
    for (const value of resolved) {
      expect(value).toBe('1 1 0%')
    }

    // The consequence, which is the thing a unit test cannot see. With the
    // fallback removed the engine measured `0 1 auto`: grow 0, so the panes
    // size to their content and stop filling the row. Asserted through a real
    // width, because the computed value alone would not show a reader what
    // breaks.
    const widths = await panes.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width)
    )
    for (const width of widths) {
      expect(width).toBeGreaterThan(50)
    }
    expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(2)
  })

  test('a drag rewrites the property, not the shorthand', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    const title = uniqueTitle('Sizing drag')
    await seedMarkdown(request, title, EXPLICIT)
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    const left = preview.locator(`${PANE}[data-side="left"]`)
    const divider = preview.getByTestId(DIVIDER_TESTID).first()
    await expect(left).toBeVisible()
    await expect(divider).toBeVisible()

    const before = await left.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue('--rt-cols-pane-flex')
    )

    const box = await divider.boundingBox()
    expect(box, 'divider must have a box to drag').not.toBeNull()
    const b = box as { x: number; y: number; width: number; height: number }
    const startX = b.x + b.width / 2
    const startY = b.y + b.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 120, startY, { steps: 8 })
    await page.mouse.up()

    const after = await left.evaluate((el) =>
      (el as HTMLElement).style.getPropertyValue('--rt-cols-pane-flex')
    )
    expect(after.trim()).not.toBe(before.trim())

    // A drag writing the shorthand would put it back inline on the first
    // pointermove, making the stylesheet rule dead for exactly the rows a reader
    // has touched — while every width assertion above still passed.
    expect(await inlineFlex(page, `${PANE}[data-side="left"]`)).toBe('')
    expect(await resolvedFlex(page, `${PANE}[data-side="left"]`)).toBe(`${after.trim()} 1 0%`)

    expect(errors, `uncaught page error(s): ${errors.join(' | ')}`).toHaveLength(0)
  })
})
