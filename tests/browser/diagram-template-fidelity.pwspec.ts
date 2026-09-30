import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { DIAGRAM_TEMPLATES } from '../../src/web/features/rich-editor/insert-blocks.js'

/**
 * Every template, on both surfaces, measured rather than asserted to exist.
 *
 * ## Why this file exists
 *
 * `diagram-templates.pwspec.ts` proves each template *renders*: an `<svg>` appears,
 * it is not Mermaid's 24x24 empty placeholder, and the labels are there. That is
 * necessary and it is not sufficient. A diagram can render perfectly and still be
 * laid out wrongly, and the layout faults are silent — nothing errors, nothing is
 * missing, the diagram is simply the wrong size or partly out of its box. That is
 * exactly the class of fault that was reported as "the diagram is not autofitted",
 * and it was invisible to every test that only asked whether a diagram appeared.
 *
 * So this file measures the **drawn** geometry of all 30 templates on both surfaces
 * and asserts four things about each:
 *
 * 1. It rendered something (not the empty placeholder).
 * 2. It carries labels.
 * 3. It is never **cropped** by its box on either axis.
 * 4. It is never drawn **larger than its own natural size**, and a note and a
 *    Diagram page draw the same diagram at the same size.
 *
 * Rules 3 and 4 are the two ways "not autofitted" presents, and they are opposites:
 * too large is a Diagram page stretching, too small-and-clipped is a box winning.
 *
 * ## Reading the table it prints
 *
 * Each test prints a markdown row per template, and the whole set is what
 * `docs/DIAGRAM_TEMPLATE_TRACKER.md` records. The document is a snapshot; this file
 * is what keeps it honest, so a template that starts failing says so in the suite
 * rather than only in the document.
 */

/**
 * The templates, read from the one list the application offers.
 *
 * Deliberately **not** restated here. An earlier version of this file carried its own
 * copy of all 30 sources, and three of them did not parse — so it reported three
 * broken templates that were merely three typos of its own. That is the same mistake
 * `diagram-templates.pwspec.ts` already documents and avoids: a restated source is a
 * second definition, and it fails for reasons that have nothing to do with the thing
 * under test. If this file had measured the copies it would have been a very
 * confident report on a subject it had not examined.
 */
const TEMPLATES: Record<string, string> = Object.fromEntries(
  Object.entries(DIAGRAM_TEMPLATES).map(([id, def]) => [id, def.source])
)
/** Mermaid's empty placeholder. A template that renders this has rendered nothing. */
const PLACEHOLDER_EXTENT = 24

const ALL = Object.keys(TEMPLATES)
/** Batches, so one page never holds 30 diagrams and the render queue cannot time out. */
const BATCHES = [ALL.slice(0, 10), ALL.slice(10, 20), ALL.slice(20)]

interface Reading {
  id: string
  rendered: boolean
  hasLabels: boolean
  natural: { w: number; h: number }
  drawn: { w: number; h: number }
  /**
   * The box the diagram has to live in. The two surfaces have different ones, and
   * that is what decides whether a diagram is drawn at its own size or shrunk, so the
   * cross-surface comparison has to be made against this and not against a guess.
   */
  box: { w: number; h: number }
  overhang: { bottom: number; right: number }
}

/**
 * Reads every diagram on a Rich Note, in document order.
 *
 * By position rather than by id, because a note's blocks do not publish their stored
 * id in the DOM — the container's `data-width` is the block's *size*, not its name.
 * The order is the document order, which is the order the blocks were seeded in, and
 * `diagram-canvas` reading below relies on the same assumption.
 */
async function readNote(page: Page): Promise<Reading[]> {
  return await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = []
    const blocks = document.querySelectorAll('[data-testid="diagram-container"]')
    let index = 0
    for (const box of blocks) {
      const id = String(index)
      index += 1
      const svg = box.querySelector('[data-testid="diagram-svg"] > svg') as SVGElement | null
      if (!svg) {
        out.push({ id, rendered: false })
        continue
      }
      const s = svg.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
      out.push({
        id,
        rendered: true,
        hasLabels: (svg.textContent ?? '').trim().length > 0,
        // The natural size is the **viewBox** extent, not the `width` attribute. A
        // percentage width is not a length, and reading it as one reported `info` as
        // a "100px" diagram drawn at 300px - a 3x stretch that never happened. The
        // viewBox is intrinsic to the SVG, so it cannot be a settling-layout
        // artefact either.
        natural: {
          w: Math.round(vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : 0),
          h: Math.round(vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : 0)
        },
        drawn: { w: Math.round(s.width), h: Math.round(s.height) },
        box: { w: Math.round(b.width), h: Math.round(b.height) },
        overhang: {
          bottom: Math.round(Math.max(0, s.bottom - b.bottom)),
          right: Math.round(Math.max(0, s.right - b.right))
        },
        viewBox: svg.getAttribute('viewBox') ?? ''
      })
    }
    return out as never
  })
}

