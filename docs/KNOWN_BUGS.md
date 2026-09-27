# Known bugs and open issues

A running list of defects found and left unfixed, so they are not rediscovered later.
Every entry records what was **measured**, what remains unproven is said plainly, and an
entry inherited from an earlier pass is marked as such rather than presented as freshly checked.

Last reviewed: 2026-09-27, on branch `feat/document-attachments`.

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

### 1. Twelve Mermaid diagram types render an empty diagram

**Impact: low today — none of them are reachable from the UI.**

RTWiki offers 21 template types, all verified rendering. Mermaid 12 supports 33. The other 12
are deliberately excluded from the template list (the rationale is recorded beside
`DIAGRAM_TEMPLATES` in `src/web/features/rich-editor/insert-blocks.ts`) because they render a
24×24 SVG with no content and no error marker.

**Root cause, established by reading Mermaid 12's source:** in 12, `loadRegisteredDiagrams()` is
called from exactly one place — inside `registerExternalDiagrams(diagrams, { lazyLoad: false })`.
The ordinary `parse` + `render` path never force-loads a lazy diagram definition, so the types
that are registered lazily resolve to an empty diagram. The chunks are present in the bundle
(all but `agentflow`).

**Inherited measurement** — this was established in an earlier pass and has not been re-measured
since. The reasoning above is from reading the source, not from a fresh run.

**Next step:** the documented lazy-load switch, if Mermaid exposes one usable from outside. If it
does not, that is a dependency limitation and the honest outcome is to document the exclusion.

### 2. `gitGraph` and `venn` produce identical markup across versions

**Impact: low.** Undiagnosed. Their rendered output did not change between Mermaid 10.9.3 and
12.0.0, which is surprising for two version bumps. **Inherited, not re-measured.**

### 3. The native desktop shell has never been built or run here

**Impact: medium, and not fixable from this machine.** There is no Rust toolchain installed, so
`bun run build:desktop` has never been executed. Everything said about the desktop shell is
inferred from the Tauri configuration, not observed.

**Next step:** run it on a machine with the Rust toolchain, or accept it as unverified.

### 4. The template bar is cramped inside a diagram block's split editor

**Impact: low, but it is a usability trade-off rather than an oversight.** The bar's buttons are
48px, chosen deliberately when the bar was only used on a full-width Diagram page. A diagram
block inside a Rich Note is a split editor and much narrower, so at typical widths only the first
few templates sit on the row and the rest are reached through the trailing `⋮`. That works and is
tested, but it is not the comfortable arrangement the page gets.

**Next step:** either a smaller icon size for the block context, or a compact variant of the bar.
Deliberately not done here: it is a design choice, and shrinking the icons is the exact thing that
made the bar unreadable when it was last tried at 15px.

### 5. Eleven `!important` declarations in the page-tree stylesheet

**Impact: low — a warning, not an error.** `lint/complexity/noImportantStyles` fires 11 times in
`src/web/features/sidebar/page-tree.module.css`. Each overrides a third-party stylesheet
(`wunderbaum`, the tree library), so they are load-bearing: removing one changes the tree's
appearance. The rule is a warning, so the lint gate is green.

**Next step:** leave them, or add a file-level suppression with the reason. Do not remove them
one at a time without looking at the tree.

### 6. Uploaded images are not associated with a page, so they are never cleaned up

**Impact: low now, and it grows silently.** An `image` block stores a URL; the `attachments` table
records the image but has no foreign key to `pages` (see [ADR-013](adr/ADR-013-image-attachments.md)).
Consequences: deleting a note leaves its images unreferenced, and there is no "images on this page"
list because there is no page to scope one by. `GET /api/pages/:id/attachments` is listed in
[ARCHITECTURE.md](ARCHITECTURE.md) as **not implemented** for this reason.

**Partly reduced by [ADR-014](adr/ADR-014-blob-stored-image-bytes.md).** Two of the three failure
modes are gone: bytes and metadata can no longer get out of step, because they are one row, and
reclaiming an unreferenced image is now a single `DELETE` rather than a delete plus an unlink that
can fail. What remains is the policy question, not the mechanics.

This was not hypothetical. The development database held **14 image files that no row referenced**,
left by earlier runs, with nothing reporting it.

**Also outstanding:** files left in `data/attachments/` by a database created before ADR-014 are
deliberately not deleted by the migration, because an unreferenced file cannot be proven to be
garbage rather than merely not-yet-referenced. They are inert and can be removed by hand.

**Why there is still no page foreign key:** an attachment may legitimately be uploaded before it is
referenced, and a note may be deleted while its images are still wanted — a cascade would destroy
images still in use elsewhere.

**Next step:** a retention pass over the `attachments` table that reclaims rows unreferenced by any
document, plus a "referenced by" check before reclaiming. This needs a deliberate policy decision
(age threshold, and what "referenced" means for a note in the recycle bin) rather than a default.

### 7. Documents are attached, searchable, and viewable in place

**Resolved for storage; preview remains open.** [R-024](PRODUCT_REQUIREMENTS.md) requires attaching
"images, PDFs, and documents", and [AC-031](ACCEPTANCE_CRITERIA.md) names DOCX, ODT, TXT and MD. All of
those are now accepted, stored in the database beside the images, and their text is extracted into the
search index — so a PDF you imported becomes findable by what is in it. See
[ADR-015](adr/ADR-015-document-attachments.md).

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

### A page closed while a save had failed loses the pending content

**Not silent at the time — and the work is still gone.** The status bar does show "Save failed" in
red, so the user is not misled while the page is open. What is unhandled is *leaving*: the pending
content does not survive the remount, and it behaves this way in every editor rather than in one
workspace, so it is not a diagram-page bug. The failure is visible only for as long as the page
stays mounted; closing it turns a visible error into a silent loss.

**Found and deliberately not fixed** in the same pass as the stale-state and status-mapping defects
below. The fix belongs in the autosave controller (hold the content for a retry that outlives the
page) or in the close/switch confirmation, which is where `isAutosaveDirty` already feeds the prompt
for the ordinary unsaved case. The failed-save case is the one that never reaches it.

### `isDirty` now means two different things, and only one of them is read

The visual workspace uses `useAutosave`'s own `isDirty` — `dirty || error`,
`src/web/features/rich-editor/use-autosave.ts:98` — while the markdown workspace
(`markdown-workspace.tsx:99`) and the HTML editor (`html-editor.tsx:154`) use `isAutosaveDirty` —
`dirty || saving`, `src/web/features/workspace/save-state.ts:51`. The only difference is a save in
flight, which the shared helper counts as dirty and the hook's own value does not.

**Inert downstream today, and left alone deliberately.** The consumer of that `isDirty` reads only
`state.saveState` and `state.error` (`App.tsx:973-976`), so changing either convention is a no-op and
"tidying" it would be a change with no observable effect. But it is a third convention waiting to
matter, and the place it will matter is the close confirmation above — where a save in flight is
precisely the case that must not be dismissed.

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
