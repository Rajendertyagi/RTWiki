import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { purgeUntitledPages } from './utils/cleanup.js'

/**
 * The right-hand panel across page types.
 *
 * The panel is one shared component, so the point of these tests is that every
 * page type actually mounts it — the Markdown and diagram pages previously had
 * no panel at all while the component sat unused outside the Rich editor, which
 * no unit test could have caught.
 */

const PANEL = '[aria-label="Page details"]'

let titleSeq = 0

function uniqueTitle(base: string): string {
  titleSeq += 1
  return `${base} ${Date.now()}-${titleSeq}`
}

async function seedPage(
  request: APIRequestContext,
  title: string,
  pageType: 'markdown' | 'diagram' | 'rich',
  /** Stored content: a BlockNote array, or the page-type's own JSON envelope. */
  content: unknown
): Promise<void> {
  const res = await request.post('/api/pages', {
    data: { title, pageType, content: JSON.stringify(content) }
  })
  if (res.status() !== 201) {
    throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  }
}

async function openPage(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click()
}

test.describe('right-hand panel', () => {
  test.beforeAll(async ({ request }) => {
    await purgeUntitledPages(request)
  })

  test('a Markdown page shows an outline built from its headings', async ({ page, request }) => {
    const title = uniqueTitle('Panel Markdown')
    await seedPage(request, title, 'markdown', {
      version: 1,
      markdown: '# Overview\n\nIntro text.\n\n## Details\n\nMore text.\n\n### Nested\n\nEnd.'
    })
    await openPage(page, title)
    await expect(page.getByTestId('markdown-workspace')).toBeVisible()

    const panel = page.locator(PANEL)
    await expect(panel, 'the Markdown page must have a right-hand panel').toBeVisible()
    await expect(panel.getByText('Outline')).toBeVisible()

    // Every heading appears, at its own level, and a fenced `#` line is not a heading.
    const entries = panel.locator('button', { hasText: /Overview|Details|Nested/ })
    await expect(entries).toHaveCount(3)
    await expect(panel.getByRole('button', { name: 'Overview' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Details' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Nested' })).toBeVisible()
  })

  test('clicking an outline entry on a Markdown page shows and scrolls to that heading', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Panel Markdown Nav')
    await seedPage(request, title, 'markdown', {
      version: 1,
      markdown: '# Top\n\n' + 'Filler line.\n\n'.repeat(120) + '## Deep Section\n\nBottom.'
    })
    await openPage(page, title)
    await expect(page.getByTestId('markdown-workspace')).toBeVisible()

    // The deep heading starts far below the fold, so the preview is scrollable.
    const preview = page.getByTestId('markdown-rendered')
    const beforeScroll = await preview.evaluate((el) => el.scrollTop)

    await page.locator(PANEL).getByRole('button', { name: 'Deep Section' }).click()

    // Navigation lands in the rendered preview even when the reader was editing.
    await expect(preview).toBeVisible()
    await expect
      .poll(async () => preview.evaluate((el) => el.scrollTop), {
        timeout: 10_000,
        message: 'the preview must scroll to the chosen heading'
      })
      .toBeGreaterThan(beforeScroll)
  })

  test('a Markdown page with no headings shows the panel without an empty outline', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Panel Markdown Flat')
    await seedPage(request, title, 'markdown', {
      version: 1,
      markdown: 'Just a paragraph with no headings at all.'
    })
    await openPage(page, title)
    await expect(page.getByTestId('markdown-workspace')).toBeVisible()

    // The panel is still there — a note without headings is not a note without a
    // panel — and the outline explains itself rather than showing a blank list.
    const panel = page.locator(PANEL)
    await expect(panel).toBeVisible()
    await expect(
      panel.getByText('No headings yet. Add a heading to build the outline.')
    ).toBeVisible()
  })

  test('a Diagram page shows page info and backlinks but no outline', async ({ page, request }) => {
    const title = uniqueTitle('Panel Diagram')
    await seedPage(request, title, 'diagram', {
      version: 2,
      type: 'diagram',
      blocks: [{ id: 'main', source: 'flowchart TD\n    A[Start] --> B[End]' }]
    })
    await openPage(page, title)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()

    const panel = page.locator(PANEL)
    await expect(panel, 'the Diagram page must have a right-hand panel').toBeVisible()
    // A diagram has no headings, so an "Outline" heading over "no headings" would
    // be noise. The section is omitted rather than shown empty.
    await expect(panel.getByText('Outline')).toHaveCount(0)
    await expect(panel.getByText('Page info')).toBeVisible()
    await expect(panel.getByTestId('backlinks-section')).toBeVisible()
  })

  test('the panel is dropped in fullscreen so the diagram is unobstructed', async ({
    page,
    request
  }) => {
    const title = uniqueTitle('Panel Diagram Fullscreen')
    await seedPage(request, title, 'diagram', {
      version: 2,
      type: 'diagram',
      blocks: [{ id: 'main', source: 'flowchart TD\n    A[Start] --> B[End]' }]
    })
    await openPage(page, title)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible()
    await expect(page.locator(PANEL)).toBeVisible()

    await page.getByTestId('diagram-fullscreen').click()
    // The point of fullscreen is an unobstructed canvas; a pane the reader cannot
    // collapse from there would defeat it.
    await expect(page.locator(PANEL)).toHaveCount(0)
  })

  test('a backlink on a Markdown page opens the page it points at', async ({ page, request }) => {
    const target = uniqueTitle('Panel Backlink Target')
    const source = uniqueTitle('Panel Backlink Source')

    // The target is created first so the linking page can carry its real id: the
    // internal-link index stores ids, not titles.
    const created = await request.post('/api/pages', {
      data: {
        title: target,
        pageType: 'markdown',
        content: JSON.stringify({ version: 1, markdown: '# Target\n\nThe linked note.' })
      }
    })
    if (created.status() !== 201) {
      throw new Error(`seed failed: ${created.status()} ${await created.text()}`)
    }
    const targetId = ((await created.json()) as { page: { id: string } }).page.id

    // Only Rich Notes contribute to the link index, so the linking page is a Rich
    // Note carrying a real internal link mark rather than a Markdown `[[...]]`.
    await seedPage(request, source, 'rich', [
      {
        id: 'p1',
        type: 'paragraph',
        props: {},
        content: [
          { type: 'text', text: 'See ', styles: {} },
          { type: 'link', href: `#/page/${targetId}`, content: [{ type: 'text', text: target }] }
        ]
      }
    ])

    await openPage(page, target)
    const entry = page.locator(PANEL).getByTestId('backlink-entry').first()
    await expect(entry, 'the linking Rich Note must appear as a backlink').toBeVisible({
      timeout: 15_000
    })
    await expect(entry).toContainText(source)

    await entry.click()
    await expect(page.getByTestId('rich-editor')).toBeVisible()
  })
})
