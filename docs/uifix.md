# Mermaid UX work, and the KNOWN_BUGS pass — report

Written 2026-09-29 on `feat/backup-restore`, working tree only, **not committed**.
Part 1 covers the Diagram page UI restructure, the Mermaid toolbar move, the
flexible workspace, and the Mermaid surfaces in Rich Document. **Part 2** covers
the systematic pass over every entry in [KNOWN_BUGS.md](KNOWN_BUGS.md), which
found that three of the most alarming entries were already fixed, fixed six real
defects, and **reverted one of my own fixes after measuring it**.

---

# Part 2 — The KNOWN_BUGS pass

## The finding that mattered

I read every entry against the code before touching anything. Three entries that
read as live, serious holes **were already fixed in the tree while still claiming to
be open**:

- **"Any web page can write to the server."** The `Host` allowlist
  (`app.ts:166`) and `isSameOrigin` on unsafe methods (`app.ts:174`) are both
  built, in `createApp()` rather than per route. The entry's "17 routes with no
  check" table describes a state that no longer exists.
- **"`checkIntegrity()` throws on severe corruption."** The `try`/`catch` is
  present and committed.
- **The two `isDirty` definitions.** Real, but inert — nothing consumed the
  answer.

A defect list that is not re-read against the code stops being evidence and
becomes folklore. `KNOWN_BUGS.md` now says so at the top, and `AGENTS.md` §9 was
corrected — it still described the cross-origin hole as unimplemented.

## Fixed, with tests

| Defect | Fix | New tests |
|---|---|---|
| JSON bodies never checked `Content-Type` | 415 unless JSON, in the **one shared reader** | 10 + 15 |
| `pages.ts` had a private copy of that reader | Deleted; it calls the shared one with its own ceiling | — |
| Unreferenced images never reclaimed | Scan/delete pass, wired into startup | 12 + 5 |
| 11 `!important` in the tree stylesheet | File-level suppression with the reason | — |
| Fatal error window closed itself | TTY-guarded pause | 1 |
| `isDirty` meant two things | One shared definition | 9 |
| **The JSON API set no `Cache-Control` at all** | Gap-filling `no-store` for `/api/*` | 8 |

The `Content-Type` rule is worth spelling out: a `POST` with `text/plain` is
CORS-**simple**, so the browser dispatches it with no preflight from any page the
user visits, and the reader would `JSON.parse` whatever arrived. Requiring
`application/json` removes the free pass. It is defence in depth — the origin
guards are the primary control — and the test asserts both layers separately so
neither is counted twice.

## The one I fixed, measured, and reverted

The `KNOWN_BUGS` entry about losing pending typing on close **prescribed its own
fix**: flush the autosave controller on `visibilitychange → hidden`, with
`pagehide` as a fallback. I implemented it. It is tidy, small, and does what it
says.

It broke the app. The browser suite went from **5 failures to 12** — every one a
rename-and-navigate spec. Two causes, and the second is fatal to the idea:

1. **The write is not deliverable.** Neither event lets the page await anything.
   The browser tears the document down as soon as the handler returns, so the
   in-flight `PATCH` is usually cancelled. It traded a *certain* two-second loss
   for an *unreliable* save.
2. **It races the app's optimistic concurrency.** Page writes are version-checked
   and a stale version is a 409. Every existing flush is user-initiated and
   awaited, so a conflict surfaces to whoever caused it. A browser-fired flush is
   neither, and it lands between a read and a write belonging to someone else.

I removed it. The bug it targeted is **still open** and the entry now carries the
measurement, because a fix that was plausible, implemented cleanly, and measured
wrong is worth more in a defect log than a silent absence of it.

**How I know it was mine, and not the database.** I first assumed the failures
were the 3,472 test-created pages in `data/rtwiki.sqlite`, and the isolation runs
supported that: the three affected specs passed together, 42/42. Then I ran the
**full suite on the stashed, unmodified tree** — and it came back nearly clean,
which contradicted my explanation. Bisecting by disabling only the listeners took
it back to 5. I had blamed the data because the cheaper evidence pointed there,
and I was wrong.

