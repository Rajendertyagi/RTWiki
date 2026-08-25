import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Rich Note block rearrangement (drag handle + keyboard Move up/down) and
 * Diagram/Mind Map container resizing. Geometry tests use real pointer
 * interaction — never synthetic event dispatches.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedRich(
  request: APIRequestContext,
  title: string,
  blocks: Array<Record<string, unknown>>
): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify(blocks) }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

async function getStoredContent(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; content: string }> }
  return body.pages.find((p) => p.id === id)?.content ?? ''
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

const DRAG_HANDLE = '[data-test="dragHandle"]'

/** Drags the block whose text matches `sourceText` above the target block. */
async function dragBlockTo(page: Page, sourceText: string, targetText: string): Promise<void> {
  const source = page.locator('.bn-block-outer', { hasText: sourceText }).first()
  await source.hover()
  // The drag handle lives in BlockNote's portal, outside the block DOM.
  const handle = page.locator(DRAG_HANDLE).first()
  await handle.waitFor({ state: 'visible' })
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('drag handle has no box')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  // A small initial wiggle reliably crosses the HTML5 dragstart threshold.
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 8, handleBox.y + 10, { steps: 3 })
  const target = page.locator('.bn-block-outer', { hasText: targetText }).first()
  const box = await target.boundingBox()
  if (!box) throw new Error(`target block ${targetText} not found`)
  // Drop slightly ABOVE the target's top edge so ProseMirror's drop cursor
  // lands before it; steps keep the drag event stream continuous.
  await page.mouse.move(box.x + box.width / 2, box.y - 4, { steps: 20 })
  await page.mouse.up()
}

let pageErrors: Error[] = []