/** Reads every diagram on a Diagram page, in block order. */
async function readDiagramPage(page: Page): Promise<Reading[]> {
  return await page.evaluate(() => {
    const out: Array<Record<string, unknown>> = []
    const cards = document.querySelectorAll('section[data-testid^="diagram-block-"]')
    for (const card of cards) {
      const canvas = card.querySelector('[data-testid="diagram-rendered"]') as HTMLElement | null
      const svg = card.querySelector('[data-testid$="-svg"] svg') as SVGElement | null
      const index = (card.getAttribute('data-testid') ?? '').replace('diagram-block-', '')
      if (!canvas || !svg) {
        out.push({ id: index, rendered: false })
        continue
      }
      const s = svg.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
      out.push({
        id: index,
        rendered: true,
        hasLabels: (svg.textContent ?? '').trim().length > 0,
        natural: {
          w: Math.round(vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : 0),
          h: Math.round(vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : 0)
        },
        drawn: { w: Math.round(s.width), h: Math.round(s.height) },
        box: { w: Math.round(c.width), h: Math.round(c.height) },
        overhang: {
          bottom: Math.round(Math.max(0, s.bottom - c.bottom)),
          right: Math.round(Math.max(0, s.right - c.right))
        },
        viewBox: svg.getAttribute('viewBox') ?? ''
      })
    }
    return out as never
  })
}

async function seedNote(request: APIRequestContext, title: string, ids: string[]): Promise<string> {
  const response = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'rich',
      content: JSON.stringify(ids.map((id) => ({ type: 'diagram', id, content: TEMPLATES[id] })))
    }
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { page: { id: string } }).page.id
}

async function seedDiagramPage(
  request: APIRequestContext,
  title: string,
  ids: string[]
): Promise<string> {
  const response = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'diagram',
      content: JSON.stringify({
        version: 2,
        type: 'diagram',
        blocks: ids.map((id) => ({ id, source: TEMPLATES[id] }))
      })
    }
  })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { page: { id: string } }).page.id
}

/**
 * Waits until every diagram on the page has drawn something.
 *
 * The selector differs by surface, and that is stated here rather than hidden behind
 * a "clever" helper:
 *
 *  - a note's block is `diagram-svg`, and the sanitised SVG is injected straight into
 *    it, so it is a direct child;
 *  - a Diagram page's card is `diagram-block-<n>-svg`, and the SVG is a *grandchild*,
 *    behind the zoom host and the wrapper the markup is injected into.
 *
 * Two separate mistakes were made here while writing this file, and both presented
 * as the same symptom - "no diagram rendered, count zero" - when in fact every
 * diagram had rendered perfectly. A selector written for one surface and used on the
 * other, and then a `> svg` child combinator on the surface where the SVG is nested.
 * Recorded because that failure mode is indistinguishable from a real product fault,
 * and the only way out is to know what the markup actually is on each surface.
 */ async function waitForAllDiagrams(
  page: Page,
  count: number,
  where: 'note' | 'page'
): Promise<void> {
  const selector =
    where === 'note'
      ? '[data-testid="diagram-svg"] > svg'
      : '[data-testid^="diagram-block-"][data-testid$="-svg"] svg'
  await expect
    .poll(async () => page.evaluate((sel) => document.querySelectorAll(sel).length, selector), {
      // Generous, and deliberately so. The first render in a fresh browser context
      // force-loads every lazily-registered Mermaid definition, which is where the
      // 1.4MB ELK and 435kB Cytoscape chunks come from, and RTWiki serialises every
      // render through one queue so a page of ten diagrams renders one after
      // another. Sixty seconds was not enough for a cold page of ten; nothing here
      // is asserting a *duration*, only that every diagram finishes, so the wait is
      // as long as the work can legitimately take.
      timeout: 180_000,
      message: `every diagram must finish rendering on the ${where}`
    })
    .toBe(count)
  // One frame for the layout that follows the render, so the geometry read is of a
  // settled box rather than of the frame the SVG was attached in.
  await page.waitForTimeout(800)
}
/**
 * The per-template checks, named so a failure says which rule was broken.
 *
 * Rule 4 is skipped for a diagram with no `viewBox`, and the skip is counted rather
 * than hidden. `info` is the one template Mermaid emits that way: there is no intrinsic
 * size to compare a drawn size against, so "never drawn larger than its own size" has
 * nothing to say about it. Asserting it anyway would have required inventing a natural
 * size, and the first attempt did exactly that — it read `width="100%"` as 100px and
 * reported a 3x stretch that had not happened.
 */
