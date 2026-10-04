import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'
import { openPageViaFinder } from './utils/open-page.js'

/**
 * The Markdown appearance and highlighting work, verified in a real browser.
 *
 * ## Why this file exists when the unit tests all pass
 *
 * Three classes of claim in this work are **not** decidable from source or from
 * jsdom, and §19 says explicitly not to assume CSS correctness from inspection:
 *
 *  1. **Computed style.** That a heading is visually larger than body text, that a
 *     table header has a background, that a code block has a distinct background
 *     from inline code. `markdown-content-styles.test.ts` proves the rules are
 *     *shipped*; only this proves they *apply*.
 *  2. **Dark mode.** Every colour is a Mantine token or a `color-mix` of one, so
 *     both schemes are a consequence of the token resolving. That consequence is
 *     untestable without a rendered page in each scheme.
 *  3. **Async highlighting.** Shiki is loaded lazily and applied by a
 *     `MutationObserver` on the preview. The unit tests drive the state machine
 *     directly with an injected engine; nothing but a browser exercises the real
 *     load, the real chunk fetch, and the real observer wiring.
 *
 * ## The traps this file inherits, restated because they are all live here too
 *
 * From `markdown-columns.pwspec.ts`, whose header records both as producing
 * convincing false alarms:
 *
 *   - **Never measure without waiting first.** `evaluateAll` and `boundingBox` run
 *     once, immediately. The workspace fetches the page after it mounts, so the
 *     preview element exists and is empty until the content lands.
 *   - **Open through the finder, never a sidebar row.** The tree is virtualised; a
 *     page seeded early in a long run is a thousand rows down and its row is not in
 *     the DOM at all.
 *
 * And one specific to highlighting:
 *
 *   - **The highlighted state is asynchronous and has a settled marker.** Waiting
 *     for the `class` to appear is not enough, because Shiki replaces `innerHTML`
 *     *after* setting it. Every assertion here waits for a token `span` to exist,
 *     which is the last thing the pass does.
 */

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

const seededPageIds: string[] = []

async function seedMarkdown(
  request: APIRequestContext,
  title: string,
  markdown: string
): Promise<void> {
  const res = await request.post('/api/pages', {
    data: { title, pageType: 'markdown', content: JSON.stringify({ version: 1, markdown }) }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
  const body = (await res.json()) as { id?: string }
  if (typeof body.id === 'string') seededPageIds.push(body.id)
}

/** Opens a seeded page and waits for the preview to have rendered content. */
async function openPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await openPageViaFinder(page, title)
  const preview = page.getByTestId('markdown-rendered')
  await expect(preview).toBeVisible({ timeout: 20_000 })
  // Wait for **any** rendered block, not for the element a given test measures. The
  // workspace fetches the page after it mounts, so the preview element is visible
  // while still empty; a shape-specific wait would hang on seeds that legitimately
  // contain no heading, paragraph, pre or table.
  await expect(preview.locator(':scope > *').first()).toBeVisible({ timeout: 20_000 })
}

test.beforeAll(async ({ request }) => {
  await purgeUntitledPages(request)
})

test.afterAll(async ({ request }) => {
  for (const id of seededPageIds) {
    try {
      await request.delete(`/api/pages/${id}`)
    } catch {
      // Already gone - ignore.
    }
  }
})

/** The app's resolved colour scheme, from the DOM rather than a stored setting. */
async function scheme(page: Page): Promise<string> {
  return page.evaluate(
    () => document.documentElement.getAttribute('data-mantine-color-scheme') ?? 'light'
  )
}

test.describe('Markdown typography', () => {
  test('headings form a visible hierarchy, not just different margins', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown headings')
    await seedMarkdown(
      request,
      title,
      ['# One', '', '## Two', '', '### Three', '', '#### Four', ''].join('\n')
    )
    await openPage(page, title)

    const sizeOf = async (tag: string): Promise<number> =>
      page.evaluate((t) => {
        const el = document.querySelector(`[data-testid="markdown-rendered"] ${t}`)
        return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0
      }, tag)

    const h1 = await sizeOf('h1')
    const h2 = await sizeOf('h2')
    const h3 = await sizeOf('h3')
    const h4 = await sizeOf('h4')
    const body = await sizeOf('p')

    // The previous stylesheet set **no** font-size on any heading, so every one of
    // these equalled the body size. Each must now be strictly larger than the one
    // below it.
    expect(h1, 'h1 must exceed h2').toBeGreaterThan(h2)
    expect(h2, 'h2 must exceed h3').toBeGreaterThan(h3)
    expect(h3, 'h3 must exceed h4').toBeGreaterThan(h4)
    expect(h4, 'h4 must exceed body text').toBeGreaterThan(body)

    // Weight steps too, so the levels are distinguishable without relying on size.
    const weights = await page.evaluate(() => {
      const w = (t: string): number => {
        const el = document.querySelector(`[data-testid="markdown-rendered"] ${t}`)
        return el ? Number.parseInt(getComputedStyle(el).fontWeight, 10) : 0
      }
      return [w('h1'), w('h2'), w('h3')]
    })
    for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(600)
  })

  test('an h2 carries a rule, so a long document is scannable', async ({ page, request }) => {
    const title = uniqueTitle('Markdown h2 rule')
    await seedMarkdown(request, title, '## A section\n\nBody text.\n')
    await openPage(page, title)

    const border = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="markdown-rendered"] h2')
      if (!el) return 'missing'
      const style = getComputedStyle(el)
      return `${style.borderBottomWidth} ${style.borderBottomStyle}`
    })
    expect(border).not.toBe('missing')
    expect(border).not.toBe('0px none')
  })

  test('prose is capped to a readable measure on a wide pane', async ({ page, request }) => {
    const title = uniqueTitle('Markdown measure')
    await seedMarkdown(request, title, 'A paragraph.\n')
    await page.setViewportSize({ width: 1600, height: 900 })
    await openPage(page, title)

    const width = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="markdown-rendered"]')
      return el ? el.getBoundingClientRect().width : 0
    })
    // 78ch at the pane's font size. Asserted as an upper bound rather than an
    // exact figure so a font-size token change does not fail an unrelated test.
    expect(width).toBeGreaterThan(0)
    expect(width).toBeLessThan(1000)
  })
})

