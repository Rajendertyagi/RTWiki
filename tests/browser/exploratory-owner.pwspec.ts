import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { resetDatabase } from './helpers/hit-target.js'

/**
 * Deterministic exploratory owner simulation.
 *
 * A seeded PRNG drives a bounded action model over the real UI. After EVERY
 * action a battery of invariants is asserted; on failure the seed and the
 * full action history are reported so any run is exactly reproducible.
 *
 * Server restarts are intentionally NOT part of the action model: Playwright
 * owns the server process via its webServer supervisor and killing it would
 * poison every later test in the worker. Restart persistence is covered by
 * the owner-journeys suite through the app's shutdown endpoint.
 */

const SEEDS = [20260826, 424242, 8675309]

// Module-level so the test body can swap in the seeded PRNG each run.
let pickRng: () => number = Math.random
const ACTIONS_PER_SEED = 75

// ---------- seeded PRNG (mulberry32) ----------

function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface ActionContext {
  page: Page
  request: APIRequestContext
  seq: () => number
  createdTitles: string[]
}

type Action = {
  name: string
  run: (ctx: ActionContext) => Promise<void>
}

function buildActions(): Action[] {
  const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]

  const createPage = async (
    ctx: ActionContext,
    type: 'Rich Note' | 'HTML Page' | 'Diagram' | 'Mind map'
  ): Promise<void> => {
    const title = `Ex${ctx.seq()}`
    ctx.createdTitles.push(title)
    await ctx.page.locator('[aria-label="New page"]').first().click()
    const dialog = ctx.page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    if (type !== 'Rich Note') {
      await dialog.getByLabel(type, { exact: true }).check()
    }
    await dialog.getByRole('button', { name: /create/i }).click()
    await expect(
      ctx.page
        .getByTestId('rich-editor')
        .or(ctx.page.getByTestId('html-preview-view'))
        .or(ctx.page.getByTestId('diagram-workspace'))
        .or(ctx.page.getByTestId('mindmap-workspace'))
    ).toBeVisible({ timeout: 20_000 })
  }

  return [
    { name: 'create-rich', run: (c) => createPage(c, 'Rich Note') },
    { name: 'create-html', run: (c) => createPage(c, 'HTML Page') },
    { name: 'create-diagram', run: (c) => createPage(c, 'Diagram') },
    { name: 'create-mindmap', run: (c) => createPage(c, 'Mind map') },
    {
      name: 'open-random-card',
      run: async (c) => {
        await c.page.locator('[aria-label="Home"]').click()
        await expect(c.page.getByRole('heading', { name: 'Pages' })).toBeVisible()
        const cards = c.page.getByRole('button', { name: /^Open / })
        const count = await cards.count()
        if (count === 0) return
        await cards.nth(Math.floor(pickRng() * count)).click()
        await expect(c.page.locator('.mantine-AppShell-main')).toBeVisible()
      }
    },
    {
      name: 'type-text',
      run: async (c) => {
        const editor = c.page.locator('.bn-editor')
        if ((await editor.count()) === 0) return
        await editor.click()
        await c.page.keyboard.type(`note ${Math.floor(pickRng() * 1000)}`)
      }
    },
    {
      name: 'press-enter',
      run: async (c) => {
        const editor = c.page.locator('.bn-editor')
        if ((await editor.count()) === 0) return
        await editor.click()
        await c.page.keyboard.press('Control+End')
        await c.page.keyboard.press('Enter')
      }
    },
    {
      name: 'apply-bold',
      run: async (c) => {
        const editor = c.page.locator('.bn-editor')
        if ((await editor.count()) === 0) return
        await editor.click()
        await c.page.keyboard.press('Home')
        await c.page.keyboard.press('Shift+End')
        const bold = c.page.getByRole('toolbar').getByRole('button', { name: 'Bold', exact: true })
        if ((await bold.count()) > 0) await bold.click()
      }
    },
    {
      name: 'insert-block',
      run: async (c) => {
        const btn = c.page.getByTestId(
          pick(pickRng, ['insert-formula', 'insert-callout-info', 'insert-quote'] as const)
        )
        if ((await btn.count()) > 0) await btn.click()
      }
    },
    {
      name: 'toggle-right-sidebar',
      run: async (c) => {
        const collapse = c.page.getByRole('button', { name: /collapse/i }).last()
        if ((await collapse.count()) > 0) await collapse.click().catch(() => {})
      }
    },
    {
      name: 'switch-html-field',
      run: async (c) => {
        const sub = c.page.locator('[data-subfile-id]')
        const count = await sub.count()
        if (count === 0) return
        await sub.nth(Math.floor(pickRng() * count)).click()
        await expect(c.page.locator('.mantine-AppShell-main')).toBeVisible()
      }
    },
    {
      name: 'return-to-preview',
      run: async (c) => {
        const btn = c.page.getByTestId('return-to-preview-button')
        if ((await btn.count()) > 0) await btn.click()
        await expect(c.page.locator('.mantine-AppShell-main')).toBeVisible()
      }
    },
    {
      name: 'open-close-ctrl-k',
      run: async (c) => {
        await c.page.keyboard.press('Control+k')
        await expect(c.page.getByTestId('quick-finder-input')).toBeVisible()
        await c.page.keyboard.press('Escape')
        await expect(c.page.getByTestId('quick-finder-input')).toHaveCount(0)
      }
    },
    {
      name: 'reload',
      run: async (c) => {
        await c.page.reload()
        await expect(c.page.locator('.mantine-AppShell-main')).toBeVisible({ timeout: 20_000 })
      }
    },
    {
      name: 'go-home',
      run: async (c) => {
        await c.page.locator('[aria-label="Home"]').click()
        await expect(c.page.getByRole('heading', { name: 'Pages' })).toBeVisible()
      }
    },
    {
      name: 'rename-active-page',
      run: async (c) => {
        const input = c.page.locator('input[aria-label="Title"]')
        if ((await input.count()) === 0) return
        const value = await input.inputValue()
        if (!value) return
        await input.fill(`${value} r${Math.floor(pickRng() * 100)}`)
        await input.blur()
      }
    },
    {
      name: 'toggle-theme',
      run: async (c) => {
        await c.page.getByRole('button', { name: 'Theme', exact: true }).click()
        await expect(c.page.locator('html[data-mantine-color-scheme]')).toHaveCount(1)
      }
    }
  ]
}