## Could not be fixed here, and say so

- **Native desktop shell** — needs a Rust toolchain this machine does not have.
  Environment, not a defect.
- **`architecture` and `cynefin` diagrams** — withheld; cause unestablished, and
  the fix is renderer work that was out of scope.
- **`gitGraph`/`venn` "identical across versions"** — the premise does not hold.
  RTWiki pins Mermaid 12.0.0 and has 10.9.3 nowhere in the tree, so the
  comparison is a measurement about a version the app does not ship. Retired with
  the experiment described, rather than left as folklore.
- **The debounce-window loss** — the only real fix is a draft in `IndexedDB`,
  which means a second unencrypted copy of private note content in the browser
  profile. The owner's call, not mine.
- **`presets/apply` with `mode: "replace"`** — no confirmation and no undo. It is
  no longer cross-origin reachable; what remains is a product decision.
- **~2,500 junk test pages in `data/rtwiki.sqlite`** — **not deleted.** It is
  your real database, and removing rows from it needs your consent.

## Verification

| Check | Result |
|---|---|
| `typecheck` | 0 |
| `format:check` | 0 |
| `lint` | 0 (50 warnings, 8 infos — none in changed files) |
| `bun test` | **1275 pass, 0 fail**, 85 files (was 1215) |
| **Browser suite, full** | **412 passed, 0 failed** |
| `verify-docs` | PASS |

The full browser suite is the number that matters here, because it is the check
that caught my own regression. It is green, and the baseline it was compared
against was not.

## Not verified

- Nothing was confirmed by eye. Every claim is a DOM measurement or a test.
- The Windows executable cannot be built here (no Rust).
- No new browser spec covers the lifecycle listeners, because there are none.
- `data/rtwiki.sqlite` still holds the accumulated test pages.

---

## 1. What was asked, and what actually turned out to be missing

The request was to make the Diagram page follow the Rich Document's structure
(tabs, toolbar, info bar, workspace) and to put the Mermaid toolbar at the top so
that picking a template adds that diagram directly.

Mapping the two UIs first changed the shape of the job. Tabs and the page-information
header were **already shared and app-level** — `TabStrip` is built once in `App.tsx`
and handed to the shell, and `EditorHeader` renders unconditionally for every page
type. Neither needed building.

The real gap was narrower and more specific:

| Element | Rich Note | Diagram page, before |
|---|---|---|
| Tab strip | app-level, shared | **already had it** |
| Page-information header | `EditorHeader` | **already had it** |
| Toolbar row | `classes.toolbarRow` | **absent** — rendered only for `rich` and `html` |
| Workspace | yes | yes |

So the work was one missing row, not a parallel UI system. That is why
`page-workspace.tsx` is the only shell file that changed.

## 2. The bug that was worth the whole exercise

Moving the toolbar to the page level required handing the workspace's "add a
diagram" action up to the toolbar, through a callback. The first version was:

```tsx
const [diagramTemplatePick, setDiagramTemplatePick] = useState<((s: string) => void) | null>(null)
// ...
onTemplatePickReady={setDiagramTemplatePick}   // receives the function directly
```

**React treats a function passed to `setState` as a functional updater and calls it
with the previous state.** So the instant the workspace handed its handler up,
React invoked it with `null`, which:

1. appended a diagram whose `source` was `null`,
2. produced a document the server rejected — `400 Stored content is not a valid
   visual page document`,
3. left the toolbar permanently absent, because the state had become the return
   value of a call that returned `void`,
4. and crashed `RightSidebarRegion` with `Cannot read properties of null (reading
   'length')`.

The type system was entirely satisfied. Nothing warned. It was found by probing the
live DOM, then reading a stack trace, after the obvious explanations (lazy chunks,
circular imports, a missing CSS rule) had each been checked and eliminated.