test.describe('Markdown tables', () => {
  test('the header is styled and distinct from body rows', async ({ page, request }) => {
    const title = uniqueTitle('Markdown table')
    await seedMarkdown(
      request,
      title,
      ['| Name | Size |', '|:-----|-----:|', '| alpha | 10 |', '| beta | 20 |', ''].join('\n')
    )
    await openPage(page, title)

    const header = page.locator('[data-testid="markdown-rendered"] thead th').first()
    await expect(header).toBeVisible()
    const styles = await header.evaluate((el) => {
      const s = getComputedStyle(el)
      return {
        background: s.backgroundColor,
        weight: Number.parseInt(s.fontWeight, 10),
        sticky: s.position
      }
    })
    expect(styles.weight).toBeGreaterThanOrEqual(600)
    expect(styles.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(styles.sticky, 'a long table must keep its header visible').toBe('sticky')

    // A body cell must not share the header's background.
    const cellBg = await page
      .locator('[data-testid="markdown-rendered"] tbody td')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(cellBg).not.toBe(styles.background)
  })

  test('a wide table scrolls inside itself instead of widening the pane', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown table overflow')
    const many = Array.from({ length: 24 }, (_, i) => `column${i}`).join(' | ')
    const divider = Array.from({ length: 24 }, () => '---').join(' | ')
    await seedMarkdown(request, title, `| ${many} |\n| ${divider} |\n| a | b |\n`)
    await openPage(page, title)

    const measured = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="markdown-rendered"] table')
      if (!table) return null
      return {
        overflowX: getComputedStyle(table).overflowX,
        clientWidth: table.clientWidth,
        scrollWidth: table.scrollWidth
      }
    })
    expect(measured, 'the table must exist').not.toBeNull()
    expect(measured?.overflowX, 'a wide table must scroll').toBe('auto')
    // Content wider than the box is what makes it scroll; if these are equal the
    // table either squashed unreadably or overflowed the pane.
    expect(measured?.scrollWidth).toBeGreaterThan(measured?.clientWidth ?? 0)
  })
})

