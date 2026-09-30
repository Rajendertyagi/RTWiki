import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * The diagram view controls — pan, zoom, reset, full screen.
 *
 * These exist on both surfaces that render a diagram: the Diagram page's block card
 * and a diagram block inside a Rich Note. They are one shared component, and this
 * spec asserts on both, because the surfaces drifting apart is exactly what happened
 * last time they had their own copy.
 *
 * Two properties are load-bearing and are each asserted directly:
 *
 * 1. **The controls do not resize the block.** Zoom moves the picture; the corner
 *    handle changes the box. Nothing here is written to the document, so these tests
 *    also check that using a control leaves the stored page content untouched.
 * 2. **Sizing the block does not collapse the diagram.** Mermaid is rendered into a
 *    layer that must have a *definite* size. It regressed to 0x0 after a size preset
 *    before the wrapper was made a flex container.
 */

const DIAGRAM = 'flowchart TD\n  A[Start] --> B[End]'

/** The pan offset and zoom scale the layer is currently showing. */
interface ViewState {
  x: string
  scale: string
}

async function readViewState(page: Page, svgTestId: string): Promise<ViewState> {
  return await page.locator(svgTestId).evaluate((el: HTMLElement) => {
    const layer = el.closest('[class*="layer"]') as HTMLElement | null
    return {
      x: layer?.style.getPropertyValue('--view-x') ?? '(none)',
      scale: layer?.style.getPropertyValue('--view-scale') ?? '(none)'
    }
  })
}

/** The drawn width of the diagram, which must follow the block's width. */
async function drawnWidth(page: Page, svgTestId: string): Promise<number> {
  return await page
    .locator(`${svgTestId} svg`)
    .first()
    .evaluate((el: SVGElement) => Math.round(el.getBoundingClientRect().width))
}

/** Seeds a Rich Note holding one block of the given type. */
async function seedNote(
  request: APIRequestContext,
  title: string,
  block: { type: string; content: string; id?: string }
): Promise<void> {
  const response = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify([block]) }
  })
  expect(response.status()).toBe(201)
}

