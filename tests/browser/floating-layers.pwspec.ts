import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Floating layers — menus, popovers, dialogs, tooltips and the toast — must all
 * share one shadow recipe rather than each relying on a library default.
 *
 * The recipe is layered rather than a single blur, and the layers are what make
 * it read as "floating": a highlight along the top edge, a hairline inner rim, a
 * solid outer ring that separates it from whatever is behind it, then three
 * progressively larger and softer drops. In dark mode the top highlight is a
 * translucent white, because a shadow alone is almost invisible on a dark
 * surface.
 */

const MENU_TRIGGER = '[data-testid="editor-actions"]'

let seq = 0
function uniqueTitle(base: string): string {
  seq += 1
  return `${base} ${Date.now()}-${seq}`
}

async function openRichPage(page: Page, request: APIRequestContext, title: string): Promise<void> {
  const res = await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  expect(res.status()).toBe(201)
  const body = (await res.json()) as { page?: { id: string }; id?: string }
  await page.goto(`/?page=${body.page?.id ?? body.id}`)
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(400)
}

/** Counts the comma-separated layers of a computed box-shadow. */
function layerCount(boxShadow: string): number {
  if (!boxShadow || boxShadow === 'none') return 0
  // rgb()/rgba()/hsl() values may themselves contain commas, so split on commas
  // that are not inside parentheses.
  let depth = 0
  let layers = 1
  for (const ch of boxShadow) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) layers += 1
  }
  return layers
}

test.describe('floating layers share one depth recipe', () => {
  test.beforeEach(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('an open menu uses the layered floating shadow', async ({ page, request }) => {
    await openRichPage(page, request, uniqueTitle('Floating'))
    await expect(page.locator(MENU_TRIGGER)).toBeVisible()
    await page.locator(MENU_TRIGGER).click()
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 })

    const shadow = await page.getByRole('menu').evaluate((el) => getComputedStyle(el).boxShadow)

    // A single-layer shadow is the library default and is not the recipe.
    expect(layerCount(shadow), `menu box-shadow was: ${shadow}`).toBeGreaterThanOrEqual(3)
  })
})
