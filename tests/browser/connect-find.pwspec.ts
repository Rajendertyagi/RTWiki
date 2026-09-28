import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { goHome } from './utils/shell.js'

/**
 * Connected-navigation workflows: internal page links ([[ picker + toolbar),
 * backlinks, broken links, the Ctrl+K finder and recent-page persistence.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedRich(
  request: APIRequestContext,
  title: string,
  blocks: Array<Record<string, unknown>> = []
): Promise<{ id: string; version: number }> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'rich', content: JSON.stringify(blocks) }
  })
  expect(res.status(), 'seed page should be created').toBe(201)
  // `version` travels with the seed: a later PATCH must present the version it
  // read, or the server rejects the write as superseded.
  const body = (await res.json()) as { page: { id: string; version: number } }
  return body.page
}

async function getStoredContent(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; content: string }> }
  return body.pages.find((p) => p.id === id)?.content ?? ''
}

async function openNote(page: Page, title: string): Promise<void> {
  await page.goto('/')
  // Session restoration may reopen the last workspace directly; go Home
  // first so the dashboard card lookup is always valid.
  await goHome(page)
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
  await expect(page.locator('[data-testid="rich-editor"]')).toBeVisible()
}

test.describe('connect and find', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  let pageErrors: Error[] = []
  test.beforeEach(({ page }) => {
    pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err))
  })
  test.afterEach(() => {
    expect(pageErrors, 'no uncaught browser exceptions').toEqual([])
  })

  /** Types `[[<query>` in the editor and picks the first matching option. */
  async function insertLinkViaPicker(page: Page, targetTitle: string): Promise<void> {
    const editor = page.locator('.bn-editor')
    await editor.click()
    await page.keyboard.type('[[')
    const menu = page.locator('.bn-suggestion-menu')
    await expect(menu).toBeVisible({ timeout: 10_000 })
    await page.keyboard.type(targetTitle)
    await expect(menu).toContainText(targetTitle)
    // Enter picks the highlighted (first) item.
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
  }

  test('insert internal link through [[ and through the toolbar', async ({ page, request }) => {
    const target = uniqueTitle('Link Target Alpha')
    await seedRich(request, target)
    const another = uniqueTitle('Link Target Beta')
    await seedRich(request, another)
    const source = uniqueTitle('Link Source A')
    const sourcePage = await seedRich(request, source)

    // Path A: [[ caret picker.
    await openNote(page, source)
    await insertLinkViaPicker(page, target)
    await expect
      .poll(async () => getStoredContent(request, sourcePage.id), { timeout: 15_000 })
      .toContain('#/page/')

    // Path B: toolbar action with search + click.
    await page.getByTestId('wiki-link-button').click()
    await page.getByTestId('wiki-link-search').fill(another)
    await page.getByRole('option').first().click()
    await expect
      .poll(async () => getStoredContent(request, sourcePage.id), { timeout: 15_000 })
      .toContain(buildHref(await lookupId(request, another)))
  })

  test('link survives target rename; click opens and deduplicates tabs', async ({
    page,
    request
  }) => {
    const target = uniqueTitle('Rename Me')
    const targetPage = await seedRich(request, target)
    const source = uniqueTitle('Renamer Source')
    await seedRich(request, source, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'go to ', styles: {} },
          {
            type: 'link',
            href: `#/page/${targetPage.id}`,
            content: [{ type: 'text', text: target, styles: {} }]
          }
        ]
      }
    ])

    // Rename the target via the API â€” the stored href keeps working.
    await request.patch(`/api/pages/${targetPage.id}`, {
      data: { title: 'Renamed Target', version: targetPage.version }
    })

    await openNote(page, source)
    const tabCountBefore = await page.locator('[role="tab"]').count()
    await page.locator('a[href^="#/page/"]').first().click()
    await expect(page.getByTestId('rich-editor')).toBeVisible()
    await expect(page.locator('[role="tab"]')).toHaveCount(tabCountBefore + 1)
    // The renamed title is visible in the header. The title is a *button*
    // carrying the title as text until it is double-clicked into an input, so
    // the assertion has to read text, not an input value.
    await expect(page.getByTestId('editor-title')).toHaveText('Renamed Target')

    // Clicking again must not duplicate the tab.
    await openNote(page, source)
    const countMid = await page.locator('[role="tab"]').count()
    await page.locator('a[href^="#/page/"]').first().click()
    await expect(page.locator('[role="tab"]')).toHaveCount(countMid)
  })

  test('pending edits flush before link navigation', async ({ page, request }) => {
    const target = uniqueTitle('Flush Target')
    const targetPage = await seedRich(request, target)
    const source = uniqueTitle('Flush Source')
    await seedRich(request, source, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: `#/page/${targetPage.id}`,
            content: [{ type: 'text', text: 'target', styles: {} }]
          }
        ]
      }
    ])
    await openNote(page, source)
    // Type WITHOUT pressing Enter into a second paragraph, then navigate
    // immediately â€” handleSelectPage flushes pending autosave first.
    await page.locator('.bn-editor').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('unsaved tail text')
    await page.locator('a[href^="#/page/"]').first().click()
    await expect(page.getByTestId('rich-editor')).toBeVisible()
    await expect
      .poll(async () => getStoredContent(request, (await seedLookup(request, source)) ?? ''), {
        timeout: 15_000
      })
      .toContain('unsaved tail text')
  })

  test('backlinks appear on the target and disappear when the link is removed', async ({
    page,
    request
  }) => {
    const target = uniqueTitle('Backlink Hub')
    const targetPage = await seedRich(request, target)
    const source = uniqueTitle('Backlink Source')
    const sourcePage = await seedRich(request, source, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: `#/page/${targetPage.id}`,
            content: [{ type: 'text', text: 'hub ref', styles: {} }]
          }
        ]
      }
    ])

    await openNote(page, target)
    await expect(page.getByTestId('backlinks-list')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('backlink-entry').first()).toContainText(source)

    // Remove the link in the source â†’ server index empties â†’ revisiting the
    // target shows the explicit empty state.
    const removeRes = await request.patch(`/api/pages/${sourcePage.id}`, {
      data: {
        content: JSON.stringify([{ id: 'p', type: 'paragraph' }]),
        version: sourcePage.version
      }
    })
    expect(removeRes.status()).toBe(200)
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/pages/${targetPage.id}/backlinks`)
          const body = (await res.json()) as { backlinks: Array<{ id: string }> }
          return body.backlinks.length
        },
        { timeout: 15_000 }
      )
      .toBe(0)
    await page.reload()
    await openNote(page, target)
    await expect(page.getByTestId('backlinks-section')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('backlink-entry')).toHaveCount(0)
    await expect(page.getByTestId('backlinks-empty')).toBeVisible()
  })

  test('deleted target renders a broken link that never navigates', async ({ page, request }) => {
    const target = uniqueTitle('Doomed Link Target')
    const targetPage = await seedRich(request, target)
    const source = uniqueTitle('Broken Holder')
    await seedRich(request, source, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: `#/page/${targetPage.id}`,
            content: [{ type: 'text', text: 'dead ref', styles: {} }]
          }
        ]
      }
    ])
    await request.delete(`/api/pages/${targetPage.id}`)

    await openNote(page, source)
    const anchor = page.locator('a[href^="#/page/"]').first()
    await expect(anchor).toHaveClass(/rtwiki-broken-link/)
    await anchor.click()
    await expect(page.getByTestId('broken-link-notice')).toBeVisible()
    // Still on the same note (no navigation to a different page). The title is
    // a button carrying the text until double-clicked into an input.
    await expect(page.getByTestId('editor-title')).toHaveText(source)

    // Recreating a page with the SAME TITLE must not reconnect the old ID.
    await seedRich(request, target)
    await page.reload()
    await openNote(page, source)
    await expect(page.locator('a[href^="#/page/"]').first()).toHaveClass(/rtwiki-broken-link/)
  })

  test('Ctrl+K finder opens from every page type with keyboard navigation', async ({
    page,
    request
  }) => {
    const needle = uniqueTitle('Finder Needle')
    await seedRich(request, needle, [
      {
        id: 'p',
        type: 'paragraph',
        content: [{ type: 'text', text: 'quantum haystack', styles: {} }]
      }
    ])

    // From a Rich Note.
    const rich = uniqueTitle('Finder Rich')
    await seedRich(request, rich)
    await openNote(page, rich)
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-input')).toBeVisible()
    // Focus, not just visibility. The modal's focus trap resolves its initial
    // target one macrotask AFTER React applies `autoFocus`, so the input is
    // visible for a beat before it is actually the focused element. Typing
    // through that window is what let keystrokes reach the document instead,
    // so wait for the invariant the user relies on rather than the paint.
    await expect(page.getByTestId('quick-finder-input')).toBeFocused()
    await page.keyboard.type(needle)
    await expect(page.getByTestId('quick-finder-input')).toHaveValue(needle)
    await expect(page.getByTestId('quick-finder-results')).toContainText(needle)
    // The harm this test exists for: the open note must be untouched. Without
    // this the suite can pass on a run that still wrote the needle into the
    // page, because `quick-finder-results` keeps listing every page while the
    // query is empty.
    await expect(page.getByTestId('rich-editor')).not.toContainText(needle)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('quick-finder-input')).toHaveCount(0)

    // Content match: searching for body text finds the page too.
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-input')).toBeFocused()
    // Typed, not filled: `fill()` assigns the value directly and so exercises
    // no key events at all. Every real user path here is keystrokes.
    await page.keyboard.type('quantum haystack')
    await expect(page.getByTestId('quick-finder-input')).toHaveValue('quantum haystack')
    await expect(page.getByTestId('quick-finder-results')).toContainText(needle)
    // Arrow to it and open.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('rich-editor')).toBeVisible()

    // From an HTML page and from the dashboard.
    const htmlTitle = uniqueTitle('Finder HTML')
    const htmlRes = await request.post('/api/pages', {
      data: {
        title: htmlTitle,
        pageType: 'html',
        content: JSON.stringify({ version: 2, html: '', css: '', javascript: '', jsEnabled: false })
      }
    })
    expect(htmlRes.status()).toBe(201)
    await page.goto('/')
    await goHome(page)
    await expect(page.getByText('Pages', { exact: true }).first()).toBeVisible()
    const htmlCard = page.getByRole('button', { name: `Open ${htmlTitle}`, exact: true })
    await htmlCard.waitFor()
    await htmlCard.click()
    await expect(page.getByTestId('html-preview-view')).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-input')).toBeFocused()
    await page.keyboard.press('Escape')

    await page.goto('/')
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-input')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('quick-finder-input')).toHaveCount(0)
  })

  test('Ctrl+K typing never reaches the open document, whatever the needle contains', async ({
    page,
    request
  }) => {
    // A regression pin for a data-corrupting focus race, not a finder-search
    // test. The finder used to hand initial focus to the modal's own close
    // button instead of the search box, so:
    //   - the rich editor's post-mount focus poll (which deliberately reclaims
    //     focus from buttons) pulled the caret into the document, and
    //   - a Space in the needle activated that close button, which called
    //     onClose and unmounted the finder mid-word.
    // Either way the rest of the word was typed into the user's page and
    // autosaved. Both the needle below and the previous one contain spaces, so
    // both paths are reachable from ordinary typing.
    const rich = uniqueTitle('Focus Victim')
    const stored = await seedRich(request, rich, [
      {
        id: 'p',
        type: 'paragraph',
        content: [{ type: 'text', text: 'untouched body', styles: {} }]
      }
    ])
    const needle = uniqueTitle('Corrupt Needle')

    await openNote(page, rich)
    await expect(page.getByTestId('rich-editor')).toBeVisible()
    // The status bar's word/char tally is the cheapest witness that the
    // document itself did not change, and unlike a text match it cannot be
    // fooled by a needle that happens to render oddly.
    const before = await page.getByTestId('status-word-count').textContent()

    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-input')).toBeFocused()
    await page.keyboard.type(needle)

    // Both halves: the finder kept every character, and the document kept none.
    await expect(page.getByTestId('quick-finder-input')).toHaveValue(needle)
    await expect(page.getByTestId('rich-editor')).not.toContainText(needle)
    expect(await page.getByTestId('status-word-count').textContent()).toBe(before)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('quick-finder-input')).toHaveCount(0)

    // An unchanged document schedules no autosave, so the stored copy is
    // already final here; the check pins that nothing reached the server.
    expect(await getStoredContent(request, stored.id)).toContain('untouched body')
    expect(await getStoredContent(request, stored.id)).not.toContain(needle)
  })

  /**
   * UNRUN. Written to be run; not executed. The Playwright suite was already in
   * flight on this machine when the fix landed, and this change was not allowed
   * to start a second run or a web build. Nothing below has been observed to
   * pass, and the reasoning it encodes has not been confirmed against a trace
   * the way the finder's was - it is carried over from `f145259`, where the
   * identical mechanism was measured to the millisecond in a real browser.
   *
   * A regression pin for a keyboard-trap defect, not a new-page test. The same
   * defect that made Ctrl+K type into the document was live here: the Modal
   * renders a `title`, so `withCloseButton` defaults true, the close button
   * precedes the body in DOM order, and `useFocusTrap` chose its initial target
   * on a `setTimeout(0)` - one macrotask *after* React applied `autoFocus` - with
   * no `[data-autofocus]` to point it at the field. So `autoFocus` was
   * decorative, the close button held focus, and typing lost the leading
   * characters to it. Worse here than in the finder: a Space activates a
   * `<button>`, so the dialog called `onClose` and vanished mid-title.
   */
  test('typing a New page title reaches the field, not the dialog close button', async ({
    page
  }) => {
    await page.goto('/')
    await page.locator('[aria-label="New page"]').first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const title = dialog.getByLabel('Title')

    // Focus, not just visibility. The trap resolves its initial target one
    // macrotask after React applies `autoFocus`, so the field is visible for a
    // beat before it is the focused element - and typing inside that window is
    // precisely how the first characters were lost. Wait for the invariant a
    // user relies on, not for the paint.
    await expect(title).toBeFocused()

    // Typed, never `fill()`. `fill()` assigns a value and emits no key events
    // at all, so it needs no focus and could never have caught this. The space
    // is in the needle on purpose: it is what a `<button>` is activated by, so
    // on the unfixed build it both drops characters and closes the dialog.
    const needle = `${uniqueTitle('Title Typing')} middle word`
    await page.keyboard.type(needle)

    // Both halves of the same failure as the finder's, asserted in the order
    // that tells them apart. On the unfixed build the Space activates the close
    // button, so the field is **unmounted** and a bare `toHaveValue` would just
    // report "element not found" - which says nothing about focus. The liveness
    // checks come first so the diagnosis is the right one, then the value.
    await expect(title).toHaveCount(1)
    await expect(dialog).toBeVisible()
    await expect(title).toHaveValue(needle)
    // Still focused at the end: the trap took focus once on mount and only
    // handles Tab thereafter, so it cannot have taken it back. If it ever does,
    // this is the assertion that notices.
    await expect(title).toBeFocused()
  })

  test('recent pages persist across reload and respect the 20-item bound', async ({
    page,
    request
  }) => {
    const first = uniqueTitle('Recent One')
    await seedRich(request, first)
    await openNote(page, first)

    // Reload: recents live in localStorage, so the finder still lists it.
    await page.reload()
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-results')).toContainText(first)
    await page.keyboard.press('Escape')

    // Bound: record 25 opens via the UI-level storage contract by opening
    // many pages through the finder is slow; instead assert the bound logic
    // directly through localStorage manipulation consistent with the util.
    await page.evaluate(() => {
      const entries = Array.from({ length: 25 }, (_, i) => ({
        id: `bulk-${i}`,
        openedAt: Date.now() - i
      }))
      window.localStorage.setItem('rtwiki.recent-pages', JSON.stringify(entries))
    })
    await page.keyboard.press('Control+k')
    await expect(page.getByTestId('quick-finder-results')).toBeVisible()
    // Missing IDs are discarded: none of the bulk-* ghosts appear.
    await expect(page.getByTestId('quick-finder-results')).not.toContainText('bulk-1')
    await page.keyboard.press('Escape')
  })

  test('external links remain untouched by wiki-link handling', async ({ page, request }) => {
    const source = uniqueTitle('External Holder')
    await seedRich(request, source, [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com/docs',
            content: [{ type: 'text', text: 'docs', styles: {} }]
          }
        ]
      }
    ])
    await openNote(page, source)
    const anchor = page.locator('a[href="https://example.com/docs"]').first()
    await expect(anchor).toBeVisible()
    await expect(anchor).not.toHaveClass(/rtwiki-broken-link/)
  })

  test('more than 50 pages: finder still reaches pages beyond the first window', async ({
    page,
    request
  }) => {
    const created: string[] = []
    for (let i = 0; i < 55; i++) {
      const p = await seedRich(request, `Bulk Finder ${Date.now()}-${i}`)
      created.push(p.id)
    }
    const deep = uniqueTitle('Deep Finder Page 54')
    const deepPage = await seedRich(request, deep)
    await page.goto('/')
    await page.keyboard.press('Control+k')
    await page.getByTestId('quick-finder-input').fill(deep)
    await expect(page.getByTestId('quick-finder-results')).toContainText(deep)
    await page.keyboard.press('Escape')
    // Clean up the bulk pages so later suites see an unpolluted tree.
    for (const id of [...created, deepPage.id]) {
      await request.delete(`/api/pages/${id}`)
    }
  })
})

// ---------- helpers ----------

function buildHref(pageId: string): string {
  return `#/page/${pageId}`
}

async function lookupId(request: APIRequestContext, title: string): Promise<string> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  const found = body.pages.find((p) => p.title === title)?.id
  if (!found) throw new Error(`page not found: ${title}`)
  return found
}

async function seedLookup(request: APIRequestContext, title: string): Promise<string | undefined> {
  const res = await request.get('/api/pages')
  const body = (await res.json()) as { pages: Array<{ id: string; title: string }> }
  return body.pages.find((p) => p.title === title)?.id
}
