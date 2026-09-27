import { expect, type Page } from '@playwright/test'

/**
 * Clicks a toolbar control wherever it currently lives.
 *
 * The bar holds more controls than fit on one row, so the tail of it moves into a
 * trailing "more" menu. That is the designed behaviour, measured rather than
 * assumed: opening the menu shows the overflowed controls, still labelled.
 *
 * ## Why this helper exists
 *
 * Tests that look for every control with a bare `getByTestId` on the bar itself
 * fail whenever a new control widens the bar enough to push an existing one over
 * - and the failure reads as "the feature is missing" rather than "the control
 * moved". Adding the Document control did exactly that to `insert-image`.
 *
 * The assertion therefore stays about *what the control does*, not where it is
 * filed, which is the only arrangement that survives the next entry being added.
 */
export async function clickControl(page: Page, testId: string): Promise<void> {
  // Scope the on-bar lookup to the toolbar. An unscoped `getByTestId` also matches
  // a menu item that is portalled outside the toolbar - and, worse, matches one
  // that is still present while the menu animates closed. Both mistakes end in a
  // click on a detached element.
  const onBar = page.getByRole('toolbar').getByTestId(testId)
  if ((await onBar.count()) > 0) {
    await onBar.click()
    return
  }
  const more = page.getByTestId('toolbar-more')
  await more.click()
  const inMenu = page.getByTestId(testId)
  await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
  await inMenu.click()
  // The menu closes itself when one of its controls is used, so wait for that to
  // settle. Without this, the next helper call can find the control in the DOM
  // during the dismissal and click it as it detaches.
  await expect(more).toHaveAttribute('aria-expanded', 'false')
}
