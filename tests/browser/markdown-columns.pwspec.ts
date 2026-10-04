import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * `:::columns` on a Markdown page: the panes, the draggable dividers, and the
 * keyboard.
 *
 * ## Why real keystrokes and never `fill()`
 *
 * `.fill()` sets a value in one shot and does not produce the input events a
 * reader's typing does. That is exactly how a focus race stayed hidden in this
 * repo: with `fill()`, the editor never held focus, so nothing exercised the
 * path where a keystroke arrives before the editor is ready. Everything here
 * types.
 *
 * ## What only a real browser can prove
 *
 * The unit tests cover the emitted DOM, the width grammar, `splitAtDivider`, and
 * the drag arithmetic. Four things they cannot, and all four were found to be
 * broken here while every unit test passed:
 *
 * 1. that the wiring is **rebuilt when the preview's `innerHTML` is replaced**.
 *    The page content loads after the workspace mounts, so the divider elements
 *    the wiring captured are detached the moment it runs. A wiring that holds
 *    them and looks them up by identity matches nothing afterwards: the container
 *    listener still runs, still gets the right event, still does not throw, and
 *    silently does nothing. jsdom cannot see it, because nothing replaces the
 *    container's contents there;
 * 2. that a pointer drag moves the divider at all;
 * 3. that `setPointerCapture` keeps the drag alive when the pointer leaves the
 *    element — jsdom has no pointer capture;
 * 4. that a measured width is non-zero, so `unitsPerPixel` is a real conversion
 *    rather than a division guarded to 1.
 *
 * ## Reading a failure here
 *
 * Two traps this file has already fallen into, both of which produced convincing
 * false alarms:
 *
 * - **Do not measure without waiting first.** `evaluateAll` and `boundingBox` do
 *   not auto-wait; they run once, immediately. A page whose content has not loaded
 *   yet reports zero panes, which is indistinguishable from a layout fault. Every
 *   measurement is preceded by an auto-waiting assertion on the thing it measures.
 * - **An uncaught page error is invisible unless collected.** `expectNoPageErrors`
 *   turns a silent exception into a named failure, which is often the only
 *   evidence that distinguishes a dead handler from a dead layout.
 */

/**
 * The left pane, addressed by its stable `data-side`. The divider itself is
 * found by its `data-testid`, which the render string emits; the ARIA contract
 * is asserted separately rather than used as the selector, so a change to the
 * role would fail a test instead of silently finding nothing.
 */
const PANE = '.rt-cols__pane'
const LEFT_PANE = `${PANE}[data-side="left"]`
const RIGHT_PANE = `${PANE}[data-side="right"]`

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedMarkdown(request: APIRequestContext, title: string, markdown: string) {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'markdown', content: JSON.stringify({ version: 1, markdown }) }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * Opens a seeded page and waits for its content to have rendered.
 *
 * Through the Ctrl+K finder, never a sidebar row: that tree is virtualised, so a
 * page seeded by an early test in a long run is a thousand rows down and its row
 * is simply not in the DOM.
 *
 * The trailing assertion is the part that matters and the part that was missing.
 * The workspace fetches the page **after** it mounts, so the preview element
 * exists and is visible while it is still empty. Any measurement taken straight
 * after opening — `evaluateAll`, `boundingBox` — runs once against that empty
 * preview and reports nothing, which reads exactly like a broken layout. It is
 * what produced `widths=[]` on a row that measurably rendered at 20 : 30 : 50.
 *
 * The wait is for the preview to have **any** rendered child rather than for a
 * column row specifically, because several tests here seed a page with no row in
 * it at all — a literal `:::` line, an unclaimed directive — and a row-shaped wait
 * would hang on those.
 */
async function openPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  const preview = page.getByTestId('markdown-rendered')
  await expect(preview).toBeVisible()
  await expect(preview.locator(':scope > *').first()).toBeVisible()
}

/** Switches a Markdown page into the source editor and focuses it. */
async function openSourceEditor(page: Page): Promise<void> {
  await page.getByTestId('markdown-edit-button').click()
  await expect(page.getByTestId('code-editor-markdown')).toBeVisible()
  await page.getByTestId('code-editor-markdown').click()
}

/** The two-pane source used throughout: `***` is the divider, not `---`. */
const TWO_PANES = ':::columns{left=40}\nLeft pane\n\n***\n\nRight pane\n:::'

