import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { MAX_VISUAL_PAGE_BLOCKS } from '../../src/shared/schemas/visual-page-content.js'
import { starterSourceFor } from '../../src/web/features/visual-pages/starter-source.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * Several diagram edits inside one autosave debounce window.
 *
 * ## The defect this covers
 *
 * A visual page's block list used to be a pure function of the `storedContent`
 * prop, and every add / remove / move built its write from that prop. The prop
 * only refreshes *after* a successful server round-trip, while writes are
 * debounced by `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` (2000 ms). So any second
 * mutation inside that window computed from a list that predated the first:
 *
 * - `+` then `+`  -> the diagram the first press added was never in the written
 *   document. The save succeeded, the status bar said "Saved", and the diagram
 *   was gone. Nothing errored.
 * - `+` then delete / move -> the new diagram was dropped from the write, and a
 *   delete landed on whatever the index meant in the *older* list.
 * - After a *failed* save the prop never refreshed at all, so the stale snapshot
 *   stayed authoritative and every later write persisted the pre-failure list.
 *
 * The existing multi-block spec cannot see any of this: it performs exactly one
 * mutating action per test and then polls until the save lands, so the window
 * never contains two actions.
 *
 * ## Why the presses are dispatched rather than clicked, with nothing between them
 *
 * Each test asserts the *number* of PATCH requests the page sent. Two Add presses
 * must coalesce into exactly one write; if they were separated by more than the
 * debounce they would be two writes and the assertion below would fail loudly
 * rather than quietly stop covering the defect. That makes the timing part of the
 * contract, so the presses must be guaranteed to land inside the window —
 * `dispatchEvent` does that without waiting for actionability, which a real click
 * would (each press starts a Mermaid render, and the second can be pushed past
 * 2000 ms behind it).
 *
 * Nothing may be awaited *between* the presses either, and that is the subtle
 * part. An assertion such as "the page now shows four blocks" looks harmless, but
 * on the unfixed code the count only rises once the save lands — so waiting for
 * it hands the second action a freshly refreshed prop and the burst stops being a
 * burst. The tests below assert the count once, *after* every press. The write
 * count is what proves the window was still open.
 *
 * Each `dispatchEvent` is its own browser task, so React has committed the first
 * press's state before the second one runs — which is the whole difference
 * between the fixed and unfixed code, and is why the two presses are not fired
 * from a single `page.evaluate`.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

type Block = { id: string; source: string }

/** Distinct sources, so "which block was deleted" is a real question. */
const ONE = 'flowchart TD\n    A[First] --> B[First end]'
const TWO = 'flowchart LR\n    C[Second] --> D[Second end]'
const THREE = 'flowchart TD\n    E[Third] --> F[Third end]'
const STARTER = starterSourceFor()

async function seedPage(
  request: APIRequestContext,
  title: string,
  sources: string[]
): Promise<string> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'diagram',
      content: JSON.stringify({
        version: 2,
        type: 'diagram',
        blocks: sources.map((source, i) => ({ id: `seed-${i}`, source }))
      })
    }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
  return ((await res.json()) as { page: { id: string } }).page.id
}

/** The stored block list, read from the API rather than from the UI. */
async function storedBlocks(request: APIRequestContext, id: string): Promise<Block[]> {
  const res = await request.get(`/api/pages/${id}`)
  const body = (await res.json()) as { page?: { content: string } }
  return (JSON.parse(body.page?.content ?? '{}') as { blocks?: Block[] }).blocks ?? []
}

interface WriteRecorder {
  /** Body of every PATCH the page sent, in order. */
  bodies: string[]
  /** Makes the next `count` PATCHes fail with a 500. */
  failNext: (count: number) => void
}

/**
 * Records the documents the page writes, and can fail writes on demand.
 *
 * Reading the request body is what makes these tests decisive: it shows the exact
 * list each save carried, so a lost block is visible in the write itself rather
 * than inferred from what the page looks like afterwards.
 */
