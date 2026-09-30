import { type APIRequestContext, expect, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Multi-block Diagram pages.
 *
 * A visual page stores an ordered list of diagram blocks (content v2). The
 * workspace still edits one diagram at a time, so these tests cover the part that
 * already has to be correct before the block view is added: **editing one block
 * must not disturb the others.**
 *
 * That is not a hypothetical. The apply path used to write a v1 document, and a
 * v1 document parses as exactly one block, so applying an edit to a page holding
 * several diagrams silently discarded all but one — with no error anywhere.
 *
 * Rendering every block in the view, and reordering them, is covered below.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

const BLOCK_ONE = 'flowchart TD\n    A[Start] --> B[End]'
const BLOCK_TWO = 'flowchart LR\n    C[One] --> D[Two]'

async function seedTwoBlockPage(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'diagram',
      content: JSON.stringify({
        version: 2,
        type: 'diagram',
        blocks: [
          { id: 'first', source: BLOCK_ONE },
          { id: 'second', source: BLOCK_TWO }
        ]
      })
    }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
  return ((await res.json()) as { page: { id: string } }).page.id
}

/** Reads the stored blocks straight from the API, not from the UI. */
async function storedBlocks(
  request: APIRequestContext,
  id: string
): Promise<Array<{ id: string; source: string }>> {
  const res = await request.get(`/api/pages/${id}`)
  const body = (await res.json()) as { page?: { content: string } }
  const parsed = JSON.parse(body.page?.content ?? '{}') as {
    blocks?: Array<{ id: string; source: string }>
  }
  return parsed.blocks ?? []
}

