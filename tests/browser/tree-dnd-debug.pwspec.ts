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
  const logs: string[] = []
  const posts: string[] = []
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`))
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url())
  })
  const a = await seedPage(request, uniqueTitle('DbgA'))
  const c = await seedPage(request, uniqueTitle('DbgC'))
  await page.goto('/')
  const rowA = page.locator(`[role="treeitem"][data-page-id="${a}"]`)
  await rowA.waitFor()

  await page.evaluate(() => {
    const events: string[] = []
    ;(window as unknown as { __dndEvents: string[] }).__dndEvents = events
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend']) {
      document.addEventListener(type, () => {
        events.push(type)
      }, true)
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
  await page.waitForTimeout(2000)

  const report = await page.evaluate(() => ({
    events: (window as unknown as { __dndEvents: string[] }).__dndEvents,
    url: location.href,
    treeItems: document.querySelectorAll('[role="treeitem"]').length,
    rootChildren: document.getElementById('root')?.children.length ?? -1,
    bodyHead: document.body.innerText.slice(0, 300),
    hasBoundary: document.body.innerText.includes('encountered a problem'),
    hasRecovery: document.body.innerText.includes('Reset document')
  }))
  console.log(`DNDEVENTS: ${JSON.stringify(report)}`)
  console.log(`POSTS: ${JSON.stringify(posts)}`)
  console.log(`CONSOLE: ${JSON.stringify(logs.slice(0, 20))}`)
})
