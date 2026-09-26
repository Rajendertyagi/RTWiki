# Known bugs and open issues

A running list of defects found and left unfixed, so they are not rediscovered later.
Every entry records what was **measured**, what remains unproven is said plainly, and an
entry inherited from an earlier pass is marked as such rather than presented as freshly checked.

Last reviewed: 2026-09-27, on branch `docs/trilium-uiux-spec` (pushed to `origin`).

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

---

## Recently fixed

Kept because the *reason* is not obvious from the code, and each was found by measurement rather
than reported.

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
