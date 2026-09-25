import { expect, type Page, test } from '@playwright/test'

/**
 * Tab reordering, by pointer and by keyboard.
 *
 * These drive a real pointer. A colour or geometry assertion cannot tell
 * whether a drag works, and the row that had "no clickable area at all" passed
 * every such check in this project before it was found by hand.
 */

const TAB = '[role="tab"]'

async function openPages(
  request: import('@playwright/test').APIRequestContext,
  titles: string[]
): Promise<void> {
  for (const title of titles) {
    await request.post('/api/pages', { data: { title, pageType: 'rich', content: '' } })
  }
}

/** The visible tab titles, left to right. */
async function tabTitles(page: Page): Promise<string[]> {
  return page
    .locator(TAB)
    .evaluateAll((els) =>
      els.map((el) => (el.querySelector('span:nth-of-type(2)')?.textContent ?? '').trim())
    )
}

/** Tab order read from the DOM, which is what a person actually sees. */
async function tabOrder(page: Page): Promise<string[]> {
  return page
    .locator(TAB)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-page-id') ?? ''))
}

async function dragTabOver(page: Page, fromId: string, ontoId: string): Promise<void> {
  const handle = page.locator(`[data-testid="tab-drag-handle-${fromId}"]`)
  const target = page.locator(`[data-testid="tab-drag-handle-${ontoId}"]`)
  const a = (await handle.boundingBox())!
  const b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  // Move in steps: a single jump does not produce the intermediate pointer
  // moves the reorder logic listens for.
  const steps = 14
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      a.x + a.width / 2 + ((b.x - a.x + b.width / 2) * i) / steps,
      a.y + a.height / 2
    )
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await page.waitForTimeout(450)
}

