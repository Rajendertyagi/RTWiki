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

  test('a note block that still holds a mindMap uses the one shared view', async ({
    page,
    request
  }) => {
    // The retired `mindMap` block used to carry a SECOND zoom in its toolbar,
    // addressed `mindMap-zoom-in`, beside the shared cluster's `note-view-zoom-in`.
    // Two zooms meant a legacy block's scale depended on which control the reader
    // pressed, and the two sets could collide on one id. `DiagramView` is now the
    // only view, so this asserts exactly that: the shared control is present and the
    // old one is gone.
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

    // One view, resolving to one element.
    await expect(page.getByTestId('note-view-zoom-in')).toHaveCount(1)
    await expect(page.getByTestId('note-view-pan-up')).toHaveCount(1)
    // The removed width-based zoom leaves nothing behind.
    await expect(page.getByTestId('mindMap-zoom-in')).toHaveCount(0)
    await expect(page.getByTestId('mindMap-zoom-out')).toHaveCount(0)

    // And it is the working one: pressing it scales the picture.
    const state = () => readViewState(page, '[data-testid="mindMap-svg"]')
    expect(await state()).toEqual({ x: '0px', scale: '1' })
    // The preview pane is `${blockType}-preview`, so a `mindMap` block's is not
    // `diagram-preview`.
    await page.locator('[data-testid="mindMap-preview"]').hover()
    await page.getByTestId('note-view-zoom-in').click()
    expect(await state()).toEqual({ x: '0px', scale: '1.25' })
  })

  // The three tests below each guard one reported fault. Every one was reproduced
  // on screen first and the measurement is in the comment, because a fault that
  // "looks inverted" and a fault caused by two swapped signs produce the same test
  // if the assertion is written from the code rather than from what a person saw.

  test('pan up moves the picture up, and pan down moves it down', async ({ page, request }) => {
    // Measured before the fix: one press of pan-up set `--view-y` to `40px`, which
    // moves the picture DOWN, and pan-down set it to `-40px`. Left and right were
    // correct, which is why this read as a rendering problem rather than a swapped
    // pair of signs, and it was wrong on both surfaces at once because they share
    // this component.
    const title = `VC pan ${Date.now()}`
    await seedNote(request, title, { type: 'diagram', content: DIAGRAM })
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(400)
    await page.locator('[data-testid="diagram-preview"]').hover()

    // Asserted on the *painted* position, not on the custom property. The property
    // is an implementation detail; what a person checks is whether the drawing
    // moved, and a sign error in the transform itself would satisfy a test that only
    // read the variable.
    const edge = async (axis: 'top' | 'left'): Promise<number> =>
      await page
        .locator('[data-testid="diagram-svg"] > svg')
        .first()
        .evaluate(
          (el: SVGElement, which: 'top' | 'left') => Math.round(el.getBoundingClientRect()[which]),
          axis
        )

    const startTop = await edge('top')
    await page.getByTestId('note-view-pan-up').click()
    await page.waitForTimeout(200)
    expect(await edge('top'), 'pan up must move the picture toward the top').toBeLessThan(startTop)

    await page.getByTestId('note-view-pan-down').click()
    await page.waitForTimeout(200)
    expect(await edge('top'), 'pan down must undo pan up').toBe(startTop)

    // The horizontal pair, which was already right and must stay right.
    const startLeft = await edge('left')
    await page.getByTestId('note-view-pan-right').click()
    await page.waitForTimeout(200)
    expect(await edge('left'), 'pan right must move the picture right').toBeGreaterThan(startLeft)
    await page.getByTestId('note-view-pan-left').click()
    await page.waitForTimeout(200)
    expect(await edge('left'), 'pan left must undo pan right').toBe(startLeft)
  })

  test('full screen grows the diagram, carries its own controls, and comes back exactly', async ({
    page,
    request
  }) => {
    // Three faults in one, because they are one chain.
    //
    // 1. The overlay carried **no** controls - measured, zero zoom buttons inside it
    //    - so the only way out was the X. Full screen was a dead end for anything
    //    except looking.
    // 2. The picture did not grow: at a 1600x950 window the overlay covered the
    //    viewport and the diagram sat in the middle of it at 426x414, exactly the
    //    size it had in the box.
    // 3. The same element was rendered into both places, so the document held two
    //    copies of the diagram while the overlay was open - measured at 24 element
    //    ids present twice, and Mermaid addresses its markers and clip paths by id.
    const title = `VC fs ${Date.now()}`
    await seedNote(request, title, { type: 'diagram', content: DIAGRAM })
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(400)

    const read = async (): Promise<{
      svgCount: number
      duplicateIds: number
      box: string
      diagram: string
      padInOverlay: number
    }> =>
      await page.evaluate(() => {
        const container = document.querySelector('[data-testid="diagram-container"]') as HTMLElement
        const overlay = document.querySelector('[data-testid="note-view-full-screen-open"]')
        const svgs = [...document.querySelectorAll('[data-testid="diagram-svg"] > svg')]
        const seen = new Map<string, number>()
        for (const s of svgs) {
          for (const el of [s, ...s.querySelectorAll('[id]')]) {
            if (el.id) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
          }
        }
        const b = container.getBoundingClientRect()
        const r = svgs[0]?.getBoundingClientRect()
        return {
          svgCount: svgs.length,
          duplicateIds: [...seen.values()].filter((n) => n > 1).length,
          box: `${Math.round(b.width)}x${Math.round(b.height)}`,
          diagram: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'none',
          padInOverlay: overlay
            ? overlay.querySelectorAll('[data-testid="note-view-zoom-in"]').length
            : 0
        }
      })

    const before = await read()
    expect(before.svgCount, 'one diagram in the document').toBe(1)

    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('note-view-full-screen').click()
    await expect(page.getByTestId('note-view-full-screen-open')).toBeVisible()
    await page.waitForTimeout(600)

    const during = await read()
    expect(during.padInOverlay, 'full screen must carry the view controls').toBe(1)
    expect(during.svgCount, 'full screen must not duplicate the diagram').toBe(1)
    expect(during.duplicateIds, 'no element id may appear twice').toBe(0)
    // The box behind is untouched: a block that resized itself when the overlay
    // opened would come back a different shape.
    expect(during.box, 'the block keeps its size while full screen is open').toBe(before.box)
    // And the picture is genuinely bigger, which is the whole point of the button.
    const [duringW, duringH] = during.diagram.split('x').map(Number)
    const [beforeW, beforeH] = before.diagram.split('x').map(Number)
    expect(
      duringH ?? 0,
      `the diagram must grow in full screen: ${before.diagram} -> ${during.diagram}`
    ).toBeGreaterThan(beforeH ?? 0)
    expect(
      duringW ?? 0,
      `the diagram must grow in full screen: ${before.diagram} -> ${during.diagram}`
    ).toBeGreaterThan(beforeW ?? 0)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('note-view-full-screen-open')).toHaveCount(0)
    await page.waitForTimeout(600)

    // Back exactly as it was. This is the assertion that catches the trap the first
    // attempt at the fit fell into: it multiplied a screen-fit scale into the
    // transform and never took it out again, so the diagram came back magnified and
    // cropped - which is the reported symptom, reintroduced by the fix for it.
    const after = await read()
    expect(after.svgCount, 'one diagram again').toBe(1)
    expect(after.diagram, 'the diagram returns to the size it had').toBe(before.diagram)
    expect(after.box, 'the block is unchanged').toBe(before.box)
  })

  test('a short block keeps its own controls instead of clipping them away', async ({
    page,
    request
  }) => {
    // Auto height on a short diagram gave a 78px box. The control pad is 90x90 and
    // anchored inside that box, which clips it, so the pad fell **entirely
    // outside**: no pan, no zoom, no full screen - and no way to undo a zoom applied
    // in full screen, where there were no controls to apply it with. That chain is
    // the reported "full screen then back and the diagram is gone", and it is *not*
    // reproducible from full screen alone: measured, open and Escape leaves the
    // diagram exactly where it was. It takes a short block to reach it.
    const title = `VC short ${Date.now()}`
    await seedNote(request, title, {
      type: 'diagram',
      content: 'flowchart LR\n    A --> B --> C --> D'
    })
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(400)

    await page.locator('[data-testid="diagram-preview"]').hover()
    await page.getByTestId('diagram-preset-fit').click({ force: true })
    await page.waitForTimeout(700)

    const measured = await page
      .getByTestId('note-view-pan-up')
      .locator('..')
      .evaluate((el: HTMLElement) => {
        const container = document.querySelector('[data-testid="diagram-container"]') as HTMLElement
        const p = el.getBoundingClientRect()
        const c = container.getBoundingClientRect()
        const button = el.querySelector('[data-testid="note-view-zoom-in"]')
        const b = button?.getBoundingClientRect()
        return {
          pad: `${Math.round(p.width)}x${Math.round(p.height)}`,
          container: Math.round(c.height),
          padInsideBlock: p.top >= c.top - 1 && p.bottom <= c.bottom + 1 && p.left >= c.left - 1,
          zoomButtonReachable: b !== null && b !== undefined && b.height > 0 && b.top >= c.top - 1
        }
      })

    expect(measured.pad, 'the control pad has a real size').not.toBe('0x0')
    expect(
      measured.padInsideBlock,
      `the ${measured.pad} control pad must sit inside the ${measured.container}px block that clips it`
    ).toBe(true)
    expect(measured.zoomButtonReachable, 'zoom must be reachable on a short block').toBe(true)

    // And usable, which a geometry check cannot see. This is the undo that was
    // missing: with the pad gone there was no way back from a zoom.
    //
    // The pointer has to be over the diagram first. The pad is revealed on hover by
    // design, and the pointer is currently on the preset button, which lives outside
    // the pad's host - so without this the buttons are present but inert, and the
    // click lands on the diagram underneath.
    await page.locator('[data-testid="diagram-preview"]').hover()
    const width = async (): Promise<number> =>
      await page
        .locator('[data-testid="diagram-svg"] > svg')
        .first()
        .evaluate((el: SVGElement) => Math.round(el.getBoundingClientRect().width))
    const beforeZoom = await width()
    await page.getByTestId('note-view-zoom-in').click()
    await page.waitForTimeout(250)
    expect(await width(), 'zoom must do something on a short block').toBeGreaterThan(beforeZoom)
    await page.getByTestId('note-view-reset-view').click()
    await page.waitForTimeout(250)
    expect(await width(), 'reset must undo it again').toBe(beforeZoom)
  })

  /*
   * Zoomed, panned and full-screen reachability lives in
   * `diagram-zoom-reachability.pwspec.ts`, which proves each of the four edges of the
   * painted drawing by scrolling to it and re-measuring, on both surfaces, at three
   * viewports and up to 2.44x.
   *
   * The two tests that used to be here are gone, and both were weaker than their names
   * said. One asserted `hiddenAtTop > 0` — that content *is* clipped above the stage —
   * which is a symptom, and which passed against an origin that left half the drawing
   * unreachable forever; it then only ever checked the *bottom* edge. The other asserted
   * `align-items` contained `safe`, which cannot take effect here at all: the overlay's
   * flex item is `width:100%; height:100%`, so it never overflows by layout, and `safe`
   * substitutes only for layout overflow. Keeping an assertion that guards a declaration
   * with no behaviour is worse than having none.
   *
   * What remains below is the part that is about the document rather than the viewport:
   * that using the view controls never writes a size.
   */
  test.describe('the view controls do not write to the document', () => {
    /** Hovers the block so the hover-revealed control cluster becomes interactive. */
    const hoverBlock = async (page: Page): Promise<void> => {
      const b = await page
        .locator('[data-testid="diagram-block-0-container"] [class*="_host_"]')
        .first()
        .boundingBox()
      if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.waitForTimeout(350)
    }

    test('zoom does not change the stored block size, and full screen restores it', async ({
      page,
      request
    }) => {
      const title = `VC nosize ${Date.now()}`
      const res = await request.post('/api/pages', {
        data: {
          title,
          pageType: 'diagram',
          content: JSON.stringify({
            version: 2,
            type: 'diagram',
            blocks: [{ id: 'a', source: DIAGRAM }]
          })
        }
      })
      expect(res.status()).toBe(201)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/')
      await page.waitForTimeout(1500)
      await page.evaluate((t) => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.getAttribute('aria-label') === `Open ${t}`
        )
        if (btn) (btn as HTMLElement).click()
      }, title)
      await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
      await page
        .locator('[data-testid="diagram-block-0-container"]')
        .first()
        .scrollIntoViewIfNeeded()
      await page.waitForTimeout(600)
      await page.getByTestId('diagram-block-0-preset-medium').click()
      await page.waitForTimeout(1000)

      const container = page.getByTestId('diagram-block-0-container')
      const stored = async () => ({
        w: await container.getAttribute('data-width'),
        h: await container.getAttribute('data-height')
      })
      const before = await stored()

      await hoverBlock(page)
      await page.getByTestId('diagram-block-0-zoom-in').click()
      await page.getByTestId('diagram-block-0-pan-down').click()
      await page.waitForTimeout(500)
      expect(await stored(), 'zoom and pan are view state and must not touch the document').toEqual(
        before
      )

      await hoverBlock(page)
      await page.getByTestId('diagram-block-0-full-screen').click()
      await page.waitForTimeout(1000)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1000)

      expect(await stored(), 'leaving full screen must not alter the stored size').toEqual(before)
      expect(
        await container.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
        'the rendered box must come back at its stored height'
      ).toBe(Number(before.h))
      expect(
        await page.evaluate(() => {
          const l = document.querySelector<HTMLElement>(
            '[data-testid="diagram-block-0-container"] [class*="_layer_"]'
          )
          return l ? getComputedStyle(l).getPropertyValue('--view-fit').trim() : '(gone)'
        }),
        'the full-screen fit scale must be cleared, or it multiplies into the box view'
      ).toBe('')

      // And the document the server holds still carries the same size.
      const storedDoc = await (
        await request.get(`/api/pages/${await pageId(request, title)}`)
      ).json()
      const blocks = JSON.parse((storedDoc as { page: { content: string } }).page.content).blocks
      expect(blocks[0].height, 'the persisted height must be untouched by the view').toBe(before.h)
    })
  })
})

/** Resolves a page's id by its exact title, for reading back what was persisted. */
async function pageId(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.get('/api/pages')
  const json = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  const found = json.pages.find((p) => p.title === title)
  if (!found) throw new Error(`page not found: ${title}`)
  return found.id
}
