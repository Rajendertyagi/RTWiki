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

**The loss surface is narrower than the entry above implies, and the gap is elsewhere.** Measured:
the controller deliberately keeps the payload on failure (`// Do NOT clear pendingContent - preserve
for retry`, `autosave-controller.ts:156`), and a retry **is** wired to the UI in two places — the
status bar (`status-bar.tsx:361`, `data-testid="status-retry"`) and the Rich Note's own alert. So
while the tab stays open, a failed save is recoverable by a visible button, not lost. The two real
losses are:

- **Close, reload or navigate away inside the 2,000 ms debounce window.** `dispose()` sets
  `disposed = true` and calls `clearTimer()` (`autosave-controller.ts:238-241`), so up to two seconds
  of typing disappears with no prompt and no flush. There is **no `beforeunload`, `pagehide` or
  `unload` handler anywhere in `src/`** — the only lifecycle listener is a `visibilitychange` in an
  unrelated feature (`schedule-notifications.tsx:24,27`).
- **Close or reload while `status === 'error'`.** The pending content lives in component state, so a
  remount loses it and the retry button cannot help a user who has already closed the tab.

**A close prompt is the wrong fix for the first one, and saying so is part of the entry.** The
pending amount is at most two seconds of typing, the failure is already surfaced visibly, and a
prompt firing on every close of a healthy document trains the user to dismiss it — destroying its
value on the one occasion it matters. Flushing the controller on `visibilitychange → hidden`, with
`pagehide` as a fallback, narrows the window to near zero for ordinary use and adds no prompt. MDN
recommends exactly this pair over `beforeunload`, and `beforeunload` is additionally unreliable
against the back/forward cache.

**Not a fix, deliberately:** the alternative is persisting the draft to `IndexedDB` per change and
recovering on mount. That trades a two-second window for a **second, unencrypted copy of private note
content in the browser profile**, surviving the app, which the privacy posture built around "the data
lives in `data/rtwiki.sqlite` beside the executable" does not cover. It also needs an explicit
staleness policy — a recovered draft older than the server copy must not silently overwrite newer
work. **The performance cost of that option on this codebase is unmeasured** and should not be
guessed: the handler already runs `JSON.stringify(editor.document)` on every change, so a draft write
is not a new class of work, but the actual number is not established.

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

> **Measured at commit `476de71`, and a fix was in flight in the working tree when this entry was
> written.** `src/server/utils/request-host.ts` had appeared and was being registered in
> `createApp()` as a `Host` allowlist on every request — requirement (1) below. That work is
> **uncommitted and unverified here**, so it is not counted as built. Two things are worth saying
> about it anyway, because they are properties of the fix rather than of the fix's completeness:
> a `Host` allowlist stops **rebinding**, but it does nothing about the plain cross-origin `POST`
> that needs no rebinding at all — the `POST /apply` wipe above is reachable from a bare form
> submit; and `isSameOrigin()` was **still** not called from `pages.ts`, `schedule.ts` or
> `schedule-presets.ts`, so requirement (2) remained unmet. Whoever lands this must re-measure the
> route table rather than assume the allowlist closed it.

### A double-clicked `RTWiki.exe` closes the window its own error message is printed in

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

> **Measured at commit `476de71`.** A fix was in the working tree when this entry was written —
> `checkIntegrity()` gained a `try`/`catch` that returns `false` — but it is **uncommitted and
> unverified here**, so this entry records the state of `476de71` and must be closed by whoever
> lands the fix, with the same discipline as any other entry in *Recently fixed*. The underlying
> measurement, that the pragma throws rather than answering, is unaffected either way.

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
