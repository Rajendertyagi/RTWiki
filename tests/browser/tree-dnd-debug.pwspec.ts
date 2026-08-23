import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * TEMPORARY diagnostic spec: instruments the native drag event pipeline
 * and logs which requests fire during one tree drag. Removed once DnD
 * behaviour is proven.
 */

let titleSeq = 0
function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  parentId: string | null = null
): Promise<string> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: '', parentId }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page.id
}

test('debug: drag event pipeline and network truth', async ({ page, request }) => {
  const a = await seedPage(request, uniqueTitle('DbgA'))
  const c = await seedPage(request, uniqueTitle('DbgC'))
  await page.goto('/')
  const rowA = page.locator(`[role="treeitem"][data-page-id="${a}"]`)
  await rowA.waitFor()

  // Instrument the native drag pipeline and inspect what pdd attached.
  await page.evaluate(() => {
    const events: string[] = []
    ;(window as unknown as { __dndEvents: string[] }).__dndEvents = events
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(type, () => {
        events.push(type)
      }, true)
    }
    const row = document.querySelector('[role="treeitem"]') as HTMLElement | null
    if (row) {
      console.log(`PROBE draggableAttr=${row.getAttribute('draggable')}`)
    }
  })

  const sb = await rowA.boundingBox()
  const rowC = page.locator(`[role="treeitem"][data-page-id="${c}"]`)
  const tb = await rowC.boundingBox()
  if (!sb || !tb) throw new Error('boxes missing')
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width / 2 + 12, sb.y + 8, { steps: 5 })
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * 0.1, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(1500)

  const report = await page.evaluate(() => ({
    events: (window as unknown as { __dndEvents: string[] }).__dndEvents,
    draggableAttrs: Array.from(document.querySelectorAll('[role="treeitem"]')).map((el) =>
      el.getAttribute('draggable')
    )
  }))
  console.log(`DNDEVENTS: ${JSON.stringify(report)}`)
})