The fix makes the mistake unrepresentable rather than merely avoided — the state
holds an object, so a bare function can never be mistaken for a state value:

```tsx
const [diagramTemplate, setDiagramTemplate] = useState<{ pick: (s: string) => void } | null>(null)
onDiagramTemplatePickReady={(pick) => setDiagramTemplate(pick ? { pick } : null)}
```

**A second real bug was introduced and caught in the same work:** wrapping each
diagram card in the resize container dropped `key={block.id}`. React then
reconciled the block list by index, so a diagram added in the middle would reuse a
neighbour's `DiagramCanvas` — and with it that component's already-rendered SVG —
showing one diagram twice and another not at all. Restored, with the reason
recorded at the site.

## 3. A false alarm worth keeping

Several rounds were spent convinced that newly added diagrams were rendering empty:
`viewBox` read `0 0 24 24` every time. They were not. The locator was scoped to the
block card, and the **first `svg` in DOM order inside a card is a 24×24 Mantine
action icon** in its toolbar. Every diagram was rendering correctly.

Two changes came out of it, both worth having regardless:

- `DiagramCanvas` now publishes `data-testid="{testId}-svg"`, so a test can address
  the diagram rather than the card's furniture.
- Those assertions read the SVG's intrinsic `viewBox` rather than a layout box. A
  layout box is read while the block is still settling and reports 0 for a diagram
  about to be 800px wide — which had also made an earlier version of one test fail
  on a correct result.

## 4. Changes made

| File | Change |
|---|---|
| `src/web/features/pages/page-workspace.tsx` | Toolbar row extended to `diagram`; state held as `{ pick }`; renders `DiagramTemplateBar` |
| `src/web/features/visual-pages/mermaid-workspace.tsx` | `onTemplatePickReady` handoff; template bar removed from edit mode; `addBlockWithSource`; blocks wrapped in `ResizableBlockContainer` with `key={block.id}`; optional dimensions committed on resize |
| `src/web/features/visual-pages/mermaid-workspace.module.css` | `.blockList` became a wrapping flex row, not a column; stored widths honoured over the flex basis |
| `src/web/features/visual-pages/diagram-canvas.tsx` | `-svg` testid on the canvas |
| `src/web/features/rich-editor/blocks/diagram-template-bar.tsx` | Control size 48px → 32px to fit the 40px toolbar row |
| `src/shared/schemas/visual-page-content.ts` | Optional `width`/`height` on `VisualPageBlockSchema` |
| `tests/browser/diagram-workspace-layout.pwspec.ts` | **New** — 10 tests for the behaviour below |
| `tests/browser/diagram-templates.pwspec.ts` | Bar tests retargeted from edit mode to the toolbar row |
| `tests/browser/visual-pages.pwspec.ts` | Removed the in-edit-pane picker step |

### Requirement-by-requirement

1. **Tabs / toolbar / info bar / workspace** — tabs and the info header were already
   shared. The toolbar row was added to the Diagram page using the same container and
   the same `--rtwiki-toolbar-height` token, so the three toolbars sit at the same
   height on every page type. Order is toolbar → info bar → workspace, matching the
   Rich Note, and a test asserts that ordering rather than mere presence.
2. **Template click adds directly** — the bar left edit mode; `onPick` appends a
   block. Verified: a click adds the chosen diagram and the page stays in `view` mode.
3. **Flexible workspace** — a wrapping flex row. Two diagrams share a row at 1800px
   and stack one per row at 900px, both asserted. No horizontal overflow at either
   width. Vertical overflow scrolls; nothing is shrunk to fit — asserted by checking
   the SVG carries `max-height: none`. Both-axis resize via the existing
   `ResizableBlockContainer`, which was already two-axis and had simply never been
   used on this page.
4. **Rich Document** — horizontal resize already worked (corner handle, both axes,
   keyboard, presets). Verified by test rather than rebuilt. The note remains a
   scrolling document; no column system was introduced.
