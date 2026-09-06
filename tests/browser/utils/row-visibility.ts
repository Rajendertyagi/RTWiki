import type { Page } from '@playwright/test'

/**
 * Wait until a tree row materialises in the DOM, scrolling the virtualised
 * tree container progressively if needed.
 *
 * Wunderbaum renders only the rows that sit inside the viewport (plus a small
 * overscan). Rows outside never exist as DOM nodes, so a plain
 * `locator.waitFor()` hangs until the test-timeout. This helper scrolls the
 * tree container in large increments, yielding briefly after each step so the
 * virtualiser can attach the new rows, then retries until the target is found
 * or we have scrolled past the full document height.
 *
 * @param page       Playwright page handle.
 * @param pageId     UUID of the page row to wait for (null for subfile rows).
 * @param subfileField  If given, waits for a virtual HTML/CSS/JS subfile row
 *                      instead of a page row.
 * @param timeoutMs   Maximum total time to spend scrolling (default 20 s).
 */
export async function waitForRow(
  page: Page,
  pageId: string | null,
  subfileField?: string,
  timeoutMs = 20_000
): Promise<void> {
  const selector = subfileField
    ? `[role="treeitem"][data-subfile-id="${pageId}::${subfileField}"]`
    : `[role="treeitem"][data-page-id="${pageId}"]`
  const row = page.locator(selector)
  const tree = page.getByTestId('page-tree')

  // Fast path: row is already in the DOM.
  try {
    await row.waitFor({ timeout: Math.min(timeoutMs, 2000) })
    return
  } catch {
    // Not yet visible — need to scroll the tree container.
  }

  const start = Date.now()

  // Iterate: scroll the container in chunks, yielding one tick between chunks
  // so Wunderbaum's mutation observer can attach new rows.
  // Use a large step (3000px) to cover deep lists efficiently, and a longer
  // timeout since the shared database may contain hundreds of pages.
  while (Date.now() - start < timeoutMs) {
    // Scroll by 3000px per step — covers ~90 rows per step at 32px/row.
    try {
      await tree.evaluate((el: HTMLElement, dy: number) => {
        // Scroll the inner Wunderbaum viewport directly — it owns the
        // virtualisation and only responds to its own scroll events.
        const wb = el.querySelector('.wunderbaum') as HTMLElement | null
        if (wb) {
          wb.scrollTop += dy
        } else {
          // Fallback: scroll the container itself.
          el.scrollTop += dy
        }
      }, 3000)
    } catch {
      // Page may have been closed during reload — give up gracefully.
      return
    }
    // Yield three event-loop ticks: one for the browser to process the DOM
    // mutation, one for Playwright's assertion engine to settle, and one
    // extra buffer for the virtualiser to attach new rows.
    await page.waitForTimeout(200)

    try {
      await row.waitFor({ timeout: 1000 })
      return
    } catch {
      // Keep scrolling.
    }
  }

  // Final diagnostic: tell the user exactly what we found.
  const count = await row.count()
  const totalRows = await page.locator('[role="treeitem"][data-page-id]').count()
  const label = subfileField ? `subfile[${pageId}::${subfileField}]` : `page[${pageId}]`
  throw new Error(
    `Tree row ${label} did not materialize after ${timeoutMs} ms of scrolling. ` +
      `DOM row count = ${count}, total tree rows = ${totalRows}. ` +
      `The page may not exist, or the tree API returned no results.`
  )
}

/** Convenience wrapper for page rows. */
export async function scrollToPageRow(
  page: Page,
  pageId: string,
  timeoutMs = 20_000
): Promise<void> {
  await waitForRow(page, pageId, undefined, timeoutMs)
}

/** Convenience wrapper for virtual subfile rows. */
export async function scrollToSubfileRow(
  page: Page,
  pageId: string,
  field: string,
  timeoutMs = 20_000
): Promise<void> {
  await waitForRow(page, pageId, field, timeoutMs)
}
