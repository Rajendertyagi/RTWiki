import { type APIRequestContext, expect, test } from '@playwright/test'

/**
 * Accumulated long session: many pages, deep hierarchy, many tabs, mixed
 * types, backlinks, rename/delete/duplicate churn, browser reload and
 * server restart — guarding against defects that only appear once the
 * shared database contains a lot of state.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${titleSeq}`
}

async function seed(
  request: APIRequestContext,
  title: string,
  pageType: 'rich' | 'html' | 'diagram' | 'mindmap',
  parentId?: string
): Promise<{ id: string }> {
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType,
      parentId,
      content:
        pageType === 'html'
          ? JSON.stringify({
              version: 2,
              html: '<p>long</p>',
              css: '',
              javascript: '',
              jsEnabled: false
            })
          : pageType === 'rich'
            ? JSON.stringify([
                {
                  id: 'p',
                  type: 'paragraph',
                  content: [{ type: 'text', text: `body of ${title}`, styles: {} }]
                }
              ])
            : ''
    }
  })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page: { id: string } }
  return body.page
}

test.describe('long accumulated session', () => {
  test('60+ pages, hierarchy, tabs, churn, reload and restart persist', async ({
    page,
    request
  }) => {
    test.setTimeout(240_000)

    // --- Seed scale -------------------------------------------------------
    const subjects: Array<{ id: string; title: string }> = []
    for (let s = 0; s < 4; s++) {
      const subjectTitle = uniqueTitle(`Subject ${s}`)
      const subject = await seed(request, subjectTitle, 'rich')
      subjects.push({ id: subject.id, title: subjectTitle })
      // Chapters under each subject (hierarchy level 2).
      for (let c = 0; c < 4; c++) {
        const chapter = await seed(request, uniqueTitle(`Ch ${s}-${c}`), 'rich', subject.id)
        // A diagram and a mind map leaf under the first chapter of each subject.
        if (c === 0) {
          await seed(request, uniqueTitle(`Dgm ${s}`), 'diagram', chapter.id)
          await seed(request, uniqueTitle(`Map ${s}`), 'mindmap', chapter.id)
        }
      }
    }
    // Flat filler pages to push past 60 total.
    for (let i = 0; i < 40; i++) {
      await seed(request, uniqueTitle(`Filler ${i}`), 'rich')
    }
    // One HTML page.
    const htmlTitle = uniqueTitle('Long HTML')
    await seed(request, htmlTitle, 'html')

    const list = await request.get('/api/pages?limit=100')
    const body = (await list.json()) as {
      pages: Array<{ id: string; title: string }>
      total: number
    }
    expect(body.total).toBeGreaterThanOrEqual(60)

    // --- Backlinks between subjects --------------------------------------
    const first = subjects[0]
    const second = subjects[1]
    await request.patch(`/api/pages/${second.id}`, {
      data: {
        content: JSON.stringify([
          {
            id: 'p',
            type: 'paragraph',
            content: [
              { type: 'text', text: 'related ', styles: {} },
              {
                type: 'link',
                href: `#/page/${first.id}`,
                content: [{ type: 'text', text: first.title, styles: {} }]
              }
            ]
          }
        ])
      }
    })
    const bl = await request.get(`/api/pages/${first.id}/backlinks`)
    const blBody = (await bl.json()) as { backlinks: Array<{ id: string }> }
    expect(blBody.backlinks.some((b) => b.id === second.id)).toBe(true)

    // --- Open tabs through real navigation ---------------------------------
    await page.goto('/')
    // Open a mix by title via Home + card to accumulate distinct tabs.
    const titlesToOpen = [...subjects.map((s) => s.title), htmlTitle]
    for (const t of titlesToOpen) {
      await page.locator('[aria-label="Home"]').click()
      await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()
      const card = page.getByRole('button', { name: `Open ${t}`, exact: true })
      await card.waitFor({ state: 'visible', timeout: 20_000 })
      await card.click()
    }
    const tabCount = await page.locator('[role="tab"]').count()
    expect(tabCount).toBeGreaterThanOrEqual(5)

    // --- Churn: rename / duplicate / delete -------------------------------
    const dupRes = await request.post(`/api/pages/${subjects[2].id}/duplicate`)
    expect(dupRes.status()).toBe(201)
    await request.patch(`/api/pages/${subjects[3].id}`, {
      data: { title: uniqueTitle('Renamed Subject') }
    })
    const filler = body.pages.find((p) => p.title.includes('Filler 0'))
    if (filler) {
      await request.delete(`/api/pages/${filler.id}`)
    }

    // --- Browser reload ----------------------------------------------------
    await page.reload()
    await expect(page.locator('.mantine-AppShell-main')).toBeVisible()

    // --- Server restart via the app's own shutdown endpoint ---------------
    const tokenRes = await page.request.get('/api/shutdown/token')
    expect(tokenRes.status()).toBe(200)
    const { token } = (await tokenRes.json()) as { token: string }
    await page.request.post('/api/shutdown', {
      headers: { 'x-rtwiki-shutdown-token': token }
    })
    let healthy = false
    for (let i = 0; i < 60 && !healthy; i++) {
      await page.waitForTimeout(500)
      try {
        healthy = (await page.request.get('/health')).ok()
      } catch {
        healthy = false
      }
    }
    expect(healthy, 'server should recover after restart').toBe(true)

    // --- Final persistence verification -----------------------------------
    const after = await request.get('/api/pages?limit=100')
    const afterBody = (await after.json()) as {
      pages: Array<{ id: string; title: string }>
      total: number
    }
    expect(afterBody.total).toBeGreaterThanOrEqual(59) // one filler deleted
    expect(afterBody.pages.some((p) => p.title.startsWith('Renamed Subject'))).toBe(true)
    expect(afterBody.pages.some((p) => p.title.includes('Filler 0'))).toBe(false)
    // Backlink survived the restart.
    const blAfter = await request.get(`/api/pages/${first.id}/backlinks`)
    const blAfterBody = (await blAfter.json()) as { backlinks: Array<{ id: string }> }
    expect(blAfterBody.backlinks.some((b) => b.id === second.id)).toBe(true)
  })
})
