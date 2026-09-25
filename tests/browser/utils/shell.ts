import type { Locator, Page } from '@playwright/test'

/**
 * Shared locators for the app shell.
 *
 * These exist because a bare attribute selector is not unique any more. The
 * status bar carries its own Home control (`data-testid="status-home"`), so
 * `page.locator('[aria-label="Home"]')` matches two elements and every test
 * using it dies on a strict-mode violation. The rail is the canonical way home,
 * so that is what these point at.
 */

/** The utility rail's navigation landmark. */
export function railNav(page: Page): Locator {
  return page.locator('nav[aria-label="RTWiki"]')
}

/** The rail's Home button — the canonical way back to the dashboard. */
export function railHome(page: Page): Locator {
  return railNav(page).locator('button[aria-label="Home"]')
}

/** The rail's Settings button. */
export function railSettings(page: Page): Locator {
  return railNav(page).locator('button[aria-label="Settings"]')
}

/** The status bar's Home control. Distinct from the rail's on purpose. */
export function statusHome(page: Page): Locator {
  return page.getByTestId('status-home')
}

/**
 * Navigate to the dashboard by clicking the rail's Home button, then wait for
 * the dashboard to actually be showing.
 *
 * Session restoration can reopen the last workspace directly, so tests that
 * assume a card on the dashboard must go Home first rather than assume it.
 */
export async function goHome(page: Page): Promise<void> {
  await railHome(page).click()
  // The heading element varies with the layout, so match the text rather than
  // a role.
  await expectDashboard(page)
}

/** Waits for the dashboard to be visible, without navigating to it. */
export async function expectDashboard(page: Page): Promise<void> {
  await page.getByText('Pages', { exact: true }).first().waitFor({ state: 'visible' })
}