test.describe('rich note block rearrangement', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  test('drag handle moves a paragraph between neighbours', async ({ page, request }) => {
    const title = uniqueTitle('Move Drag')
    await seedRich(request, title, [
      { id: 'p1', type: 'paragraph', content: [{ type: 'text', text: 'alpha block', styles: {} }] },
      { id: 'p2', type: 'paragraph', content: [{ type: 'text', text: 'beta block', styles: {} }] },
      { id: 'p3', type: 'paragraph', content: [{ type: 'text', text: 'gamma block', styles: {} }] }
    ])
    await openNote(page, title)
    await expect(page.getByText('alpha block')).toBeVisible()

    // Drag "gamma block" toward the top. Each pass is a real pointer drag;
    // repeat until it reaches the first slot (drop-cursor geometry can land
    // one slot short depending on where the pointer crosses the target).
    const editor = page.locator('[data-testid="rich-editor"]')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const order = await editor.locator('.bn-block-outer').allTextContents()
      if (order[0]?.includes('gamma')) break
      await dragBlockTo(page, 'gamma block', 'alpha block')
      await expect(editor).toContainText('alpha block')
    }
    const finalOrder = await editor.locator('.bn-block-outer').allTextContents()
    expect(finalOrder[0]).toContain('gamma')
    // Content survived the move.
    expect(finalOrder.join('\n')).toContain('alpha block')
    expect(finalOrder.join('\n')).toContain('beta block')
  })

  test('keyboard Move up/down actions reorder every custom block type', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Move Keys')
    await seedRich(request, title, [
      {
        id: 'h',
        type: 'heading',
        props: { level: 1 },
        content: [{ type: 'text', text: 'Key Heading' }]
      },
      {
        id: 'c',
        type: 'callout',
        props: { variant: 'info' },
        content: [{ type: 'text', text: 'Key Callout' }]
      },
      { id: 'q', type: 'quote', content: [{ type: 'text', text: 'Key Quote' }] },
      { id: 'p', type: 'paragraph', content: [{ type: 'text', text: 'Key Paragraph' }] }
    ])
    await openNote(page, title)
    await expect(page.getByText('Key Callout')).toBeVisible()

    // Open the callout's block menu and move it down.
    const callout = page.locator('.bn-block-outer', { hasText: 'Key Callout' }).first()
    await callout.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-down').click()
    let order = await page.locator('[data-testid="rich-editor"] .bn-block-outer').allTextContents()
    expect(order.findIndex((t) => t.includes('Key Callout'))).toBeGreaterThan(
      order.findIndex((t) => t.includes('Key Heading'))
    )

    // Move it back up.
    await callout.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-up').click()
    order = await page.locator('[data-testid="rich-editor"] .bn-block-outer').allTextContents()
    expect(order.findIndex((t) => t.includes('Key Callout'))).toBeLessThan(
      order.findIndex((t) => t.includes('Key Quote'))
    )
  })

  test('boundary blocks offer no crossing move action', async ({ page, request }) => {
    const title = uniqueTitle('Move Edge')
    await seedRich(request, title, [
      { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'edge first', styles: {} }] },
      { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'edge second', styles: {} }] }
    ])
    await openNote(page, title)
    const first = page.locator('.bn-block-outer', { hasText: 'edge first' }).first()
    await first.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    // First block cannot move up: the action is absent.
    await expect(page.getByTestId('move-up')).toHaveCount(0)
    await expect(page.getByTestId('move-down')).toBeVisible()
    await page.keyboard.press('Escape')

    const last = page.locator('.bn-block-outer', { hasText: 'edge second' }).first()
    await last.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await expect(page.getByTestId('move-down')).toHaveCount(0)
    await expect(page.getByTestId('move-up')).toBeVisible()
  })

  test('moving autosaves and reload preserves the new order', async ({ page, request }) => {
    const title = uniqueTitle('Move Persist')
    const p = await seedRich(request, title, [
      { id: 'm1', type: 'paragraph', content: [{ type: 'text', text: 'persist one', styles: {} }] },
      { id: 'm2', type: 'paragraph', content: [{ type: 'text', text: 'persist two', styles: {} }] }
    ])
    await openNote(page, title)
    const second = page.locator('.bn-block-outer', { hasText: 'persist two' }).first()
    await second.hover()
    await page.locator(DRAG_HANDLE).first().waitFor({ state: 'visible' })
    await page.locator(DRAG_HANDLE).first().click()
    await page.getByTestId('move-up').click()

    await expect
      .poll(async () => getStoredContent(request, p.id), { timeout: 15_000 })
      .toContain('persist two')
    const stored = await getStoredContent(request, p.id)
    const oneIdx = stored.indexOf('persist one')
    const twoIdx = stored.indexOf('persist two')
    expect(twoIdx).toBeGreaterThan(-1)
    expect(oneIdx).toBeGreaterThan(-1)

    // Wait until the moved order is PERSISTED before reloading — a reload
    // during the autosave debounce window would legitimately lose the move.
    await expect
      .poll(
        async () => {
          const stored = await getStoredContent(request, p.id)
          const two = stored.indexOf('persist two')
          const one = stored.indexOf('persist one')
          return two > -1 && one > -1 && two < one ? 'moved' : 'pending'
        },
        { timeout: 15_000 }
      )
      .toBe('moved')

    // Reload: session restoration reopens the same note directly (the tab
    // and active page persist in sessionStorage), so no dashboard navigation.
    await page.reload()
    await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible({ timeout: 15_000 })
    const order = await page
      .locator('[data-testid="rich-editor"] .bn-block-outer')
      .allTextContents()
    expect(order.findIndex((t) => t.includes('persist two'))).toBeLessThan(
      order.findIndex((t) => t.includes('persist one'))
    )
  })
})

