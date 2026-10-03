/*
 * The Mermaid fixture audit, kept as a regression test.
 *
 * ## Why this file exists
 *
 * It began as a throwaway audit to answer "which constructs actually work", and it is
 * kept because the answer is not obvious from the source and is easy to regress:
 * three of Mermaid 12.0.0's diagram types fail in ways that produce no clue in the
 * DOM beyond a generic "Diagram error" box.
 *
 * ## The findings it locks down
 *
 * Everything below renders, through the real pipeline, in Chromium. The three that do
 * not are recorded as failures **with their measured cause**, because the causes are
 * upstream grammar defects in Mermaid 12.0.0 and cannot be fixed from here:
 *
 * | type                    | verdict | measured cause |
 * | ----------------------- | ------- | -------------- |
 * | `swimlane-beta`         | fails   | its grammar rejects a lane: `swimlane-beta\n  lane A` → `Expecting 'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', 'LINK', 'LINK_ID', got 'NODE_STRING'`. Fails identically with `layout: 'dagre'`, unset, and `'elk'`, so it is not the global layout pin. |
 * | `architecture-beta`     | partial | services, groups, junctions and service-to-service edges all render; an edge to a **group** endpoint throws `undefined is not an object (evaluating 'this.nodes.get(rhsId).in')`. |
 * | `cynefin-beta`          | partial | `title` alone renders; any `description` line fails with a lexer error on the generated `->d<-` domain markers, in both the bare and `domain` keyword forms. |
 *
 * ## A correction this file records
 *
 * `insert-blocks.ts` previously described all three as rendering "as Mermaid's empty
 * 24x24 placeholder: no error is raised". Both halves of that are wrong — an error IS
 * raised, and the cause is the parser, not the lazy-chunk warm-up. This test is what
 * established that, and it fails if any of the three ever starts rendering.
 *
 * ## Two measurement traps, both hit while writing this
 *
 * 1. A prefix selector on `diagram-block-` also matches the per-block buttons, which
 *    returned 606 elements for 25 fixtures.
 * 2. A bare `svg` inside a block matches a 24x24 toolbar ICON. Reading that as the
 *    diagram reports every fixture — flowchart included — as an empty placeholder.
 *    Hence the `[data-testid$="-svg"]` scoping throughout.
 */

import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '@playwright/test'