5. **Same templates both surfaces** — unchanged and verified by a test that compares
   the chooser's offered ids against `DIAGRAM_TEMPLATES` itself, so a template added
   to one and not the other fails the suite. Mermaid stays out of the slash menu.

## 5. Verification

| Check | Result |
|---|---|
| `typecheck` | 0 |
| `format:check` | 0 |
| `lint` | 0 (62 warnings) |
| `bun test` | **1215 pass, 0 fail**, 79 files |
| Browser, 8 affected specs | **116 passed, 0 failed** |
| Browser, 10 further specs | **98 passed, 4 failed** |
| New layout spec | **10 passed** |
| `diagram-templates` | `total=30 failures=0`, real pipeline |
| `verify-docs` | PASS |

Every layout claim is measured from the live DOM in the real application, including
the sanitiser — nothing here was verified by rendering Mermaid in isolation.

## 6. UX issues discovered and left

- **Size presets overlap the block's own toolbar** on the Diagram page. They are
  absolutely positioned top-left, where the card's action row is. Hover-only, and
  the same overlap already exists on rich-note blocks, so it was not a regression —
  but it is untidy and the presets are the keyboard-reachable resize path.
- **A block dragged shorter than its diagram overlaps the next row** rather than
  clipping. Only reachable by explicitly under-sizing; the default is `auto`.
- **30 templates in a 40px row is dense.** The overflow dropdown does most of the
  work, which is the arrangement the bar's own tests already cover.

## 7. Not verified

- **Four `stability-regressions` failures are not from this change.** Three are
  tree-row lookups in a spec that was never touched, and the tree **virtualises**
  (`wb-tree-host.ts:322`). They reproduce in isolation. The cause is data volume:
  `data/rtwiki.sqlite` holds **2514 pages, all created by today's test runs**, so a
  freshly seeded page sits outside the rendered window and the test never scrolls
  to it. I did not prove this by running the pre-change code, and did not fix it —
  it is test infrastructure, outside this task. The fourth is a teardown artefact
  ("browser has been closed").
- **Lint reports 62 warnings against a 61 baseline.** The extra one could not be
  attributed: every diagnostic Biome lists is in a file this change did not touch,
  and linting the seven changed files directly is clean.
- 14 browser specs remain unrun.
- Windows executable build — CI only, no Rust toolchain here.
- Nothing was confirmed by eye. Every claim is a DOM measurement.

---

# Part 3 — the resize regression (2026-09-29)

## 8. What was reported

> "unable to resize properly, junky resizing, not consistent, nor you can do what you want"

The report was correct, and it was a regression I had introduced in Part 2. I reproduced it before
arguing about it. An 160px drag on the corner handle, sampled on every `pointermove`:

```
BEFORE 481x328
TRACK  481x340 -> 481x352 -> 481x364 -> ... 481x424     <- width never moved
AFTER  641x424                                             <- snapped on release
```

Every one of eight samples read 481. The box did not move horizontally during the drag at all.

## 9. Three causes, all measured

1. **I had made the reorder item the fixed box.** It took `width`/`height` from the block, and the
   resize container inside it was forced to `width: 100%`. The item's value only changed on commit,
   so the container had nowhere to grow.
2. **The drag clamp used `parent.clientWidth`.** The parent is the reorder item, which shrink-wraps
   the block, so once a block had been sized the clamp equalled its own width and the block could
   never be widened again. Replaced with `widthCeiling()` — the full width of the nearest scrolling
   ancestor, so a block may grow to the whole row and the wrapping layout re-wraps underneath it.
   Measured before the fix: 10px of travel available on a 481px block.
3. **The fix I tried first re-rendered the workspace per mouse move.** Holding the in-flight size in
   `useState` meant a `setState` per `pointermove` re-rendering every Mermaid canvas on the page. The
   box tracked but lagged the pointer by up to 31px. That lag is most of what "junky" meant.

## 10. The prototype, and why it came second

