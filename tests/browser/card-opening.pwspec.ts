import { expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * Dashboard card opening must work across the whole visible card surface,
 * not only through the hidden ghost button's accessible name.
 *
 * Reproduction-first: these tests use physical pointer coordinates over the
 * rendered card (title, centre, lower corners) exactly like a real user.
 */

const editorRoot = '[data-testid="rich-editor"]'

function uniqueTitle(base: string): string {
  return `${base} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`
}

async function createNoteViaDialog(page: Page, title: string): Promise<void> {
  await page.locator('[aria-label="New page"]').first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByRole('button', { name: /create/i }).click()
}

function cardLocator(page: Page, title: string) {
  return page.locator('.mantine-Card-root').filter({ hasText: title })
}

test.describe('Dashboard card opening', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })
  const points: Array<{ label: string; fx: number; fy: number }> = [
    { label: 'title area', fx: 0.3, fy: 0.12 },
    { label: 'centre', fx: 0.5, fy: 0.5 },
    { label: 'lower-left', fx: 0.08, fy: 0.92 },
    { label: 'lower-right', fx: 0.92, fy: 0.92 }
  ]

  for (const point of points) {
    test(`clicking the ${point.label} of a card opens the page`, async ({ page }) => {
      const title = uniqueTitle('Coord')
      await page.goto('/')
      await createNoteViaDialog(page, title)
      await page.getByRole('button', { name: 'Home' }).click()

      const card = await cardLocator(page, title).boundingBox()
      expect(card, 'card should be visible on the dashboard').not.toBeNull()
      if (!card) return

      await page.mouse.click(card.x + card.width * point.fx, card.y + card.height * point.fy)

      await expect(page.locator(editorRoot)).toBeVisible()
      await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
  }

  test('the card menu does not open the page and closes without side effects', async ({ page }) => {
    const title = uniqueTitle('MenuOnly')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await page.getByRole('button', { name: 'Home' }).click()

    cardLocator(page, title).getByLabel(`Actions for ${title}`).click()
    // Menu open: duplicate/delete visible in the portal dropdown.
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toHaveCount(0)

    // Still on the dashboard: the page did not open.
    await expect(cardLocator(page, title)).toBeVisible()
    await expect(page.locator(editorRoot)).toHaveCount(0)
  })

  test('keyboard Enter on a focused card opens the page', async ({ page }) => {
    const title = uniqueTitle('KbdCard')
    await page.goto('/')
    await createNoteViaDialog(page, title)
    await page.getByRole('button', { name: 'Home' }).click()

    // Focus the card's open control directly and activate it.
    await page.getByRole('button', { name: `Open ${title}` }).focus()
    await page.keyboard.press('Enter')

    await expect(page.locator(editorRoot)).toBeVisible()
    await expectTabActive(page, title)
  })

  async function expectTabActive(page: Page, title: string): Promise<void> {
    await expect(page.getByRole('tab', { name: new RegExp(title) })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  }
})