/**
 * Fails a test on any uncaught page error, and names it.
 *
 * **Why this exists.** Five interaction tests failed in a browser with "the pane
 * did not move", and a unit test could not tell a dead handler from a dead
 * layout — both look identical from the outside. An uncaught error in the page is
 * the one thing that distinguishes them, and it is invisible to Playwright unless
 * something collects it. `setPointerCapture` throwing `NotFoundError` is the
 * specific case this was added for: it is the one call in the drag path a real
 * browser can throw from, and it used to leave the wiring permanently wedged.
 *
 * The product code no longer depends on this, but a silent exception is exactly
 * the kind of thing that makes a browser failure unexplainable, so the harness
 * refuses to let one pass unnoticed.
 */
function watchForPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

/**
 * Asserts no uncaught error was collected, naming the first one.
 *
 * Called at the end of every test that drives a pointer or the keyboard, so a
 * failure reports the exception rather than only its consequence.
 */
function expectNoPageErrors(errors: string[]): void {
  expect(errors, `uncaught page error(s): ${errors.join(' | ')}`).toHaveLength(0)
}

/**
 * Focuses an element the way a keyboard user would, so `:focus-visible` matches.
 *
 * Chromium only applies `:focus-visible` to a programmatically focused element
 * when the **current input modality is the keyboard**. A bare `element.focus()`
 * on a freshly loaded page therefore leaves the focus ring off, and an assertion
 * about visible focus styling fails for a reason that has nothing to do with the
 * product. Pressing a key first sets the modality; that is what this is for.
 */
async function focusAsKeyboardUser(page: Page, target: Locator): Promise<void> {
  await page.keyboard.press('Shift')
  await target.focus()
}

/**
 * A `::::columns` block with `count` `:::column` children.
 *
 * The outer fence is one longer than the inner, which the extension requires:
 * measured, an equal-length pair does not nest and the trailing fence leaks as a
 * stray paragraph. Optional per-child `width` values.
 */
function childColumns(count: number, widths: Array<string | null> = []): string {
  const inner = ':'.repeat(3)
  const outer = ':'.repeat(4)
  const children = Array.from({ length: count }, (_, index) =>
    [
      `${inner}column${widths[index] ? `{width=${widths[index]}}` : ''}`,
      `Pane ${index + 1}`,
      inner,
      ''
    ].join('\n')
  )
  return [`${outer}columns`, ...children, outer].join('\n')
}

/** Renders the drag a reader performs, in steps so no move event is coalesced. */
async function dragBy(
  page: Page,
  divider: Locator,
  pixels: number,
  fromPaneWidth: number
): Promise<void> {
  const box = await divider.boundingBox()
  expect(box, 'the divider must be hit-testable').not.toBeNull()
  if (!box) return
  const y = box.y + box.height / 2
  const startX = box.x + box.width / 2
  await page.mouse.move(startX, y)
  await page.mouse.down()
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
    await page.mouse.move(startX + (pixels * fromPaneWidth * fraction) / 5, y)
  }
  await page.mouse.up()
}