async function recordWrites(page: Page, pageId: string): Promise<WriteRecorder> {
  const bodies: string[] = []
  let failuresLeft = 0
  await page.route(`**/api/pages/${pageId}`, async (route) => {
    const request = route.request()
    if (request.method() !== 'PATCH') {
      await route.fallback()
      return
    }
    bodies.push(request.postData() ?? '')
    if (failuresLeft > 0) {
      failuresLeft -= 1
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Injected save failure' })
      })
      return
    }
    await route.fallback()
  })
  return {
    bodies,
    failNext: (count: number) => {
      failuresLeft = count
    }
  }
}

function blocksInWrite(body: string): Block[] {
  const { content } = JSON.parse(body) as { content: string }
  return (JSON.parse(content) as { blocks: Block[] }).blocks
}

function sourcesOf(blocks: Block[]): string[] {
  return blocks.map((block) => block.source)
}

async function openDiagramPage(page: Page, title: string, id: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title, id)
  await expect(page.getByTestId('diagram-workspace')).toBeVisible()
  await expect(page.getByTestId('diagram-block-title-0')).toBeVisible()
}

/** Asserts the last title reads "Diagram N of N", i.e. the page holds N blocks. */
async function expectBlockCount(page: Page, total: number): Promise<void> {
  await expect(page.getByTestId(`diagram-block-title-${total - 1}`)).toHaveText(
    `Diagram ${total} of ${total}`
  )
}