test.describe('deterministic exploratory owner', () => {
  let consoleErrors: string[] = []
  let failedRequests: string[] = []
  let pageErrors: Error[] = []

  for (const seed of SEEDS) {
    test(`seed ${seed}: ${ACTIONS_PER_SEED} bounded actions with invariants`, async ({
      page,
      request
    }) => {
      test.setTimeout(240_000)
      await resetDatabase(request)

      consoleErrors = []
      failedRequests = []
      pageErrors = []
      page.on('pageerror', (err) => pageErrors.push(err))
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })
      page.on('response', (res) => {
        if (res.url().includes('/api/') && res.status() >= 400) {
          failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`)
        }
      })

      const rng = makeRng(seed)
      pickRng = rng
      const actions = buildActions()
      const history: string[] = []
      let counter = 0

      // Seed state: three pages so navigation actions always have targets.
      for (const t of ['Exploratory One', 'Exploratory Two', 'Exploratory Three']) {
        await request.post('/api/pages', {
          data: {
            title: t,
            pageType: 'rich',
            content: JSON.stringify([{ id: 'p', type: 'paragraph' }])
          }
        })
      }
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible()

      const ctx: ActionContext = {
        page,
        request,
        seq: () => ++counter,
        createdTitles: []
      }

      for (let step = 1; step <= ACTIONS_PER_SEED; step += 1) {
        const action = actions[Math.floor(rng() * actions.length)]
        history.push(`#${step} ${action.name}`)
        try {
          await action.run(ctx)
        } catch (err) {
          throw new Error(
            `Exploratory failure.\nSEED=${seed}\nSTEP=${step}\nACTION=${action.name}\nHISTORY:\n${history.join('\n')}`,
            { cause: err }
          )
        }
        await assertInvariants(page, request, `${seed}/${step}/${action.name}`)
      }

      // Final persistence sweep.
      const res = await request.get('/api/pages?limit=100')
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { pages: Array<{ id: string }> }
      expect(body.pages.length).toBeGreaterThan(0)
    })
  }

  async function assertInvariants(
    page: Page,
    request: APIRequestContext,
    where: string
  ): Promise<void> {
    const fail = (msg: string): never => {
      throw new Error(`INVARIANT [${where}] ${msg}`)
    }
    if (pageErrors.length > 0) fail(`uncaught page error: ${pageErrors[0]?.message}`)
    if (consoleErrors.length > 0) fail(`console error: ${consoleErrors[0]}`)
    if (failedRequests.length > 0) fail(`failed API request: ${failedRequests[0]}`)

    // Zero or one selected tree row.
    const selected = await page.locator('[role="treeitem"][aria-selected="true"]').count()
    if (selected > 1) fail(`${selected} tree rows selected`)

    // Active tab corresponds to the open page title (when a workspace is open).
    // Scope to the editor header input (placeholder 'Page title'); the New
    // Page dialog's title field can still be mounted mid-transition.
    const titleInput = page.locator('input[aria-label="Title"][placeholder="Page title"]')
    if ((await titleInput.count()) > 0 && (await titleInput.isVisible())) {
      const activeTitle = await titleInput.inputValue()
      const tabs = page.locator(
        '[role="tab"][aria-selected="true"], [role="tab"][data-active="true"]'
      )
      if ((await tabs.count()) === 1) {
        const tabText = (await tabs.first().textContent()) ?? ''
        if (activeTitle && tabText && !tabText.startsWith(activeTitle.slice(0, 8))) {
          fail(`active tab "${tabText}" does not match open page "${activeTitle}"`)
        }
      }
    }

    // No lingering BLOCKING modal overlay. Mantine keeps the overlay node
    // mounted during its exit transition, so tolerate non-interactive ones
    // and give the transition up to a second to finish.
    const blocking = async (): Promise<number> =>
      page.evaluate(() => {
        const els = document.querySelectorAll('.mantine-Modal-overlay, .mantine-Overlay-root')
        return Array.from(els).filter((el) => {
          const style = window.getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          if (style.pointerEvents === 'none') return false
          return true
        }).length
      })
    if ((await blocking()) > 0) {
      await page.waitForTimeout(1000)
    }
    const overlaysLeft = await blocking()
    if (overlaysLeft > 0) fail(`${overlaysLeft} blocking modal overlay(s) still mounted`)

    // Main workspace keeps positive visible dimensions.
    const mainBox = await page.locator('.mantine-AppShell-main').boundingBox()
    if (!mainBox || mainBox.width <= 0 || mainBox.height <= 0) {
      fail('main workspace has non-positive dimensions')
    }

    // Duplicate tab titles would indicate duplicated tabs for one page.
    const tabTitles = await page.locator('[role="tab"]').allTextContents()
    const dupes = tabTitles.filter((t, i) => t.length > 0 && tabTitles.indexOf(t) !== i)
    if (dupes.length > 0) fail(`duplicate tabs: ${dupes.join(', ')}`)

    // Saved content remains fetchable and parseable.
    const res = await request.get('/api/pages?limit=1')
    if (res.status() !== 200) fail(`pages list status ${res.status()}`)
    const body = (await res.json()) as unknown
    if (typeof body !== 'object' || body === null || !('pages' in body)) {
      fail('pages list envelope malformed')
    }
  }
})
