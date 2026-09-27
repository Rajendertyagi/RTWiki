# Known bugs and open issues

A running list of defects found and left unfixed, so they are not rediscovered later.
Every entry records what was **measured**, what remains unproven is said plainly, and an
entry inherited from an earlier pass is marked as such rather than presented as freshly checked.

Last reviewed: 2026-09-27, on branch `feat/document-attachments`.

**Not yet built, and recorded here so it is not mistaken for done:** a visual page can now *store*
several diagrams (content v2, ordered blocks, 50-block cap), but the workspace still edits one
diagram at a time and there is no reordering UI yet. The storage and parsing half is done and
tested; the view and the drag-to-reorder are the remaining work.

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

### 7. Documents are stored and searchable, but cannot be previewed in the app

**Resolved for storage; preview remains open.** [R-024](PRODUCT_REQUIREMENTS.md) requires attaching
"images, PDFs, and documents", and [AC-031](ACCEPTANCE_CRITERIA.md) names DOCX, ODT, TXT and MD. All of
those are now accepted, stored in the database beside the images, and their text is extracted into the
search index — so a PDF you imported becomes findable by what is in it. See
[ADR-015](adr/ADR-015-document-attachments.md).

**What is still missing:** a document downloads rather than opening in a tab. That is deliberate rather
than unfinished — a document is a program, and serving one inline means executing it in RTWiki's own
origin — so the download is protected twice, by `Content-Disposition: attachment` and by a per-response
`default-src 'none'` policy. Two known gaps remain inside that: **legacy binary `.doc`/`.xls` are
refused** (they are OLE compound files this parser does not handle; AC-031 names DOCX and ODT, not
DOC), and **a scanned PDF yields no searchable text**, because it has no text layer and there is no OCR.

**Next step:** an inline preview, if it is wanted at all, would reuse the sandboxed-iframe treatment
[ADR-007](adr/ADR-007-sandboxed-custom-content.md) gives custom content. That is a separate decision with
its own threat model, not an allowlist edit.

### 8. There is no way to attach a document from the application

**Impact: high — the feature cannot be reached by a user.** Document upload works at every layer
below the toolbar: the endpoint accepts the formats, the parser extracts text, the bytes are stored
in the database, the search index picks the text up, and the download is protected. None of it is
reachable. `uploadDocument` in
`src/web/features/rich-editor/blocks/document-upload.ts` is exported and **imported nowhere** — it has
no caller, no toolbar entry, and no menu item. (Measured: a repository-wide search for the symbol
returns only its own definition.)

So [R-024](PRODUCT_REQUIREMENTS.md)'s "images, PDFs, and documents" is satisfied for the API and not
for the product. A user cannot attach a PDF today.

**Next step:** add the insert entry beside the Image one, declaring its toolbar run through
`INSERT_RUNS` rather than by adding a key to a list — the exact trap recorded under
*The toolbar silently hid a newly added insert control* above, which is why the declaration
mechanism is the thing to reuse here. Its `fileBlockAccept` list will collide with the `file` block's
`*/*` in the way described under *BlockNote picks the file block, not the image block*, so the schema
ordering has to be checked rather than assumed.

## Recently fixed

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

**The outline is built from `marked.lexer`, not a regex**, because the outline and the preview must
agree about which lines are headings or a click scrolls to the wrong place. A `^#{1,6}` scan
disagrees three ways: a `#` line in a fenced block is code, a setext `===` heading has no leading
`#`, and an indented line is a code block. Navigation is by index into the lexer's heading list, not
by text, because `## **Bold**` reads as `**Bold**` in the source and `Bold` once rendered.

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
