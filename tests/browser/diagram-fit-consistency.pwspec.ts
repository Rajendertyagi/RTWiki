import { type APIRequestContext, expect, test } from '@playwright/test'

/**
 * The two surfaces must lay the same Mermaid output out the same way.
 *
 * ## The defect this guards
 *
 * The Rich Note fitted the diagram to its box and the Diagram page stretched it to
 * fill it. The same SVG, from the same pipeline, therefore came out at two different
 * sizes depending on which page it was on, and the Diagram page's answer was the
 * absurd one. Measured there, unsized, five blocks in a row:
 *
 *   natural 656x67   -> drawn 455x46    (shrunk to fit: correct)
 *   natural 196x976  -> drawn 455x2266   (2.3x larger than it has any right to be)
 *   natural 1806x67  -> drawn 455x17    (shrunk to fit: correct)
 *   natural 551x450  -> drawn 455x372   (shrunk to fit: correct)
 *   natural 1600x148 -> drawn 948x88    (shrunk to fit: correct)
 *
 * The 196x976 one is a ten-node flowchart: it rendered with single-letter node labels
 * a third of the card wide, and a card 2290px tall. The note drew the identical
 * diagram at its own 196x976. `preserveAspectRatio` letterboxes the *drawing* inside a
 * stretched *element*, so nothing looked broken and nothing errored - the diagram was
 * simply enormous, which is what "the diagram is not autofitted" looks like when the
 * diagram happens to be narrower than its box.
 *
 * The rule both surfaces now share: the diagram keeps its own size, shrinks when the
 * box is smaller, is never cropped, and is never enlarged past its natural size.
 */

const TALL_FLOWCHART = 'flowchart TD\n    A --> B --> C --> D --> E --> F --> G --> H --> I --> J'
const WIDE_FLOWCHART = 'flowchart LR\n    A[One] --> B[Two] --> C[Three] --> D[Four] --> E[Five]'
const PIE = 'pie title Pets\n    "Dogs" : 386\n    "Cats" : 85\n    "Rats" : 15'

async function seedDiagramPage(
  request: APIRequestContext,
  title: string,
  keys: string[]
): Promise<string> {
  const sources: Record<string, string> = {
    tall: TALL_FLOWCHART,
    wide: WIDE_FLOWCHART,
    pie: PIE
  }
  const response = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'diagram',
      content: JSON.stringify({
        version: 2,
        type: 'diagram',
        blocks: keys.map((key) => ({ id: key, source: sources[key] ?? PIE }))
      })
    }
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { page: { id: string } }).page.id
}

async function seedNote(
  request: APIRequestContext,
  title: string,
  keys: string[]
): Promise<string> {
  const sources: Record<string, string> = {
    tall: TALL_FLOWCHART,
    wide: WIDE_FLOWCHART,
    pie: PIE
  }
  const response = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify(
        keys.map((key) => ({ type: 'diagram', id: key, content: sources[key] ?? PIE }))
      )
    }
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { page: { id: string } }).page.id
}

interface Row {
  natural: { w: number; h: number }
  drawn: { w: number; h: number }
  overhang: { bottom: number; right: number }
}

/** Natural and drawn geometry of every diagram on a Diagram page. */
async function readDiagramPage(page: import('@playwright/test').Page): Promise<Row[]> {
  return await page.evaluate(() =>
    [...document.querySelectorAll('section[data-testid^="diagram-block-"]')].map((card) => {
      const svg = card.querySelector('[data-testid$="-svg"] svg') as SVGElement | null
      const canvas = card.querySelector('[data-testid="diagram-rendered"]') as HTMLElement | null
      if (!svg || !canvas) {
        return {
          natural: { w: 0, h: 0 },
          drawn: { w: 0, h: 0 },
          overhang: { bottom: 0, right: 0 }
        }
      }
      const s = svg.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      return {
        natural: {
          w: Math.round(Number.parseFloat(svg.getAttribute('width') ?? '0')),
          h: Math.round(Number.parseFloat(svg.getAttribute('height') ?? '0'))
        },
        drawn: { w: Math.round(s.width), h: Math.round(s.height) },
        overhang: {
          bottom: Math.round(Math.max(0, s.bottom - c.bottom)),
          right: Math.round(Math.max(0, s.right - c.right))
        }
      }
    })
  )
}