test.describe(':::columns', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('renders two panes at the authored width, and the divider is focusable', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns render')
    await seedMarkdown(request, title, TWO_PANES)
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    await expect(preview).toBeVisible()
    await expect(preview.locator(LEFT_PANE)).toContainText('Left pane')
    await expect(preview.locator(RIGHT_PANE)).toContainText('Right pane')

    // The split is real geometry, not two text runs: the panes are side by side
    // and neither overlaps the other.
    const left = await preview.locator(LEFT_PANE).boundingBox()
    const right = await preview.locator(RIGHT_PANE).boundingBox()
    expect(left, 'the left pane must be laid out').not.toBeNull()
    expect(right, 'the right pane must be laid out').not.toBeNull()
    if (left && right) {
      expect(right.x, 'the right pane must sit to the right of the left').toBeGreaterThan(
        left.x + left.width - 1
      )
      // 40% authored, allowing for the divider's own hit-area width.
      const ratio = left.width / (left.width + right.width)
      expect(ratio, 'the authored 40% must be the rendered ratio').toBeGreaterThan(0.3)
      expect(ratio).toBeLessThan(0.5)
    }

    // Slider semantics, so a screen reader announces the boundary.
    const divider = preview.getByTestId('rt-cols-divider')
    await expect(divider).toBeVisible()
    await expect(divider).toHaveAttribute('role', 'separator')
    await expect(divider).toHaveAttribute('aria-valuenow', '40')
    await expect(divider).toHaveAttribute('tabindex', '0')
    // The pointer affordance is present, which is what makes it feel draggable.
    await expect(divider).toHaveCSS('cursor', 'col-resize')
  })

  test('dragging the divider moves the boundary, and the panes follow', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns drag')
    const errors = watchForPageErrors(page)
    await seedMarkdown(request, title, TWO_PANES)
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    const divider = preview.getByTestId('rt-cols-divider')
    await expect(divider).toBeVisible()

    const before = await preview.locator(LEFT_PANE).boundingBox()
    expect(before, 'the left pane must be laid out before the drag').not.toBeNull()
    if (!before) return

    // A real pointer drag, in steps: a single jump can be coalesced away, and a
    // missing listener produces no movement at all rather than a wrong amount.
    await dragBy(page, divider, 0.4, before.width)

    // The announced value is checked **before** the geometry, and it is a pure
    // DOM fact with no layout involved. So a failure here means the handler never
    // ran, and a failure only on the geometry below means the handler ran and the
    // layout did not follow. The previous version of this test asserted only the
    // geometry, which cannot tell those apart.
    const announced = Number(await divider.getAttribute('aria-valuenow'))
    expect(
      announced,
      `the drag must move the announced value (pane error(s): ${errors.join(' | ')})`
    ).toBeGreaterThan(40)

    const after = await preview.locator(LEFT_PANE).boundingBox()
    expect(after, 'the pane must still be laid out after a drag').not.toBeNull()
    if (after && before) {
      expect(
        after.width,
        'the left pane must be wider after dragging the divider right'
      ).toBeGreaterThan(before.width)
    }
    expectNoPageErrors(errors)
  })

  test('a drag that leaves the divider keeps working, which is what capture buys', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns capture')
    const errors = watchForPageErrors(page)
    await seedMarkdown(request, title, TWO_PANES)
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    const divider = preview.getByTestId('rt-cols-divider')
    await expect(divider).toBeVisible()
    const before = await preview.locator(LEFT_PANE).boundingBox()
    expect(before, 'the left pane must be laid out before the drag').not.toBeNull()
    if (!before) return

    // Drag deliberately far past the divider's own 6px hit-area, out over the
    // right pane. Without `setPointerCapture` the move events stop at the
    // element edge and the pane never widens.
    await dragBy(page, divider, 2, before.width)

    // As above: the announced value first, because it separates a dead handler
    // from a dead layout.
    const announced = Number(await divider.getAttribute('aria-valuenow'))
    expect(
      announced,
      `the drag must move the announced value (page error(s): ${errors.join(' | ')})`
    ).toBeGreaterThan(40)

    const after = await preview.locator(LEFT_PANE).boundingBox()
    if (after) {
      expect(after.width, 'the drag must survive leaving the divider').toBeGreaterThan(before.width)
    }
    expectNoPageErrors(errors)
  })

  test('the keyboard moves the divider, and the divider is focusable', async ({
    page,
    request
  }) => {
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Columns keyboard')
    await seedMarkdown(request, title, TWO_PANES)
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    const divider = preview.getByTestId('rt-cols-divider')
    await expect(divider).toBeVisible()
    const before = await preview.locator(LEFT_PANE).boundingBox()
    expect(before, 'the left pane must be laid out before the key steps').not.toBeNull()
    if (!before) return

    // Focus the way a keyboard user would, so `:focus-visible` applies — see
    // `focusAsKeyboardUser`. A bare `focus()` leaves the modality as "pointer" and
    // the focus-ring assertion below would fail for a reason unrelated to the
    // product.
    await focusAsKeyboardUser(page, divider)
    await expect(divider).toBeFocused()
    // A visible focus state, required for a keyboard-operable control.
    await expect(divider).toHaveCSS('outline-style', 'solid')

    await page.keyboard.press('ArrowRight')
    // The announced value first, then the geometry: `aria-valuenow` is a pure DOM
    // fact, so if it moved and the box did not, the fault is layout. If neither
    // moved, the handler is dead. Reporting them in that order makes the next
    // failure diagnosable without a rerun.
    const afterStep = Number(await divider.getAttribute('aria-valuenow'))
    expect(afterStep, 'ArrowRight must move the announced value').toBeGreaterThan(40)
    const afterRight = await preview.locator(LEFT_PANE).boundingBox()
    if (afterRight) {
      expect(afterRight.width, 'and the pane must widen to match').toBeGreaterThan(before.width)
    }

    // End and Home jump to the bounds, which is the other half of the contract.
    await page.keyboard.press('End')
    await expect(divider).toHaveAttribute('aria-valuenow', '99')
    const atEnd = await preview.locator(LEFT_PANE).boundingBox()
    if (atEnd) expect(atEnd.width, 'End must reach the maximum').toBeGreaterThan(before.width)

    await page.keyboard.press('Home')
    await expect(divider).toHaveAttribute('aria-valuenow', '1')
    const atHome = await preview.locator(LEFT_PANE).boundingBox()
    // A 1% pane is narrow but must not vanish: the clamp exists so a reader
    // cannot lose a pane entirely.
    if (atHome) expect(atHome.width, 'a 1% pane must still have width').toBeGreaterThan(0)
    expectNoPageErrors(errors)
  })

  test('the drag survives the preview re-rendering, which is why it is delegated', async ({
    page,
    request
  }) => {
    /**
     * The load-bearing test for the wiring's design.
     *
     * The preview's `innerHTML` is replaced from scratch on **every keystroke**,
     * so the divider element is a brand-new node after each one. If the
     * listeners were bound to that node, the drag would work once and then be
     * gone. They are delegated on the container, which survives.
     */
    const title = uniqueTitle('Columns redraw')
    await seedMarkdown(request, title, TWO_PANES)
    await openPage(page, title)
    await expect(page.getByTestId('markdown-rendered')).toBeVisible()

    const preview = page.getByTestId('markdown-rendered')
    const divider = preview.getByTestId('rt-cols-divider')
    await expect(divider).toBeVisible()
    const nodeBefore = await divider.elementHandle()

    // Type one character into the source, which re-renders the preview.
    await openSourceEditor(page)
    await page.keyboard.type('x')
    await page.getByTestId('markdown-preview-button').click()
    await expect(page.getByTestId('markdown-rendered')).toBeVisible()

    const dividerAfter = page.getByTestId('markdown-rendered').getByTestId('rt-cols-divider')
    await expect(dividerAfter).toBeVisible()
    const nodeAfter = await dividerAfter.elementHandle()
    // The element really was replaced; otherwise this test proves nothing.
    const replaced = nodeBefore === null || nodeAfter === null || nodeBefore !== nodeAfter
    expect(replaced, 'innerHTML should have replaced the divider node').toBe(true)

    // And the drag still works on the new node.
    const before = await page.getByTestId('markdown-rendered').locator(LEFT_PANE).boundingBox()
    expect(before, 'the re-rendered pane must be laid out').not.toBeNull()
    if (!before) return
    await dragBy(page, dividerAfter, 0.25, before.width)
    const after = await page.getByTestId('markdown-rendered').locator(LEFT_PANE).boundingBox()
    if (after) {
      expect(after.width, 'the drag must still work after a re-render').toBeGreaterThan(
        before.width
      )
    }
  })

  test('an unknown :::name is shown, and the paragraph after it survives', async ({
    page,
    request
  }) => {
    /**
     * The content-loss case, end to end through the real pipeline.
     *
     * An unclaimed `:::` container directive is *buffered* by the extension and
     * handed to a handler; nothing writing it back would delete its body and
     * everything after the unclosed fence. The fallback is what prevents that,
     * and this asserts the user-visible consequence.
     */
    const title = uniqueTitle('Columns unknown')
    // The `**` markers are load-bearing and were missing: without them the body
    // compiles to `<p>be careful</p>` and there is no `<strong>` anywhere in the
    // document, so the locator below could never match in any browser. The intent
    // is to prove the body is rendered *as Markdown*, which needs real emphasis.
    // Pinned in `tests/markdown-columns-wiring.test.ts`.
    // `:::notice`, not `:::warning`. `markdown-callouts.ts` claims `:::warning`, so
    // it now renders as a callout and would never produce the
    // `.rt-unknown-directive` this test is about. `:::notice` is measured to still
    // fall through to the fallback.
    await seedMarkdown(
      request,
      title,
      'before paragraph\n\n:::notice\n**be careful**\n\nafter paragraph\n'
    )
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    await expect(preview).toContainText('before paragraph')
    await expect(preview).toContainText('after paragraph')
    // The body of the unknown directive is still rendered, as Markdown.
    await expect(preview.locator('.rt-unknown-directive strong')).toHaveText('be careful')
    // And the name is visible, so the reader can see what was not recognised.
    await expect(preview.locator('.rt-unknown-directive__name')).toContainText('notice')
  })

  test('an invalid width is shown rather than silently accepted', async ({ page, request }) => {
    const title = uniqueTitle('Columns width')
    await seedMarkdown(request, title, ':::columns{left="a-->b"}\nLeft\n\n***\n\nRight\n:::')
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    // The content is intact on both sides — a rejected width costs layout, not
    // content.
    await expect(preview.locator(LEFT_PANE)).toContainText('Left')
    await expect(preview.locator(RIGHT_PANE)).toContainText('Right')
    // The mistake is reported, with the default in use.
    await expect(preview.locator('.rt-cols__notice')).toBeVisible()
    await expect(preview.locator('.rt-cols')).toHaveAttribute('data-left', '50')
  })

  test('typing a directive live renders and then re-renders it', async ({ page, request }) => {
    /**
     * Types the whole construct character by character, with no `fill()`.
     *
     * Partly this checks the obvious. Its real purpose is the intermediate
     * states: a half-typed `:::col` must render as literal text rather than as a
     * broken two-pane block that throws, because the reader is passing through
     * that state on every edit.
     */
    const title = uniqueTitle('Columns typing')
    await seedMarkdown(request, title, 'placeholder')
    await openPage(page, title)
    await expect(page.getByTestId('markdown-rendered')).toBeVisible()

    await openSourceEditor(page)
    // Select-all then type, so the seeded placeholder is replaced rather than
    // the directive being appended to it. `pressSequentially` would be the
    // strictest form; `keyboard.type` still dispatches real key events, which is
    // the property that matters here and the reason `fill()` is not used.
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type(':::columns{left=40}')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Left pane')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('***')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Right pane')
    await page.keyboard.press('Enter')
    await page.keyboard.type(':::')

    // Still in the editor: an unclosed container must not have thrown or
    // blanked the workspace while it was being typed.
    await expect(page.getByTestId('code-editor-markdown')).toBeVisible()

    await page.getByTestId('markdown-preview-button').click()
    const preview = page.getByTestId('markdown-rendered')
    await expect(preview.locator(LEFT_PANE)).toContainText('Left pane')
    await expect(preview.locator(RIGHT_PANE)).toContainText('Right pane')

    // Autosave must persist it, so the layout survives a reload — the drag is a
    // view-time affordance and the *authored* width is what is stored.
    //
    // The poll waits for the **saved content** to contain the directive, not for
    // the page to exist. The previous version asserted `pages.length > 0`, which
    // was true the moment the poll started — the page was seeded by this very test
    // — so it was satisfied instantly while the 2000 ms autosave debounce was
    // still pending, and the `reload()` below raced it. The failure that produced
    // was therefore indistinguishable from a broken save.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/pages?q=${encodeURIComponent(title)}`)
          const body = (await res.json()) as {
            pages: Array<{ id: string; content?: string }>
          }
          return (body.pages[0]?.content ?? '').includes(':::columns')
        },
        { timeout: 15_000, message: 'the typed directive must reach the server' }
      )
      .toBe(true)
    await page.reload()
    await expect(page.getByTestId('markdown-rendered')).toBeVisible()
    await expect(
      page.getByTestId('markdown-rendered').getByTestId('rt-cols-divider')
    ).toHaveAttribute('aria-valuenow', '40')
  })

  test('a block with no divider shows one pane rather than an empty column block', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns nodivider')
    await seedMarkdown(request, title, ':::columns{left=40}\nonly one side\n:::')
    await openPage(page, title)
    const preview = page.getByTestId('markdown-rendered')
    // The content is not lost, and the block says it could not be split.
    await expect(preview.locator(LEFT_PANE)).toContainText('only one side')
    await expect(preview.locator(RIGHT_PANE)).toHaveText('')
    await expect(preview.locator('.rt-cols')).toHaveAttribute('data-unsplit', 'true')
  })

  test('::: with a space is literal text, and stays visible', async ({ page, request }) => {
    const title = uniqueTitle('Columns spacing')
    await seedMarkdown(request, title, '::: columns\nleft\n:::')
    await openPage(page, title)
    const preview = page.getByTestId('markdown-rendered')
    // No block was created, and the reader sees their own text.
    await expect(preview.locator('.rt-cols')).toHaveCount(0)
    await expect(preview).toContainText('::: columns')
    await expect(preview).toContainText('left')
  })
})

