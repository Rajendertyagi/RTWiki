# Unified Toolbar — Handover

**Status: PARTIAL. Two measured defects remain open. This is a handover, not a completion claim.**

Branch: `fix/diagram-sizing-controls-and-consistency`
Nothing has been committed. Nothing has been pushed. The working tree contains
many unrelated workstreams from other people — see §9.

---

## 1. Objective

One application-level toolbar across every page surface. Surfaces change its
**contents** (capabilities, groups), never the toolbar implementation.

Target layout:

```
TABS
────────────────────────────────────────────────────────────
[Undo][Redo] | [Formatting] | [IDE] | …                    [page controls]
────────────────────────────────────────────────────────────
INFO BAR
────────────────────────────────────────────────────────────
CONTENT
```

---

## 2. Decisions (made by the user, not by me)

| # | Decision |
|---|---|
| 1 | CodeMirror stays for Markdown. No conversion to BlockNote. |
| 2 | HTML joins the same unified toolbar as separate **data-driven groups**: Formatting, then IDE. No second contextual toolbar. |
| 3 | Diagram page becomes **one Template menu control** in the application toolbar, with all templates **and variants** inside it. No 12- or 30-icon row. |
| 4 | The Diagram **block-level** toolbar stays contextual and keeps `role="toolbar"`. |
| 5 | `Export .md` goes in the toolbar overflow/page-actions; the tree context menu stays; both call one shared command. |
| 6 | Group order is **Formatting → IDE**, consistently on every surface. |
| 7 | **Font size is in the IDE group.** **Word Wrap moved from Formatting to IDE** — both are editor/view settings, not document formatting. |
| 8 | Keep existing control order within each group unless there's a usability reason. |
| 9 | Diagram is explicitly **not** in the HTML pass. |

---

## 3. Architecture as built

```
page-workspace.tsx
  └── toolbarRow                      one flex row, 40px, chrome tint
        └── DocumentToolbar            the ONLY application toolbar
              ├── role="toolbar", aria-label, roving focus (use-roving-focus.ts)
              ├── TOOLBAR_GROUPS       data, from toolbar-model.ts
              │     └── each control: key, label, Icon, testId, group align
              ├── EditorCapabilities  from capabilities.ts
              │     ├── commands       static
              │     ├── menus          panel-backed controls; content(close)
              │     └── state()        a READER, not a value (see §7)
              ├── useToolbarOverflow   measures, splits into bar + "More"
              └── trailing            surface-owned, rendered last
                    │
                    ├── MarkdownPageWorkspace  → codemirror-capabilities.ts
                    ├── RichToolbarBridge      → blocknote-capabilities.tsx  (lazy)
                    └── SourceToolbarBridge    → source-capabilities.ts       (lazy)
```

`DocumentToolbar` draws every pixel. Adapters supply capabilities and render no
toolbar chrome.

---

## 4. What is DONE, and how it was verified

### 4.1 The menu seam (was structurally broken in four ways)

The old `renderMenu` seam shipped **unused and unusable**:

1. A menu-only capability was **dropped** — the resolver rule was
   `if (!run && !stated) continue`, and text colour has no command, so the controls
   that most needed migrating could not be expressed at all.
2. The trigger **ran the command** instead of opening the panel.
3. The panel was a bare `ReactNode` with **no way to close itself**.
4. `aria-haspopup` claimed a structure the panel did not have.

Replaced by `menus: EditorMenu { content: (close) => ReactNode }`.

### 4.2 Rich Note migrated

Deleted: `rich-toolbar.tsx` (831 lines), `rich-toolbar.module.css` (139 lines).
Created: `blocknote-capabilities.tsx`, `rich-toolbar-bridge.tsx`, `swatch-panel.tsx`.

`tests/browser/toolbar-controls.pwspec.ts` — **27/27, spec file unmodified.**

Also removed two **second implementations** that the brief forbids:

- `WikiLinkToolbarAction` was its own trigger + `Popover`. Its panel was extracted to
  `WikiLinkPanel` in `wiki-link.tsx`; the trigger deleted.
- The Mermaid template menu existed twice. Extracted to
  `blocks/diagram-template-menu.tsx`.

### 4.3 HTML source editor migrated

Deleted: `source-toolbar.tsx` (261 lines), `source-toolbar.module.css` (31 lines).
Created: `source-capabilities.ts`, `source-toolbar-bridge.tsx`.

`tests/browser/code-ide.pwspec.ts` — **8/8, spec file unmodified** (all 15 legacy
test ids still resolve).

**The defect it fixed:** an HTML page had **two `role="toolbar"` elements nested
inside each other**, with two focus models and two divider systems. Tab walked into
the inner one and then through all 17 of its controls one at a time.

### 4.4 Model additions