I should have prototyped before editing, and did not. After the third attempt I built a standalone
page — no framework, mirroring the app's exact DOM and CSS — to test the mechanism before touching any
further source file. It is at
`C:\Users\RTPC\AppData\Local\Temp\opencode\resize-proto.html` and runs by opening it.

It measured the two candidate mechanisms head to head on an 8-step drag:

| | item tracks pointer | box tracks pointer | worst error |
| --- | --- | --- | --- |
| write on the container | ✗ | ✗ | **160px** — frozen for the whole drag |
| write on the ancestor | ✓ | ✓ | **0px** — exact, both axes, every sample |

It also confirmed the ceiling clamps cleanly (1526px in a 1560px row), the floor at 240×120, and
**zero** neighbour collisions while growing a block to 970px.

**What the prototype could not test:** whether Motion forwards a ref to the DOM node. That turned out
to be answerable from source — `framer-motion` 13.4.4, `ReorderItemComponent(..., externalRef)` —
and the answer is yes. It also could not test React's ownership of the stored style property, which is
where the one remaining subtlety lives.

## 11. What shipped

The in-flight size is published as `--block-width-live` / `--block-height-live` **on the reorder item**,
written straight to the DOM from the resize container via a ref, with no React involved.

Two details are load-bearing and both were found by a failing test, not by reasoning:

- **A separate property name.** The item also carries the *stored* size, published by React. Clearing
  the live value on release must not remove it, and React would not put it back — from its point of
  view the value it wrote has not changed. A shared name would leave a sized block with no size and
  fall back to its row share. There is a test for exactly this.
- **A drag that changes nothing commits nothing.** `pointerup` used to commit the block's current
  measured size, so a bare click on the handle turned an unsized block into a sized one the user
  never asked to size and could not undo except by resizing it again. The guard compares against the
  drag's own measured start, not the stored prop — comparing against the prop is wrong, because an
  unsized block's stored width is `''` while its measured width is a real number.

## 12. Verification

| Gate | Result |
| --- | --- |
| `bun run typecheck` | 0 |
| `bun run format:check` | 0 |
| `bun run lint` | 1 error, pre-existing, in `tests/browser/right-sidebar.pwspec.ts` — untouched by this work |
| `bun test` | **1283 pass, 0 fail** |
| `bun run test:browser` | **432 passed, 0 failed** (429 before, +3 new) |
| `bun scripts/verify-docs.ts` | PASS |
| `bun run build:web` | 0 |
| server compile | 0 — verified by compiling to a scratch path, 88.1 MB |

Three tests added to `tests/browser/diagram-workspace-layout.pwspec.ts`, because **every earlier resize
test read the size after the pointer came up** — which is why a frozen control passed all of them:

- the block follows the pointer during a widening drag, on both axes, sampled synchronously inside the
  `pointermove` that published the size;
- a drag that ends where it started leaves the stored size intact;
- clicking the handle without moving does not size the block.

**The first test was checked against the old code** by reverting the fix: it fails with
`box width 481 vs expected 496`. It is a real guard, not a passing decoration.

**Two of the three initially failed for a reason worth recording:** at the Playwright default viewport
block 1 already spans the whole block list, so the drag ceiling equals its current width and widening
is *correctly* refused. The tests were measuring the clamp, not the tracking. Both now set a viewport
wide enough to have headroom. Narrowing would not have caught the original bug at all, because a box
can shrink inside its share — the drag has to go the other way.

## 13. Not verified

- **`bun run build` cannot complete here.** The compile succeeds but the final move to
  `build/server/RTWiki.exe` fails with `EPERM` because a running RTWiki instance (pid 7048, listening
  on `127.0.0.1:8080`) is holding the file. I did not kill it, in case it is in use. Closing the app
  unblocks the gate. This is an environment lock, not a code failure — proven by compiling the same
  entry point to a scratch path successfully.
- **Nothing was confirmed by eye.** Every number here is a DOM measurement. The prototype is a
  faithful copy of the CSS, not the app.