test.describe('multi-block diagram pages', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('a page with several diagrams renders them all, each labelled', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Multi Block View')
    await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    // Two canvases, not one: the page holds two diagrams and both are drawn.
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)
    // Each says which diagram it is, so the controls are unambiguous.
    await expect(page.getByTestId('diagram-block-title-0')).toHaveText('Diagram 1 of 2')
    await expect(page.getByTestId('diagram-block-title-1')).toHaveText('Diagram 2 of 2')
  })

  test('Add diagram appends a third and the page keeps them in order', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Multi Block Add')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)

    await page.getByTestId('diagram-add-block').click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(3)

    await expect
      .poll(async () => (await storedBlocks(request, id)).length, { timeout: 20_000 })
      .toBe(3)
    const blocks = await storedBlocks(request, id)
    // Appended, not inserted: the two existing diagrams keep their order and
    // their sources.
    expect(blocks.slice(0, 2).map((b) => b.source)).toEqual([BLOCK_ONE, BLOCK_TWO])
  })

  test('Move down reorders the page and persists the new order', async ({ page, request }) => {
    const title = uniqueTitle('Multi Block Reorder')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)

    // Move the first diagram down, so the order becomes second-then-first.
    await page.getByTestId('diagram-block-down-0').click()

    // The visible order changes immediately.
    await expect(page.getByTestId('diagram-block-0')).toContainText('Diagram 1 of 2')
    await expect
      .poll(async () => (await storedBlocks(request, id)).map((b) => b.source), { timeout: 20_000 })
      .toEqual([BLOCK_TWO, BLOCK_ONE])
  })

  test('the first diagram cannot move up and the last cannot move down', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Multi Block Bounds')
    await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)

    // Disabled rather than silently doing nothing when pressed.
    await expect(page.getByTestId('diagram-block-up-0')).toBeDisabled()
    await expect(page.getByTestId('diagram-block-down-1')).toBeDisabled()
    await expect(page.getByTestId('diagram-block-down-0')).toBeEnabled()
    await expect(page.getByTestId('diagram-block-up-1')).toBeEnabled()
  })

  test('removing a diagram leaves the others, and the last one cannot go', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Multi Block Remove')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)

    // A page with no diagrams cannot be rendered at all, so the control is off
    // while only one remains.
    await expect(page.getByTestId('diagram-block-remove-0')).toBeEnabled()
    await page.getByTestId('diagram-block-remove-0').click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(1)
    await expect(page.getByTestId('diagram-block-remove-0')).toBeDisabled()

    await expect
      .poll(async () => (await storedBlocks(request, id)).map((b) => b.source), {
        timeout: 20_000
      })
      .toEqual([BLOCK_TWO])
  })

  test('a diagram on a multi-block page can be edited on its own', async ({ page, request }) => {
    const title = uniqueTitle('Multi Block Edit Second')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(2)

    // Edit the *second* block, not the first: the first must not even open.
    await page.getByTestId('diagram-block-edit-1').click()
    const input = page.getByTestId('diagram-source-input')
    await expect(input).toHaveValue(BLOCK_TWO)
    const edited = 'flowchart LR\n    R[Rewritten]'
    await input.fill(edited)
    await page.getByTestId('diagram-apply').click()

    await expect
      .poll(async () => (await storedBlocks(request, id))[1]?.source, { timeout: 20_000 })
      .toBe(edited)
    const blocks = await storedBlocks(request, id)
    // Block one is untouched, and it is still first.
    expect(blocks[0].source).toBe(BLOCK_ONE)
  })

  test('editing one diagram leaves the others untouched', async ({ page, request }) => {
    const title = uniqueTitle('Multi Block Apply')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    // Editing is per block, so the control names which diagram it opens.
    await page.getByTestId('diagram-block-edit-0').click()
    const input = page.getByTestId('diagram-source-input')
    await expect(input).toBeVisible()
    const edited = 'flowchart TD\n    X[Edited] --> Y[Done]'
    await input.fill(edited)
    await page.getByTestId('diagram-apply').click()

    // The network is the truth. Polled on the *edited source* rather than on the
    // block count: the count is already 2 before the save lands, so waiting on it
    // returns immediately and would then read stale content.
    await expect
      .poll(async () => (await storedBlocks(request, id))[0]?.source, { timeout: 20_000 })
      .toBe(edited)
    const blocks = await storedBlocks(request, id)
    expect(blocks.map((b) => b.id)).toEqual(['first', 'second'])
    expect(blocks[1].source).toBe(BLOCK_TWO)
  })

  test('cancelling an edit changes nothing', async ({ page, request }) => {
    const title = uniqueTitle('Multi Block Cancel')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    // Editing is per block, so the control names which diagram it opens.
    await page.getByTestId('diagram-block-edit-0').click()
    await page.getByTestId('diagram-source-input').fill('flowchart TD\n    Z[Discarded]')
    await page.getByTestId('diagram-cancel').click()

    // Nothing was written, so the stored blocks are untouched. Give the debounced
    // autosave more than enough time to prove it never fires.
    await page.waitForTimeout(2600)
    const blocks = await storedBlocks(request, id)
    expect(blocks.map((b) => b.id)).toEqual(['first', 'second'])
    expect(blocks[0].source).toBe(BLOCK_ONE)
  })

  test('a v1 single-diagram page still opens and saves as one block', async ({ page, request }) => {
    // The backward-compatibility path: a page written before v2 must keep working
    // rather than erroring.
    const title = uniqueTitle('Multi Block Legacy')
    const res = await request.post('/api/pages', {
      data: {
        title,
        pageType: 'diagram',
        content: JSON.stringify({ version: 1, type: 'diagram', source: BLOCK_ONE })
      }
    })
    expect(res.status()).toBe(201)
    const id = ((await res.json()) as { page: { id: string } }).page.id

    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await expect(page.getByTestId('diagram-rendered')).toHaveCount(1)

    // Editing is per block, so the control names which diagram it opens.
    await page.getByTestId('diagram-block-edit-0').click()
    await page.getByTestId('diagram-source-input').fill('flowchart TD\n    P[New] --> Q[End]')
    await page.getByTestId('diagram-apply').click()

    const newSource = 'flowchart TD\n    P[New] --> Q[End]'
    await expect
      .poll(async () => (await storedBlocks(request, id))[0]?.source, { timeout: 20_000 })
      .toBe(newSource)
    // Still exactly one block: a v1 page must not gain one by being edited.
    expect(await storedBlocks(request, id)).toHaveLength(1)
  })
})
