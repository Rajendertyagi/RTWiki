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
 *
 * ## Why the menu is opened idempotently
 *
 * A caller may already have the panel open - a test that checks what the panel
 * contains leaves it open, and the next helper call inherits that state. The
 * trigger is a **toggle** (`setMoreOpen((v) => !v)` in `rich-toolbar.tsx`), not
 * an "open", so a blind `more.click()` there does not open the panel, it closes
 * it.
 *
 * A closed panel is not immediately gone. Mantine's `Popover` runs the dropdown
 * through a 150 ms fade on the way out (`transitionProps: { transition: 'fade',
 * duration: 150 }`, read in `node_modules/@mantine/core/esm/components/Popover/
 * Popover.mjs`; the exit path is `use-transition.mjs` and only unmounts once the
 * status reaches `exited`). For that window the panel is still in the DOM with
 * `opacity: 0`. Playwright's `visible` does not consider opacity, and its
 * stability check compares bounding boxes, which a fade never moves - so both
 * checks pass on a dying node and the click lands on it sometimes and not others.
 * That double outcome is the 1-in-4 shape this helper used to have.
 *
 * So: read `aria-expanded`, click only if it is not already `'true'`, and assert
 * it reached `'true'` before looking for the item. `aria-expanded` is always
 * present on the trigger (`PopoverTarget.mjs` sets it unconditionally, unlike
 * `aria-controls`, which is only there while open), so its absence cannot be
 * mistaken for "closed".
 *
 * Deliberately **not** `force: true`. That would drop the hit-target check,
 * which is exactly the check that notices a click aimed at a closing panel: it
 * would convert the flake into a click that sometimes hits nothing and passes
 * anyway. Nor is there a retry loop or a wait for a "stable node" - the node is
 * stable, and the problem is whether it is there at all.
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
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click()
  // The panel is up, not merely on its way out. Asserted rather than assumed,
  // because "it is closing" and "it is open" look identical to a `visible`
  // check and only differ to the user.
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const inMenu = page.getByTestId(testId)
  await inMenu.waitFor({ state: 'visible', timeout: 5_000 })
  await inMenu.click()
  // The menu closes itself when one of its controls is used, so wait for that to
  // settle. Without this, the next helper call can find the control in the DOM
  // during the dismissal and click it as it detaches.
  await expect(more).toHaveAttribute('aria-expanded', 'false')
}