/** The same, for a note, where the block is the reference rather than a canvas. */
async function readNote(page: import('@playwright/test').Page): Promise<Row[]> {
  return await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="diagram-container"]')].map((box) => {
      const svg = box.querySelector('[data-testid="diagram-svg"] > svg') as SVGElement | null
      if (!svg) {
        return {
          natural: { w: 0, h: 0 },
          drawn: { w: 0, h: 0 },
          overhang: { bottom: 0, right: 0 }
        }
      }
      const s = svg.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      return {
        natural: {
          w: Math.round(Number.parseFloat(svg.getAttribute('width') ?? '0')),
          h: Math.round(Number.parseFloat(svg.getAttribute('height') ?? '0'))
        },
        drawn: { w: Math.round(s.width), h: Math.round(s.height) },
        overhang: {
          bottom: Math.round(Math.max(0, s.bottom - b.bottom)),
          right: Math.round(Math.max(0, s.right - b.right))
        }
      }
    })
  )
}

const KEYS = ['tall', 'wide', 'pie']

test.describe('the Diagram page fits a diagram the same way a note does', () => {
  test('no diagram is drawn larger than its own natural size', async ({ page, request }) => {
    const title = `FitPage ${Date.now()}`
    const id = await seedDiagramPage(request, title, KEYS)
    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto(`/?page=${id}`)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('section[data-testid="diagram-block-0"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(600)

    const rows = await readDiagramPage(page)
    expect(rows).toHaveLength(3)

    for (const [index, row] of rows.entries()) {
      const where = `${KEYS[index]} (natural ${row.natural.w}x${row.natural.h})`
      // The assertion that was 2.3x out before the fix. A drawn size may be
      // *smaller* than natural - that is fitting - but never larger.
      expect(
        row.drawn.w,
        `${where}: the diagram must not be stretched wider than it is`
      ).toBeLessThanOrEqual(row.natural.w + 1)
      expect(
        row.drawn.h,
        `${where}: the diagram must not be stretched taller than it is`
      ).toBeLessThanOrEqual(row.natural.h + 1)
      // Still never cropped, which is the other half of "fit".
      expect(row.overhang.bottom, `${where}: nothing below the box`).toBe(0)
      expect(row.overhang.right, `${where}: nothing beside the box`).toBe(0)
    }
  })

  test('the two surfaces draw the same diagram at the same size', async ({ page, request }) => {
    // The drift itself, asserted as a comparison rather than as two absolute
    // expectations, because "the same" is the requirement and an absolute number
    // would have to be written twice and could pass while the two disagreed.
    const noteId = await seedNote(request, `FitNote ${Date.now()}`, KEYS)
    const pageId = await seedDiagramPage(request, `FitBoth ${Date.now()}`, KEYS)

    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto(`/?page=${noteId}`)
    await expect(page.locator('[data-testid="diagram-svg"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(600)
    const inNote = await readNote(page)

    await page.goto(`/?page=${pageId}`)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('section[data-testid="diagram-block-0"] svg').first()).toBeVisible({
      timeout: 20_000
    })
    await page.waitForTimeout(600)
    const onPage = await readDiagramPage(page)

    expect(inNote).toHaveLength(3)
    expect(onPage).toHaveLength(3)
    for (const [index, key] of KEYS.entries()) {
      const inNoteRow = inNote[index]
      const onPageRow = onPage[index]
      expect(inNoteRow, `${key} must be present in the note`).toBeDefined()
      expect(onPageRow, `${key} must be present on the page`).toBeDefined()
      if (!inNoteRow || !onPageRow) continue
      // A diagram wider than the column is shrunk on one surface and not the other
      // depending on the column widths, which is legitimate. A diagram *narrower*
      // than its box must be identical on both, and that is the case that broke.
      if (inNoteRow.natural.w > 800) continue
      expect(onPageRow.drawn, `${key} must be drawn the same size on both surfaces`).toEqual(
        inNoteRow.drawn
      )
    }
  })
})
