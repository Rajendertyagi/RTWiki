import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * A diagram block in a Rich Note must scale its diagram to the box it was given.
 *
 * ## The defect this guards
 *
 * The Diagram page had scale-to-fit rules and a note did not, so the same diagram was laid
 * out two different ways on two surfaces. In a note the failure was not a subtle
 * difference of opinion, it was data loss: the box shrank to its stored height and the
 * diagram kept its natural size, so the box **cropped** it. Measured with the Medium
 * preset — a 400px box holding a 549px diagram, overhanging the bottom by 82px with no
 * way to see the rest.
 *
 * A test that only asserted "an `<svg>` appeared" would pass throughout, which is the
 * same blind spot that let the missing-labels defect ship. So this asserts the drawn
 * geometry: how tall the diagram is, and whether any of it sits outside the box.
 */

const DIAGRAM = 'flowchart TD\n  A[Start] --> B[End]'

async function seedNote(request: APIRequestContext, title: string): Promise<string> {
  const response = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify([{ type: 'diagram', content: DIAGRAM }])
    }
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { page: { id: string } }).page.id
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 950 })
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
    timeout: 20_000
  })
  await page.waitForTimeout(400)
}

/** Box and drawn-diagram geometry, in pixels. */
async function geometry(page: Page): Promise<{ box: number; svg: number; overhang: number }> {
  return await page
    .locator('[data-testid="diagram-container"]')
    .first()
    .evaluate((el: HTMLElement) => {
      const svg = el.querySelector('svg') as SVGElement
      const box = el.getBoundingClientRect()
      const drawn = svg.getBoundingClientRect()
      return {
        box: Math.round(box.height),
        svg: Math.round(drawn.height),
        // How far the diagram pokes out below its box. Must be zero.
        overhang: Math.round(Math.max(0, drawn.bottom - box.bottom))
      }
    })
}

test.describe('a diagram block in a note never crops or enlarges its diagram', () => {
  test('a stored height leaves the diagram whole, at its own size', async ({ page, request }) => {
    const title = `SC note ${Date.now()}`
    await seedNote(request, title)
    await openNote(page, title)

    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('diagram-preset-medium').click({ force: true })
    await page.waitForTimeout(600)

    const { box, svg, overhang } = await geometry(page)

    // The box is genuinely smaller than a diagram drawn to fill it would be — that is
    // what makes this the case that used to crop.
    expect(box).toBe(400)
    // The diagram keeps its own size rather than being blown up to fill the box. The
    // Medium preset previously drew a 196px flowchart at 640px wide, with label text the
    // height of a headline. Shrink-to-fit, never grow.
    expect(svg).toBe(168)
    // And nothing hangs outside the box. This is the assertion that failed at 82px.
    expect(overhang).toBe(0)
  })

  test('auto height still hugs the diagram', async ({ page, request }) => {
    const title = `SC auto ${Date.now()}`
    await seedNote(request, title)
    await openNote(page, title)

    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('diagram-preset-medium').click({ force: true })
    await page.waitForTimeout(500)
    await page.getByTestId('diagram-preset-fit').click({ force: true })
    await page.waitForTimeout(600)

    const { box, svg, overhang } = await geometry(page)
    // The box is the diagram's own height again, with the small padding a block has.
    expect(Math.abs(box - svg)).toBeLessThan(24)
    expect(overhang).toBe(0)
  })

  test('an unsized block is still drawn at its natural size', async ({ page, request }) => {
    // The scale-to-fit rules must not touch a block with no stored size: the diagram is
    // drawn naturally and the pane scrolls, which is the documented difference from the
    // Diagram page. A fix that scaled every block would silently change this.
    const title = `SC natural ${Date.now()}`
    await seedNote(request, title)
    await openNote(page, title)

    const { box, svg, overhang } = await geometry(page)
    expect(Math.abs(box - svg)).toBeLessThan(24)
    expect(overhang).toBe(0)
  })
})

test.describe('the corner grip resizes the right way from the keyboard', () => {
  test('Arrow Right grows an unsized block instead of shrinking it', async ({ page, request }) => {
    const title = `KB grow ${Date.now()}`
    await seedNote(request, title)
    await openNote(page, title)

    const size = async (): Promise<{ w: number; h: number }> =>
      await page
        .locator('[data-testid="diagram-container"]')
        .first()
        .evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        })

    const start = await size()
    expect(start.w).toBeGreaterThan(500)

    // Arrow Right must enlarge. It previously left an 820px block at 280px, because the
    // handler read the *stored* size — absent on an unsized block — and so began from the
    // 240px minimum, then added 40 to it.
    await page.getByTestId('diagram-resize-handle').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    const grown = await size()
    // Clamped at the column, so it may legitimately stay level; what must never happen is
    // a large decrease. 40px is the step.
    expect(grown.w).toBeGreaterThanOrEqual(start.w - 2)
    expect(grown.h).toBeGreaterThanOrEqual(start.h - 2)

    // Arrow Left must shrink by one step.
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(400)
    const shrunk = await size()
    expect(shrunk.w).toBe(start.w - 40)
  })

  test('the grip is reachable by tabbing', async ({ page, request }) => {
    // Asserted because the grip was once wrongly recorded as unreachable. That claim came
    // from calling `focus()` and seeing focus had not moved, which does not test tab
    // order. This walks the real tab sequence.
    const title = `KB tab ${Date.now()}`
    await seedNote(request, title)
    await openNote(page, title)

    let reached = false
    for (let i = 0; i < 60 && !reached; i += 1) {
      await page.keyboard.press('Tab')
      reached =
        (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ===
        'diagram-resize-handle'
    }
    expect(reached).toBe(true)
  })
})