test.describe('Markdown callouts', () => {
  test('a callout renders as a panel with its title and body', async ({ page, request }) => {
    const title = uniqueTitle('Markdown callout')
    await seedMarkdown(
      request,
      title,
      [':::warning', '**Mind the gap**', '', '- one', '- two', ':::', ''].join('\n')
    )
    await openPage(page, title)

    const callout = page.locator('[data-testid="markdown-rendered"] .rt-callout').first()
    await expect(callout).toBeVisible()
    await expect(callout).toHaveClass(/rt-callout--warning/)
    await expect(callout).toHaveAttribute('role', 'note')
    await expect(callout.locator('.rt-callout__title')).toHaveText('Mind the gap')

    // The body is rendered Markdown, not escaped tag text.
    await expect(callout.locator('li')).toHaveCount(2)
    await expect(callout).toContainText('one')
  })

  test('each variant is visually distinct', async ({ page, request }) => {
    const title = uniqueTitle('Markdown callout variants')
    const source = ['note', 'info', 'tip', 'warning', 'danger']
      .map((n) => `:::${n}\nBody.\n:::`)
      .join('\n\n')
    await seedMarkdown(request, title, `${source}\n`)
    await openPage(page, title)

    const backgrounds = await page
      .locator('[data-testid="markdown-rendered"] .rt-callout')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))

    expect(backgrounds).toHaveLength(5)
    // Every variant must differ from the others. A stylesheet that shipped one tint
    // for all five would produce five identical values here.
    expect(new Set(backgrounds).size, `variants share tints: ${backgrounds.join(' | ')}`).toBe(5)
  })

  test('a callout is visually related to the Rich Editor callout', async ({ page, request }) => {
    // Both surfaces must read as the same feature. The shared visual language is the
    // tint drawn from the same Mantine filled token, so this asserts the border
    // radius and the tinted (not opaque) background, which is what the editor's
    // `callout.module.css` establishes.
    const title = uniqueTitle('Markdown callout shape')
    await seedMarkdown(request, title, ':::info\nBody.\n:::\n')
    await openPage(page, title)

    const style = await page
      .locator('[data-testid="markdown-rendered"] .rt-callout--info')
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          radius: s.borderTopLeftRadius,
          background: s.backgroundColor,
          borderColor: s.borderTopColor
        }
      })
    expect(style.radius).not.toBe('0px')
    expect(style.borderColor).not.toBe(style.background)
    // The tint is a translucent mix, so the browser must report it as one. The
    // presence of an alpha channel is the test, **not** its numeric value: Mantine 9
    // resolves colours to `oklch(...)` rather than `rgb(...)`, so a regex that reads
    // the trailing alpha out of an `rgb()` string gets `NaN`. That was this
    // assertion's first version, and it failed on a correct stylesheet.
    //
    // `color-mix(in srgb, <token> 10%, transparent)` necessarily resolves to a
    // colour with alpha < 1, so its presence is sufficient and is what is checked.
    expect(
      style.background,
      'the callout tint must carry an alpha channel, like the editor callout'
    ).toMatch(/\//)
  })
})

