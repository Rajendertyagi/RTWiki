import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * A ` ```mermaid ` fence on a Markdown page: the diagram it becomes.
 *
 * ## What only a real browser can prove here
 *
 * The unit tests in `tests/markdown-mermaid-hydrate.test.ts` drive the whole
 * state machine through an injected renderer, and they cover the part that has
 * bitten this feature twice - the wiring surviving a replacement of the preview's
 * contents. Four things they cannot, and every one of them has been broken in
 * this repository while every unit test passed:
 *
 * 1. that the **real** `renderMermaidSvg` produces an SVG, with its labels, in
 *    the real preview;
 * 2. that the `MutationObserver` fires on the replacement React actually
 *    performs. jsdom never replaces a container's contents on its own, which is
 *    exactly the event this feature is arranged around;
 * 3. that a failure is **readable** - that the source is on screen and the
 *    placeholder is not an empty box, which is a statement about what a reader
 *    can see and not about which attributes were set;
 * 4. that the diagram is legible in both colour schemes. Mermaid bakes the theme
 *    into the SVG, so this cannot be answered from CSS, and
 *    `diagram-labels.pwspec.ts` already found a defect here that every
 *    "an `<svg>` appeared" assertion sailed past.
 *
 * ## Why real keystrokes and never `fill()`
 *
 * `.fill()` sets a value in one shot and produces none of the input events a
 * reader's typing does. That is how a focus race stayed hidden in this repo for
 * a whole session: with `fill()`, the editor never held focus, so nothing
 * exercised the path where a keystroke arrives before the editor is ready.
 * Everything here types.
 *
 * ## The assumption, measured rather than assumed
 *
 * The column feature's notes describe the framework replacing the preview's
 * `innerHTML` "17 ms after" the wiring ran, with byte-identical HTML. That was
 * inherited here, so it was measured. With the hydration module instrumented to
 * log what each scan found, on the built app:
 *
 * ```text
 * 1105ms  the framework writes the preview's children (the placeholder is there)
 * 1115ms  the first scan runs, and finds 1 placeholder
 * 1164ms  the framework writes the preview's children AGAIN, with new nodes
 * ```
 *
 * The assumption holds, with one correction worth keeping: the first scan is not
 * too early to find the content - it finds it and starts a render. The
 * replacement lands about **50 ms** later and discards the node that render is
 * drawing into. Consequence for this file: with the observer commented out,
 * **all six** tests here fail, not only the re-rendering one, because nothing is
 * ever drawn into a node a reader can see.
 *
 * The replacement is also what makes `re-rendering keeps the diagram wired` a
 * real test - a node-identity assertion is included there so it cannot pass
 * against a preview that was never actually replaced - and it is why
 * `a replaced preview is re-hydrated` writes the parser's own placeholder markup
 * through `replaceChildren`, the same wholesale write React performs, with no
 * React dependency changing.
 */

const DIAGRAM_SOURCE = 'graph TD; A[Start]-->B{Choice}; B-->|yes| C[Done]'
const DIAGRAM_LABELS = ['Start', 'Choice', 'Done']

/** A fence Mermaid cannot detect a diagram type in, so `parse` throws. */
const UNRENDERABLE_SOURCE = 'not a diagram at all'

const PLACEHOLDER = '.rt-mermaid'
const SOURCE_ELEMENT = '.rt-mermaid-source'
const ERROR_ELEMENT = '.rt-mermaid__error'

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

const noteWith = (source: string): string =>
  [
    '# Diagram',
    '',
    'Before the fence.',
    '',
    '```mermaid',
    source,
    '```',
    '',
    'After the fence.'
  ].join('\n')

/**
 * Opens a seeded page and waits for its content to have rendered.
 *
 * Through the Ctrl+K finder, never a sidebar row: that tree is virtualised, so a
 * page seeded earlier in a long run can be a thousand rows down and its row is
 * not in the DOM at all. The trailing assertion is the part that matters - the
 * workspace fetches the page after it mounts, so the preview element exists and
 * is visible while it is still empty, and any measurement taken straight after
 * opening runs once against nothing and reads exactly like a broken feature.
 */
async function openPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  const preview = page.getByTestId('markdown-rendered')
  await expect(preview).toBeVisible()
  await expect(preview.locator(':scope > *').first()).toBeVisible()
}

/**
 * Fails a test on any uncaught page error, and names it.
 *
 * A silent exception is exactly the kind of thing that makes a browser failure
 * unexplainable, and here it is the one thing that distinguishes "the diagram
 * did not render" from "the diagram rendered and the assertion is wrong".
 */
function watchForPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

