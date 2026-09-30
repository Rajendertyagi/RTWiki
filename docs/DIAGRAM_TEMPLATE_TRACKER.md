# Diagram tracker

The status of every diagram type RTWiki offers, measured rather than asserted.

This is a **snapshot of a measurement**, not a claim. Every number below was read out
of the running application by
[`tests/browser/diagram-template-fidelity.pwspec.ts`](../tests/browser/diagram-template-fidelity.pwspec.ts),
which renders all thirty templates on both surfaces and fails on any that is not whole,
is not labelled, is cropped, or is drawn larger than its own size. If a template
regresses, the suite fails; this document is the record of the last run, not a
substitute for it.

Reproduce it with:

```sh
bun run build:web
bunx playwright test tests/browser/diagram-template-fidelity.pwspec.ts
```

The spec prints the table below as its output, so the two cannot drift apart
silently — a changed number here is a number the suite printed.

---

## 1. What "working" means here

A template passes when all of these hold, on **both** a Rich Note block and a Diagram
page card:

| # | Rule | Why it is a rule |
|---|---|---|
| 1 | It renders something | Mermaid draws an empty box, with no error, when a definition never resolves. That is the original silent failure. |
| 2 | It is not the empty placeholder | `viewBox` of `0 0 24 24` is that failure's signature. An `<svg>` merely *existing* is not evidence of anything. |
| 3 | It carries labels | With `htmlLabels: false` the labels are `<text>`. A diagram of shapes and no words has lost the thing the user wrote. |
| 4 | It is not cropped | No part of the drawing may sit outside the box it is in. A cropped diagram is data the user cannot reach. |
| 5 | It is not drawn larger than its own size | "Fit" means fitted. A diagram may be shrunk by its box; it may never be blown up by it. |
| 6 | Both surfaces draw it the same way | The same SVG, from the same pipeline, must not come out at two different sizes on two pages. |

Rule 5 is the one the report called "not autofitted", and it fails in **two opposite
directions**. Too large is a surface stretching the drawing; too small *and* cropped
is a box winning against it. A check that only looked for one of them would have
passed throughout.

---

## 2. Status of all thirty templates

Last run: 30 of 30 pass, on both surfaces. Sizes in pixels; `natural` is the SVG's own
`viewBox` extent, which is intrinsic to the element and cannot be a settling-layout
artefact. `note box` and `page box` are the widths the two surfaces actually gave the
diagram, which differ (a note column is about 822px, a Diagram page card about 479px)
and are the reason some diagrams are shrunk on one side and not the other.

| template | natural | note box | note drawn | page box | page drawn | cross-surface | status |
|---|---|---|---|---|---|---|---|
| `flowchart` | 426x414 | 822 | 426x414 | 479 | 426x414 | identical | pass |
| `sequence` | 450x275 | 822 | 450x275 | 479 | 450x275 | identical | pass |
| `class` | 180x282 | 822 | 180x282 | 479 | 180x282 | identical | pass |
| `state` | 152x293 | 822 | 152x293 | 479 | 152x293 | identical | pass |
| `er` | 160x468 | 822 | 160x468 | 479 | 160x468 | identical | pass |
| `timeline` | 895x544 | 822 | 822x500 | 479 | 455x277 | shrunk to the narrower box | pass |
| `mindmap` | 134x414 | 822 | 134x414 | 479 | 134x414 | identical | pass |
| `gantt` | 1600x148 | 822 | 822x76 | 479 | 455x42 | shrunk to the narrower box | pass |
| `pie` | 551x450 | 822 | 551x450 | 479 | 455x372 | shrunk to the narrower box | pass |
| `gitGraph` | 275x168 | 822 | 275x168 | 479 | 275x168 | identical | pass |
| `sankey` | 600x400 | 822 | 600x400 | 479 | 455x303 | shrunk to the narrower box | pass |
| `requirement` | 246x402 | 822 | 246x402 | 479 | 246x402 | identical | pass |
| `c4` | 832x508 | 822 | 822x502 | 479 | 455x278 | shrunk to the narrower box | pass |
| `packet` | 1026x109 | 822 | 822x87 | 479 | 455x48 | shrunk to the narrower box | pass |
| `xychart` | 700x500 | 822 | 700x500 | 479 | 455x325 | shrunk to the narrower box | pass |
| `block` | 282x47 | 822 | 282x47 | 479 | 282x47 | identical | pass |
| `radar` | 700x700 | 822 | 700x700 | 479 | 455x455 | shrunk to the narrower box | pass |
| `ishikawa` | 403x186 | 822 | 403x186 | 479 | 403x186 | identical | pass |
| `kanban` | 1040x71 | 822 | 822x56 | 479 | 455x31 | shrunk to the narrower box | pass |
| `userJourney` | 900x540 | 822 | 822x493 | 479 | 455x273 | shrunk to the narrower box | pass |
| `quadrantChart` | 500x500 | 822 | 500x500 | 479 | 455x455 | shrunk to the narrower box | pass |
| `treemap` | 996x371 | 822 | 822x306 | 479 | 455x169 | shrunk to the narrower box | pass |
| `treeView` | 107x186 | 822 | 107x186 | 479 | 107x186 | identical | pass |
| `venn` | 800x450 | 822 | 800x450 | 479 | 455x256 | shrunk to the narrower box | pass |
| `railroad` | 185x207 | 822 | 185x207 | 479 | 185x207 | identical | pass |
| `wardley` | 900x600 | 822 | 822x548 | 479 | 455x303 | shrunk to the narrower box | pass |
| `eventmodeling` | 481x190 | 822 | 481x190 | 479 | 455x180 | shrunk to the narrower box | pass |
| `usecase` | 410x101 | 822 | 410x101 | 479 | 410x101 | identical | pass |
| `agentflow` | 166x269 | 822 | 166x269 | 479 | 166x269 | identical | pass |
| `info` | none (no `viewBox`) | 822 | 300x150 | 479 | 300x150 | not comparable | pass |