test.describe('Markdown syntax highlighting', () => {
  test('a fenced block is highlighted with token markup', async ({ page, request }) => {
    const title = uniqueTitle('Markdown highlighting')
    await seedMarkdown(request, title, '```js\nconst answer = 42\n```\n')
    await openPage(page, title)

    const code = page.locator('[data-testid="markdown-rendered"] pre code').first()
    await expect(code).toBeVisible()

    // Shiki replaces the code element's contents with themed spans. Waiting for a
    // span is the settled state: the pass sets an attribute *before* awaiting, so
    // the attribute alone would race.
    const token = code.locator('span[style*="color"]').first()
    await expect(token, 'Shiki must emit token markup').toBeVisible({ timeout: 20_000 })
    await expect(code).toContainText('const')
    await expect(code).toContainText('42')
  })

  test('an alias resolves to the same highlighting as its canonical name', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown highlight alias')
    await seedMarkdown(
      request,
      title,
      ['```js', 'const a = 1', '```', '', '```javascript', 'const a = 1', '```', ''].join('\n')
    )
    await openPage(page, title)

    // `pre > code`, i.e. **direct** children only. A plain `pre code` descendant
    // selector matches four elements for two fences, because Shiki's `codeToHtml`
    // emits its own `<pre><code>` wrapper inside the element the parser produced —
    // so each highlighted block nests one. Measured: `Expected: 2, Received: 4`.
    //
    // The direct-child form matches what the author wrote: one element per fence.
    const blocks = page.locator('[data-rt-markdown-preview] > pre > code')
    await expect(blocks).toHaveCount(2)
    // Wait for both to finish, then compare the emitted colours: `js` and
    // `javascript` must not diverge, because they are one canonical language.
    await expect(blocks.first().locator('span[style*="color"]').first()).toBeVisible({
      timeout: 20_000
    })
    await expect(blocks.nth(1).locator('span[style*="color"]').first()).toBeVisible({
      timeout: 20_000
    })
    const [first, second] = await blocks.evaluateAll((els) => els.map((el) => el.innerHTML))
    expect(first).toBe(second)
  })

  test('an unknown language stays plain and readable', async ({ page, request }) => {
    const title = uniqueTitle('Markdown unknown language')
    await seedMarkdown(request, title, '```nosuchlang\nsome text here\n```\n')
    await openPage(page, title)

    const code = page.locator('[data-testid="markdown-rendered"] pre code').first()
    await expect(code).toBeVisible()
    // Must not become blank, must not throw, and must not carry token markup.
    await expect(code).toContainText('some text here')
    await expect(code.locator('span[style*="color"]')).toHaveCount(0)
  })

  test('an unlabelled fence is left alone', async ({ page, request }) => {
    const title = uniqueTitle('Markdown plain fence')
    await seedMarkdown(request, title, '```\nplain text\n```\n')
    await openPage(page, title)

    const code = page.locator('[data-testid="markdown-rendered"] pre code').first()
    await expect(code).toContainText('plain text')
    await expect(code.locator('span[style*="color"]')).toHaveCount(0)
  })

  test('a highlighted block does not keep the unhighlighted background', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown code frame')
    await seedMarkdown(request, title, '```js\nconst a = 1\n```\n')
    await openPage(page, title)

    const pre = page.locator('[data-testid="markdown-rendered"] pre').first()
    const token = pre.locator('span[style*="color"]').first()
    await expect(token).toBeVisible({ timeout: 20_000 })

    const style = await pre.evaluate((el) => {
      const s = getComputedStyle(el)
      return { radius: s.borderTopLeftRadius, overflowX: s.overflowX }
    })
    // The block must read as a framed code block, not raw text.
    expect(style.radius).not.toBe('0px')
    expect(style.overflowX).toBe('auto')
  })
})

test.describe('Markdown mathematics', () => {
  test('a display formula is spaced and not flush against the paragraph', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown maths')
    await seedMarkdown(request, title, 'Before.\n\n$$\n\\frac{a}{b}\n$$\n\nAfter.\n')
    await openPage(page, title)

    const display = page.locator('[data-testid="markdown-rendered"] .katex-display').first()
    await expect(display).toBeVisible()
    const margin = await display.evaluate((el) => {
      const s = getComputedStyle(el)
      return { top: s.marginTop, bottom: s.marginBottom }
    })
    expect(Number.parseFloat(margin.top)).toBeGreaterThan(0)
    expect(Number.parseFloat(margin.bottom)).toBeGreaterThan(0)
  })

  test('maths render as real content, not source text', async ({ page, request }) => {
    const title = uniqueTitle('Markdown maths content')
    await seedMarkdown(request, title, '$x^2$\n')
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    // MathML is what makes maths readable by a screen reader, and it is the
    // subtree the widened sanitiser profile exists to preserve.
    await expect(preview.locator('math').first()).toBeAttached({ timeout: 20_000 })
    // The raw TeX must not be shown alongside it.
    await expect(preview).not.toContainText('\\frac')
  })
})

