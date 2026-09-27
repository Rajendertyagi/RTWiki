import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
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
 * Rendering every block in the view, and reordering them, is the next increment
 * and is not covered here yet.
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

  test('editing one diagram leaves the others untouched', async ({ page, request }) => {
    const title = uniqueTitle('Multi Block Apply')
    const id = await seedTwoBlockPage(request, title)
    await page.goto('/')
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    await page.getByTestId('diagram-edit-button').click()
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

    await page.getByTestId('diagram-edit-button').click()
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

    await page.getByTestId('diagram-edit-button').click()
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