function expectNoPageErrors(errors: string[]): void {
  expect(errors, `uncaught page error(s): ${errors.join(' | ')}`).toHaveLength(0)
}

/** The placeholder in the preview, once it is on screen. */
function placeholder(page: Page) {
  return page.getByTestId('markdown-rendered').locator(PLACEHOLDER)
}

/** The label colour Mermaid generated into the diagram's own stylesheet. */
async function labelColour(page: Page): Promise<string> {
  const style = await page
    .getByTestId('markdown-rendered')
    .locator(`${PLACEHOLDER} svg style`)
    .first()
    .textContent()
  return style ?? ''
}

test.describe('a ```mermaid fence on a Markdown page', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('renders the fence as a diagram, with its labels', async ({ page, request }) => {
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Mermaid render')
    await seedMarkdown(request, title, noteWith(DIAGRAM_SOURCE))
    await openPage(page, title)

    // The SVG, and not merely an element with the right tag: a measured,
    // non-degenerate box. A diagram that laid out to nothing would satisfy every
    // existence assertion and show a reader an empty frame.
    const diagram = placeholder(page).locator('svg')
    await expect(diagram).toBeVisible()
    const box = await diagram.boundingBox()
    expect(box, 'the diagram must be laid out').not.toBeNull()
    expect(box?.width ?? 0, 'the diagram must have real width').toBeGreaterThan(20)
    expect(box?.height ?? 0, 'the diagram must have real height').toBeGreaterThan(20)

    // The labels, because "an `<svg>` appeared" is the assertion that missed the
    // `foreignObject` defect in `diagram-labels.pwspec.ts`.
    const rendered = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="markdown-rendered"] .rt-mermaid svg')
      return {
        text: svg?.textContent ?? '',
        textNodes: svg?.querySelectorAll('text').length ?? 0,
        foreignObjects: svg?.querySelectorAll('foreignObject').length ?? 0
      }
    })
    for (const label of DIAGRAM_LABELS) {
      expect(rendered.text, `"${label}" must be rendered`).toContain(label)
    }
    expect(rendered.textNodes, 'labels must be <text> elements').toBeGreaterThan(0)
    expect(rendered.foreignObjects, 'no HTML labels may reach the sanitiser').toBe(0)

    // The rest of the document survived the fence. The parser's buffer stack
    // desynchronises silently if `buffer()`/`resume()` are mismatched, and that
    // failure costs the reader everything after the fence with no error anywhere.
    await expect(page.getByTestId('markdown-rendered')).toContainText('After the fence.')

    expectNoPageErrors(errors)
  })

  test('keeps the source in the document, hidden behind the diagram', async ({ page, request }) => {
    const title = uniqueTitle('Mermaid source')
    await seedMarkdown(request, title, noteWith(DIAGRAM_SOURCE))
    await openPage(page, title)
    await expect(placeholder(page).locator('svg')).toBeVisible()

    // The source is the reader's content. It is hidden, not destroyed: a reader
    // who selects the page and copies it must get the diagram back, and a render
    // error has nothing to show without it.
    const source = placeholder(page).locator(SOURCE_ELEMENT)
    await expect(source).toHaveCount(1)
    await expect(source).toBeHidden()
    expect(await source.textContent()).toBe(DIAGRAM_SOURCE)
  })

  test('re-rendering keeps the diagram wired', async ({ page, request }) => {
    // The reachable replacement: React writes the whole `innerHTML` again on every
    // Edit -> Preview round trip, so the placeholder is a **different node** each
    // time. Proving that is what stops this test from passing vacuously - without
    // it, a wiring that captured the original node and never looked again would
    // satisfy every other assertion here.
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Mermaid re-render')
    await seedMarkdown(request, title, noteWith(DIAGRAM_SOURCE))
    await openPage(page, title)
    await expect(placeholder(page).locator('svg')).toBeVisible()
    // Tagged in the page, not compared as a handle: Playwright returns a **new**
    // `JSHandle` object for the same element on every `elementHandle()` call, so
    // `first !== second` is true whether or not the node changed and would assert
    // nothing at all. The mark is the only way to ask the real question.
    await placeholder(page).evaluate((element) => {
      element.setAttribute('data-mm-before-round-trip', 'yes')
    })

    await page.getByTestId('markdown-edit-button').click()
    const editor = page.getByTestId('code-editor-markdown')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n\nA typed tail.')
    await page.getByTestId('markdown-preview-button').click()

    await expect(page.getByTestId('markdown-rendered')).toContainText('A typed tail.')
    await expect(placeholder(page).locator('svg')).toBeVisible()
    expect(
      await placeholder(page).getAttribute('data-mm-before-round-trip'),
      'the preview was not actually replaced; this test would pass without proving anything'
    ).toBeNull()

    // And a second round trip, because the first one can succeed for the wrong
    // reason - a fresh effect - while the wiring underneath has quietly stopped
    // following the content.
    await page.getByTestId('markdown-edit-button').click()
    await expect(page.getByTestId('code-editor-markdown')).toBeVisible()
    await page.getByTestId('code-editor-markdown').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n\nAnd more.')
    await page.getByTestId('markdown-preview-button').click()
    await expect(placeholder(page).locator('svg')).toBeVisible()
    await expect(page.getByTestId('markdown-rendered')).toContainText('And more.')

    expectNoPageErrors(errors)
  })

  test('a replaced preview is re-hydrated', async ({ page, request }) => {
    /**
     * The observer's own test, on top of the fact that every test in this file
     * depends on it.
     *
     * The framework replaces the preview's `innerHTML` wholesale, which mints new
     * nodes while **no React dependency changes** - the new HTML is not required
     * to differ. A wiring that captured the placeholders when it attached then
     * holds detached nodes: the container is still there, nothing throws, and the
     * reader simply has no diagram. jsdom cannot produce this event, which is why
     * it has to be driven here.
     *
     * What is written is the parser's own placeholder markup for the same source,
     * which is exactly what React writes - React knows nothing about the SVG this
     * module injects.
     */
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Mermaid replacement')
    await seedMarkdown(request, title, noteWith(DIAGRAM_SOURCE))
    await openPage(page, title)
    await expect(placeholder(page).locator('svg')).toBeVisible()

    await page.evaluate((source) => {
      const preview = document.querySelector('[data-testid="markdown-rendered"]')
      if (preview === null) throw new Error('no preview')
      const holder = document.createElement('div')
      holder.className = 'rt-mermaid'
      const pre = document.createElement('pre')
      pre.className = 'rt-mermaid-source'
      pre.textContent = source
      holder.append(pre)
      // Wholesale, exactly as React does it: every child goes.
      preview.replaceChildren(holder)
    }, DIAGRAM_SOURCE)

    // The fresh placeholder has no diagram until the observer notices it.
    await expect(placeholder(page).locator('svg')).toBeVisible()
    await expect(placeholder(page)).toHaveAttribute('data-rt-state', 'rendered')
    await expect(placeholder(page).locator(SOURCE_ELEMENT)).toBeHidden()

    expectNoPageErrors(errors)
  })

  test('a diagram that cannot be drawn shows the source, not a blank box', async ({
    page,
    request
  }) => {
    const errors = watchForPageErrors(page)
    const title = uniqueTitle('Mermaid error')
    await seedMarkdown(request, title, noteWith(UNRENDERABLE_SOURCE))
    await openPage(page, title)

    // Not "an element with the error class exists": the reader's two real options
    // are to see why it failed and to still have the text they wrote.
    await expect(placeholder(page).locator(ERROR_ELEMENT)).toBeVisible()
    await expect(placeholder(page)).toHaveAttribute('data-rt-state', 'error')
    await expect(placeholder(page).locator('svg'), 'a failed render drew something').toHaveCount(0)

    const source = placeholder(page).locator(SOURCE_ELEMENT)
    await expect(source, 'a failure must not cost the reader their source').toBeVisible()
    expect(await source.textContent()).toBe(UNRENDERABLE_SOURCE)

    // The rest of the note is untouched, which is the point of a contained
    // failure: one bad fence is not a broken page.
    await expect(page.getByTestId('markdown-rendered')).toContainText('After the fence.')

    // No uncaught exception escaped the render, either.
    expectNoPageErrors(errors)
  })

  test('is readable in both colour schemes', async ({ page, request }) => {
    // The theme is baked into the SVG Mermaid emits, so this cannot be answered
    // from CSS and each scheme has to be rendered. Light emits a dark label
    // colour, dark a light one, and the assertion is against Mermaid's own
    // generated stylesheet - which is what actually paints the text.
    const title = uniqueTitle('Mermaid colour scheme')
    await seedMarkdown(request, title, noteWith(DIAGRAM_SOURCE))

    await page.emulateMedia({ colorScheme: 'light' })
    await openPage(page, title)
    await expect(placeholder(page).locator('svg')).toBeVisible()
    expect(await labelColour(page), 'light scheme must use a dark label colour').toMatch(
      /\.label\{[^}]*color:\s*#(?!fff)/i
    )

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
    await expect(placeholder(page).locator('svg')).toBeVisible()
    expect(await labelColour(page), 'dark scheme must use a light label colour').toMatch(
      /\.label\{[^}]*color:\s*#(eee|ccc|f9f)/i
    )
  })
})
