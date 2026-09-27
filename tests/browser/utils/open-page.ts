import { expect, type Page } from '@playwright/test'

/**
 * Opens a page through the Ctrl+K finder instead of by clicking its sidebar row.
 *
 * ## Why not click the tree row
 *
 * The sidebar tree is a *virtual scrolling* tree: only the rows near the viewport
 * exist in the DOM. The whole browser suite shares one long-lived database, and a
 * full run accumulates well over a thousand pages, so a page seeded by an early
 * test ends up a thousand rows down and its row is never rendered. A locator for
 * that row matches nothing and the click times out — which is how two long-standing
 * "data loss" failures were actually caused. Nothing was being lost; the row simply
 * was not on screen.
 *
 * The finder searches the loaded page collection, so it finds a page at any size.
 *
 * ## Why click the option rather than press Enter
 *
 * Enter opens whichever row is highlighted, and the first group is *Recent*. If the
 * page being opened was opened recently it can be row 0, but so can an unrelated
 * page, and the two are not distinguished by position. Clicking the option whose
 * text is exactly the wanted title removes the guess entirely.
 */
export async function openPageViaFinder(page: Page, title: string, pageId?: string): Promise<void> {
  // The finder is a modal, so if a previous step left it open the hotkey would
  // target a page behind it. Close it first rather than assume.
  const input = page.getByTestId('quick-finder-input')
  if (await input.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
  }

  await page.keyboard.press('Control+k')
  await expect(input).toBeVisible()

  await input.fill(title)

  // Prefer the id: it is unambiguous even if two pages ever share a title.
  const option = pageId
    ? page.getByTestId(`quick-finder-option-${pageId}`)
    : page.getByRole('option', { name: title, exact: true })

  await expect(option, `the finder must offer "${title}" as an option`).toBeVisible({
    // Title matching filters the page collection the app has already loaded, and
    // loading it is a walk of 50-row batches. On a large database that can still
    // be in flight when the finder opens, so this waits for the data rather than
    // racing it.
    timeout: 15_000
  })
  await option.click()

  // Clicking closes the modal; assert it rather than sleep, so a failure here says
  // the navigation did not happen instead of surfacing later as a missing element.
  await expect(input).toHaveCount(0)
}