- 14 `ide.*` capabilities, two groups:
  - `ide-formatting`: `ide-indent`, `ide-outdent`, `ide-format`
  - `ide-tools`: `ide-find`, `ide-replace`, `ide-comment`, `ide-fold-all`,
    `ide-unfold-all`, `ide-word-wrap`, `ide-font-smaller`, `ide-font-reset`,
    `ide-font-larger`, `ide-save-now`, `ide-fullscreen`
- `history.undo` / `history.redo` reused, not redeclared.
- 4 HTML field capabilities: `html.fieldPreview` / `html.fieldHtml` /
  `html.fieldCss` / `html.fieldJs`, in group `html-fields` with `align: 'end'`.
- `ToolbarGroup.align?: 'start' | 'end'` — pins a group to the right edge.
- `CapabilityState.label?: string` — dynamic accessible name (fullscreen reads
  "Enter fullscreen" / "Exit fullscreen").
- `DocumentToolbar` gained an optional `testId`, so a surface keeps its own row name
  (`source-toolbar`) instead of the shell inventing one.

### 4.5 Right-alignment mechanism

`margin-left: auto` on the first control of an `align: 'end'` group
(css class `.pinnedEnd`).

Chosen over a flexible spacer element because `useToolbarOverflow` **measures each
child** to decide the split: a zero-width spacer measures as a unit, and a real one
swallows the bar. No absolute positioning, transform, or pixel offset anywhere.

### 4.6 Test results

| Suite | Result |
|---|---|
| `bun test` (unit) | **1556 pass / 0 fail** |
| `bun run build:web` | pass |
| `bun run build:server` | pass (after `RTWiki.exe` was stopped) |
| `bun scripts/verify-docs.ts` | PASS (63 checks) |
| `tsc --noEmit` | **0 errors** |
| `biome check .` | 2 errors, both in files never touched (see §9) |
| Full browser suite | **518/518** — run BEFORE the field-switch change |
| `code-ide` + `html-toolbar-unified` | **18/18** — run AFTER it |

> ⚠️ The full 518 was **not** re-run after the HTML field-switch migration. That is
> the first thing the next person should do.

### 4.7 Bundle

- Entry `index-*.js` — **1855 KB** (was 1858 before the work).
- `blocknote`, `getActiveStyles`, `indentMore`, `toggleComment` — all **absent** from
  the eager entry. Lazy boundaries intact.
- Shell `document-toolbar-*.js`, adapter `rich-editor-*.js` — separate chunks.

---

## 5. What is PENDING — with measurements

### 5.1 The bar does not fill or shrink with its row — **OPEN**

Measured across three viewports, after the field-switch migration:

| viewport | row width | bar width | bar right edge | overflow button |
|---|---|---|---|---|
| 1600 | 1264 | 714 | 1264 | 0 |
| 1280 | 944 | 714 | 1264 | 0 |
| 900 | 564 | **714** | **1264** | **0** |

The bar is **714px at every width**, pinned at x=1264. At a 900px viewport the row
is 564px but the bar still measures 1264 — it overflows, gets clipped by
`overflow: hidden`, and **no overflow button appears**. The HTML navigation would be
invisible at narrow widths.

**Root cause (identified, not yet fixed):** `page-workspace.tsx` renders the HTML row
as `{htmlToolbar}` — a `useMemo` in `html-editor.tsx` returning
`<Group w="100%" justify="space-between" gap="sm">` that contains the breadcrumb, the
preview-refresh controls, the toolbar bridge and the JS-enabled toggle. The bar is
therefore **not a direct flex child of `.toolbarRow`**, so it cannot claim leftover
space and cannot shrink below its content.

On Rich Note and Markdown the bar **is** a direct flex child, which is why those two
are correct and only HTML is wrong.

**The fix:** make the bar a direct child of the row, as on the other two surfaces.
The breadcrumb and the preview-refresh controls belong to the editor header below the
row, not inside the toolbar row. This is one deliberate structural edit to
`html-editor.tsx` plus the `toolbarNode` memo and its dependency list.

**Two CSS fixes were tried and reverted** (recorded in
`document-toolbar.module.css` so they are not retried):

- `flex: 1 1 auto` alongside `width: 100%` — **no effect**. `width: 100%` sets the
  flex basis to the parent's full width, leaving no free space to grow into.
- `flex: 1 1 0%` with `width: 100%` — **worse**: 530px, narrower than its content.

### 5.2 The field group is not flush right — **OPEN**

Measured: the nav group's last control ends at x=1180; the bar's content right edge
is 1256. An **84px gap**.

Cause: `margin-left: auto` pushes the nav right, but the `trailing` slot
(`return-to-preview`) renders **after** it, so the nav is flush against trailing
rather than against the row's edge.