function checkTemplate(id: string, where: string, reading: Reading): 'sized' | 'no intrinsic size' {
  expect(reading.rendered, `${id} (${where}): must render something`).toBe(true)
  expect(reading.hasLabels, `${id} (${where}): must carry labels`).toBe(true)
  expect(reading.overhang.bottom, `${id} (${where}): must not be cropped at the bottom`).toBe(0)
  expect(reading.overhang.right, `${id} (${where}): must not be cropped at the right`).toBe(0)
  if (reading.natural.w <= 0 || reading.natural.h <= 0) return 'no intrinsic size'
  // Not the empty placeholder either. `0 0 24 24` is what Mermaid draws when a
  // definition never resolves, and it is the defect this whole file exists to catch.
  expect(
    reading.natural.w > PLACEHOLDER_EXTENT || reading.natural.h > PLACEHOLDER_EXTENT,
    `${id} (${where}): rendered Mermaid's empty placeholder, ${reading.natural.w}x${reading.natural.h}`
  ).toBe(true)
  expect(
    reading.drawn.w,
    `${id} (${where}): drawn ${reading.drawn.w} wide from a natural ${reading.natural.w}`
  ).toBeLessThanOrEqual(reading.natural.w + 1)
  expect(
    reading.drawn.h,
    `${id} (${where}): drawn ${reading.drawn.h} tall from a natural ${reading.natural.h}`
  ).toBeLessThanOrEqual(reading.natural.h + 1)
  return 'sized'
}

for (const [batchIndex, batch] of BATCHES.entries()) {
  test(`templates ${batchIndex * 10 + 1}-${batchIndex * 10 + batch.length} are whole and fitted on both surfaces`, async ({
    page,
    request
  }) => {
    // Ten diagrams on each of two surfaces, rendered one at a time through a shared
    // queue, with a cold chunk download for the lazily-registered types. The default
    // 30s is not a bound on any of that.
    test.setTimeout(600_000)
    const noteId = await seedNote(request, `FID note ${batchIndex} ${Date.now()}`, batch)
    const pageId = await seedDiagramPage(request, `FID page ${batchIndex} ${Date.now()}`, batch)

    await page.setViewportSize({ width: 1600, height: 950 })
    await page.goto(`/?page=${noteId}`)
    await waitForAllDiagrams(page, batch.length, 'note')
    const inNote = await readNote(page)

    await page.goto(`/?page=${pageId}`)
    await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
    await waitForAllDiagrams(page, batch.length, 'page')
    const onPage = await readDiagramPage(page)

    const rows: string[] = []
    for (const [index, id] of batch.entries()) {
      const note = inNote[index]
      const card = onPage[index]
      expect(note, `${id}: must be present in the note`).toBeTruthy()
      if (!note) continue
      checkTemplate(id, 'note', note)
      expect(card, `${id}: must be present on the Diagram page`).toBeDefined()
      if (!card) continue
      const kind = checkTemplate(id, 'diagram page', card)

      // The same diagram at the same size on both surfaces — but only where it fits
      // both boxes, because the boxes are genuinely different. A note's column is
      // about 820px and a Diagram page's card about 479px, so a 551px diagram is drawn
      // at its own size in a note and has to shrink on the page. That is the layout
      // working, not the two surfaces disagreeing.
      //
      // Where the diagram fits both, the two must be identical. That is the case the
      // drift broke: a 196x976 flowchart fitted in both, and the Diagram page drew it
      // at 455x2266 while the note drew it at 196x976.
      const fitsBoth = note.natural.w <= Math.min(note.box.w, card.box.w)
      if (fitsBoth && kind === 'sized') {
        expect(
          { w: card.drawn.w, h: card.drawn.h },
          `${id} fits both boxes, so both surfaces must draw it identically (note ${note.drawn.w}x${note.drawn.h} in ${note.box.w}, page ${card.drawn.w}x${card.drawn.h} in ${card.box.w})`
        ).toEqual({ w: note.drawn.w, h: note.drawn.h })
      }

      rows.push(
        `| \`${id}\` | ${note.natural.w > 0 ? `${note.natural.w}x${note.natural.h}` : 'none (no viewBox)'} | ${note.box.w} | ${note.drawn.w}x${note.drawn.h} | ${card.box.w} | ${card.drawn.w}x${card.drawn.h} | ${kind === 'no intrinsic size' ? 'not comparable' : fitsBoth ? 'identical' : 'shrunk to the narrower box'} | pass |`
      )
    }
    console.log(
      '\n| template | natural | note box | note drawn | page box | page drawn | cross-surface | status |'
    )
    console.log('|---|---|---|---|---|---|---|---|')
    for (const row of rows) console.log(row)
  })
}