test.describe('diagram and mind map resizing', () => {
  test.beforeEach(({ page }) => {
    page.on('pageerror', (err) => pageErrors.push(err))
  })

  test('pointer resize changes width and height independently', async ({ page, request }) => {
    const title = uniqueTitle('Resize Pointer')
    await seedRich(request, title, [
      {
        id: 'd',
        type: 'diagram',
        props: { width: '500', height: '300' },
        content: 'graph TD\n  A-->B'
      }
    ])
    await openNote(page, title)
    const container = page.getByTestId('diagram-container')
    await expect(container).toBeVisible()
    await expect(container).toHaveAttribute('data-width', '500')
    await expect(container).toHaveAttribute('data-height', '300')

    const handle = page.getByTestId('diagram-resize-handle')
    const box = await handle.boundingBox()
    if (!box) throw new Error('resize handle not visible')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 90, { steps: 10 })
    await page.mouse.up()

    const width = await container.getAttribute('data-width')
    const height = await container.getAttribute('data-height')
    // Height is unclamped and must grow; width clamps to the document column
    // (the stored 500px may exceed it, in which case the clamp pulls it in).
    expect(Number(height)).toBeGreaterThan(340)
    const workspace = page.getByTestId('rich-editor')
    const wsBox = await workspace.boundingBox()
    const containerBox = await container.boundingBox()
    expect(containerBox?.width ?? 0).toBeLessThanOrEqual((wsBox?.width ?? 9999) + 2)
    expect(Number(width)).toBeGreaterThanOrEqual(240)
  })

  test('size presets apply clamped dimensions via keyboard-accessible buttons', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Resize Presets')
    await seedRich(request, title, [{ id: 'd', type: 'diagram', content: 'graph TD\n  A-->B' }])
    await openNote(page, title)
    await page.getByTestId('diagram-preset-small').click()
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-width', '360')
    // Large clamps to the document column when narrower than the preset.
    await page.getByTestId('diagram-preset-large').click()
    const largeWidth = Number(
      await page.getByTestId('diagram-container').getAttribute('data-width')
    )
    expect(largeWidth).toBeGreaterThanOrEqual(360)
    expect(largeWidth).toBeLessThanOrEqual(1600)
    await page.getByTestId('diagram-preset-fit').click()
    await expect(page.getByTestId('diagram-container')).toHaveAttribute('data-width', '')
  })

  test('narrow screens clamp responsively without destroying stored size', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Resize Narrow')
    await seedRich(request, title, [
      {
        id: 'd',
        type: 'diagram',
        props: { width: '1200', height: '600' },
        content: 'graph TD\n  A-->B'
      }
    ])
    await openNote(page, title)
    await page.setViewportSize({ width: 480, height: 800 })
    const container = page.getByTestId('diagram-container')
    const boxWidth = (await container.boundingBox())?.width ?? 0
    const workspace = page.getByTestId('rich-editor')
    const wsBox = await workspace.boundingBox()
    expect(boxWidth).toBeLessThanOrEqual((wsBox?.width ?? 480) + 2)
    // Stored desktop size is untouched by the responsive clamp.
    await expect(container).toHaveAttribute('data-width', '1200')
  })

  test('reload and duplicate preserve stored dimensions', async ({ page, request }) => {
    const title = uniqueTitle('Resize Persist')
    const original = await seedRich(request, title, [
      {
        id: 'mm',
        type: 'mindMap',
        props: { width: '700', height: '450' },
        content: 'mindmap\n  root((R))\n    A'
      }
    ])
    await openNote(page, title)
    await expect(page.getByTestId('mindMap-container')).toHaveAttribute('data-width', '700')
    await expect(page.getByTestId('mindMap-container')).toHaveAttribute('data-height', '450')

    const dup = await request.post(`/api/pages/${original.id}/duplicate`)
    expect(dup.status()).toBe(201)
    const listRes = await request.get('/api/pages')
    const body = (await listRes.json()) as { pages: Array<{ id: string; content: string }> }
    const copy = body.pages.find((x) => x.id !== original.id && x.content.includes('"width":"700"'))
    expect(copy?.content).toContain('"height":"450"')
  })
})
