import { expect, test } from '@playwright/test'

/**
 * The save indicator must tell the truth.
 *
 * Autosave is debounced, so between an edit and the save there is a window where
 * the work exists only in memory. The status bar reporting "Saved" during that
 * window is the one thing a save indicator must never do, and it did: the
 * mapping from the autosave lifecycle to the displayed state existed in three
 * copies, of which two folded "dirty" into "clean". A Rich Note and a Markdown
 * page both claimed to be saved while the edit was pending. Only the HTML editor
 * was correct, and the tests asserted against the copy that happened to be right.
 *
 * This spec covers all three page types, because that divergence is the defect.
 */

const STATUS = '[data-testid="workspace-status-bar"]'

type Editable = { page: import('@playwright/test').Page; target: string; typeText: string }

/** Opens a page of the given type and returns how to type into it. */
async function openEditable(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  pageType: 'rich' | 'markdown' | 'html'
): Promise<Editable> {
  const title = `SaveInd${pageType}${Date.now()}`
  await request.post('/api/pages', { data: { title, pageType, content: '' } })
  await page.goto('/')
  await page.locator('nav[aria-label="RTWiki"] button[aria-label="Home"]').click()
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()

  if (pageType === 'rich') {
    await expect(page.locator('.bn-editor')).toBeVisible()
    return { page, target: '.bn-editor', typeText: 'truth probe' }
  }
  if (pageType === 'markdown') {
    // The Markdown workspace is a mode switch plus a CodeMirror pane; the pane
    // is only mounted in edit mode, so the Edit control has to be pressed first.
    await expect(page.getByTestId('markdown-workspace')).toBeVisible()
    await page.getByTestId('markdown-edit-button').click()
    await expect(page.locator('[data-testid="markdown-workspace"] .cm-content')).toBeVisible()
    return {
      page,
      target: '[data-testid="markdown-workspace"] .cm-content',
      typeText: 'truth probe'
    }
  }
  // An HTML page opens on its rendered preview. The editable source lives behind
  // the source view, reached through the subfile row in the tree.
  await expect(page.getByTestId('html-preview-view')).toBeVisible()
  const tree = page.getByTestId('page-tree')
  const row = page.locator(`[role="treeitem"][data-subfile-id$="::html"]`)
  if ((await row.count()) === 0) {
    const parent = page.locator('[role="treeitem"]').filter({ hasText: title }).first()
    const expand = parent.locator('[aria-label="Expand"]')
    if ((await expand.count()) > 0) await expand.click()
    await page.waitForTimeout(400)
  }
  await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(300)
  await page.locator(`[role="treeitem"][data-subfile-id$="::html"]`).click()
  await expect(page.getByTestId('html-source-view')).toBeVisible()
  await expect(page.locator('[data-testid="code-editor-html"] .cm-content')).toBeVisible()
  return { page, target: '[data-testid="code-editor-html"] .cm-content', typeText: 'truth probe' }
}

for (const pageType of ['rich', 'markdown', 'html'] as const) {
  test(`the status bar says "Unsaved changes" while a ${pageType} edit awaits its save`, async ({
    page,
    request
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const { page: p, target, typeText } = await openEditable(page, request, pageType)

    // Clean on open.
    await expect(p.getByTestId('workspace-status-bar')).toContainText('Saved')

    await p.locator(target).click()
    await p.keyboard.type(typeText)

    // The debounce window: the edit is in memory and no save has run. The bar
    // must say so. This is the assertion that failed for Rich Note and Markdown.
    await expect(p.getByTestId('workspace-status-bar')).toContainText('Unsaved changes', {
      timeout: 2_000
    })

    // Then it settles, and the work is actually written.
    await expect(p.getByTestId('workspace-status-bar')).toContainText('Saved', {
      timeout: 10_000
    })
    await expect(p.getByTestId('workspace-status-bar')).not.toContainText('Unsaved changes')
  })
}

test('the unsaved window survives a slow save rather than being skipped', async ({
  page,
  request
}) => {
  // Guards the assertion above against passing for the wrong reason. If the save
  // were instant the "Unsaved changes" check could be satisfied by luck, so the
  // indicator is sampled repeatedly *inside* the debounce window and must be
  // pending every time, never "Saved".
  await page.setViewportSize({ width: 1280, height: 800 })
  const { page: p, target } = await openEditable(page, request, 'rich')
  await p.locator(target).click()
  await p.keyboard.type('window probe')

  const bar = p.getByTestId('workspace-status-bar')
  const seen: string[] = []
  for (let i = 0; i < 4; i += 1) {
    seen.push(((await bar.textContent()) ?? '').replace(/\s+/g, ' ').trim())
    await p.waitForTimeout(250)
  }
  // eslint-disable-next-line no-console
  console.log('SAVEWINDOW ' + JSON.stringify(seen))
  // Every sample is inside the 2000ms debounce, so every one must be pending.
  for (const sample of seen) {
    expect(sample, `sampled inside the debounce window: ${sample}`).toContain('Unsaved changes')
    expect(sample).not.toContain('Saved')
  }
})