test.describe('diagram edits inside one autosave debounce window', () => {
  test('two Add presses inside the window persist both blocks', async ({ page, request }) => {
    const title = uniqueTitle('Burst Add Add')
    const id = await seedPage(request, title, [ONE])
    const writes = await recordWrites(page, id)
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, 1)

    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await page.getByTestId('diagram-add-block').dispatchEvent('click')

    // On screen first: the list is local state now, so both presses show at once.
    await expectBlockCount(page, 3)

    await expect
      .poll(async () => sourcesOf(await storedBlocks(request, id)), { timeout: 20_000 })
      .toEqual([ONE, STARTER, STARTER])

    // Past a whole debounce window, so a second write could have started.
    await page.waitForTimeout(2500)
    // Exactly one write, and it carried all three blocks. Two writes would mean
    // the presses fell outside the window and this test is no longer covering the
    // defect it exists to cover.
    expect(writes.bodies.map(blocksInWrite).map(sourcesOf)).toEqual([[ONE, STARTER, STARTER]])
  })

  test('Add then delete inside the window deletes the block that was clicked', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Burst Add Remove')
    const id = await seedPage(request, title, [ONE, TWO, THREE])
    const writes = await recordWrites(page, id)
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, 3)

    // Append a fourth, then delete the *second* of the four — nothing awaited in
    // between, so both act on the same un-acknowledged write. Building the delete
    // from a list that lacks the new block would delete the wrong diagram *and*
    // take the new one with it.
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await page.getByTestId('diagram-block-remove-1').dispatchEvent('click')
    await expectBlockCount(page, 3)

    await expect
      .poll(async () => sourcesOf(await storedBlocks(request, id)), { timeout: 20_000 })
      .toEqual([ONE, THREE, STARTER])

    await page.waitForTimeout(2500)
    expect(writes.bodies.map(blocksInWrite).map(sourcesOf)).toEqual([[ONE, THREE, STARTER]])
  })

  test('Add then move inside the window reorders the list that includes the new block', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Burst Add Move')
    const id = await seedPage(request, title, [ONE, TWO])
    const writes = await recordWrites(page, id)
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, 2)

    // Move the first diagram down: TWO, ONE, then the one just added. Again with
    // no assertion between the two presses, so the move reads the list as it was
    // when Add ran and not the list as the server last confirmed it.
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await page.getByTestId('diagram-block-down-0').dispatchEvent('click')

    await expect
      .poll(async () => sourcesOf(await storedBlocks(request, id)), { timeout: 20_000 })
      .toEqual([TWO, ONE, STARTER])

    await page.waitForTimeout(2500)
    expect(writes.bodies.map(blocksInWrite).map(sourcesOf)).toEqual([[TWO, ONE, STARTER]])
  })

  test('a failed save keeps the pending block, and the next mutation keeps it too', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Burst Save Failure')
    const id = await seedPage(request, title, [ONE])
    const writes = await recordWrites(page, id)
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, 1)

    // The first save fails. Nothing reaches the server, so the stored page still
    // holds one block — but the block the user added is still on screen.
    writes.failNext(1)
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    const statusBar = page.getByTestId('workspace-status-bar')
    await expect(statusBar).toContainText('Save failed', { timeout: 20_000 })
    await expect(page.getByTestId('status-retry')).toBeVisible()
    await expectBlockCount(page, 2)
    expect(sourcesOf(await storedBlocks(request, id))).toEqual([ONE])

    // The failure must not have left the page writing from the pre-failure
    // snapshot. This is the case that loses data outright rather than only
    // narrowing the window: with the prop as the source of truth it never
    // refreshed, so the second Add would have written [ONE, secondBlock] and the
    // first block the user added would have been silently discarded.
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await expectBlockCount(page, 3)

    await expect
      .poll(async () => sourcesOf(await storedBlocks(request, id)), { timeout: 20_000 })
      .toEqual([ONE, STARTER, STARTER])

    // Two writes, and the one that landed carried the failed save's block too.
    const landed = writes.bodies.map(blocksInWrite).map(sourcesOf)
    expect(landed).toHaveLength(2)
    expect(landed[1]).toEqual([ONE, STARTER, STARTER])
  })

  test('the status bar says "Unsaved changes" while a diagram edit awaits its save', async ({
    page,
    request
  }) => {
    // The half of the defect a person actually sees. The workspace cast the
    // autosave status to a type the status bar does not recognise, so `'dirty'`
    // fell through to "Saved" — the bar claimed the page was written while the
    // debounce timer was still counting down.
    const title = uniqueTitle('Burst Status Bar')
    const id = await seedPage(request, title, [ONE])
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, 1)

    const statusBar = page.getByTestId('workspace-status-bar')
    await expect(statusBar).toContainText('Saved')

    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    // Inside the 2000 ms window, so the honest answer is "Unsaved changes".
    await expect(statusBar).toContainText('Unsaved changes', { timeout: 1_200 })
    await expect(statusBar).not.toContainText('Saved')

    await expect(statusBar).toContainText('Saved', { timeout: 20_000 })
  })

  test('a burst of Add presses stops at the block cap on the value that is written', async ({
    page,
    request
  }) => {
    // The cap has to be read from the list the next write is built from. Read
    // from the stored prop instead, a burst inside one window would append the
    // same diagram over and over and never once consult the cap.
    test.setTimeout(90_000)
    const title = uniqueTitle('Burst Cap')
    const seeded = MAX_VISUAL_PAGE_BLOCKS - 2
    const id = await seedPage(
      request,
      title,
      Array.from({ length: seeded }, (_, i) => `flowchart TD\n    N${i}[${i}] --> M${i}[end]`)
    )
    const writes = await recordWrites(page, id)
    await openDiagramPage(page, title, id)
    await expectBlockCount(page, seeded)

    // Two presses fit under the cap; the third has nowhere to go. Nothing is
    // awaited between them, so the cap can only hold if it is read from the list
    // the write is built from.
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await page.getByTestId('diagram-add-block').dispatchEvent('click')
    await expectBlockCount(page, MAX_VISUAL_PAGE_BLOCKS)
    await expect(page.getByTestId('diagram-add-block')).toBeDisabled()

    await expect
      .poll(async () => (await storedBlocks(request, id)).length, { timeout: 30_000 })
      .toBe(MAX_VISUAL_PAGE_BLOCKS)

    await page.waitForTimeout(2500)
    const written = writes.bodies.map((body) => blocksInWrite(body))
    // The written document is the capped one, and it is capped exactly.
    expect(written).toHaveLength(1)
    expect(written[0]).toHaveLength(MAX_VISUAL_PAGE_BLOCKS)
  })
})