test.describe('Tab reordering', () => {
  test('a tab can be dragged to a new position', async ({ page, request }) => {
    const stamp = Date.now()
    const titles = [`${stamp} One`, `${stamp} Two`, `${stamp} Three`]
    await openPages(request, titles)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })

    // Open all three so there is something to reorder.
    for (const title of titles) {
      await tree.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await page.waitForTimeout(350)
      const row = page.locator('[role="treeitem"]').filter({ hasText: title }).first()
      await row.scrollIntoViewIfNeeded().catch(() => {})
      await row.click()
      await page.waitForTimeout(700)
    }

    const before = await tabTitles(page)
    expect(before.length).toBe(3)

    // Drag the first tab past the third.
    const ids = await tabOrder(page)
    await dragTabOver(page, ids[0]!, ids[2]!)

    const after = await tabTitles(page)
    // eslint-disable-next-line no-console
    console.log('TABS ' + JSON.stringify({ before, after }))
    expect(after, 'the dragged tab must end up after the one it was dropped on').not.toEqual(before)
    expect(after.indexOf(before[0]!)).toBeGreaterThan(after.indexOf(before[2]!))
    // Nothing lost, nothing duplicated.
    expect([...after].sort()).toEqual([...before].sort())
  })

  test('the close button still closes, and does not start a drag', async ({ page, request }) => {
    const stamp = Date.now()
    await openPages(request, [`${stamp} Kept`, `${stamp} Dropped`])
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    for (const title of [`${stamp} Kept`, `${stamp} Dropped`]) {
      await tree.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await page.waitForTimeout(350)
      await page.locator('[role="treeitem"]').filter({ hasText: title }).first().click()
      await page.waitForTimeout(700)
    }
    expect(await tabTitles(page)).toHaveLength(2)

    // The × sits on top of the drag handle. If stacking were wrong this would
    // reorder rather than close.
    const before = await tabTitles(page)
    await page.locator(`${TAB}:has-text("Dropped") button`).click()
    await page.waitForTimeout(500)
    const after = await tabTitles(page)
    expect(after).toHaveLength(1)
    expect(after.join()).toContain('Kept')
    expect(after.join()).not.toContain('Dropped')
    // And no reordering happened as a side effect: the survivor is still first.
    expect(after).toEqual([before[0]!])
  })

  test('Ctrl+Arrow moves a tab and announces the new position', async ({ page, request }) => {
    const stamp = Date.now()
    const titles = [`${stamp} Alpha`, `${stamp} Bravo`, `${stamp} Charlie`]
    await openPages(request, titles)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    for (const title of titles) {
      await tree.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await page.waitForTimeout(350)
      await page.locator('[role="treeitem"]').filter({ hasText: title }).first().click()
      await page.waitForTimeout(700)
    }

    const before = await tabTitles(page)
    expect(before).toHaveLength(3)

    // Focus the first tab and move it right with the keyboard.
    await page.locator(TAB).first().focus()
    await page.keyboard.press('Control+ArrowRight')
    await page.waitForTimeout(400)

    const after = await tabTitles(page)
    // eslint-disable-next-line no-console
    console.log('TABS_KB ' + JSON.stringify({ before, after }))
    expect(after[1]).toBe(before[0])
    expect(after).toHaveLength(3)
    expect([...after].sort()).toEqual([...before].sort())

    // The live region must actually say where it went, or a screen-reader user
    // gets no confirmation at all.
    const announced =
      (await page.locator('[data-testid="tab-reorder-announcer"]').textContent()) ?? ''
    // eslint-disable-next-line no-console
    console.log('TABS_ANNOUNCEMENT ' + JSON.stringify(announced))
    expect(announced).toContain(before[0]!)
    expect(announced).toContain('position 2 of 3')

    // Focus must have travelled with the tab it moved.
    const focusedId = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el?.getAttribute('data-page-id') ?? null
    })
    const idsAfter = await tabOrder(page)
    // eslint-disable-next-line no-console
    console.log('TABS_FOCUS_FOLLOW ' + JSON.stringify({ focusedId, idsAfter }))
    expect(focusedId, 'focus must follow the moved tab').not.toBeNull()
    // The focused element is the one now sitting in the second slot.
    expect(idsAfter[1]).toBe(focusedId)
    expect(after[1]).toBe(before[0]!)
    expect(idsAfter.length).toBe(3)
  })

  test('Ctrl+Arrow stops at the ends instead of wrapping', async ({ page, request }) => {
    const stamp = Date.now()
    await openPages(request, [`${stamp} First`, `${stamp} Second`])
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    for (const title of [`${stamp} First`, `${stamp} Second`]) {
      await tree.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await page.waitForTimeout(350)
      await page.locator('[role="treeitem"]').filter({ hasText: title }).first().click()
      await page.waitForTimeout(700)
    }

    const before = await tabTitles(page)
    await page.locator(TAB).first().focus()
    await page.keyboard.press('Control+ArrowLeft')
    await page.waitForTimeout(350)
    // Wrapping would silently send the first tab to the end.
    expect(await tabTitles(page)).toEqual(before)
  })

  test('a bare arrow still switches tabs rather than moving them', async ({ page, request }) => {
    const stamp = Date.now()
    const titles = [`${stamp} One`, `${stamp} Two`]
    await openPages(request, titles)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    for (const title of titles) {
      await tree.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await page.waitForTimeout(350)
      await page.locator('[role="treeitem"]').filter({ hasText: title }).first().click()
      await page.waitForTimeout(700)
    }

    const before = await tabTitles(page)
    expect(before).toHaveLength(2)
    // The *last* page opened is the active tab, not the first. Activate the
    // first one explicitly, otherwise ArrowRight wraps back to it and the
    // assertion below would be checking the tab that was already selected.
    await page.locator(`${TAB}:has-text("${before[0]}")`).click()
    await page.waitForTimeout(350)
    expect(await page.locator(`${TAB}[aria-selected="true"]`).textContent()).toContain(before[0]!)

    await page.locator(`${TAB}[aria-selected="true"]`).focus()
    // Measured, not assumed: if focus never reached the tab, the keypress goes
    // somewhere else entirely and the assertion below would be testing nothing.
    const focusedTag = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return {
        tag: el?.tagName ?? null,
        role: el?.getAttribute('role') ?? null,
        isTab: el?.getAttribute('role') === 'tab'
      }
    })
    // eslint-disable-next-line no-console
    console.log('TABS_FOCUS ' + JSON.stringify(focusedTag))
    expect(focusedTag.isTab, 'focus must be on the tab for the keypress to mean anything').toBe(
      true
    )

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    // Selection moved, order did not.
    expect(await tabTitles(page)).toEqual(before)
    const selected = await page.locator(`${TAB}[aria-selected="true"]`).textContent()
    expect(selected).toContain(before[1]!)
  })

  test('the tab strip is still a valid ARIA tablist after the change', async ({
    page,
    request
  }) => {
    await openPages(request, [`${stampSafe()} ArIATab`])
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const tree = page.locator('[data-testid="page-tree"]')
    await expect(tree).toBeVisible({ timeout: 20_000 })
    await tree.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(400)
    await page.locator('[role="treeitem"]').filter({ hasText: `ArIATab` }).first().click()
    await expect(page.locator('[role="tablist"]')).toBeVisible({ timeout: 10_000 })

    const m = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]') as HTMLElement
      const tabs = Array.from(list.querySelectorAll('[role="tab"]')) as HTMLElement[]
      return {
        listLabel: list.getAttribute('aria-label'),
        count: tabs.length,
        selectedCount: tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length,
        focusableCount: tabs.filter((t) => t.getAttribute('tabindex') === '0').length,
        // Every tab must be focusable in the tab order exactly once.
        ids: tabs.map((t) => t.id),
        position: tabs[0] ? getComputedStyle(tabs[0]).position : null
      }
    })
    expect(m.count).toBeGreaterThan(0)
    expect(m.listLabel).toBeTruthy()
    expect(m.selectedCount, 'exactly one tab is selected').toBe(1)
    expect(m.focusableCount, 'roving tabindex: exactly one tab in the tab order').toBe(1)
    expect(new Set(m.ids).size, 'tab ids must be unique').toBe(m.count)
    // The drag raises the tab with z-index, which needs a positioned element.
    expect(['relative', 'absolute']).toContain(m.position)
  })
})

function stampSafe(): string {
  return `ArIA${Date.now()}`
}