**Fix options:** move `trailing` before the `align: 'end'` group, or drop
`return-to-preview` from `trailing` (it is arguably a field navigation control and
belongs in the same group as Preview/HTML/CSS/JS). The second is cleaner but changes
where an existing control lives — needs the user's call.

### 5.3 Not started

| Item | Notes |
|---|---|
| **Diagram page migration** | Point the page at the existing `DiagramTemplateMenu`. Restore `Menu.Sub` for the 2 variant families (`flowchart` ×4, `state` ×3) under a **separate test-id prefix** so `diagram-templates.pwspec.ts`'s exact-30-keys assertion survives. Drop `DiagramTemplateBar` from `page-workspace.tsx:224`; **keep** it for `mermaid-block-view.tsx:277`. Reconcile ~16 `template-*` test refs. |
| **`Export .md`** | Extract the tree context-menu export into one shared command; call from both. Add a regression test. |
| **`block-resize.tsx`** | `role="toolbar"` → `role="group"` (5 presets, no tabIndex/arrows). Add a11y test. **Do not touch the drag-handle `onKeyDown` at ~line 455.** |
| **Final group model** | Generalise group membership per surface. Do **not** change the resolver's greying or the control order for Rich Note / Markdown. |
| **Docs** | `ADR-022` and `docs/ARCHITECTURE.md` are **stale**. `verify-docs.ts` passing does not make them accurate. |
| **Full verification** | §8. |

---

## 6. Files

### Created
```
src/web/features/workspace/capabilities.ts              (extended)
src/web/features/workspace/toolbar-model.ts             (extended)
src/web/features/workspace/document-toolbar.tsx         (extended)
src/web/features/workspace/document-toolbar.module.css  (extended)
src/web/features/workspace/swatch-panel.tsx
src/web/features/workspace/use-roving-focus.ts
src/web/features/rich-editor/blocknote-capabilities.tsx
src/web/features/rich-editor/rich-toolbar-bridge.tsx
src/web/features/rich-editor/blocks/diagram-template-menu.tsx
src/web/features/html-editor/source-capabilities.ts
src/web/features/html-editor/source-toolbar-bridge.tsx
tests/browser/rich-toolbar-unified.pwspec.ts            13 tests
tests/browser/html-toolbar-unified.pwspec.ts            10 tests
tests/toolbar-menu-contract.test.ts                     11 tests
```

### Deleted
```
src/web/features/rich-editor/rich-toolbar.tsx           831 lines
src/web/features/rich-editor/rich-toolbar.module.css   139 lines
src/web/features/html-editor/source-toolbar.tsx         261 lines
src/web/features/html-editor/source-toolbar.module.css   31 lines
```

### Modified
```
src/web/features/pages/page-workspace.tsx               row ownership
src/web/features/rich-editor/rich-editor.tsx            bridge import + re-export
src/web/features/rich-editor/wiki-link.tsx              WikiLinkPanel extracted
src/web/features/markdown/markdown-workspace.tsx        (earlier session)
src/web/features/html-editor/html-editor.tsx            switcher removed, both call sites wired
src/web/config/index.ts                                 UI_TEXT already had every label
```

---

## 7. Landmines — every one measured, not reasoned

### Mantine

1. **A controlled `Popover` attaches NO click handler.** `PopoverTarget` composes
   `onClick` only when uncontrolled: `...!ctx.controlled ? { onClick: … } : null`.
   Every popover here is controlled, so triggers are inert without their own handler.
2. **A `Tooltip` between `Popover.Target` and the DOM node takes the ref** — the
   popover's wiring lands on the wrong element and the panel never opens. The repo
   had already paid for this twice.
3. **`popupType` overwrites the child's `aria-haspopup`.** Set `popupType="menu"` on
   the target to keep the button's own declaration.
4. **`Menu.Dropdown` renders nothing while closed.** Hosted in a Popover it needs
   `opened` forced, or the rows are never in the DOM.

### The capability contract

5. **`state()` is a READER, not a value.** Memoising it on `[capabilities]` froze
   every pressed indicator at `false` while commands still worked. Markdown was
   unaffected, which is exactly why Markdown-only tests missed it. **Never memoise it.**