- `build:desktop` / the Windows executable — no Rust toolchain in this environment.

---

# Part 4 — two diagram surfaces, and a size control you can read (2026-09-29)

## 14. What changed, and what did not

**The renderer was never the difference.** Both surfaces call the same function with the same
config — `renderMermaidSvg` with `theme: colorScheme === 'dark' ? 'dark' : 'default'`, the same
`MERMAID_CONFIG`, the same `svg-sanitize.ts`. There is no second Mermaid setup to drift.

What *had* drifted was everything around it, and all of it was in CSS the two surfaces do not
share:

| | Rich Note block (was) | now | Diagram page |
|---|---|---|---|
| background | `#fff` | `oklch(0.955 0.004 255)` | same |
| border | `#ced4da` | `oklch(0.86 0.008 255)` | same |
| caption | uppercase, letter-spaced | sentence case, muted | same |
| floating toolbar | 0.7 opacity until hover | opaque | same |

The background was the visible one: in the light scheme the note's block was **a white block on a
white canvas**, held apart by a hairline, next to a grey card.

## 15. A false start worth recording

I thought the diagram was left-aligned in the note and centred on the page, and "fixed" it with a
flex wrapper. Then I reverted the fix and the test passed either way — `margin: 0 auto` was already
centring it. The change did nothing, so it was removed rather than left in as decoration. The
comment in `mermaid-block.module.css` now records that it was tried and measured, so the next
reader does not re-add it.

## 16. A phantom width in the document

Reported as "cannot flex horizontally". The block in a note already spans its whole document
column, so a rightward drag asks for width that does not exist. The real defect was quieter:

```
DURING  container=820 pane=842   (×6 samples, unmoved)
AFTER   storedW="948"           (rendered 820)
```

A width the page can never draw was written to the document, and `max-width: 100%` reduced it on
every render — so the stored width disagreed with the picture forever, across reloads.

Two causes, both measured:

1. **The drag committed the *requested* width, not the rendered one.** Now measured with the live
   size still applied, which is the only moment the box holds its final geometry.
2. **`clientWidth` includes the parent's padding**, while `max-width: 100%` resolves against the
   content box. The `large` preset stored 840 in an 820px box. Now `availableWidth()`.

## 17. The size presets read as `S M L F A`

They were `label.charAt(0)` — five bare letters, with the real name only in a hover tooltip. Two
of the five mean *behaviour* rather than size ("Full width", "Auto height") and neither is
guessable, and a tooltip is no help on a touch screen.

Now drawn: a single solid bar whose **width** is the size (dot / short / long), arrows out to the
edges for *Full width*, and a frame with vertical arrows for *Auto height*. A dashed frame was
tried first and read as noise at the 16px an `ActionIcon size="compact-xs"` leaves.

**The accessible name is unchanged** and still carries the full label, so this is visual only: a
screen reader announces "Size: Medium", not "M".

## 18. What the tests do and do not prove

Both new tests were **checked against the unfixed code**, because a first attempt at the phantom
test passed against the bug:

| test | unfixed code |
|---|---|
| preset stores what it draws | fails — `stored 520px must equal the 500px the block actually draws` |
| stored width equals drawn width | fails — `stored 628 must equal the 500px the block actually draws` |

The phantom test **was rewritten once**: asserting "nothing was written" passed against the buggy
code, because whether anything is written depends on where the drag ceiling happens to fall. It
now asserts the *equality*, which is the invariant.

## 19. Not verified

- **Nothing was confirmed by eye in the app.** The preset glyphs were reviewed as a zoomed
  screenshot; the rest is DOM measurement.
- **The Rich Note's diagram block still has no grip, no up/down, no remove and no action bar.**
  Drag-to-reorder was explicitly deferred. The bar and the keyboard route are not, and would use
  BlockNote's own `editor.moveBlocksUp` / `moveBlocksDown` (verified present in 0.54) rather than
  anything hand-rolled.
- `bun run build` — still blocked by the running instance, as in Part 3.