test.describe('diagram view controls', () => {
  test('a diagram block in a note zooms, pans, resets, and opens full screen', async ({
    page,
    request
  }) => {
    const title = `VC note ${Date.now()}`
    const created = (await (
      await request.post('/api/pages', {
        data: {
          title,
          pageType: 'rich',
          content: JSON.stringify([{ type: 'diagram', content: DIAGRAM }])
        }
      })
    ).json()) as { page: { id: string } }

    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(400)

    // All eight controls are present.
    for (const id of [
      'note-view-pan-up',
      'note-view-pan-down',
      'note-view-pan-left',
      'note-view-pan-right',
      'note-view-zoom-in',
      'note-view-zoom-out',
      'note-view-reset-view',
      'note-view-full-screen'
    ]) {
      await expect(page.getByTestId(id)).toHaveCount(1)
    }

    expect(await readViewState(page, '[data-testid="diagram-svg"]')).toEqual({
      x: '0px',
      scale: '1'
    })

    // The cluster is revealed on hover and is inert until then, so a click has to
    // hover the block first. That is deliberate: a permanently visible pad of eight
    // buttons would sit on top of every diagram being read.
    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('note-view-zoom-in').click()
    await page.getByTestId('note-view-pan-right').click()
    expect(await readViewState(page, '[data-testid="diagram-svg"]')).toEqual({
      x: '40px',
      scale: '1.25'
    })

    await page.getByTestId('note-view-reset-view').click()
    expect(await readViewState(page, '[data-testid="diagram-svg"]')).toEqual({
      x: '0px',
      scale: '1'
    })

    await page.getByTestId('note-view-full-screen').click()
    await expect(page.getByTestId('note-view-full-screen-open')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('note-view-full-screen-open')).toHaveCount(0)

    // Moving the picture must not write to the document. Only a real block-size
    // change is stored, so a stored width after all this would mean the view
    // controls had started editing the page.
    await page.waitForTimeout(1200)
    const after = (await (await request.get(`/api/pages/${created.page.id}`)).json()) as {
      page?: { content: string }
      content?: string
    }
    const raw = after.page?.content ?? after.content ?? ''
    expect(raw).not.toContain('"width"')
  })

  test('a diagram is never stretched past its own size, whatever the box does', async ({
    page,
    request
  }) => {
    const title = `VC preset ${Date.now()}`
    await seedNote(request, title, { type: 'diagram', content: DIAGRAM })
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(400)

    const natural = await drawnWidth(page, '[data-testid="diagram-svg"]')
    expect(natural).toBe(196)

    // Two Mermaid attributes have to be dealt with, and both used to stretch the
    // diagram: an inline `max-width`, and `width="100%"` on the root <svg>. The second
    // is the one that bites — it is an attribute, so `width: auto` in a stylesheet
    // resolves to 100% of the container rather than to the diagram's own size. With
    // both handled, a full-width box leaves the diagram at 196px instead of blowing it
    // up to 720px with headline-sized label text. That was measured on screen, not
    // inferred: it is the state this test exists to prevent returning.
    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('diagram-preset-large').click({ force: true })
    await page.waitForTimeout(600)
    expect(await drawnWidth(page, '[data-testid="diagram-svg"]')).toBe(natural)

    // And it shrinks only when the box is genuinely narrower than the diagram.
    await page.getByTestId('diagram-preset-small').click({ force: true })
    await page.waitForTimeout(600)
    const small = await drawnWidth(page, '[data-testid="diagram-svg"]')
    expect(small).toBeGreaterThan(0)
    expect(small).toBeLessThanOrEqual(natural)
  })

  test('a diagram block on a Diagram page has the same controls', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`VC page ${Date.now()}`)
    await dialog.getByTestId('new-page-type-diagram').click()
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('template-flowchart').click()
    await expect(
      page.locator('section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"] svg')
    ).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)

    for (const id of [
      'diagram-block-0-pan-up',
      'diagram-block-0-pan-down',
      'diagram-block-0-pan-left',
      'diagram-block-0-pan-right',
      'diagram-block-0-zoom-in',
      'diagram-block-0-zoom-out',
      'diagram-block-0-reset-view',
      'diagram-block-0-full-screen'
    ]) {
      await expect(page.getByTestId(id)).toHaveCount(1)
    }

    // The control icons are inline SVG, so they must stay OUTSIDE
    // `[data-testid="diagram-rendered"]` — otherwise every locator that reaches for
    // the diagram through that path matches nine elements instead of one.
    await expect(
      page.locator('section[data-testid="diagram-block-0"] [data-testid="diagram-rendered"] svg')
    ).toHaveCount(1)

    const state = () => readViewState(page, '[data-testid="diagram-block-0-svg"]')
    expect(await state()).toEqual({ x: '0px', scale: '1' })

    // The cluster is revealed on hover and is inert until then, so a click has to
    // hover the block first. That is deliberate: a permanently visible pad of eight
    // buttons would sit on top of every diagram being read.
    await page.locator('section[data-testid="diagram-block-0"]').hover()
    await page.getByTestId('diagram-block-0-zoom-in').click()
    await page.getByTestId('diagram-block-0-pan-down').click()
    expect(await state()).toEqual({ x: '0px', scale: '1.25' })
    await page.getByTestId('diagram-block-0-reset-view').click()
    expect(await state()).toEqual({ x: '0px', scale: '1' })
  })

  test('a note block that still holds a mindMap keeps its own zoom controls', async ({
    page,
    request
  }) => {
    // The retired `mindMap` block carries toolbar zoom buttons addressed as
    // `mindMap-zoom-in`. The shared cluster uses a different stem, so the two sets
    // of controls must both resolve to exactly one element.
    const title = `VC mindmap ${Date.now()}`
    await seedNote(request, title, {
      id: 'mm',
      type: 'mindMap',
      content: 'mindmap\n  root((R))\n    A'
    })
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="mindMap-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })

    await expect(page.getByTestId('mindMap-zoom-in')).toHaveCount(1)
    await expect(page.getByTestId('note-view-zoom-in')).toHaveCount(1)
  })
})