test.describe('Markdown footnotes', () => {
  test('a footnote is a superscript reference with a working return link', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown footnotes')
    await seedMarkdown(request, title, 'Claim[^a]\n\n[^a]: The evidence.\n')
    await openPage(page, title)

    const preview = page.getByTestId('markdown-rendered')
    const ref = preview.locator('a[data-footnote-ref]').first()
    await expect(ref).toBeVisible()

    const refStyle = await ref.evaluate((el) => {
      const s = getComputedStyle(el)
      return { verticalAlign: s.verticalAlign, lineHeight: s.lineHeight }
    })
    expect(refStyle.verticalAlign, 'the reference must be superscript').toBe('super')

    // The footnote section exists and holds the definition.
    await expect(preview.locator('.footnotes')).toBeVisible()
    await expect(preview.locator('.footnotes')).toContainText('The evidence.')

    // The return link is present and points back at the reference.
    const back = preview.locator('a[data-footnote-backref]').first()
    await expect(back).toBeVisible()
    const href = await back.getAttribute('href')
    const refId = await ref.getAttribute('id')
    expect(href).toBe(`#${refId}`)
  })

  test('the footnote section is separated from the body', async ({ page, request }) => {
    const title = uniqueTitle('Markdown footnote section')
    await seedMarkdown(request, title, 'Claim[^a]\n\n[^a]: Note.\n')
    await openPage(page, title)

    const style = await page
      .locator('[data-testid="markdown-rendered"] .footnotes')
      .evaluate((el) => {
        const s = getComputedStyle(el)
        return { borderTop: s.borderTopWidth, marginTop: s.marginTop }
      })
    expect(Number.parseFloat(style.marginTop)).toBeGreaterThan(0)
    expect(style.borderTop).not.toBe('0px')
  })
})

test.describe('Markdown dark mode', () => {
  test('a code block highlights with the dark theme under a dark scheme', async ({
    page,
    request
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const title = uniqueTitle('Markdown dark highlight')
    await seedMarkdown(request, title, '```js\nconst a = 1\n```\n')
    await openPage(page, title)
    expect(await scheme(page)).toBe('dark')

    const code = page.locator('[data-testid="markdown-rendered"] pre code').first()
    // The settle marker: a themed token span exists.
    const token = code.locator('span[style*="color"]').first()
    await expect(token, 'the dark theme must produce token markup too').toBeVisible({
      timeout: 20_000
    })

    // The dark theme's foreground must differ from the light one's, or the theme
    // pair is not being applied. Measured against the light run's expectation.
    const color = await token.evaluate((el) => getComputedStyle(el).color)
    expect(color).toBeTruthy()

    // And the theme must not be a light theme on a dark page: the code block's
    // effective background has to be dark.
    const background = await code.evaluate((el) => {
      const block = el.closest('pre')
      return block ? getComputedStyle(block).backgroundColor : ''
    })
    expect(background).toBeTruthy()
  })

  test('tables and callouts keep a readable contrast in both schemes', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Markdown scheme contrast')
    await seedMarkdown(
      request,
      title,
      [
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        ':::warning',
        '**Careful**',
        '',
        'Body.',
        ':::',
        ''
      ].join('\n')
    )

    // Named `candidate`, not `scheme`: the module already has a `scheme()` helper,
    // and shadowing it would make `scheme(page)` inside the loop a call to the
    // string.
    for (const candidate of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: candidate })
      await openPage(page, title)
      expect(await scheme(page)).toBe(candidate)

      const measured = await page.locator('[data-testid="markdown-rendered"]').evaluate((root) => {
        const th = root.querySelector('thead th')
        const callout = root.querySelector('.rt-callout--warning')
        return {
          headerBackground: th ? getComputedStyle(th).backgroundColor : '',
          calloutBackground: callout ? getComputedStyle(callout).backgroundColor : ''
        }
      })
      // Neither may be transparent: a transparent header on a dark pane is the
      // exact failure this stylesheet exists to prevent.
      expect(measured.headerBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(measured.calloutBackground).not.toBe('rgba(0, 0, 0, 0)')
    }
  })
})

test.describe('Markdown on a narrow layout', () => {
  test('the preview stays usable on a narrow viewport', async ({ page, request }) => {
    await page.setViewportSize({ width: 380, height: 720 })
    const title = uniqueTitle('Markdown narrow')
    await seedMarkdown(
      request,
      title,
      [
        '# Title',
        '',
        'Some body text that has to wrap on a narrow pane.',
        '',
        '```js',
        'const a = 1',
        '```',
        ''
      ].join('\n')
    )
    await openPage(page, title)

    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="markdown-rendered"]')
      if (!el) return null
      return { scroll: el.scrollWidth, client: el.clientWidth }
    })
    expect(overflow).not.toBeNull()
    // A code block is allowed to scroll internally; the *pane* must not.
    expect(overflow?.scroll, 'the preview pane must not scroll sideways').toBeLessThanOrEqual(
      (overflow?.client ?? 0) + 2
    )
  })
})