/**
 * The N-pane form: `::::columns` with `:::column` children.
 *
 * The everyday case above is a two-pane row. These are the cases above two, which
 * are rare but must be available without anyone having to ask for them twice.
 */
test.describe(':::columns with N children', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('four children render four panes side by side, with three dividers', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns four')
    await seedMarkdown(request, title, childColumns(4))
    await openPage(page, title)

    const row = page.getByTestId('markdown-rendered').locator('.rt-cols')
    await expect(row).toHaveAttribute('data-count', '4')
    await expect(row.locator(PANE)).toHaveCount(4)
    await expect(row.getByTestId('rt-cols-divider')).toHaveCount(3)

    // Real geometry: the panes are laid out left to right, in authored order,
    // each one to the right of the last.
    const boxes = await row.locator(PANE).evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return { x: rect.x, width: rect.width, text: node.textContent ?? '' }
      })
    )
    expect(boxes).toHaveLength(4)
    for (const [index, box] of boxes.entries()) {
      expect(box.text.trim(), `pane ${index}`).toBe(`Pane ${index + 1}`)
      expect(box.width, `pane ${index} must have real width`).toBeGreaterThan(0)
      if (index > 0) {
        const previous = boxes[index - 1] as { x: number; width: number }
        expect(
          box.x,
          `pane ${index} must sit to the right of pane ${index - 1}`
        ).toBeGreaterThanOrEqual(previous.x + previous.width - 1)
      }
    }
    // Equal division: with no width declared, the four panes are near-equal, and
    // the first is not the leftover bucket.
    const widths = boxes.map((box) => box.width)
    const narrowest = Math.min(...widths)
    const widest = Math.max(...widths)
    expect(widest - narrowest, 'four undeclared panes are near-equal').toBeLessThan(2)
  })

  test('each divider names the boundary it moves, for a screen reader', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns labels')
    await seedMarkdown(request, title, childColumns(4))
    await openPage(page, title)

    const dividers = page.getByTestId('markdown-rendered').getByTestId('rt-cols-divider')
    await expect(dividers).toHaveCount(3)
    // "Resize columns" alone would not say which boundary; each one names its
    // position and the two columns it sits between.
    await expect(dividers.nth(0)).toHaveAttribute(
      'aria-label',
      'Resize columns: boundary 1 of 3, between column 1 and column 2'
    )
    await expect(dividers.nth(1)).toHaveAttribute(
      'aria-label',
      'Resize columns: boundary 2 of 3, between column 2 and column 3'
    )
    await expect(dividers.nth(2)).toHaveAttribute(
      'aria-label',
      'Resize columns: boundary 3 of 3, between column 3 and column 4'
    )
    // Every one is focusable and carries the slider contract.
    for (const index of [0, 1, 2]) {
      const divider = dividers.nth(index)
      await expect(divider).toHaveAttribute('role', 'separator')
      await expect(divider).toHaveAttribute('tabindex', '0')
      await expect(divider).toHaveAttribute('aria-valuemin', '1')
      await expect(divider).toHaveAttribute('aria-valuemax', '99')
    }
  })

  test('dragging the second divider moves only its own pane', async ({ page, request }) => {
    const title = uniqueTitle('Columns drag middle')
    const errors = watchForPageErrors(page)
    await seedMarkdown(request, title, childColumns(4, ['25', '25', '25', '25']))
    await openPage(page, title)

    const row = page.getByTestId('markdown-rendered').locator('.rt-cols')
    const dividers = row.getByTestId('rt-cols-divider')
    await expect(dividers).toHaveCount(3)
    const before = await row
      .locator(PANE)
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    expect(before).toHaveLength(4)

    // The second boundary, which sits between panes 2 and 3.
    const box = await dividers.nth(1).boundingBox()
    expect(box, 'the second divider must be hit-testable').not.toBeNull()
    if (!box) return
    await dragBy(page, dividers.nth(1), 0.3, before[1] ?? 100)

    const after = await row
      .locator(PANE)
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    // The announced value first: a pure DOM fact, so it separates a dead handler
    // from a dead layout. Reported with the page errors, because a
    // `setPointerCapture` throw is the specific thing that would wedge this.
    const announced = Number(await dividers.nth(1).getAttribute('aria-valuenow'))
    expect(
      announced,
      `the drag must move the announced value (page error(s): ${errors.join(' | ')})`
    ).toBeGreaterThan(25)
    // The pane to the left of the dragged boundary grew.
    expect(after[1] ?? 0, 'the pane left of the dragged divider must widen').toBeGreaterThan(
      before[1] ?? 0
    )
    // The one before it did not: a boundary only moves its own left pane.
    expect(
      Math.abs((after[0] ?? 0) - (before[0] ?? 0)),
      'the untouched pane must keep its width'
    ).toBeLessThan(2)
    await expect(dividers.nth(1)).toHaveAttribute('aria-valuenow', /^(2[6-9]|3\d)$/)
    expectNoPageErrors(errors)
  })

  test('the keyboard moves each boundary, and each is independently focusable', async ({
    page,
    request
  }) => {
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Columns keyboard n')
    await seedMarkdown(request, title, childColumns(3))
    await openPage(page, title)

    const row = page.getByTestId('markdown-rendered').locator('.rt-cols')
    const dividers = row.getByTestId('rt-cols-divider')
    await expect(dividers).toHaveCount(2)

    // The second boundary specifically — a wiring that only found the first
    // would still pass every two-pane test.
    await focusAsKeyboardUser(page, dividers.nth(1))
    await expect(dividers.nth(1)).toBeFocused()
    const before = Number(await dividers.nth(1).getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    const after = Number(await dividers.nth(1).getAttribute('aria-valuenow'))
    // Pure DOM, no layout: if this fails, the keydown chain is dead and the
    // geometry is beside the point.
    expect(
      after,
      `ArrowRight must move the announced value (page error(s): ${errors.join(' | ')})`
    ).toBeGreaterThan(before)
    // And the first boundary is untouched by it.
    const first = Number(await dividers.nth(0).getAttribute('aria-valuenow'))
    await expect(dividers.nth(0)).toHaveAttribute('aria-valuenow', String(first))

    // End reaches the maximum, on this boundary.
    await page.keyboard.press('End')
    await expect(dividers.nth(1)).toHaveAttribute('aria-valuenow', '99')
    expectNoPageErrors(errors)
  })

  test('a width on a child is honoured, and an invalid one is reported', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns child widths')
    await seedMarkdown(request, title, childColumns(3, ['20', '30', null]))
    await openPage(page, title)
    const row = page.getByTestId('markdown-rendered').locator('.rt-cols')
    const widths = await row
      .locator(PANE)
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))
    const total = widths.reduce((a, b) => a + b, 0)
    // 20 : 30 : 50, within a pixel or two of rounding.
    //
    // The raw numbers go in the message. The previous version asserted a bare
    // ratio, so a failure reported only `Expected: > 0.18` with no indication of
    // whether the widths were wrong, all zero, or `NaN` from an empty total — three
    // very different faults that need three different fixes.
    const detail = `widths=${JSON.stringify(widths)} total=${total}`
    expect(widths, `the three authored panes must be laid out (${detail})`).toHaveLength(3)
    expect(total, `the row must have real width (${detail})`).toBeGreaterThan(0)
    expect((widths[0] ?? 0) / total, `pane 1 of a 20:30:50 row (${detail})`).toBeGreaterThan(0.18)
    expect((widths[0] ?? 0) / total, `pane 1 of a 20:30:50 row (${detail})`).toBeLessThan(0.22)
    expect((widths[1] ?? 0) / total, `pane 2 of a 20:30:50 row (${detail})`).toBeGreaterThan(0.28)
    expect((widths[1] ?? 0) / total, `pane 2 of a 20:30:50 row (${detail})`).toBeLessThan(0.32)
    // No notice: a valid width is not a correction.
    await expect(page.getByTestId('markdown-rendered').locator('.rt-cols__notice')).toHaveCount(0)

    // Now an invalid one.
    const bad = uniqueTitle('Columns bad width')
    await seedMarkdown(
      request,
      bad,
      [
        '::::columns',
        ':::column{width="a-->b"}',
        'A',
        ':::',
        '',
        ':::column',
        'B',
        ':::',
        '::::'
      ].join('\n')
    )
    await openPage(page, bad)
    const badPreview = page.getByTestId('markdown-rendered')
    await expect(badPreview.locator('.rt-cols__notice')).toBeVisible()
    await expect(badPreview.locator(PANE)).toHaveCount(2)
    // The content is intact on both sides: a rejected width costs layout, not
    // content.
    await expect(badPreview.locator(PANE).first()).toContainText('A')
    await expect(badPreview.locator(PANE).nth(1)).toContainText('B')
  })

  test('an orphan :::column still renders its content rather than losing it', async ({
    page,
    request
  }) => {
    /**
     * The measured failure that ruled out handing children over through
     * micromark's compile-data store: a `:::column` outside any `::::columns`
     * was pushed onto the store, never reached the output, and vanished.
     */
    const title = uniqueTitle('Columns orphan')
    await seedMarkdown(request, title, ':::column\nOrphan content\n:::\n\nafter paragraph')
    await openPage(page, title)
    const preview = page.getByTestId('markdown-rendered')
    await expect(preview).toContainText('Orphan content')
    await expect(preview).toContainText('after paragraph')
  })

  test('the setext trap is reported, because --- under text is a heading', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns setext')
    await seedMarkdown(request, title, ':::columns{left=40}\nLeft text\n---\nRight text\n:::')
    await openPage(page, title)
    const preview = page.getByTestId('markdown-rendered')
    // The failure is loud and names the form that works.
    await expect(preview.locator('.rt-cols__notice')).toContainText('No column separator found')
    await expect(preview.locator('.rt-cols__notice')).toContainText('***')
    // Nothing was lost.
    await expect(preview).toContainText('Left text')
    await expect(preview).toContainText('Right text')
  })

  test('typing a child directive live re-renders and keeps the drag wired', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Columns typing children')
    await seedMarkdown(request, title, 'placeholder')
    await openPage(page, title)
    await expect(page.getByTestId('markdown-rendered')).toBeVisible()

    await openSourceEditor(page)
    await page.keyboard.press('ControlOrMeta+a')
    // Typed top to bottom, exactly as a reader would write it, so every
    // half-typed intermediate state is genuinely passed through: `::::`, then an
    // unclosed `:::column`, then a second one, and only at the end a closing
    // fence. No state of that sequence may throw or blank the workspace.
    await page.keyboard.type('::::columns')
    for (const text of ['Alpha', 'Beta', 'Gamma']) {
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type(':::column')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type(text)
      await page.keyboard.press('Enter')
      await page.keyboard.type(':::')
    }
    await page.keyboard.press('Enter')
    await page.keyboard.type('::::')

    // Still in the editor, and the source is what was typed.
    await expect(page.getByTestId('code-editor-markdown')).toBeVisible()

    await page.getByTestId('markdown-preview-button').click()
    const row = page.getByTestId('markdown-rendered').locator('.rt-cols')
    await expect(row.locator(PANE)).toHaveCount(3)
    await expect(row.getByTestId('rt-cols-divider')).toHaveCount(2)
    for (const [index, text] of ['Alpha', 'Beta', 'Gamma'].entries()) {
      await expect(row.locator(PANE).nth(index)).toContainText(text)
    }

    // And the drag is wired on the freshly re-rendered nodes, which is the whole
    // reason the listeners are delegated on the container.
    const dividers = row.getByTestId('rt-cols-divider')
    const before = await row.locator(PANE).first().boundingBox()
    expect(before).not.toBeNull()
    if (before) await dragBy(page, dividers.first(), 0.3, before.width)
    const after = await row.locator(PANE).first().boundingBox()
    if (after && before) {
      expect(after.width, 'the drag must work on the re-rendered nodes').toBeGreaterThan(
        before.width
      )
    }
  })
})