**`info` is the one template with no `viewBox`,** and it is called out rather than
averaged in. Mermaid emits it with `width="100%"` and no geometry at all, so there is
no intrinsic size to compare a drawn size against, and rule 5 has nothing to say
about it. It is drawn at 300x150 — the replaced-element default — which is stable,
centred and never cropped, but is not derived from its contents. See section 4.

---

## 3. Defects this tracker was built to find

Each was measured before it was fixed, and each has a test that fails against the
code as it was.

| Defect | Measured | Status |
|---|---|---|
| The Diagram page **stretched** diagrams to fill their card, while a note fitted them. The same 196x976 flowchart was drawn at **455x2266** on the page and 196x976 in a note — 2.3x, with one-letter node labels a third of a card wide. | Unsized Diagram page, five blocks in a row | **Fixed.** Both surfaces now cap with `max-*` and never grow a diagram. `diagram-fit-consistency.pwspec.ts` |
| The size-preset row sat **on top of the diagram** (106x22 overlap at every size in a note) and **on top of the Diagram page's own action bar**, covering the block label and drag handle. | Note, all five presets; Diagram page | **Fixed.** Moved to the bottom-left corner, the one corner nothing else occupies. `diagram-workspace-layout.pwspec.ts` |
| The eight view buttons were **clipped away entirely** on a short block. Auto height on a short diagram gave a 78px box, the pad is 90x90 anchored inside it, so the pad fell outside: no pan, no zoom, no full screen, and no way to undo a zoom. | Note at Auto height; Diagram page at Small | **Fixed.** A block is never shorter than the controls it carries. `diagram-view-controls.pwspec.ts` |
| `info` kept `width="100%"` — the exact attribute `svg-sanitize.ts` exists to remove — because it has no `viewBox` to derive a real size from. | Rendered markup inspected | **Fixed.** A percentage width is not an intrinsic size and is now removed. |
| Pan **up moved the picture down** and pan down moved it up. Left and right were correct, so it read as a rendering fault rather than two swapped signs. | `--view-y` went to `+40px` on pan-up | **Fixed.** `diagram-view-controls.pwspec.ts` |

---

## 4. Known limitation: `info` has no size of its own

Mermaid emits `info` with `width="100%"` and **no `viewBox`**, so the drawing carries
no intrinsic geometry. The sanitizer now removes the percentage width — leaving it was
the bug — and the element falls back to the browser's replaced-element default of
300x150.

That is stable, centred, never cropped, and identical on both surfaces. It is **not**
derived from the diagram's contents, and there is no way to derive it in the sanitizer:
the element is parsed but never laid out, and a sanitizer that attached it to the
document to measure it would be doing something it should not do. Getting a real size
means measuring after render, which is a change to the render pipeline rather than to
this file, and is not built.

**Not** one of the two Mermaid types that are deliberately withheld
(`architecture-beta`, `cynefin-beta`, which render as the empty placeholder and are
explained in `insert-blocks.ts`); `info` renders, and renders labels.

---

## 5. How to add a template

1. Add it to `DIAGRAM_TEMPLATES` in
   [`insert-blocks.ts`](../src/web/features/rich-editor/insert-blocks.ts) with a source
   that Mermaid actually detects. Most newer types need a `-beta` keyword and a bare
   name does not parse.
2. Add its icon and family to `PRESENTATION` in
   [`diagram-template-catalog.ts`](../src/web/features/rich-editor/blocks/diagram-template-catalog.ts).
   The map is typed `Record<DiagramTemplateId, Presentation>`, so a template with no
   icon and an icon with no template are both compile errors.
3. Run the fidelity spec. It reads the template list from `DIAGRAM_TEMPLATES` rather
   than restating it, so a new template is measured automatically and cannot ship
   without a layout result.
4. Copy the new row into section 2 above.

**Do not restate the source in a test.** An earlier version of the fidelity spec kept
its own copy of all thirty sources; three of them were typos that did not parse, and
the spec confidently reported three broken templates that were merely three broken
copies of its own. The list in the application is the one definition.