/** Constructs Mermaid 12.0.0 handles, spanning the families RTWiki offers. */
const SUPPORTED: Array<{ id: string; source: string }> = [
  { id: 'flowchart', source: 'flowchart TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]' },
  { id: 'sequence', source: 'sequenceDiagram\n  participant U as User\n  U->>U: hi' },
  { id: 'class', source: 'classDiagram\n  class Animal {\n    +name: string\n  }' },
  { id: 'state', source: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Active: start' },
  { id: 'er', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places' },
  { id: 'journey', source: 'journey\n  title S\n  section A\n    Search: 5: C' },
  {
    id: 'gantt',
    source: 'gantt\n  title P\n  dateFormat YYYY-MM-DD\n  T1 :a1, 2024-01-01, 10d'
  },
  { id: 'pie', source: 'pie title Pets\n  "Dogs" : 386' },
  { id: 'mindmap', source: 'mindmap\n  root((Idea))\n    Branch A' },
  { id: 'timeline', source: 'timeline\n  title P\n  2024 : Plan' },
  {
    id: 'quadrantChart',
    source: 'quadrantChart\n  title R\n  x-axis L --> H\n  y-axis L --> H\n  quadrant-1 E'
  },
  { id: 'gitGraph', source: 'gitGraph\n  commit id: "init"\n  branch develop' },
  { id: 'subgraph', source: 'flowchart TD\n  subgraph one [G1]\n    A --> B\n  end\n  B --> C' },
  { id: 'classDef', source: 'flowchart TD\n  A --> B\n  classDef s fill:#f9f\n  class B s' },
  {
    id: 'punctuation-label',
    source: 'flowchart TD\n  A["Cost: $5 (approx.)"] --> B["50% - 60%?"]'
  },
  { id: 'multiline-label', source: 'flowchart TD\n  A["One<br/>Two"] --> B["Three<br/>Four"]' },
  { id: 'links', source: 'flowchart LR\n  A -.-> B\n  B -. d .-> C' },
  { id: 'unicode', source: 'flowchart TD\n  A[日本語] --> B[Ελληνικά]' },
  // Chunk-backed types, to prove lazy loading is not a factor.
  { id: 'venn-beta', source: 'venn-beta\n  set A[Study]\n  set B[Rest]' },
  // The working subset of a type whose full grammar is broken.
  { id: 'architecture services', source: 'architecture-beta\n  service api(server)[API]' },
  {
    id: 'architecture group',
    source: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api'
  },
  { id: 'cynefin title', source: 'cynefin-beta\n  title T' }
]

/** Upstream Mermaid 12.0.0 defects. Each renders nothing and shows an error box. */
const UPSTREAM_BROKEN: Array<{ id: string; source: string }> = [
  { id: 'swimlane-beta', source: 'swimlane-beta\n  lane A\n    A1 --> A2' },
  {
    id: 'architecture edge-to-group',
    source:
      'architecture-beta\n  group api(cloud)[API]\n  service db(database)[DB] in api\n  db:L -- R:api'
  },
  {
    id: 'cynefin description',
    source: 'cynefin-beta\n  title T\n  description A\n  A chaos'
  }
]

/** Invalid input must fail loudly rather than render an empty box. */
const INVALID: Array<{ id: string; source: string }> = [
  { id: 'malformed', source: 'flowchart TD\n  A[Unclosed --> B{' },
  { id: 'unknown-type', source: 'notADiagramType\n  A --> B' }
]

/** Empty and whitespace-only source are a legitimate state, never a parse failure. */
const EMPTY: Array<{ id: string; source: string }> = [
  { id: 'empty', source: '' },
  { id: 'whitespace', source: '   \n\t  \n  ' }
]

const ALL = [...SUPPORTED, ...UPSTREAM_BROKEN, ...INVALID, ...EMPTY]

interface Verdict {
  index: number
  errorShown: boolean
  pending: boolean
  viewBox: string
  shapes: number
  labels: number
}

async function seedAndRead(
  request: APIRequestContext,
  page: import('@playwright/test').Page
): Promise<Verdict[]> {
  const title = `Fixtures ${Date.now()}`
  const res = await request.post('/api/pages', {
    data: {
      title,
      pageType: 'diagram',
      content: JSON.stringify({
        version: 2,
        type: 'diagram',
        blocks: ALL.map((f, i) => ({ id: `fx${i}`, source: f.source }))
      })
    }
  })
  expect(res.status(), 'the fixture page must be created').toBe(201)

  await page.goto('/')
  await page.waitForTimeout(2000)
  await page.getByText(title, { exact: false }).first().click()
  await expect(page.getByTestId('diagram-workspace')).toBeVisible({ timeout: 20_000 })
  // Long enough for the lazily-registered chunks to resolve; several fixtures are
  // chunk-backed and would otherwise be measured mid-load.
  await page.waitForTimeout(12_000)

  return page.evaluate(() =>
    Array.from(document.querySelectorAll('section[data-testid^="diagram-block-"]')).map(
      (el, index) => {
        const svg = el.querySelector('[data-testid$="-svg"] svg')
        return {
          index,
          errorShown: !!el.querySelector('[role="alert"]'),
          pending: !el.querySelector('[role="alert"]') && !svg,
          viewBox: svg?.getAttribute('viewBox') ?? '',
          shapes: svg ? svg.querySelectorAll('path,rect,polygon,ellipse').length : 0,
          labels: svg ? svg.querySelectorAll('text,tspan').length : 0
        }
      }
    )
  )
}

test.describe('Mermaid fixture audit', () => {
  test('supported constructs render, broken and invalid ones fail, empty ones are inert', async ({
    page,
    request
  }) => {
    const verdicts = await seedAndRead(request, page)
    expect(verdicts.length, 'every fixture must produce a block').toBe(ALL.length)

    const at = (offset: number): Verdict => verdicts[offset]!
    const named = <T extends { id: string }>(list: T[], start: number): Array<[string, Verdict]> =>
      list.map((f, i) => [f.id, at(start + i)] as [string, Verdict])

    for (const [id, v] of named(SUPPORTED, 0)) {
      expect(v.errorShown, `${id} must not show an error`).toBe(false)
      expect(v.viewBox, `${id} must produce an SVG`).not.toBe('')
      expect(
        v.shapes,
        `${id} must draw something, not Mermaid's empty placeholder`
      ).toBeGreaterThan(0)
      expect(v.labels, `${id} must render its labels`).toBeGreaterThan(0)
    }

    /*
     * Locked in as failures on purpose. If a Mermaid upgrade fixes any of these, this
     * assertion fails and the type can be added to `DIAGRAM_TEMPLATES` — which is the
     * intended way for this file to change.
     */
    for (const [id, v] of named(UPSTREAM_BROKEN, SUPPORTED.length)) {
      expect(
        v.errorShown,
        `${id} unexpectedly renders now. Mermaid may have fixed it: re-check whether it can be offered as a template.`
      ).toBe(true)
    }

    // Invalid input must be visible, not a silently blank diagram.
    for (const [id, v] of named(INVALID, SUPPORTED.length + UPSTREAM_BROKEN.length)) {
      expect(v.errorShown, `${id} must report an error rather than render nothing`).toBe(true)
    }

    /*
     * `empty_source` behaviour, observed end to end. The renderer returns
     * `empty_source` before importing Mermaid, and both surfaces keep what is already
     * on screen rather than replacing it with an error — so an empty block shows
     * neither an error box nor a diagram.
     */
    for (const [id, v] of named(EMPTY, ALL.length - EMPTY.length)) {
      expect(v.errorShown, `${id} must not be reported as a parse failure`).toBe(false)
      expect(v.viewBox, `${id} must not produce an empty placeholder diagram`).toBe('')
    }
  })
})
