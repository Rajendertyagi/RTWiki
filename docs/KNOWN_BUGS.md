# Known bugs and open issues

A running list of defects found and left unfixed, so they are not rediscovered later.
Every entry records what was **measured**, what remains unproven is said plainly, and an
entry inherited from an earlier pass is marked as such rather than presented as freshly checked.

Last reviewed: 2026-09-29, on branch `feat/backup-restore`.

**A systematic pass over every entry was done on 2026-09-29**, and its finding is worth stating
before the list: **three of the entries most alarming on a first read were already fixed and still
said to be open.** The cross-origin write, `checkIntegrity` throwing, and the `isDirty`
disagreement had all been resolved in code while their entries continued to describe the unfixed
state. A defect list that is not re-read against the code stops being evidence and becomes folklore.

**Resolved in that pass**, each with tests: the JSON media-type rule (item "the readers never inspect
`Content-Type`"), the unreferenced-image reclaim (item 6), the `Cache-Control` gap on the JSON API,
the `isDirty` disagreement, and the fatal-error window (item "A double-clicked `RTWiki.exe`…").
**Entries rewritten as resolved or partly resolved**, with the reasoning preserved: 1 (two types
withheld), 2 (not reproducible, and not closable without a version RTWiki does not ship), 4 (the
context no longer exists), 5 (suppressed with the reason).

**One entry was "fixed", measured, and reverted**, and that is recorded as the entry's most useful
content rather than deleted: flushing autosave on `pagehide`/`visibilitychange` — the fix the
debounce-window entry itself prescribed — took the browser suite from 5 failures to 12, because an
unload-path write races the app's version-checked page writes and is not reliably deliverable. See
that entry. **A fix that was plausible, implemented cleanly, and measured wrong is worth more in a
defect log than a silent absence of it.**

**Two entries could not be closed and say so plainly:** item 3, which needs a Rust toolchain this
machine does not have, and item 1's two withheld diagram types, whose cause is unestablished and
whose fix is renderer work that was explicitly out of scope.

The previous review was 2026-09-27 on `feat/document-attachments`.

**The Mind Map page and block are retired.** A mind map is now a Mermaid template rather than a page
or block type, because both duplicated the Diagram page by a single ternary. The `mindMap` **block**
name is retained for reading only, so a document that already holds one still loads. See
[ADR-019](adr/ADR-019-one-mermaid-page-and-block.md) and [VISUAL_BLOCKS.md](VISUAL_BLOCKS.md).

**Multi-block diagram pages are done:** a page renders every diagram it holds, each as its own card
with its own render state, and each can be edited, moved up or down, or removed. Verified by
`tests/browser/visual-multi-block.pwspec.ts`. Reordering is buttons rather than drag, deliberately —
see [ARCHITECTURE.md](ARCHITECTURE.md) for why, and for the fact that drag-to-reorder is *not*
included.

**Likewise for documents:** the backend exists, is tested, and is now reachable - a Document control sits
beside Image on the Rich Note toolbar. What is still missing is *viewing*: a document downloads rather
than opening in a tab, and that is a deliberate security decision rather than unfinished work. See
item 7.

---

## Open

### 1. ~~Twelve Mermaid diagram types render an empty diagram~~ — RESOLVED, the claim was wrong

**Closed.** Re-measured 2026-09-28. All twelve types render, and the exclusion was based on a
bad measurement rather than a real defect.

RTWiki offered 32 template types, up from 21. Eleven of the twelve that were excluded were added:
quadrantChart, treemap, treeView, venn, architecture, railroad, wardley, cynefin,
eventmodeling, agentflow and usecase. The twelfth, swimlane, remains withheld for an unrelated
reason (below).

**Corrected 2026-09-29, from the application itself.** That pass measured Mermaid in a browser
against a build of `mermaid.core.mjs`, explicitly not the app's bundle and explicitly pre-sanitisation.
Re-measured in RTWiki, through the real pipeline and the real sanitiser, by
`tests/browser/diagram-templates.pwspec.ts`: **30 of the 32 render. Two do not.**

- `architecture` and `cynefin` render as Mermaid's **empty 24×24 placeholder** — no error is
  raised, and no diagram is drawn. The spec fails the build on exactly that signature, which is the
  check that exists to catch it.

**Both have been withheld from the template list** rather than shipped, on the rule the file's own
comment states: a template that renders an empty box is worse than one that is absent. So the honest
current count is **30 offered, 2 withheld, `swimlane` withheld**. `venn`, `treemap`,
`quadrantChart` and `treeView` — the four that were most suspect — all render.

**Why these two, when ten others from the same batch render.** Both ids exist in the installed
Mermaid 12.0.0 but only inside lazily-loaded chunks, and the warm-up in `mermaid-render.ts` does not
resolve them. That is not sufficient to be the cause on its own: `wardley-beta`, `usecase-beta`,
`agentflow-beta` and `railroad-beta` are chunk-backed too and all render. So the gap is specific to
these two definitions, and **the cause is not established** — saying "lazy loading" explains them no
better than it explains the four that work. Closing it is renderer work in `mermaid-render.ts`, which
is out of scope for the change that found it, and it is not attempted here.

**What the earlier entry got wrong.** It rested on a source-reading argument, and marked as
inherited: that Mermaid 12's ordinary `parse` + `render` path never force-loads a lazy diagram, so
those types resolved to an empty 24×24 SVG. The specific claim — that `loadRegisteredDiagrams()` has
exactly one caller — is true, but it does not imply the conclusion. `Diagram.fromText` in
`mermaid.core.mjs` already loads per-type on demand: it calls `getDiagram(type)`, and on failure
falls back to `getDiagramLoader(type)` and awaits the loader. So the bulk loader is a warm-up, not
the only route to a loaded definition. **That explanation is now known to be incomplete**: it
accounts for nothing, and two types still come out empty.

**The likelier explanation for the original result** is sample syntax, which the earlier entry
never separated out. Most of these types need a `-beta` keyword and a bare type name is *not* a
synonym: `venn` does not detect, `venn-beta` does. A wrong keyword throws at parse time rather than
rendering empty, so this explains a loudly-failing probe better than it explains a silent empty
SVG — which is precisely why the original 24×24 signature is not accounted for here.

**`swimlane` is still withheld, for a different reason.** It renders, but as an ordinary flowchart
with no lanes: Mermaid gives swimlanes their own layout engine and this app's global
`layout: 'dagre'` overrides it. Measured, the `cluster swimlane`, `swimlane-body` and
`swimlane-title` elements are absent under `dagre` and present under Mermaid's default layout.
Offering it as "Swimlanes" would misdescribe what the user sees.

**Next step:** if swimlanes are wanted, scope the layout per diagram type rather than globally. That
is a change to `MERMAID_CONFIG` in `src/web/features/rich-editor/blocks/mermaid-render.ts` and is not
done here.

### 2. `gitGraph` and `venn` produce identical markup across versions — NOT REPRODUCIBLE, and not closable here

**Re-measured 2026-09-29: the entry's premise does not hold on the version this build uses.** The
claim was inherited, never re-measured, and it does not survive contact with the code.

**What is now established.** Both types are in the offered template list and both render, verified
through RTWiki's own pipeline by `tests/browser/diagram-templates.pwspec.ts`:

- `venn` renders with a real viewBox, past the 24×24 empty-placeholder check that would catch a
  broken diagram.
- `gitGraph` renders likewise.

**Why the original comparison cannot be repeated.** The entry's substance is a claim about output
*differing between* Mermaid 10.9.3 and 12.0.0 — but RTWiki pins `mermaid: 12.0.0` and has 10.9.3
nowhere in the tree. Reproducing it would mean installing a second Mermaid version to render the same
source twice and diffing the results, which is a measurement about a version the application does
not use. **It is not established that this was ever a defect** rather than a curiosity about two
versions, and the entry's own impact rating was "low".

**What would actually close it,** if the owner wants it closed rather than retired: install
`mermaid@10.9.3` in a scratch directory, render both diagrams under each version in Chromium, and
diff the SVG. That is a real experiment and it is cheap, but it answers a question about a version
RTWiki does not ship — so it is listed here as an option rather than done unasked.

### 3. The native desktop shell has never been built or run here

**Impact: medium, and NOT fixable from this machine.** There is no Rust toolchain installed, so
`bun run build:desktop` has never been executed. Everything said about the desktop shell is inferred
from the Tauri configuration, not observed. This is unchanged by the 2026-09-29 pass and cannot be
changed by it: a missing compiler is an environment fact, not a defect.

**The closest thing available was checked instead**, and it is worth recording because the two
defences in the cross-origin entry are said to exist in the shell: `src-tauri/src/main.rs:429-431`
does perform the equivalent `Host` check on navigation, so the pattern is in the codebase. That is
source inspection, not a running shell.

**Next step, unchanged:** run it on a machine with the Rust toolchain — CI does this — or accept it
as unverified. Until then no claim about the shell should be made as though it were observed.

### 4. ~~The template bar is cramped inside a diagram block's split editor~~ — RESOLVED, the context no longer exists

**Closed 2026-09-29 by the change described in [VISUAL_BLOCKS.md](VISUAL_BLOCKS.md).** The bar is
no longer rendered inside a diagram block's split editor at all. It moved to the Diagram page's
own toolbar row, where it shares the Rich Note's row and its `--rtwiki-toolbar-height` token.

So the complaint this entry recorded — that a 48px control did not fit a narrow split editor — was
a real observation about a context that no longer exists. The controls are now 32px so they fit the
40px toolbar row, and the Rich Note reaches the same templates through its toolbar chooser rather
than through a bar in a block.

**What replaced it.** The bar is one row in the page's toolbar, above the workspace and visible
without entering edit mode. Choosing a template adds that diagram to the page. A Rich Note has an
equivalent chooser on its own toolbar, reading the same list. Neither surface shows Mermaid in the
`/` slash menu, which lists block types rather than a template library.

**Residual, and small:** 30 templates in a 40px row is dense, and the overflow dropdown does most
of the work. That is a density question, not the cramping this entry described.

### 5. ~~Eleven `!important` declarations in the page-tree stylesheet~~ — RESOLVED, suppressed with the reason

**Closed 2026-09-29.** `src/web/features/sidebar/page-tree.module.css` now carries a file-level
`biome-ignore-all lint/complexity/noImportantStyles` with a note explaining why each group is
load-bearing: the Wunderbaum stylesheet is part of the cascade, so specificity alone cannot beat its
own state rules, and the declarations that matter exist because the library paints a container
border that turns blue on `:focus-within` — putting focus on the whole tree instead of the focused
row.

**The entry offered two options — remove them, or document the suppression — and only one of them
was available.** Removal was explicitly the wrong move and remains so: the warnings are 11 because
they are 11 distinct overrides of third-party CSS, each individually commented at its own site.
Deleting them one at a time is what this entry warned against, and doing it blind would have changed
the tree's appearance without anyone able to say which change caused what.

**So the declarations stay, and the file says why.** A reader now sees one explained block rather than
eleven unexplained declarations, and the lint gate is quieter rather than redder.

### 6. ~~Uploaded images are not associated with a page, so they are never cleaned up~~ — the leak is fixed; the missing feature is not

**Partly resolved 2026-09-29.** The unreferenced-image leak now has a reclaim pass, and the policy
decision this entry said was needed has been made and recorded.

**What was built.** `src/server/attachments/attachment-retention.ts` exposes two functions, and the
split between them is the design:

- `findUnreferencedAttachments` — **read-only.** Answers "what would go" without touching anything,
  so a caller can report or count before acting.
- `reclaimUnreferencedAttachments` — deletes, and reports rather than throwing: which ids went, how
  many bytes, which were too young, and which failed with a reason. A single unremovable row must
  not abandon the rest of the pass, and it must not vanish silently.

Run once from `bootstrap()`, not on a timer. The leak only grows when a note is deleted, so a
startup pass costs one table scan where a timer would keep re-scanning a condition that has not
changed. Failures are logged and never block startup — the data is merely still there, which is the
state before this ran.

**The policy, and the reasoning:**

- **References are found by searching stored page text for the attachment id**, in one pass that
  builds a set. The per-attachment alternative is a full page scan per row, which is quadratic in
  exactly the case the leak makes large. The search is deliberately looser than matching the
  `/api/attachments/<id>` path, so a reference written in a shape this function does not understand
  is still a reference.
- **Pages in the recycle bin count as references.** This is the part a reasonable implementation gets
  wrong by forgetting `WHERE deleted_at IS NULL`. A binned page can be restored, so its images must
  survive; reclaiming them would destroy the images of a note deleted by mistake, which is worse
  than the leak being fixed. Asserted directly in `tests/attachment-retention.test.ts`.
- **30 days minimum age**, generous on purpose. The alternative is deleting on page-delete, which is
  the cascade ADR-013 rejected. With a threshold the worst case is that an image outlives its need —
  recoverable. In the other direction it is not.
- **A row whose `created_at` will not parse is never reclaimed**, reported as `unreferencedForMs:
  null` rather than 0. "Unknown age" and "brand new" are different facts, and collapsing them would
  let a zero threshold delete a row nobody can date.

**What is still open, and deliberately so.** There is still no `GET /api/pages/:id/attachments`
and still no "images on this page" list, because the `attachments` table has no foreign key to
`pages` and adding one is a schema decision, not a bug fix — a cascade would destroy an image still
used in another note, and an attachment may legitimately be uploaded before it is referenced. That
is unchanged from ADR-013 and belongs to the owner as a product decision.

**Also still open:** files in `data/attachments/` from a database predating ADR-014 are not touched
by the migration, because an unreferenced file cannot be proven to be garbage rather than merely
not-yet-referenced. That is now a much smaller set than it was — ADR-014 moved image bytes into the
database, so this is about older files only.

### 7. Documents are attached, searchable, and viewable in place

**Resolved for storage; preview remains open.** [R-024](PRODUCT_REQUIREMENTS.md) requires attaching
"images, PDFs, and documents", and [AC-031](ACCEPTANCE_CRITERIA.md) names DOCX, ODT, TXT and MD. All of
those are now accepted, stored in the database beside the images, and their text is extracted into the
search index — so a PDF you imported becomes findable by what is in it. See
[ADR-015](adr/ADR-015-document-attachments.md).

**The "extracted into the search index" clause was false when this entry was written, and is only
now true.** `extracted_text` was written on upload and read by exactly one route,
`GET /api/attachments/:id/text`, which is reachable only by opening the document's "View text"
dialog. `search_index` was populated from page content alone, so a document's words were not
findable. AC-030, AC-030a, ADR-015, DATA_MODEL.md and this entry all asserted otherwise, and
ADR-016 correctly described the opposite — five documents disagreeing about the same feature.
The gap is now closed by appending a page's referenced documents' text to that page's own
`search_index` row, with the lifecycle made explicit: adding a document to a note re-indexes it
on the next save, and deleting an attachment re-indexes the pages that referenced it. The entries
were left in place and the code changed to match them, because the claim is the product
requirement. See [DATA_MODEL.md §3.6](DATA_MODEL.md).

**Attaching is now reachable from the editor.** A Document control sits beside Image on the Rich Note
toolbar and in the slash menu, opens a picker, and inserts a card carrying the file's own name. Drop and
paste work too. This entry previously recorded the opposite — that the whole document half of the
feature was unreachable — and that part is now wrong and has been corrected.

**Viewing is now built, on a separate route.** The card offers three actions: **View text** (the text
RTWiki already extracted, rendered in the app), **View** (opens in a new tab, the browser draws it),
and **Download** (unchanged). The owner authorised inline serving on 2026-09-27; see
[ADR-016](adr/ADR-016-inline-document-viewing.md), which supersedes ADR-015 §3 and records the
residual same-origin risk plainly.

The download route is untouched and still a forced download. Inline is opt-in per click, and the card
embeds nothing — a browser test asserts there is no `iframe`, `embed` or `object` in it, so merely
opening a note never renders a file.

**Measured, and it contradicted the obvious assumption:** `sandbox` was expected to block Chrome's PDF
viewer, on the theory that the viewer is a plugin document a sandboxed response refuses. **It does
not.** The PDF rendered identically with and without it, byte-for-byte identical screenshots, and the
stricter policy turned out to be free. Had the plausible-sounding inference been trusted, `sandbox`
would have been dropped from the inline route for no reason.

**Two gaps remain, and neither is RTWiki's policy to fix:**

- **Office formats will not render in a browser.** `DOCX`, `XLSX`, `PPTX` and `ODT` have no
  mainstream browser renderer, so **View** on one downloads it or shows source. That is the browser's
  behaviour, not a restriction RTWiki imposes, and it is why Download and View text are on the card.
- **A scanned PDF has no text layer**, so there is no OCR and **View text** says so rather than showing
  an empty box. **View** still works on a scanned PDF, because the browser reads the image.

**Also still open:** **legacy binary `.doc`/`.xls` are refused** — OLE compound files this parser does
not handle. AC-031 names DOCX and ODT, not DOC.

### 8. The Diagram page's layout cannot size a block without reaching into a shared component

**Not a user-visible bug. A structural one, found while fixing a real one, and it will cause the next
one too.**

Block resizing lives in `src/web/features/rich-editor/blocks/block-resize.tsx`, shared by the Rich Note
and the Diagram page. Its container carries `max-width: 100%`, so its width is bounded by whatever
wraps it. On the Rich Note that is the document column and the bound is correct. On the Diagram page
the block list is a `flex-wrap: row` container, so the block's parent is a **flex item** whose width
comes out of the row's sharing, and the bound silently becomes "as wide as my share of the row".

The Diagram page therefore cannot size a block by styling the block. It has to publish a size onto the
reorder item, from inside a component that lives in another feature, across **two CSS modules** that
cannot see each other's class names. Three attempts were made and each failed differently, all
measured:

| Attempt | Result |
| --- | --- |
| `width`/`height` on the reorder item | Item fixed its box; the drag had nowhere to go. 160px drag → 0px movement. |
| `.blockListItem > div { width: … }` | A specificity contest with the shared component's own rule, across modules. Lost: the box stayed at the row share. |
| Live size in workspace `useState` | Worked, but a `setState` per `pointermove` re-rendered every Mermaid canvas on the page. Up to 31px of lag. |

What shipped publishes the in-flight size as a CSS custom property on the reorder item, written
directly to the DOM from the resize container via a ref, under a name (`--block-width-live`) that is
separate from the stored one. Measured in a standalone prototype of the same DOM and CSS: **0px**
tracking error at every sample, against **160px** for the container-only version.

**Why this entry stays open.** The fix works, but it is a ref through a feature boundary, and the
`liveStyleTarget` prop only makes sense to one caller. The real fix is for the block list to own its
children's sizing — the resize container should not have to know that something above it is a flex
item. Until then, a change to `max-width` on `.sizeContainer`, or to the Diagram page's flex rules, can
reintroduce this and the symptom will again be "the drag stopped working" with no error anywhere.

**Not covered by any test at the unit level.** `tests/browser/diagram-workspace-layout.pwspec.ts` now
asserts the box tracks the pointer *during* a drag on both axes, which is the only kind of assertion
that catches it; every earlier resize test read the size *after* the pointer came up, so all of them
passed while the control was frozen.

### A document could be attached, and the user was told it was an image

**The kind of failure that reads as "the feature is broken" and is actually two mistakes.** The document
picker and uploader existed and were complete, but were **imported nowhere** — no toolbar control, no
menu item, no caller at all. A user could not attach a document, while the API behind it was fully
working and tested.

Wiring it up exposed a second defect that had been invisible precisely because nothing called the code:
a **dropped or pasted PDF was reported as an image failure** — "That image could not be added. Try a PNG,
JPEG, GIF…". BlockNote routes paste, drop and its own picker through a *single* `uploadFile` hook with no
per-block routing, and that hook pointed straight at the image uploader. So a document was not merely
rejected on two of the three routes; it was rejected with wording that named no format which would have
worked, and there was no way for a user to tell a refused document from a refused image.

A third defect sat in the same function, in the path the toolbar uses: an oversized **document** was
refused with the *image* size message, and the failure mapper handled two image-only reason codes
(`svg_not_supported`, `too_many_pixels`) that a document can never produce — a document is identified
from a real container, so it is never refused for either.

**Fixed** by adding a Document insert entry beside Image, declaring its run through `INSERT_RUNS` rather
than by naming it in a toolbar list — the exact trap recorded under *The toolbar silently hid a newly
added insert control*, and reusing the declaration mechanism is what made it a non-issue. The upload hook
now dispatches to the uploader that owns the right *message*; it does not decide acceptance, which stays
with the server reading the bytes. A new `documentTooLarge` message was added, and the image-only
branches removed.

**Two traps hit while doing it, both recorded here because both would recur:**

- **The `file` block is not a link.** BlockNote's built-in `file` block renders a card whose name is a
  `div`, not an anchor, so a document is attached and visible but not clickable. Reusing it was still the
  right call — it is already in the schema, and a custom block would have to be registered or it is
  silently rewritten to a JSON `codeBlock` on every load — but "attached" and "viewable" are different
  things, and only the first was built.
- **A new control pushes an existing one off the bar.** Adding Document overflowed the row and moved
  `insert-image` into the "more" menu, which failed a test asserting the image control was on the bar.
  The helper that clicks a control wherever it lives is now shared in `tests/browser/utils/toolbar.ts`
  rather than duplicated, and it is named `clickControl` because Biome's `useHookAtTopLevel` rule treats
  a `use`-prefixed name in a `.ts` spec as a React hook and fails the lint gate.

### A stylesheet rule that matched nothing, for the whole life of the feature

**The kind of failure that cannot fail.** The task-list rule read
`.previewPane :global(li.task-list-item)`. That class is emitted by **neither** Markdown engine the
project has used: a task item is `<li><input type="checkbox" disabled checked>`, with no class on the
`li` or anywhere else. Measured against both `marked` and micromark before changing anything. The
checkbox styling worked, so the rule that was supposed to suppress the list bullet — the visible
symptom — was dead code, and no test covered it because no assertion could fail.

`marked`'s documented `task-list-item` class belongs to its GFM renderer output and was never produced
by the configuration RTWiki used. The rule looked plausible enough that a reader would assume it had
been verified.

**Fixed** by selecting the structure both engines agree on, `li:has(> input[type='checkbox'])`, rather
than by injecting a class in the renderer. The alternative would have meant a second pass over
rendered HTML with a regular expression — a second parser to keep in step, and a new way for content to
be mangled. A test now asserts the class is *absent* and that the structure the stylesheet targets is
present, so the rule and the markup are checked against each other.

### A sanitiser profile that silently deleted every equation

`USE_PROFILES: { html: true }` removed **every** `<math>` and **every** `<svg>`. Measured: one of each
in, zero of each out — while the surrounding `<span class="katex-html">` survived byte-identically.
That is why it was invisible: a DOM snapshot of the output looked perfect, and the byte comparison used
to check KaTeX passed. A KaTeX radical is a MathML `<msqrt>` with an SVG overlay, so `\sqrt{2}` was
losing both and rendering as a bare `2`, and maths were entirely invisible to a screen reader.

**Fixed** by widening the profile to include `mathMl`, `svg` and `svgFilters`. The widening was then
checked against what it could plausibly admit rather than assumed safe: script inside `<math>` and
inside `<svg>`, `<animate onbegin>`, `xlink:href="javascript:"`, and
`<annotation-xml encoding="text/html">` are all still removed, and `FORBID_TAGS` still wins over the
svg profile for `<style>`.

**The widening is smaller than the profile diff looks, which is the part worth remembering.** Because
the parser now escapes raw HTML, a user cannot put `<math>` or `<svg>` into the sanitiser at all — the
characters arrive as text. The only MathML or SVG reaching the sanitiser is markup RTWiki generated
itself. So this widens what our own output may contain, not what a user's keystrokes can.

### Adjacent maths, `$a$$b$`, renders as a KaTeX error

**Measured, and inherited rather than introduced.** `$a$$b$` opens with a run of one `$` and the next run
it meets has two, so the run sizes do not match; the scan continues and the final single `$` matches,
leaving the TeX source `a$$b`. KaTeX cannot render that and shows the source in its error styling.

The upstream package was measured against RTWiki's construct and produces **byte-identical** output for
`$a$$b$`, `x $a$$b$ y`, `$a$$b$ $c$`, `$$x$$`, `$a$ $b$` and `$a$$b`. So this is a property of marker-run
matching, not a cost of owning the tokenizer.

**The workaround is a space.** `$a$ $b$` is two expressions and renders correctly. Asserted both ways by
`tests/markdown-render.test.ts` so that a future change to run matching is noticed. See
[ADR-017](adr/ADR-017-markdown-engine-micromark.md).

### Display maths only works when `$$` is alone on its line

`$$x$$` written on one line renders as **inline** maths, not display. The flow construct is only reached
when the opening `$$` sits on a line by itself, with the expression on the lines between and a closing `$$`
after them. The expression is still rendered correctly; only the presentation differs, so nothing looks
broken — it just does not do what the author expected.

**This matches GitHub's documented syntax**, which specifies display maths as `$$` beginning a new line, so
the one-line form is a reasonable superset rather than a defect. The multi-line form is the documented one:

```markdown
$$
\frac{a}{b}
$$
```

Measured across five shapes and asserted both ways.

**`\$` is the escape hatch for a literal `$`.** It works everywhere — in prose, and it still composes with
the adjacency rule, so `\$x$` is a literal `$` followed by real maths. RTWiki's inline maths is delimited by
GitHub's adjacency rule (see [ADR-017](adr/ADR-017-markdown-engine-micromark.md)), so ordinary currency —
`Only $100.`, `Pay $5 or $10 today.`, `Between $3 and $4.` — is text without any escaping. `\$` is only
needed when the author genuinely wants a `$` that would otherwise open maths.

### KaTeX fonts: a silent failure that no test would have caught

Importing the stylesheet is not enough. KaTeX's CSS references `.woff2` files that the bundler copies
alongside it, and **a missing font produces a correct DOM and wrong pixels** — no console error, no
failed assertion, just maths that looks subtly off or falls back to a serif.

Two specific traps found here:

- **The stylesheet was in a lazy chunk.** `@blocknote/math-block` imports `katex/dist/katex.min.css`,
  but only from the Rich Note's dynamically-loaded chunk. A Markdown page never mounts the rich editor,
  so that CSS was never fetched: the full stylesheet (19 font references) lived in `rich-editor-*.css`
  while the eagerly-loaded `index-*.css` carried 9. The Markdown workspace now imports the same file,
  and the bundler emits one shared `katex-*.css` for both paths — verified after a build, not assumed.
- **`document.fonts.check` returns false for a family that has not been requested.** An early version
  of the browser test checked all of KaTeX's families and failed on `KaTeX_Size1`, which this page never
  uses. Checking only the families the page actually renders with is the meaningful check.

**The checkable rule:** after a build, `build/web` must contain the `KaTeX_*.woff2` files, and a browser
test must assert the SVG overlay and a resolved font. See `docs/evidence/markdown-math-zoom.png` for
what correct output looks like.

### A page closed while a save had failed loses the pending content — STILL OPEN, and the prescribed fix was tried and rejected

**Unchanged 2026-09-29, with one new and load-bearing measurement: the fix this entry prescribed
does not work, and shipping it would have made things worse.** It was built, measured, and removed.
Both the bug and the reasoning are kept.

**What was tried.** The entry's own prescription — flush the controller on
`visibilitychange → hidden`, with `pagehide` as a fallback — was implemented in `App.tsx`, the one
place that already holds the active editor's flush. It is a small, tidy change and it does exactly
what it says.

**Why it was removed.** Two reasons, and the second decided it.

1. **The write is not deliverable.** Neither `pagehide` nor `visibilitychange` lets the page await
   anything. A browser tears the document down once the handler returns, so an in-flight `PATCH` is
   usually cancelled. The change would have traded a *certain* two-second loss for an *unreliable*
   save, which is not obviously a win even before the second reason.
2. **A background write races the app's optimistic concurrency.** Page writes are version-checked
   and a stale `version` is refused with 409. Every existing flush is user-initiated and awaited, so
   a conflict surfaces to whoever caused it. A flush fired by the browser on teardown is neither, and
   it lands between a read and a write belonging to someone else — a second tab, or the user
   themselves — turning their edit into a conflict they did not cause and cannot explain.

**Measured, in the real application.** With the listeners registered, the browser suite went from
**5 failures to 12** — 4 in `connect-find`, 4 in `stability-regressions`, 4 in `tree-dnd`, all of
them rename-and-navigate specs, all of them timing out on exactly the version conflict described
above. Removing them returned the suite to 5, and those 5 are `backup-panel`, which is flaky
independently and which also failed on the unmodified baseline. The attribution was established by
running the whole suite on the stashed, unmodified tree, not by reasoning.

**The bug itself is still real and still unfixed.** Both loss surfaces stand: closing or reloading
inside the `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` window discards pending typing, and closing while
`status === 'error'` discards content that lives only in component state.

**What the fix actually is, and why it is not simply applied.** A draft in `IndexedDB`, and this
entry's reasoning against it stands: that trades a two-second window for a **second, unencrypted
copy of private note content in the browser profile**, surviving the app — which the privacy posture
built around "the data lives in `data/rtwiki.sqlite` beside the executable" does not cover. It also
needs a staleness policy, since a recovered draft older than the server copy must not silently
overwrite newer work. Both are decisions for the owner.

**A narrower option nobody has costed:** a *synchronous* `navigator.sendBeacon` carrying the draft
would be deliverable where the async PATCH is not, and would still race the version check unless it
skipped it. That is a different design, not this one, and it is unmeasured.

**Do not re-attempt this fix without reading the measurement above.** The reasoning that produced it
was reasonable, and it is wrong. `src/web/App.tsx` carries the same warning at the point of use.

### ~~`isDirty` now means two different things~~ — RESOLVED, one definition

**Fixed 2026-09-29.** There were two spellings: the visual workspace used `useAutosave`'s own
`dirty || error`, while the markdown workspace and the HTML editor used the shared `isAutosaveDirty`,
which read `dirty || saving`. `use-autosave` now imports the shared function rather than restating
it.

**The disagreement was not cosmetic, and that is the part worth recording.** This entry called it
inert because nothing read the answer. Two things have since made it matter:

- The close/switch confirmation reads it, and a save in flight is precisely the case that must not
  be dismissed.
- The shared helper did **not** count `error`. A failed save leaves content in memory and unwritten,
  so it is unsaved work by any definition — yet the copy used by two of the three editors reported
  the one state where content is genuinely at risk as clean. `isAutosaveDirty` now includes `error`.

**The test asserts the relationship, not a truth table.** `tests/save-state-dirty.test.ts` checks
that `isAutosaveDirty` is true for exactly the states where the document is not durably written, and
that it never contradicts the status bar. A third copy of the question cannot be caught by testing
one function; it can be caught by testing the invariant. Note that the invariant is *not* "the bar
is not saying Clean" — `saved` is a fourth bar state meaning a write just completed, correctly not
dirty, and conflating the two is how the first version of that test failed on correct code.

### A page whose only content is a table rendered an empty dashboard card

**Measured.** A table block's text lives at `content.rows[].cells[].content` — a nested *object*, not an
array. `page-preview-text.ts` descended into `content` only when it was an array, so it never saw a single
cell. On a page containing nothing but a two-row table:

| Consumer | Before | After |
|---|---|---|
| search extraction | `Header A Header B Cell one Cell two` | unchanged |
| dashboard card | `""` | `Header A Header B Cell one Cell two` |

The result was a page that showed an **empty card** on the dashboard while being perfectly searchable. To a
user that reads as a broken or empty page, and it is the mirror image of the search-recursion defect
fixed in `934f151`: search walked into tables, the preview did not.

**Two further divergences surfaced while fixing it**, both in the same direction — the page and its own
search index disagreeing:

- **Image captions.** The preview indexed `props.caption`; search did not. A page whose only prose is
  captions was visible on a card and unfindable.
- **The stored `PlainContent` array form.** A stored `codeBlock`/`mathBlock` serialises its text as an
  inline array, but `collectOwnBlockText` accepted only `typeof content === 'string'`. Search returned
  `""` where the preview returned the text. The pre-existing test used only the partial string form, which
  is exactly why it was never caught.

**All three are reconciled**, and `tests/search-preview-equality.test.ts` walks one document covering every
block type through both consumers and asserts the strings are **equal** — so a future divergence is a red
test rather than a user's dashboard. A fourth defect was found on the way: the preservation-marker payload
(`containUnknownBlocks()` output) reached the card, putting
`[unsupported block preserved below] {"type":"futureBlock"}` in plain sight. Both consumers now check the
marker *before* emitting anything, and the check covers the inline-array form, which is how a stored
codeBlock actually serialises.

### Three places decided what text a page contains, and all three disagreed

| Consumer | Before | Now |
|---|---|---|
| `search-extraction.ts` | recursed into `children` and table cells (fixed in `934f151`) | unchanged |
| `page-preview-text.ts` | recursed, but missed table cells, the array code form, and it **leaked** marker payloads | one shared reduction |
| `rich-editor.tsx:52-68` word count | **top-level blocks only**, with a comment calling that deliberate | one shared reduction |

The word count was the quiet one: the Rich Note's own count and the status bar's count — both on screen,
both for the same document — could report different numbers, because one walked nested content and the
other did not. Its comment claimed the shallowness was deliberate. It was not deliberate, it was
inconvenient, and it was the same defect in a third place.

**Decision: aligned, with the cost measured rather than assumed.** `richBlocksPlainText` is now exported
from `page-preview-text.ts` and the editor's `countBlockWords` calls it, so all three consumers share one
reduction. It runs on every keystroke, so the numbers were measured (Bun 1.4.2, 200 runs after warm-up):

| Document | was | now |
|---|---|---|
| 150 blocks (19 kB) | 0.02 ms | 0.08 ms |
| 800 blocks (100 kB) | 0.03 ms | 0.20 ms |
| 2,500 blocks (314 kB) | 0.20 ms | 1.87 ms |
| 12,000 blocks (1.5 MB) | 0.98 ms | 11.67 ms |

Sub-millisecond for any realistic study note. The last row is a 1.5 MB document, in a handler that
**already** spends 5.1 ms there on `JSON.stringify(editor.document)` for autosave — the walk is not what
makes such a page slow, and it stays inside a 16 ms frame to roughly 10,000 blocks, which is a document
nobody writes. The trade was worth it: a slightly slower count that is right, over a fast one that
disagrees with the number printed beside it.

The preview walk also gained its own depth guard, `PREVIEW_MAX_BLOCK_DEPTH = 64`, deliberately equal to
the server's `SEARCH_MAX_BLOCK_DEPTH` and with the same defined behaviour — read to the cap, keep
everything already collected, stop, never throw. The client cannot import the server constant, so the
equality is asserted by a test rather than assumed. Without it, a hand-edited document nested without
bound would exhaust the stack while the dashboard was merely drawing a card.

### **Any web page open in the user's own browser can write to the server**

**Impact: high, and it is the only finding in this list that is remotely reachable without physical
access to the machine.** Measured from the code, not inferred.

`isSameOrigin()` exists and works (`src/server/utils/request-origin.ts:16-44`). It is called on
**5 route files** — attachments, settings, shutdown, client-errors, client-debug-events — and on
**none of the three that write user content**. Of the 25 mutating routes in `src/server/`, **17
perform no origin check at all**:

| Route | Method | Origin check | Reachable from another site |
|---|---|---|---|
| `pages.ts:99` `POST /api/pages` | POST | **No** | **YES** |
| `pages.ts:235` `POST /api/pages/:id/move` | POST | **No** | needs an id |
| `pages.ts:261` `POST /api/pages/:id/duplicate` | POST | **No** | needs an id |
| `pages.ts:276` `POST /api/pages/:id/restore` | POST | **No** | needs an id |
| `pages.ts:180` `PATCH /api/pages/:id` | PATCH | **No** | No — preflight |
| `pages.ts:291,306` `DELETE` | DELETE | **No** | No — preflight |
| `schedule.ts:65` `POST /api/schedule/entries` | POST | **No** | **YES** |
| `schedule.ts:136` `POST /api/schedule/reminders` | POST | **No** | **YES** |
| `schedule.ts:95,115,166,186` | PATCH/DELETE | **No** | No — preflight |
| `schedule-presets.ts:28` `POST /api/schedule/presets` | POST | **No** | **YES** |
| `schedule-presets.ts:79` `POST /apply` | POST | **No** | **YES — and it destroys data.** See below |
| `schedule-presets.ts:47,67` | PATCH/DELETE | **No** | No — preflight |

**The mechanism, and why nothing else stops it.** A cross-origin `POST` whose `Content-Type` is one
of the CORS-safelisted values — `text/plain` is enough — is a *simple request*: no preflight is
sent, and the browser sends it unconditionally. CORS governs whether the attacker's JavaScript may
**read the reply**, never whether the request is dispatched. RTWiki has **no** CORS middleware (0
matches for `hono/cors` or `Access-Control-Allow-Origin` in `src/`), and its JSON readers never
inspect `Content-Type` — `readJsonBody` (`pages.ts:44-65`) calls `c.req.text()` and `JSON.parse`s
whatever arrives, so the safelisted header and a JSON body coexist without objection. The reply is
opaque, and the attacker does not need it.

`PATCH`, `PUT` and `DELETE` are a different case and are **not** reachable: an HTML `<form>` cannot
send them, and `fetch()` triggers a preflight that RTWiki answers through `app.notFound`
(`app.ts:218`) with no CORS headers, so the browser never dispatches the real request. Saying
"every route is exposed" would overstate it; saying "no write route is exposed" would understate it.

**The loopback bind does not cover this, which is the part that is easy to get wrong.** Binding
`127.0.0.1` stops a *remote host*. It does nothing about a page in the user's **own** browser, and
RTWiki starts a browser tab itself on every launch unless `--no-open` is passed. For a study-notes
app on a shared family PC — the stated deployment — the user is browsing the web at the same time.

**What an attacker can actually achieve, bounded honestly.** Without reading any response they can
**create** pages, timetable entries, reminders and presets — four write routes that need no prior
identifier — and, on a fifth, **destroy the timetable outright**. Page `content` is `z.string()`
with no server-side validation (`CreatePageSchema`, `src/shared/schemas/pages.ts:3-10`), so nothing at
the API boundary refuses attacker-chosen text. The move, duplicate, restore and delete routes are
equally unprotected but need a page UUID that cannot be read cross-origin, so they are not
practically reachable today.

**The worst of them: `POST /api/schedule/presets/apply` wipes the user's study schedule.** With
`mode: "replace"`, `applyPreset` (`src/server/services/schedule-service.ts`) runs
`repo.deleteAllScheduleEntries(db)` and `repo.deleteAllReminders(db)` — unqualified
`DELETE FROM schedule_entries` and `DELETE FROM reminders` — inside one transaction, then inserts
the preset's contents. The `source` is **not** required to name an existing record: the `builtin`
branch takes any **key string**, and the three valid keys are literal, obvious and enumerable —
`builtin:blank`, `builtin:school`, `builtin:exam` (`src/shared/schedule/presets.ts:11,19,75`). An
attacker needs no identifier, no reconnaissance, and no knowledge of the victim's data. The shortest
possible request is:

```
POST http://127.0.0.1:8080/api/schedule/presets/apply
Content-Type: text/plain

{"source":{"type":"builtin","key":"builtin:blank"},"mode":"replace"}
```

`builtin:blank` is `data: { periods: [], reminders: [] }` (`presets.ts:16`). So the deletes run and
the inserts add nothing: **every timetable period and every reminder is permanently gone**, in one
request, from a web page the user merely visited. An unknown key is refused by `resolvePresetData`
*before* the transaction opens, so the attacker must supply a valid one — and all three are guessable
from the product's own vocabulary. This is data destruction, not defacement, and it is the single
most severe finding in this document.

**The rest is not script execution, and that distinction is worth keeping precise.** An injected
`html` page renders inside the sandboxed `<iframe>` on an opaque origin with `connect-src 'none'`, so
it cannot read or call the API. The realistic impact of the other four routes is therefore
**persistent attacker-chosen content written into a private local wiki** — spam, defacement, and
content the user later opens believing it is their own — which is serious for an application whose
entire value is that the notes in it are the user's, but is not code execution and not a wipe.

**The one control that closes the DNS-rebinding variant, and it is the one that is missing.** Under
rebinding the browser believes the request is same-origin, so it sends **no** `Origin` and **no**
`Sec-Fetch-Site` — and `isSameOrigin` reaches its final `return true` at
`request-origin.ts:43`, the branch documented as the CLI/automation path. Validating the **`Host`**
header is what distinguishes the attack, because it is the one header the browser still sends
attacker-influenced. There is no `Host` validation in `src/` (0 matches for `allowedHosts`,
`hostAllow`, or reading the `host` header), and there are no cookies anywhere, so `SameSite` has
nothing to protect. RTWiki's own Tauri shell already does the equivalent check on navigation
(`src-tauri/src/main.rs:429-431`), so the pattern exists in the codebase — but the shell does not
protect the HTTP server, which is reachable from a browser tab regardless of which shell launched
it.

**Next step, in order.** (0) `POST /api/schedule/presets/apply` with `mode: "replace"` is
unqualified bulk deletion reachable cross-origin — if only one route is fixed, fix that one, and make
"replace" require a named existing source instead of accepting an arbitrary key string. (1) A `Host`
allowlist middleware in `createApp()` permitting only `127.0.0.1[:port]`, `localhost[:port]` and the
configured host — this is the only control that stops rebinding, and the only one that covers all 17
unprotected routes at once. (2) Apply `isSameOrigin` to the unprotected routes, or hoist it to one
`app.use` covering all unsafe methods; the helper exists and is tested, so this is small. (3)
Requiring `Content-Type: application/json` in the body readers — cheap, and worth doing, but on its
own it only defends against the `text/plain` variant, because such a `fetch` would preflight and fail
anyway. A per-process token in a custom header is the durable answer and the model every comparable
loopback product chose, but it is a larger change that must not live in `localStorage`, and it does
not replace (1) or (2).

**What was not established.** No live cross-origin page was run against a running server, so the
chain is established from the code and from the CORS and Fetch-Metadata specifications, not from an
executed exploit. What would settle it end to end is a page served from a second origin asserting
that a page is created by `POST /api/pages` with `Content-Type: text/plain`, and — the one that
matters — that `GET /api/schedule/entries` afterwards returns nothing. See [SECURITY.md](SECURITY.md)
§4.1 for the requirement this fails.

> **SUPERSEDED 2026-09-29 — the hole described above is closed, and this entry should not be read
> as a live finding.** It was written at commit `476de71` with the fix uncommitted. Both controls it
> asked for are now built, in `createApp()` rather than per route:
>
> - **`Host` allowlist on every request** — `src/server/app.ts:166`, via `isAllowedHost`. This is the
>   control that stops DNS rebinding, and it is the one that was missing.
> - **`isSameOrigin` on every state-changing method** — `src/server/app.ts:174`, via
>   `isUnsafeMethod`. Not on the five route files this entry listed, and not on the three it said
>   were unprotected: on all of them, at the app level.
>
> So requirement (1) and (2) are both met, the "17 routes with no check" table above describes a
> state that no longer exists, and `tests/cross-origin-guard.test.ts` asserts the reachable write
> routes are refused.
>
> **Requirement (3) is now also done.** The JSON body readers require
> `Content-Type: application/json` and answer 415 otherwise, which removes the CORS-simple
> `text/plain` free pass entirely — the entry's own note that this "only defends against the
> `text/plain` variant" is now the whole of the second layer rather than a partial measure. See
> `src/server/utils/read-json.ts` and `tests/json-media-type-defence.test.ts`.
>
> **The entry is kept rather than deleted** because the reasoning above is the most careful
> cross-origin analysis in this document and it is what the three controls are designed against. What
> is stale is its conclusion, not its analysis.
>
> **Still true and still worth acting on:** the `mode: "replace"` wipe is reachable by any
> *authorised* caller with a valid preset key, so it deserves an undo or a confirmation. That is a
> product decision, not a security one, and it is not a regression.

### ~~A double-clicked `RTWiki.exe` closes the window its own error message is printed in~~ — RESOLVED

**Fixed 2026-09-29.** `reportFatalStartupError` now holds the process open after reporting, so the
message is still on screen when the window would have closed.

**Guarded on `process.stdin.isTTY`, and the direction of that guard is the whole point.** The wait is
for the *interactive* case — a double-clicked console application, where stdin is a TTY. A script, a
service or CI has no console to hold open, and waiting there would hang the job rather than report
anything. The condition is the opposite way round from what it first reads like: "no waiting" does
not mean "always wait".

The wait resumes stdin, which is what keeps a compiled Bun process alive, and resolves on the first
keystroke. Cleanup detaches the listener and pauses the stream, so the process can then exit
normally.

**Honest limit, unchanged from the original entry:** this makes the message **readable**, not
actionable. A GUI dialog would need `bun:ffi` → `MessageBoxW`, and Bun's own documentation calls
`bun:ffi` experimental and advises against it in production; whether `dlopen` survives
`bun build --compile` is unestablished. A window-subsystem build is not the answer either — it would
remove the console from *normal* operation, which is the diagnostic surface `fatal.ts` exists to use.

**Not verified here:** this path is only reachable through a double-click, and the compiled
executable cannot be built on this machine (item 3). What is verified is that the function resolves
without waiting when stdin is not a TTY, so a CI run cannot hang — see `tests/fatal-startup.test.ts`.

**Measured, and it is a visibility defect rather than a reporting one.** The message is correct; it
is written into a stream nobody is watching.

- `build/server/RTWiki.exe` is a PE32+ x64 image with **Subsystem 3**
  (`IMAGE_SUBSYSTEM_WINDOWS_CUI`), read from the file header. A console-subsystem process launched by
  double-click gets a console window that appears and closes as the process exits.
- `src/server/index.ts:132-135` is `main().catch(async (err) => { await reportFatalStartupError(err);
  process.exitCode = 1 })` — no pause, no wait, no dialog.
- `reportFatalStartupError` (`src/server/fatal.ts:28-29`) writes to **stderr first**, then the log.
  `stderr` is bound to that closing window.

**The commonest fatal cause has a specific fix that the user is never shown.** An unwritable install
folder now produces an actionable message naming the directory, the OS error and three remedies
(`138aa62`) — and a user who cannot write to `Program Files` is exactly the user who needs to read
it. `fatal.ts` fixed the *log-write* half of "a diagnostic nobody reads" and left the
*terminal-visibility* half open. `138aa62` says so in its own commit message and does not claim
otherwise; the gap is recorded here so it is not rediscovered as a surprise.

**Next step:** pause on the fatal path only, guarded by `!process.stdin.isTTY` so a script or CI
launch does not hang. Roughly ten lines, no dependency. Honest limit: it makes the message
*readable*, not *actionable*. `bun:ffi` → `MessageBoxW` would be the fatal-only GUI option, but
Bun's own documentation calls `bun:ffi` experimental and advises against it in production, and
whether `dlopen` survives `bun build --compile` is unestablished. A window subsystem is not the
answer either: it removes the console from *normal* operation, which is the diagnostic surface
`fatal.ts` exists to use.

### `checkIntegrity()` throws on severe corruption instead of reporting failure

**The rule a validator needs is half of what it looks like.** `checkIntegrity()`
(`src/server/database/index.ts`) calls `db.query('PRAGMA integrity_check').all()` with **no
`try`/`catch`**, and the pragma does not always return rows to be judged. Measured on the bundled
SQLite 3.53.2:

| Corruption | `integrity_check` | `quick_check` |
|---|---|---|
| intact | `["ok"]` | `["ok"]` |
| truncated by 300 bytes | 5 error rows | 5 identical rows |
| truncated to 60% | **throws** `database disk image is malformed` | **throws** the same |
| not a database at all | **throws** `file is not a database` | — |

So "returns true only when SQLite reports a single `ok` row" is correct but incomplete: on the
corruption classes that matter most, the helper **crashes instead of returning false**, and a
restore validator built by reusing it would reject nothing and die instead.

**Two consequences beyond the helper itself.** At `bootstrap.ts` the call is unwrapped, so
severe corruption propagates as a raw `SQLiteError` and the intended `'Database integrity check
failed'` log line never fires — the diagnostic designed for exactly this case is the one
the exception pre-empts. And the read-only fallback described in [SECURITY.md](SECURITY.md) §7 is
unreachable for this corruption class, which is a further reason to treat that branch as unverified.

**Next step:** wrap the pragma and treat a throw as failure, keeping the single-`ok`-row test for
the cases that do return rows. `src/server/app.ts` is already inside a `try` and is unaffected.

> **RESOLVED — the fix is built and committed, verified 2026-09-29.** `checkIntegrity()` in
> `src/server/database/index.ts` now wraps the pragma in `try`/`catch` and returns `false` on a
> throw, keeping the single-`ok`-row test for the cases that do return rows. The measurement this
> entry rests on — that the pragma throws rather than answering — is unaffected and still true.
>
> One thing the fix does **not** do, and which the original entry's "next step" was careful not to
> claim: `integrity_check` does not check foreign keys. SQLite documents that separately, so a
> validator that reuses this helper still needs `foreign_key_check` as its own required step. That is
> recorded in [SECURITY.md](SECURITY.md) §8.1 and is honoured by the backup restore validator, which
> is the only consumer that matters for corruption.

## Recently fixed

### Two amounts in one paragraph became maths

**This was recorded here for three commits as "a deliberate trade-off rather than a bug". That framing
was wrong, and so was the reasoning behind it.** `micromark-extension-math@3.1.0` decides inline maths by
marker count — one `$` opens maths and anything may sit between the delimiters. Its only option,
`singleDollarTextMath`, governs marker count and nothing more, so **no configuration of that package can
express GitHub's adjacency rule.** The absence of a fix had been read as a decision to accept the false
positive.

Measured, in a paragraph:

| Source | Before | After |
|---|---|---|
| `Only $100.` · `Earn $5 million.` · `The fee is $100.` | text ✓ | text ✓ |
| `Pay $5 or $10 today.` | **maths** ✗ | text ✓ |
| `Between $3 and $4.` | **maths** ✗ | text ✓ |
| `It cost $20,000 and $30,000 won.` | **maths** ✗ | text ✓ |
| `Budget is $100 for food and rent.` | text ✓ | text ✓ |
| `value $E=mc^2$ here` | maths ✓ | maths ✓ |

RTWiki now owns the inline construct and implements GitHub's rule: the opening `$` is followed by a
non-whitespace character, the closing `$` is preceded by a non-whitespace character, and the closing `$`
is not followed by a digit. The package's `$$` handling and its KaTeX renderer are reused unchanged.

**Why it mattered:** for a study-notes application, a sentence about money rendering as an equation is a
visible, credibility-destroying failure, and it was invisible in testing because a note with one amount
renders perfectly. `Between $3 and $4.` reads as a single amount to a person and as a pair of delimiters to
the parser.

**The cost, stated plainly:** RTWiki now owns this tokenizer instead of receiving it from a maintainer.
That is a permanent, real trade, recorded in
[ADR-017](adr/ADR-017-markdown-engine-micromark.md) along with the MIT attribution.

### A document's own Content-Security-Policy was silently replaced by the app-wide one

**The kind of failure that passes every gate.** A document response is protected twice: by
`Content-Disposition: attachment`, and by a stricter per-response `default-src 'none'; sandbox`.
`secureHeaders` sets its headers *after* `await next()`, so it overwrote the second layer on every
PDF and DOCX response and left `script-src 'self'` in force. The disposition was still present, so
nothing executed — but the second of two independent layers was doing no work, which is the entire
reason for having two. The fix is a middleware registered *before* `secureHeaders`; see
[ADR-015](adr/ADR-015-document-attachments.md) and the comment above `app.use` in `src/server/app.ts`.

**No unit test could have caught it.** The route is mounted on its own Hono instance in tests, so the
app-wide `secureHeaders` middleware does not exist there at all. It shipped through a fully green
suite and was found only by `scripts/verify-compiled-e2e.ts`, which starts the built executable and
drives it over HTTP as a browser would.

**And the regression test written for it could not fail.** It mounted the override middleware in the
*broken* order — the arrangement the fix was moving away from — so it passed whether the code was
right or wrong. Verified by swapping `src/server/app.ts` back to the broken arrangement: 23/23 still
passed. A test that cannot fail is worse than no test, because it reads as coverage; see the last
entry under *Harness traps* for the same lesson arriving independently.

### A PDF renamed `.txt` was accepted as text and read as note prose

**The kind of failure only shows up to someone trying to break it.** The document detector checked
the *reported* type before looking at the bytes, so a PDF renamed `.txt` matched the text rule, and
the parser read the container's own markup as if it were the note's content. A DOCX renamed `.html`
had the same problem one layer up. Caught by a test that renamed a fixture.

**Fixed** by inverting the order: identify the container from the bytes *first*, and consult the
reported type only when the bytes are not a recognisable container, and only for the formats the
allowlist marks `signatureless` (`.txt`, `.md`, `.html`) — those have no signature to check, which is
precisely why they are the only ones where a claim is worth anything.

### Every document was refused inside the compiled `.exe`

**Working perfectly in development, silently broken in the build the user actually runs.** The
document parser's own file-type auto-detection fails inside the compiled binary and reports the
failure in the same words it uses for "this is not a document" — indistinguishable from a rejection.
Every document would have been refused in the shipped executable.

**Fixed** by passing the parser the type RTWiki has already determined itself, so it never has to
guess. A second library was measured and rejected: it parsed exactly one PDF per process and every
later call threw. See [ADR-015](adr/ADR-015-document-attachments.md).

**This is the second defect in this class** — behaviour that differs between the dev server and the
compiled binary. It cannot be found by any test that does not run the executable.

### Every text upload was refused, because a browser reports a charset

`text/plain;charset=utf-8` matches no exact allowlist entry, so `.txt` and `.md` uploads were
rejected while unit tests uploading raw `text/plain` passed. **Fixed** by normalising the media type
— parameters such as `charset` are not part of the type — before it is compared.

### Storage settings that failed silently

**The kind of failure that looks like it worked.** `PRAGMA page_size` is ignored entirely once a
database is in WAL mode, and `VACUUM` cannot undo it. Setting `journal_mode = WAL` before
`page_size` left the page size at its 4096 default with no error, and `auto_vacuum` was silently
ignored on any database that already had tables. Both settings are now applied *before* WAL and
their values read back, and a database that could not be converted says so at startup rather than
quietly never reclaiming space. See [ADR-014](adr/ADR-014-blob-stored-image-bytes.md).

### An image was accepted because it started with the right bytes

**The kind of failure that only shows up to someone trying to break it.** `image-formats.ts`
identified a format by comparing the file's leading bytes against a hand-written signature list. A
PNG signature is eight bytes, so *any* file beginning with those eight bytes was accepted as a PNG —
including a PNG header followed by attacker-chosen content — and then stored and served as
`image/png`. The test suite covered SVG, HTML, a PDF, a PE executable and a shell script, but never a
**valid signature followed by hostile content**, which is the one case the check got wrong.

**Fixed** by detecting with `file-type`, which reads the container: for PNG it walks the chunk
sequence and requires a well-formed 13-byte `IHDR`, and it caps chunk count and scan budget so a
crafted file cannot make the parser walk indefinitely. The accepted-format list stayed ours and stayed
dependency-free; only the byte inspection moved server-side. A regression test now covers the
signature-then-garbage case at both the unit and the route level.

**Also fixed:** `pixelCount` returned a subtly wrong number for an image declaring dimensions near
2^32, because the product exceeds `Number.MAX_SAFE_INTEGER` and a JavaScript number silently loses
its low digits. It now reports a value too large to represent as `Infinity` rather than a figure
that is not the truth. The pixel limit was never at risk — the imprecision only appears far above it
— but a function that reports a wrong number is a trap for whoever uses it next.

### The toolbar silently hid a newly added insert control

**The kind of failure that looks like "the feature I asked for isn't there."** The Insert-menu
entries are defined once in `getInsertEntries`, but the rich toolbar rendered them from a
*hand-maintained list of entry keys* written out in the toolbar. Adding a correct, working Image
entry made it appear in the slash menu and nowhere else on the toolbar — with no error, no type
failure, and no failing test.

**Fixed** by having each entry declare which toolbar run it belongs to (`INSERT_RUNS`), and having
the toolbar group by that instead of naming keys. A key list fails silently; a declaration on the
entry cannot drift from the entry. The browser test that caught this asserts the control by
`data-testid`, so the same omission now fails the build.

**Also removed:** the same file used a `group` field that the slash menu read and the toolbar
filtered on, with the run boundaries written out separately. One field, one meaning.

### BlockNote picks the file block, not the image block, and it works by accident

Worth recording because the reasoning is not visible in the code. When a file is pasted or dropped,
BlockNote picks a target block by scanning the schema's `fileBlockAccept` lists, and the `file`
block accepts `*/*` — a superset of the image block's `image/*`. The scan does not stop at the
first match: the inner `break` exits only the accept-list loop, so the outer loop keeps going and
the **last** match wins. It works because `file` happens to be ordered before `image` (the spec map
is alphabetical), so `image` overwrites it.

**Not changed** — it is BlockNote's behaviour and the outcome is correct. Verified in the browser
rather than assumed: `tests/browser/images.pwspec.ts` asserts a dropped PNG becomes a rendered
image. If a future BlockNote version changes that loop to break on first match, this test is what
will notice.

Kept because the *reason* is not obvious from the code, and each was found by measurement rather
than reported.

### The Markdown and Diagram pages had no right-hand panel

**The component was fine. That is why nothing caught it.** `RightSidebarRegion` was extracted so one
implementation would serve every page type, and it was correct — but only `rich-editor.tsx` ever
mounted it. The Markdown and diagram pages had no panel, and no test could fail, because nothing was
wrong with anything under test.

**Fixed** by mounting the same region in both, with `createdDate` / `updatedDate` threaded through
`page-workspace.tsx`. A diagram has no headings, so it omits the outline rather than showing an
"Outline" heading over "no headings". Fullscreen drops the panel: an unobstructed canvas is the
whole point of fullscreen, and a pane the reader cannot collapse from there would defeat it.

**The outline is built from the same parser the preview uses**, not a regex, because the outline and
the preview must agree about which lines are headings or a click scrolls to the wrong place. A
`^#{1,6}` scan disagrees three ways: a `#` line in a fenced block is code, a setext `===` heading has no
leading `#`, and an indented line is a code block. Navigation is by index into the parser's heading
list, not by text, because `## **Bold**` reads as `**Bold**` in the source and `Bold` once rendered.
The engine behind that changed from `marked` to micromark — see
[ADR-017](adr/ADR-017-markdown-engine-micromark.md). The reasoning above is unchanged and is why the
swap was low-risk.

### A `Fragment` around each toolbar run silently broke overflow measurement

Found by the narrow-width test, and the cause is already recorded lower down this page as a harness
trap — which is exactly why it is repeated here. `Children.toArray` treats a `Fragment` as **one
opaque child**, so grouping eleven insert controls into three runs made the overflow hook measure
three units. The split stopped meaning anything: controls moved into the "more" panel when they
should have stayed on the bar, and the table control could not be found at all.

**Fixed** by rendering the runs through `flatMap` — one element per child, no grouping wrapper. The
grouping reads like a harmless readability improvement, which is why the comment at the site now
explains it.

A related test change is worth flagging because it looks like weakening a test: one case used a bare
`getByTestId('insert-table')` while its siblings used the file's own `useControl` helper. The bar is
one control wider now that image insertion is on it, so "this control is on the bar at this width" is
no longer a true statement at every width. `useControl` is the established pattern in that file for
precisely this, and the assertion under test — a table appears — is unchanged.

### Diagram labels were missing from every diagram in the application

**The worst defect found in this project, and nothing caught it.** Mermaid emits HTML labels
inside `<foreignObject>` by default. `sanitizeDiagramSvg` removes every `foreignObject` as
defence in depth. Together: every diagram — every type, on every page — rendered as shapes and
connectors with **no text at all**.

**Why nothing caught it:** every existing assertion was "an `<svg>` appeared". A diagram with no
labels still has an `<svg>`. The rendered `viewBox` was even tall enough to have reserved space
for labels that were not there.

**Fixed** by `htmlLabels: false` in `MERMAID_CONFIG`, which makes Mermaid emit SVG `<text>`.
`<text>` cannot carry script or event handlers, so this is both the fix and the safer setting.
Guarded by `tests/browser/diagram-labels.pwspec.ts` and a unit assertion in
`tests/mermaid-security.test.ts`.

### A diagram in a note could not be resized sideways at all

A block in a note already fills the width of the text column, so the resize control — a single
grip in the **bottom-right corner** — had nowhere to grow into. Dragging it sideways did nothing:
**measured, an 820px block stayed 820px.** Narrowing worked, so the control looked alive, but
growing was impossible, and a user who had made the block smaller could not make it big again
without reaching for a preset.

**Fixed** by replacing the corner grip with two grips, one on each **side edge**. Moving an edge is
always possible; growing an already-maximal box is not. The left grip inverts the pointer delta, so
pulling it left *widens* the block — without that the picture would shrink as its left border
travelled outward, the opposite of what the pointer is doing.

This is how images and video already resize in BlockNote, the editor RTWiki uses: its image block
carries a `previewWidth` prop and ships `bn-resize-handle` grips on **both** sides, revealed on
hover or during a drag, with an invisible shield over the picture so a drag cannot be mistaken for
a text selection. It also **clamps to the editor's own width**, and that is the model followed
here — a diagram never reaches into the margin, so a note containing a resized diagram looks
exactly like a note of plain text. The one deliberate difference is the Diagram page, whose blocks
sit in a wrapping grid where a wider block reflows into a second column, so its ceiling is
correctly the full width of the row.

**Measured after:** right grip pulled left 820 → 616; left grip pulled left 616 → 770; pulled
900px past the edge, clamps at 820. Guarded by
`tests/browser/diagram-note-scale-to-fit.pwspec.ts`.

**A trap the change exposed.** The grip is 8px wide and sits mid-height, where the old corner
handle was 18px square at the bottom. Six existing tests grabbed it at a fixed `+8` from its
top-left — inside the old handle, *outside* the new one — so the drag silently never started. They
kept passing on the geometry they asserted and failed on the drag, which is worth remembering: a
test that positions a pointer with a hardcoded offset is measuring the old control's size, and
reports "no change" rather than "cannot find the target". All now grab the grip's own centre.

### A note's diagram was cropped by its own box, while the Diagram page scaled

The Diagram page scaled a diagram into its box whenever the block had a stored height. A Rich
Note had no equivalent rule, so the same diagram was laid out two different ways on two surfaces
— the exact drift the shared `DiagramView` component was introduced to end, and it survived that
work because the shared piece was the *view* and not the *sizing*.

The failure was not a difference of taste, it was unreachable content. The box shrank to its
stored height and the diagram kept its natural size, so the box cropped it: **measured, the Medium
preset gave a 400px box holding a 549px diagram, overhanging the bottom by 82px** with no way to
scroll to the rest. This is the report that a resized diagram "goes into the edges and is not
fully visible".

**Fixed** by giving a note the same rules the Diagram page already had, applied only when a height
is in play. The container gains `sizeContainerSized` (mirroring the page's `blockCanvasSized`)
whenever a height is stored or being dragged, so an unsized block still draws naturally and still
scrolls. `object-fit: contain` is also set: it has no effect on an SVG's internal geometry by
itself, but combined with `contain` on the root it letterboxes a diagram whose aspect ratio
differs from its box rather than stretching it.

**Measured after:** 400px box, 384px diagram, **0px overhang**. Confirmed to fail at 549px/82px
against the unfixed code, and the padding was measured at every preset rather than assumed (16px at
all three).

### A keyboard user resizing an unsized block with the arrow keys made it the wrong size

The resize grip's arrow-key handler worked from the block's **stored** size. An unsized block
stores nothing, so the handler fell back to the smallest permitted width, 240px, and then added
its 40px step to that. One press of Arrow Right — the key that *enlarges* — therefore **shrank** an
820px block to 280px, and Arrow Down drove the height to the 120px minimum. The pointer drag was
unaffected because it measures the real box on press; the keyboard path was missing that
measurement.

**Fixed** by starting from the box actually on screen, then the stored value, then the limits. An
in-flight drag still wins, so a keypress mid-drag steps from the in-flight size.

**Measured after:** 820x719 → Arrow Left 780x678 → Arrow Right 820x718 → Arrow Down 780x678.

**A wrong claim, withdrawn here.** This was first recorded as "the grip cannot be reached by
keyboard at all", inferred from calling `focus()` and finding focus had not moved. That does not
test tab order. Tabbing reaches the grip after 16 presses with `tabIndex=0` and nothing disabled —
it always was reachable. The companion claim that the size buttons were unreachable was inferred
from the false one rather than measured, and is withdrawn too. Guarded by
`tests/browser/diagram-note-scale-to-fit.pwspec.ts`.

### "Fit width" did nothing: the border resized and the diagram did not

Mermaid writes `style="max-width: <natural width>px"` onto the root `<svg>` of every diagram it
renders, so that a small diagram is not stretched by a wide container. That cap is **inline**, and
an inline style outranks any stylesheet rule — including the `.fit` rule that is supposed to scale
the diagram to the block it sits in.

The consequence was the phantom-width shape of bug, on a block-size feature that otherwise worked:
the size presets resized the box correctly, **measured 820 → 640 → 820 across small/medium/large**,
while the picture stayed frozen at its intrinsic **196px** the whole time. A user pressing the
"fit" button saw a border change and a diagram that ignored them.

**Why it survived:** every assertion was about the *container* — that a stored width is drawn, that a
drag tracks the pointer. The container was correct. Nothing asked how wide the diagram inside it
actually was, which is the same blind spot as the missing-labels entry above: asserting that a
thing exists is not asserting that it is the right size.

**Fixed** in `svg-sanitize.ts`, which now strips that one property from the root `<svg>`. It is
layout, not content: the `viewBox` keeps the real geometry and the `width`/`height` attributes keep
the intrinsic size, so nothing is lost. Fixing it in the shared sanitiser rather than in a
stylesheet is deliberate — Mermaid emits it on both surfaces, and a CSS override would have had to be
duplicated in two modules and would still lose to `!important` on one of them.

Guarded by `tests/browser/diagram-view-controls.pwspec.ts` ("a block size preset resizes the
diagram instead of only the border"), which asserts the drawn width changes with the preset. **It
was confirmed to fail against the unfixed code** before the fix was kept.

### A template's submenu would not open inside the "more" dropdown

The overflow dropdown was built by moving the toolbar's own nodes into another `Menu.Dropdown` —
including a `<Menu>`, so a `Menu` nested inside a `Menu.Dropdown`. That is not Mantine's nesting
mechanism, and the submenu never opened. The dropdown now renders real `Menu.Item` / `Menu.Sub`
rows, which also made it keyboard-reachable.

**Measured, not assumed:** the reported symptom ("submenus unavailable in the dropdown") and the
fix are both covered by tests that fail against the old implementation.

### The rich toolbar's overflow panel could not be operated by keyboard

It was a Mantine `Menu`, which renders `role="menu"` and moves focus by querying
`[data-menu-item]`. The controls moved into it were bare `ActionIcon`s carrying neither, so the
ARIA was a lie and a keyboard user could not get in.

**Fixed** by making it a `Popover`, which is what a panel of arbitrary controls actually is, plus
`trapFocus` so focus moves inside. Two things were found by reading Mantine's source rather than
guessing: a *controlled* `Popover` does not attach its own target toggle (so the trigger did
nothing until an explicit `onClick` was added), and its dropdown carries no data attribute (so a
test coupled to `[data-menu-dropdown]` had to be repointed).

### Continuous integration was blocked at three separate gates

**Measured:** `bun run lint` exited 1 with **175 errors**, so the `Lint` step in
`.github/workflows/build.yml` failed and nothing could be published. `bun run format:check` also
exited 1, because a Biome major deprecated the `recommended` key.

- **162 of the 175** were in `docs/plans/*.html` (design mockups) and a stray `.agnes/` directory
  — untracked but not gitignored, and Biome reads `.gitignore`. Both are now ignored.
- **9 were real.** A dead `min-width: 0` in the page tree (silently overridden by the `72px`
  floor below it), an unused binding, three toolbar index-keys, and three
  `useExhaustiveDependencies` findings. The last three were fixed properly rather than silenced:
  two helpers wrapped in `useCallback` so the dependency list became honest, and one targeted
  `biome-ignore` for a dependency that is a deliberate re-run trigger and whose removal would
  reintroduce stale chevrons.
- The `recommended` → `preset` migration was applied with the tool's own `biome migrate`, and
  verified behaviour-neutral: 0 errors and 55 warnings before and after.

**Now green:** `format:check` 0, `lint` 0, `typecheck` 0, 506 unit tests pass.

### The CSP directive every diagram depends on was untested

`style-src 'self' 'unsafe-inline'` is what allows Mermaid's injected `<style>` to apply. Nothing
asserted it, so tightening the CSP would have unstyled every diagram in the database with no test
failing. `tests/security-headers.test.ts` now pins it, along with a check that no directive has
been widened to a wildcard.

### Mermaid 12 dark mode is verified, not assumed

This was previously "asserted in configuration, never looked at". **Measured** in a browser: in
light mode Mermaid emits `.label { color: #333 }` on a white page; in dark mode it emits
`.label { color: #ccc }` on `rgb(36, 36, 36)`. The theme is applied per render and agrees with
the rest of the application. There was no defect here.

### A narrowing cast turned a failed save into a display of "Saved"

**The kind of failure that removes the alarm along with the bug.**
`src/web/features/visual-pages/mermaid-workspace.tsx` cast `AutosaveStatus` to the narrower
`StatusSaveState` union instead of mapping it. `'dirty'` therefore reached the status bar as a value
it does not recognise and fell through to the **saved** branch, so a diagram page sitting mid-debounce
displayed "Saved" while the edit existed only in memory.

**It was the second, independent cause of a reported symptom whose primary cause was a stale state
list** — the content was being lost *and* the UI was asserting it had been saved. A single-cause
reading of that report would have fixed the data and left the indicator lying to the user, which is
the worse of the two to leave in place.

**The general trap: a cast that narrows a union converts a type error into a lie.** A cast is an
assertion to the compiler and a no-op at runtime, so an unrecognised value has nowhere to fail. The
same missing case in an ordinary mapping is a visible gap; reached through the cast it lands in a
*default* branch, and a default branch is precisely where a reassuring label goes. The compiler was
asked to believe something and it obliged.

**Fixed** by calling the shared `mapAutosaveStatus` from
`src/web/features/workspace/save-state.ts`, which was the last editor still carrying its own copy of
that mapping — the rich editor, the markdown workspace and the HTML editor all call it now. That also
closes the loop: `mapAutosaveStatus` switches exhaustively over `AutosaveStatus` with no default
branch, so adding a case to `AutosaveStatus` without handling it there is a **compile** error. A new
state cannot be added and silently un-mapped, which is exactly the failure the cast was suppressing.

### Ctrl+K could write the search term into the open note, and autosave it

**Impact: high — it destroyed user data, and the keystrokes were never visible in the finder.**

Press Ctrl+K on a Rich Note, start typing a page title, and a run of characters could land in the
document instead of the search box. The debounced autosave then persisted them. The finding that made
this worth chasing was not the assertion but its *shape*: the character where the input stopped
receiving text moved between runs (3 characters one run, 20 the next), and a character-by-character
cut at a shifting offset is a focus race, not a search bug.

**Two independent defects, either of which is sufficient to corrupt the note.**

1. **The modal's focus trap overrode `autoFocus`.** Mantine's `Modal` wraps its content in
   `useFocusTrap` (`node_modules/@mantine/hooks`), which chooses an initial focus target on a
   `setTimeout(0)` — one macrotask *after* React has already applied `autoFocus`. It picks an element
   carrying `data-autofocus`, and failing that **the first tabbable descendant**. The finder Modal sets
   a `title`, so `withCloseButton` defaults to true, and the close button precedes the body in DOM
   order. Measured in the browser: the input received focus at t=1199 ms and the trap moved it to

   ```html
   <button class="mantine-focus-auto mantine-active … mantine-Modal-close …">
   ```

   at t=1218 ms. The search box therefore never held focus for the whole session, and the
   `autoFocus` prop was decorative.

2. **The rich editor's post-mount focus poll treated any button as reclaimable.** `rich-editor.tsx`
   re-asserts focus into the document for 1.2 s after mount — deliberately, because a closing Mantine
   Modal restores focus to its *trigger* button — and its grace list covers `input`, `textarea`,
   `contenteditable`, `role=tree/tab/tablist` but not buttons. So a button inside an open dialog was
   read as "the trigger", and 1 ms after the trap focused the close button the poll moved the caret
   into the document. Mantine's trap does not pull focus back: `useFocusTrap` focuses once on mount
   and thereafter only handles Tab, so once focus escapes, it stays escaped.

**How the finder was dismissed — the part that was not obvious.** Neither of `setFinderOpen`'s two call
sites should have fired: the needle contains no `k`, and `keyboard.type` sends no clicks. The trace
shows the finder was closed by **a Space activating the close button the trap had focused**, because a
`<button>` is activated by Space. The needle `Finder Needle 1756534…` contains spaces. In the traced
run the sequence was: trap → close button (t=1235), keystrokes to the button (t=1250–1284), Space at
t=1261 fires a synthetic `click`, the `onClick` stack reaches the `onClose` prop, the finder unmounts,
and the remaining characters are typed into the document behind it. `openRow`'s result buttons have
the same property, so a Space on a focused result row also opens that page.

**Fixed** in two places. `quick-finder.tsx` now carries `data-autofocus` on the search input, which is
Mantine's documented way to tell the trap where focus belongs, so the trap agrees with `autoFocus`
instead of overriding it. `rich-editor.tsx` adds `[role="dialog"]` to the poll's grace selector, so a
focus target inside an open dialog is never stolen from. The poll's original intent is intact:
`useFocusReturn` moves focus back out of the dialog ~10 ms after it closes, so by the time the poll
observes the trigger button the dialog is no longer an ancestor and the trigger is still reclaimable.
`tests/browser/connect-find.pwspec.ts` pins both halves — the input keeps every character *and* the
open document keeps none, checked against the status bar's word/char tally so a needle cannot hide
from it.

**The trap worth keeping: `.fill()` is not a user.** The sibling step that searched for body text used
`locator.fill()`, which assigns the value directly and emits no key events at all. It had never
flaked, in any run, because it never needed focus. The one step that typed for real was the one that
failed. A suite can be green on a path no human takes; `keyboard.type` is not redundant with `fill`,
it is the only one of the two that exercises focus.

**Harness trap, same class as the PDF one.** The failure snapshot showed the finder "entirely absent",
which reads as "something closed the modal and nothing is wrong with focus". It was the *timing*: the
finder was still in its 200 ms exit transition when the snapshot was taken, so `toHaveCount(0)` was
not yet true while `inputCount` measured 1. The modal had genuinely closed — but the trace, not the
snapshot, is what identified the Space activation.

### The same `autoFocus` defect is still live in the New page dialog

**Found, not fixed — outside the file partition of the pass that found it.**

`src/web/features/pages/new-page-dialog.tsx:92` puts `autoFocus` on the Title `TextInput` inside a
`Modal` with a `title`, so `withCloseButton` is on and `useFocusTrap` moves initial focus to the close
button by exactly the mechanism measured above. Consequence: opening *New page* and typing leaves the
first characters in the title field, which reads as the field ignoring the keyboard. There is no data
loss — the field is not a document and nothing is autosaved — but the fix is the same one line
(`data-autofocus` on that `TextInput`).

`src/web/features/rich-editor/wiki-link.tsx:144` also uses `autoFocus`, but its `TextInput` is inside a
`Popover`, which does not use `useFocusTrap`. Checked and not affected.

---

## Harness traps that cost real time

Kept because each one produced a confidently wrong conclusion.

- **The dev server serves the prebuilt `build/web`.** A source change is invisible to the browser
  suite until `bun run build:web` runs. A test against a stale bundle looks exactly like a fix
  that did not work.
- **Playwright needs a free port.** The default 8080 collides with single-instance detection. Set
  `PLAYWRIGHT_PORT`; `reuseExistingServer: false` starts its own server.
- **Do not substring-match `error-icon`.** Mermaid's `<style>` block *defines* `.error-icon` in
  every SVG it emits, including successful ones. Matching that string reports failures on healthy
  diagrams.
- **Do not simulate a bug inside a fixed build.** The fix had changed the mechanism, so the
  simulation produced a false negative and looked like the fix had failed.
- **The overflow split cannot be forced with the window width.** The page layout clamps its own
  minimum, so the toolbar keeps its width and no "more" button ever appears. Constrain the
  toolbar element itself (`el.style.width = '120px'`) to exercise overflow.
- **`Children.toArray` guarantees a key on every child** — use it instead of the array index, or
  a control is torn down and rebuilt on every resize, losing its own state.
- **A red result from a harness built in the current session is a fact about the harness**, not
  about the product. Verify the harness before believing it.
- **A test that cannot fail is worse than no test.** An early version of the submenu test skipped
  its only meaningful assertion because the type it needed never reached the dropdown. It now
  forces the condition and fails loudly if it cannot.
- **A test that cannot fail is worse than no test, and it is not obvious from reading it.** The
  regression test written for the document CSP overwrite (above) mounted its middleware in the broken
  order, so it agreed with the code *and* with the opposite of the code. Nothing about the test
  looked wrong. **Check a regression test by breaking the code it guards** — if the suite still
  passes, the test is decoration and the claim that the fix is verified is false.
- **Breaking the code is necessary but not sufficient: a test can go red for a reason unrelated to
  the defect.** A test written for the stale diagram-workspace state awaited a block count *between*
  two rapid Add presses. Against the unfixed code it failed — but for the wrong reason. On the
  unfixed code the count only rises once the save lands, so that intervening wait handed the second
  press a freshly refreshed prop and the two actions stopped being a rapid sequence at all. The
  assertion's *result* was correct while the test was still failing for a third cause, which would
  have been "fixed" by changing the thing that was actually broken. **Await nothing between the
  actions under test and assert once at the end** — here the write count is what proves the debounce
  window was still open, not the block count. Then **confirm the red is red *for the intended
  reason*, not merely red**: read what the failure says, not just that a failure exists.
- **Two dispatches fired from a single `page.evaluate` share one pre-commit closure.** The second
  action then reads state React has not committed yet, so it exercises neither the fixed nor the
  unfixed code and a fix cannot possibly appear to work. **Each dispatch must be its own browser
  task** — two `dispatchEvent` calls in a row, nothing awaited between them.
- **Starting the built application opens a browser tab on the user's screen.** `bootstrap` launches
  a browser unless `--no-open` is passed. The end-to-end script omitted it and opened a tab on every
  run, dozens of times. The script now passes the flag.
- **Stop a spawned server on every exit path.** An earlier version only stopped it on the success
  path, so a single failed assertion left an `RTWiki.exe` running and holding its port for the rest
  of the session. Cleanup registered before anything can throw, not inside the success branch.
- **Never copy the workspace's own `data/` directory into a test.** The end-to-end script staged a
  copy of the real data directory, and that copy silently changed what the CSP check reported.
  Chasing the symptom — middleware ordering, an instrumented build, a stale-binary theory — cost far
  more than building a fresh data directory would have. A test that stages state must construct all
  of it.
- **A build that reported success can still be stale.** `bun run format:fix` running alongside
  `bun run build` produced an executable that predated the fix under test, which made a correct
  change look broken. The end-to-end script now compares the executable's age against the source's
  and prints a warning when the source is newer.
- **In a compiled executable, check what the *library* does, not what your code does.** Two separate
  defects above (document auto-detection, and a PDF parser that worked once per process) existed
  only inside the binary. Run the build.