6. **The resolver rule is `if (!run && !menu && !stated) continue`.** A capability
   with no command is **dropped**. Stating a reason for it (e.g. "not available in a
   source editor") overrides that and renders it **greyed** — which filled the HTML
   row with ~30 dead controls and pushed all 14 real ones into the overflow, making
   `ide-fullscreen` unclickable. Greyed-with-a-reason is for a command that exists
   and cannot act *now* (font-size bounds, history depth).
7. **`indent.increase` / `indent.outdent` are BlockNote's `nestBlock`/`unnestBlock`**,
   NOT CodeMirror's `indentMore`/`indentLess`. Reusing them for the IDE group rendered
   indent twice on a Rich Note. Caught by the model invariant test. Use `ide.indent` /
   `ide.outdent`.

### Test measurement traps

8. **Overflow cannot be asserted with `scrollWidth <= clientWidth`** — the portalled
   panel's children count toward the bar's overflow in Chromium. A *correct* split
   measured 702 vs 540. Assert the last visible slot's right edge vs the bar's.
9. **Compare the toolbar ROW, not the inner `role="toolbar"` element** — the inner one
   is vertically centred and reads a 6px difference that is centring, not a gap.
10. **`tabindex` is on the slot `<span>` wrapper, not on the button.** So
    `document.activeElement.getAttribute('data-testid')` is `null`; read the control
    *inside* it.
11. **The roving focus counts dividers**, so a divider's slot can hold the tab stop.
    Pre-existing, not fixed.
12. **`cloneElement` on the overflowed controls duplicated every one of them** —
    `insert-code-block` resolved to **24 elements**, because the children are `Tooltip`
    wrappers and cloning one re-renders its subtree. Use the `buildItems(close)`
    rebuild instead.
13. **A greyed control's accessible name** must NOT gain an `(unavailable)` suffix —
    it renames the control and breaks every locator. Use native `disabled` +
    `data-disabled` + `title`.
14. **A `SegmentedControl` inside a `justify="space-between"` group** is what caused
    the 683px bar and the nav floating in dead space.

### Gates

15. **`tests/theme-registry.test.ts` fails any component file with inline `display` or
    `gap`.** Use Mantine `Stack`, never a `style={{ display: 'flex' }}`.
16. **`tsc` does NOT catch duplicated comments or dead code.** Comment-only
    corruption passed typecheck four times. Always check line counts and grep for
    duplicate anchors after any bulk edit.

---

## 8. How I broke things — do not repeat these

1. **PowerShell line-range splicing corrupted files four times.** `Get-Content` +
   index arithmetic + `Set-Content` duplicated blocks: `document-toolbar.tsx` →
   1662 lines, `blocknote-capabilities.tsx` → 2168, `html-editor.tsx` → 922,
   a spec → 556. **Every one was invisible to `tsc` when the damage was comments.**
   Use `write` for whole files and `edit` with unique surrounding context. If a splice
   is ever unavoidable, verify line count and grep for duplicate anchors immediately.
2. **I guessed counts.** I said the Diagram bar had "~12 icons"; it has **30**
   (`DIAGRAM_TEMPLATES`). I invented a design proposal when the answer **already
   existed** in the codebase — the Rich Note already had exactly the control I was
   proposing. Measure and search before proposing.
3. **I shipped an over-stated verdict** earlier and had to walk it back. The verdict
   line must match the measurements.
4. **Two of my own fixes were bugs**: reusing `indent.*` for the IDE group, and
   `withDocumentControlsUnavailable` (see §7.6).

---

## 9. Do not touch

Unrelated workstreams live in the same tree: Import Phase, diagram/Mind Map, security,
backup, OpenCode/Tool-UI, `src/web/features/code/`, ADR-021 + Shiki, markdown columns.

The 2 remaining `biome check .` errors are in
`rich-editor/blocks/diagram-template-bar.tsx` and `diagram-template-catalog.ts` —
files this work has never modified.

**Git safety:** no `git add .`, no `git add -A`, no `git reset --hard`, no `git clean`,
no `git checkout -- .`. Do not commit. Do not push.

---

## 10. Suggested order for whoever picks this up

1. **Re-run the full browser suite** to confirm the field-switch migration did not
   regress anything (`bun run test:browser`). Last full run was before it.
2. **Fix §5.1** — make the bar a direct child of the row for HTML. Read
   `html-editor.tsx` **fully** first; it is ~698 lines and the `toolbarNode` memo has
   a 20-item dependency list. Move the breadcrumb and preview-refresh controls to the
   editor header, not the toolbar row. Then measure at 1600 / 1280 / 900 and assert
   `barRight ≈ rowRight` and that an overflow button appears when controls do not fit.
3. **Fix §5.2** — decide where `return-to-preview` belongs relative to the field group.
4. **Add a width regression test** asserting the bar's right edge tracks the row's at
   more than one width. Nothing currently catches this.
5. Diagram (§5.3) → Export → `block-resize` → group model → docs → full verification.
6. Update this file, or delete it once the work is done.

---

## 11. Final verdict

**PENDING — the HTML toolbar still does not fill or shrink with its row (measured 714px
fixed at a 900px viewport, clipping the navigation with no overflow control), and the
field group sits 84px short of the right edge because the `trailing` slot renders
after it; both trace to the HTML row wrapping the toolbar in a content-sized `Group`
instead of hosting it directly as a flex child.**