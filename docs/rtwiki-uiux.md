# RTWiki — UI/UX Reference

> **If you are the project owner and not a programmer, read
> [rtwiki-uiux-guide.md](rtwiki-uiux-guide.md) instead.** That guide explains the
> design intent in plain language. This document is the engineering reference: exact
> measurements, source locations, and the reasoning behind each decision. The guide
> points here whenever a number or a file location is needed.

This is the authoritative technical reference for RTWiki's user interface. It records what the app currently looks like, why it looks that way, what has been measured and decided, and what remains to be done. It is not a design brief for a future redesign — it is the living record of the current state and its history.

- **Date:** 2026-09-25
- **Baseline:** Mantine **9.6.2**, chrome band **40px**
- **Method:** real app driven with Playwright/Chromium against a live server. Every number below is measured from the rendered DOM **unless §10 says it was only read from source** — the two are kept separate deliberately.
- **Evidence:** screenshots from the audit live in a local scratch folder
  (`.superpowers/sdd/desktop-chrome-fix/audit/`) that is **excluded from the repository**
  via `.git/info/exclude`. They are therefore not available to anyone else. The
  measurements quoted here stand on their own; the images are not part of the record.

## 1. Purpose and scope

This document answers three questions for any engineer who touches the UI:

1. **What is it?** — the current layout, geometry, colour system, and behaviour, with measured values and source-file references.
2. **Why is it that way?** — the decisions that produced the current state and the evidence behind them.
3. **What comes next?** — the ordered work plan, what is decided versus what is still open, and what is unverified.

### What this document is not

- It is **not** a copy of the upstream TriliumNext study. The upstream reference lives in [trilium-uiux-reference.md](trilium-uiux-reference.md) (which itself references `trilium-uiux-spec.md`). That document was the source material; this one translates its findings into RTWiki's reality.
- It is **not** a defect tracker. The audit findings live in [ui-ux-audit-findings.md](ui-ux-audit-findings.md). This document cites specific findings by ID (F1, F2, etc.) when they shape a decision or a work item.
- It is **not** implementation code. All numbers here are read from source files or measured from the running app; the source of truth for code is the code itself.

### Relation to other documents

| Document | Role | Cross-reference |
|---|---|---|
| [trilium-uiux-reference.md](trilium-uiux-reference.md) | Upstream study of TriliumNext's shell geometry, colour tokens, and behaviour | Every RTWiki geometry decision traces back to a section here |
| [ui-ux-audit-findings.md](ui-ux-audit-findings.md) | Verified defects found by driving the running app with Playwright | Findings F1–F8 are cited by ID; the full register is never repeated |
| [UI_UX_PLAN.md](UI_UX_PLAN.md) | A previous proposed redesign | Flagged as superseded — it specified Mantine v7, hardcoded hex surfaces, and a third incompatible geometry set |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture | Shell components (`AppShell`, `TabStrip`, utility rail) live in the frontend layer described there |
| [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) | Coding rules | Theme tokens, UI text dictionary, and the "define once" rule are enforced here |

## 2. Design principles adopted from Trilium

The following rules were extracted from the TriliumNext study ([trilium-uiux-reference.md](trilium-uiux-reference.md)) and adopted for RTWiki. Each is traced to the section that grounded it.

| # | Principle | Grounded in | RTWiki consequence |
|---|---|---|---|
| 1 | **One number per dimension** | §2 of the Trilium reference | `LAYOUT` in `src/web/config/index.ts` is the single source; no parallel token set. The rail, tab strip, and band all read from the same `40px` value. |
| 2 | **Per-region surface tokens** | §9 and §12 | Tokens are named by region (`--rtwiki-canvas`, `--rtwiki-pane`, `--rtwiki-rail`, `--rtwiki-elevated`), never by a generic "surface". The pane is always recessed relative to the document in both colour schemes. |
| 3 | **Borders as focus indicators, not frames** | §4 | The note canvas border is transparent by default; it appears only when a split is active in a multi-split view. |
| 4 | **Radii are conditional on layout context** | §4 | Top radius drops when a toolbar spans above; bottom radius drops when the status bar panel is open. |
| 5 | **Drag regions via a filler element** | §3 | *Adopted target, not yet built.* The band currently uses an absolutely positioned `.dragLayer` backdrop carrying `data-tauri-drag-region`. Replacing it with a filler element removes the overlap and the z-index ordering. Tracked as work-plan item 5. |
| 6 | **Component responsiveness via container queries** | §8 | The toolbar should reflow by its own width, not a viewport breakpoint. |
| 7 | **Caption buttons aligned by explicit centre-line calculation** | §13.8 | *Adopted target, not yet built.* Today the buttons are 46px wide and full band height (40px) inside an `align-items: stretch` row, so no centre-line calculation is needed. The pattern matters only if button and band heights ever diverge. |
| 8 | **Keep tab strip unmodified** | Task constraint | `TabStrip` is not to be changed during this phase of work. |

## 3. Dimensions, shape, motion and behaviour

Every number in this section is read from source, with a file and line reference.
Nothing here is estimated. Where a value is contested or stale it is flagged
inline rather than smoothed over.

### 3.1 Shell geometry

All shell dimensions are defined in `src/web/config/index.ts` inside the `LAYOUT` constant. Every component reads from this single object. No CSS module repeats these values.

| Element | Value | Source | Note |
|---|---|---|---|
| Tab strip / chrome band height | **40px** | `LAYOUT.tabStripHeight`, `LAYOUT.chromeBandHeight` (§15, `src/web/config/index.ts:15–25`) | The band and the tab row share one value because they are the same DOM row. A taller band (e.g. 50px) left 9–10px of dead space above the tab row. |
| Utility rail width | **48px** | `LAYOUT.railWidth` (§27) | Compact; holds the home/search/favorites/themes/stop buttons. Icons are 34px, so 7px of padding on each side centres them. |
| Rich editor toolbar height | **40px** | `--rtwiki-toolbar-height` → `--rtwiki-row-height` | Shares one equal row height with the tab strip, so the two rows read as one stacked band. |
| Status bar height | **28px** | `LAYOUT.statusBarHeight` | **Deliberately left at 28px, not raised to 40px.** It matches Trilium's StatusBar exactly, and a 12px-taller footer costs document height on every window. Measured 28px. |
| Page tree pane width (default) | **336px** | `LAYOUT.treePaneWidth` (§31) | User-resizable; min 220px, max 520px. |
| Right sidebar width (default) | **260px** | `LAYOUT.rightSidebarWidth` (§38) | User-resizable; min 220px, max 420px. |
| Status bar height | **28px** | `LAYOUT.statusBarHeight` (§55) | Matches Trilium's StatusBar. Verified by measurement: the rendered footer host is 28px. |
| Divider hit-area width | **6px** | `LAYOUT.dividerHitWidth` (§43) | Visible line is 1px; the rest is invisible pointer tolerance. |
| Overlay z-index | **1000** | `LAYOUT.overlayZIndex` (§53) | Every floating layer (menus, popovers, portals, full-screen workspaces) sits above the AppShell navbar. Exposed as `--rtwiki-overlay-z-index`. |
| Mobile drawer width | **280px** | `LAYOUT.mobileDrawerWidth` (§29) | Decoupled from the desktop tree pane. |
| Workspace minimum width | **480px** | `LAYOUT.workspaceMinWidth` (§36) | The narrow-window collapse threshold derives from this, not from a fixed breakpoint. |
| Block size clamps (min W × H) | **240 × 120** | `LAYOUT.blockMinWidth`, `blockMinHeight` (§57–58) | — |
| Block size clamps (max W × H) | **1600 × 2000** | `LAYOUT.blockMaxWidth`, `blockMaxHeight` (§59–60) | — |

### 3.2 Centralized token blocks

`src/web/theme/customization.css` is the second single-source block. It carries two
groups: chrome row heights, and tree metrics. The tree metrics are consumed by the
Wunderbaum bridge in `page-tree.module.css` through its `--wb-*` variables, and
`wb-tree-host.ts` keeps its `ROW_HEIGHT_PX` in sync with `--rtwiki-tree-row-height`.
The file's own instruction is explicit: *do not restate these numbers elsewhere*.

**Chrome rows**

| Token | Value | Source | Consumers |
|---|---|---|---|
| `--rtwiki-row-height` | `40px` | `customization.css:54` | Tab strip, toolbars, page header — all share this one equal height |
| `--rtwiki-tab-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:55` | Tab strip |
| `--rtwiki-toolbar-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:56` | Rich editor toolbar |
| `--rtwiki-header-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:57` | Page title row |
| ~~`--rtwiki-statusbar-height`~~ | **Retired.** Was a restated `26px` that disagreed with `LAYOUT.statusBarHeight` (28px) | Removed from `customization.css` | **CORRECTED.** The status bar now reads `--rtwiki-status-bar-height`, published from `LAYOUT` by the theme resolver. One source, no restatement |
| `--rtwiki-chrome-pad-x` | `var(--mantine-spacing-sm)` | `customization.css` | Shared left/right padding of every chrome row |
| `--rtwiki-chrome-hairline` | `rgba(0, 0, 0, 0.09)` light · `rgba(255, 255, 255, 0.09)` dark | `customization.css` | Every separator between chrome rows. **Deliberately fainter than `--rtwiki-border`** — see below |
| `--rtwiki-chrome-border` | `var(--rtwiki-chrome-hairline)` | `customization.css` | Alias kept so existing consumers need no change |
| `--rtwiki-active-fill` | `color-mix(in srgb, var(--mantine-color-blue-filled) 22%, transparent)` | `customization.css:64` | Tree rows and the Home/root nav entry, so their selection fill is identical |
| `--rtwiki-chrome-divider` | `var(--mantine-color-default-border)` | `customization.css:60` | Compact divider between toolbar groups |

> **Rule (F5):** there must never be two conflicting numbers for the same dimension.
> The `statusBarHeight` in `LAYOUT` (28) and the CSS variable (26) are a known
> mismatch. The rendered output is correct; the CSS variable is stale. This is the
> one surviving violation of the define-once rule.

**Tree metrics**

| Token | Value | Source | Note |
|---|---|---|---|
| `--rtwiki-tree-row-height` | `30px` | `customization.css:12` | A full click target and a visible focus ring, denser than the former 32px |
| `--rtwiki-tree-row-inner-height` | `28px` | `customization.css:13` | — |
| `--rtwiki-tree-subfile-row-height` | `26px` | `customization.css:14` | Sub-items step down one step |
| `--rtwiki-tree-indent-step` | `16px` | `customization.css:15` | Per-level indent |
| `--rtwiki-tree-expander-size` | `18px` | `customization.css:17` | Chevron click target |
| `--rtwiki-tree-glyph-size` | `12px` | `customization.css:18` | SVG mask glyph inside the target |
| `--rtwiki-tree-icon-size` | `16px` | `customization.css:20` | Standard icon slot |
| `--rtwiki-tree-subfile-icon-size` | `14px` | `customization.css:22` | Sub-items step down one step |
| `--rtwiki-tree-icon-outer-height` | `22px` | `customization.css:21` | — |
| `--rtwiki-tree-expander-icon-gap` | `2px` | `customization.css:24` | Tight by design |
| `--rtwiki-tree-icon-title-gap` | `5px` | `customization.css:25` | — |
| `--rtwiki-tree-row-padding-left` | `0px` | `customization.css:29` | Zero so `padding + expander + gap == --rtwiki-tree-indent-step`, keeping the root lead equal to the per-level indent rather than larger |
| `--rtwiki-tree-row-padding-right` | `8px` | `customization.css:30` | — |
| `--rtwiki-tree-action-reserve` | `24px` | `customization.css:32` | Reserved trailing space so the hover action button never overlaps a title |
| `--rtwiki-tree-menu-width` | `240px` | `customization.css:34` | Fixed and compact, independent of title length |
| `--rtwiki-drop-target-border` | `var(--mantine-color-blue-6)` | `customization.css:35` | Drop-target affordance |

### 3.3 Typography

The type scale is Mantine's, overridden once in the Default theme
(`src/web/theme/registry.ts`).

| Concern | Value | Source |
|---|---|---|
| Font family | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | registry.ts, `mantine.fontFamily` |
| `xs` | `0.75rem` (12px) | registry.ts, `mantine.fontSizes` |
| `sm` | `0.8125rem` (13px) | registry.ts |
| `md` | `0.875rem` (14px) | registry.ts — the base body size |
| `lg` | `1rem` (16px) | registry.ts |
| `xl` | `1.125rem` (18px) | registry.ts |

Local treatments, where a component needs to differ from the scale:

| Treatment | Value | Source |
|---|---|---|
| Page title row | `md` / weight 600 / line-height equal to the 40px row | `editor-header.module.css:30-32` |
| Page card title | `lg` / weight 700 / line-height 22px | `page-card.module.css:104-106` |
| Page card body | `sm` / line-height 1.5 | `page-card.module.css:118-119` |
| Page card footer label | `xs` / weight 500 | `page-card.module.css:145,154` |
| Status bar | `0.85em`, with `0.95em` for the emphasised value | `status-bar.module.css:15,66,82,118` |
| Tab label | `sm` | `tab-strip.module.css:67` |
| Right sidebar heading | `sm` | `right-sidebar.module.css:45` |
| Quick finder | `sm` | `quick-finder.module.css:22` |
| Markdown body | `sm` / line-height 1.6; heading 1.25 | `markdown-workspace.module.css:35-36,43` |
| HTML source toolbar badge | `10px` / weight 700 | `source-toolbar.module.css:22-23` |
| Window chrome drag hint | `xs` | `window-chrome.module.css:47` |

**There is no text-measure constraint.** The document spans its pane. This is a
deliberate canvas-style choice, consistent with the upstream reference (§10 there).

### 3.4 Shape and radii

Radii come from the Mantine scale in the Default theme — `xs 4px`, `sm 6px`,
`md 8px`, `lg 12px`, `xl 16px` — and components reference the token rather than a
literal. The distribution is consistent: **cards and framed regions use `md`,
controls and rows use `sm`, small chips and badges use `xs`.**

| Element | Radius | Source |
|---|---|---|
| Page card, calendar day, mermaid container, markdown surface, HTML editor surface, mermaid block, source-find dialog | `md` (8px) | `page-card.module.css:4`, `calendar.module.css:39`, `mermaid-workspace.module.css:48,66`, `markdown-workspace.module.css:21,32`, `html-editor.module.css:44`, `mermaid-block.module.css:5,148`, `source-find-dialog.module.css:11` |
| Tab (top corners only) | `sm sm 0 0` | `tab-strip.module.css:42` |
| Status bar rows, right sidebar row, editor header, tree row, toolbar control, code editor, debug log row, settings row, HTML preview, mermaid inner block | `sm` (6px) | `status-bar.module.css:64,105,146`, `right-sidebar.module.css:43`, `page-workspace.module.css:38`, `page-tree.module.css:118`, `rich-toolbar.module.css:38`, `code-editor.module.css:6`, `debug-log-viewer.module.css:22`, `settings.module.css:23`, `html-preview.module.css:15`, `mermaid-block.module.css:16,73` |
| Quick finder, tree badges, rich-editor small controls, mermaid block corner | `xs` (4px) | `quick-finder.module.css:18`, `page-tree.module.css:218,332`, `rich-editor.module.css:121`, `mermaid-block.module.css:95` |
| Tree drag handle | `6px` literal | `page-tree.module.css:106` — ⚠ the one hardcoded radius; it matches the `sm` token today but will not follow a theme change |
| Utility rail debug status dot | `50%` on an 8 × 8px box | `utility-rail.module.css:13-17` — a circle, so the radius is a literal |
| Caption buttons | `0` | `window-chrome.module.css:86` — square, Windows convention |

**The document surface carries no radius and no border at all**
(`rich-editor.module.css:37-39`). The upstream reference is explicit that a
transparent 2px border and a 10px radius exist only as *focus and context
indicators* — a note is framed when it is the active split, and the radius drops
when a toolbar spans above it. RTWiki has no multi-split, so the frame is simply
absent.

### 3.5 Elevation and shadows

Floating layers — menus, popovers, dialogs, tooltips and the toast — share **one
layered recipe**, defined once as `--rtwiki-floating-shadow` in
`customization.css` and applied through theme component defaults, so no call site has
to remember it and no menu can quietly ship without it.

| Layer | Light | Dark |
|---|---|---|
| Top-edge highlight | `inset 0 1px 0 rgb(255 255 255 / 0.8)` | `inset 0 1px 0 rgb(255 255 255 / 0.12)` |
| Inner rim | `inset 0 0 0 1px rgb(0 0 0 / 0.04)` | `inset 0 0 0 1px rgb(255 255 255 / 0.08)` |
| Outer ring | `0 0 0 1px rgb(0 0 0 / 0.1)` | `0 0 0 1px rgb(0 0 0 / 0.36)` |
| Drops (growing) | 2px → 8px → 20px at 8% | 1px → 3px → 6px at 22/20/16% |

The layers are the point. A single blur says "there is a box here"; a top highlight,
an inner rim, a solid ring and three softening drops say "lifted off the page". The
ring is what keeps the edge readable when the drop is too soft to do it alone. In
dark mode the highlight and rim are translucent **white**, because a drop shadow is
almost invisible on a near-black surface.

Before this, the only shadow in the app was `box-shadow: none` on menus — the test
`tests/browser/floating-layers.pwspec.ts` now requires at least three layers on an
open menu, and would fail on a library default.

The remaining three shadows in the stylesheet are the Mantine scale (`xs` `0 1px 2px
rgba(0,0,0,0.05)`, `sm` `0 2px 8px rgba(0,0,0,0.08)`, `md` `0 4px 16px
rgba(0,0,0,0.12)`) plus the sidebar and rail lifts.

The focus ring is Mantine's `auto`, so it adapts to the surface behind it. The
toolbar's active swatch uses an explicit `outline: 2px solid` with a 1px offset
(`rich-toolbar.module.css:48-49`) because it sits on a user-chosen colour where the
automatic ring cannot be trusted.

### 3.6 Hairlines, shadows, and the separation hierarchy

The rule adopted for RTWiki: **colour carries structure, shadow means "floating",
and a hairline is the exception.** Shadows are reserved for menus, popovers, dialogs
and an overlaying sidebar. Two surfaces of the *same* shade meeting side by side (the
Markdown editor and its preview) are the one case where a hairline is the honest
answer, because there is no colour difference to detect.

Chrome separators are **deliberately fainter than the general `--rtwiki-border`
token**. The chrome stacks several full-width rows against each other, so a
full-strength separator turns the top of the window into a set of stacked bands. The
hairline is a translucent value rather than a solid one, and it is **scheme-aware**: a
translucent black is invisible on a dark surface, so the dark value is a translucent
white at the same opacity. A single definition drives all four chrome separators (band,
tab strip, page header, workspace), so they cannot drift apart.

Shadows are reserved for floating layers. Every menu, pop-up, dialog, tooltip and
the toast now share one layered recipe (§3.5) rather than each relying on a library
default or on nothing at all.

Separators are **deliberately fainter than the general `--rtwiki-border` token**. The
chrome stacks several full-width rows against each other, so a full-strength
separator turns the top of the window into a set of stacked bands. The hairline is a
translucent value rather than a solid one, and it is **scheme-aware**: a translucent
black is invisible on a dark surface, so the dark value is a translucent white at the
same opacity. A single definition drives all four chrome separators (band, tab strip,
page header, workspace), so they cannot drift apart.

The surface ladder is **measured in Oklab L**, not judged by eye (§5).

### 3.7 Motion

Motion is minimal and consistent — there are exactly **three** transitions in the
entire stylesheet set, all short and all on `background-color` or `transform`:

| Where | Transition | Source |
|---|---|---|
| Pane divider | `background-color 120ms ease` | `pane-divider.module.css:25` |
| Tab strip | `background-color 150ms ease` | `tab-strip.module.css:46` |
| Debug log viewer | `transform 120ms ease` | `debug-log-viewer.module.css:62` |

Page cards also transition `box-shadow`, `border-color` and `transform` at 150ms
(`page-card.module.css:5-8`). There are no entrance animations, no slide or scale
transitions, and no motion on the document canvas. This matches the upstream
principle that motion is for state, not decoration.

### 3.8 Spacing

The Mantine spacing scale in the Default theme: `xs 8px`, `sm 12px`, `md 16px`,
`lg 20px`, `xl 24px`. Component CSS references these tokens rather than literals.
The literal exceptions found are all small and local: colour swatch grid gap,
insert-menu item padding `6px 10px`, and the tree metrics in §3.2, which are named
tokens rather than literals.

### 3.9 Layering

`--rtwiki-overlay-z-index: 1000` is exported from the theme resolver and is the
single stacking level for every floating layer: menus, popovers, portals, and
full-screen workspaces. It exists specifically so a collision-shifted dropdown near
the left edge can never paint behind the sidebar. Within the band, the window
chrome sets its own local contract (`window-chrome.module.css:11`): the
`data-tauri-drag-region` backdrop is absolutely positioned and every interactive
control inside it opts out.

### 3.10 Interaction behaviours

| Behaviour | Rule | Source / note |
|---|---|---|
| Theme toggle | Rail button flips Mantine's binary scheme; it does **not** follow `prefers-color-scheme` (F7) | `utility-rail.tsx:79-81` |
| Pane resize | Pointer hit area 6px, keyboard step 20px; bounds 220–520px tree, 220–420px right sidebar | `LAYOUT.dividerHitWidth`, `dividerStepWidth` |
| Tree row selection | Selection fill is shared with the Home/root nav entry so the two are identical | `--rtwiki-active-fill` |
| Tree hover action | Reserved 24px trailing space so the button never overlaps a title | `--rtwiki-tree-action-reserve` |
| Drag and drop | Drop targets are outlined with `--rtwiki-drop-target-border` | `customization.css:35` |
| Autosave | Debounced 2000ms with a visible save-status indicator | Provisional centralized default; see AGENTS.md §8 |
| Scroll ownership | `.main` is the single definite-height flex column at `100dvh`; every region below binds through flex with `min-height: 0`. The rich note is the only vertically scrolling element on its route | `app-shell.module.css`, `customization.css:68-79` |
| Rich toolbar at narrow widths | `overflow-x: auto`, `overflow-y: hidden`, `flex-wrap: nowrap` — one row that scrolls, never wraps | `rich-toolbar.module.css:52-57` — see F2, whose recorded measurement predates this |
| Caption buttons | `align-items: stretch`, each button `height: 100%` at 46px wide | `window-chrome.module.css:65-84` |
| Window dragging | An absolutely positioned backdrop carries `data-tauri-drag-region`; controls opt out | `window-chrome.tsx:127` — the upstream filler-element pattern is still planned |

## 4. Window chrome (desktop mode)

RTWiki ships a custom caption bar when running inside the Tauri desktop shell. This section records what was built and why.

### DOM structure

```
RootContainer
├── utility rail (40px wide, full window height)
├── page tree pane (336px default, full window height)
└── content column
    ├── chrome band (40px)
    │   ├── tab strip (40px, the same DOM row as the band)
    │   ├── dragLayer (absolute backdrop, data-tauri-drag-region)
    │   └── caption controls (46px wide each, full band height)
    ├── main content area (fills remaining height)
    │   ├── rich editor toolbar (40px)
    │   ├── page title row (40px)
    │   └── editor canvas
    └── status bar (28px, at the bottom)
```

### Custom caption behaviour

- The band is **40px** tall. Each caption button is **46px wide and full band height** (`height: 100%` inside a `.controls` flex row using `align-items: stretch`), so a button is 46 × 40 and does **not** overflow the band. Tauri runs with `decorations: false`, so there is no OS title bar to align against.
- **Planned, not built:** aligning the buttons by an explicit centre-line calculation rather than by stretch. This only matters if a future change makes the button height differ from the band height; today the two are equal by construction, so the centre-line calculation would be a no-op. Recorded as work-plan item 7.
- The tab strip is the same visual row as the chrome band — they share the `TAB_STRIP_HEIGHT = 40` constant. There is no dead space between them.
- The utility rail and the page tree run the **full window height** beside the band; the band only spans the content area, not the rail.
- Drag-region approach (**current**): an absolutely positioned `.dragLayer` element carrying `data-tauri-drag-region` sits behind the band's interactive controls (`window-chrome.tsx:127`); the layering contract is documented at `window-chrome.module.css:11`. Replacing this backdrop with a filler element is planned work (work-plan item 5), not the current state.

### Tauri capability requirement

The custom caption buttons require the Tauri capability that permits programmatic window control. Commit `02f576a` (fix(desktop): grant the loopback origin the window controls it needs) added the necessary capability grant for the loopback origin so the WebView2 host can communicate with the shell. Without this, the caption buttons are non-functional.

### Browser mode

In browser mode there is **no visual change** to the chrome. The AppShell renders the same rows; the only difference is the absence of custom caption buttons. The `TabStrip` component is **not modified** — this is a hard constraint of the current task.

## 5. Surface and colour system

### Current tokens

Declared once as data in `src/web/theme/registry.ts`, mapped to custom properties by
`buildVariantVariables`, and applied per scheme by `createThemeCssVariablesResolver`
in `src/web/theme/index.ts`. Every value is required — a theme with a missing token
is a compile error, and a test asserts completeness.

| Token | Light value | Dark value | Region |
|---|---|---|---|
| `--rtwiki-canvas` | `oklch(1 0 0)` | `oklch(0.27 0.005 255)` | **Document canvas** |
| `--rtwiki-pane` | `oklch(0.955 0.004 255)` | `oklch(0.22 0.005 255)` | Panels (tree, right sidebar, settings) |
| `--rtwiki-rail` | `oklch(0.91 0.005 255)` | `oklch(0.17 0.005 255)` | Utility rail |
| `--rtwiki-elevated` | `oklch(1 0 0)` | `oklch(0.32 0.006 255)` | Raised surfaces (hover fills, selected rows) |
| `--rtwiki-border` | `oklch(0.86 0.008 255)` | `oklch(0.4 0.008 255)` | Separators |
| `--rtwiki-text` | `oklch(0.38 0.01 255)` | `oklch(0.85 0.005 255)` | Primary text |
| `--rtwiki-text-muted` | `oklch(0.55 0.01 255)` | `oklch(0.75 0.005 255)` | Muted / secondary text |
| `--rtwiki-hover` | `oklch(0 0 0 / 0.032)` | `oklch(1 0 0 / 0.05)` | Hover fills |
| `--rtwiki-selected` | `oklch(1 0 0)` | `oklch(1 0 0 / 0.14)` | Selected tree rows |

The previous ambiguous pair — one token for the document and another for panels,
which converged on the same tone in dark — has been **deleted, not aliased**. An
alias would have preserved the ambiguity. A test asserts the old names appear
nowhere in `src/web`.

### Origin of the values

TriliumNext's palette, transcribed to RTWiki's region names
([trilium-uiux-reference.md](trilium-uiux-reference.md), §9 and §12):

| RTWiki token | Trilium origin |
|---|---|
| `--rtwiki-canvas` (light L 1.0, dark L 0.27) | `--main-background-color` |
| `--rtwiki-pane` (light L 0.955, dark L 0.22) | `--left-pane-background-color` |
| `--rtwiki-rail` (light L 0.91, dark L 0.17) | `--launcher-pane-vert-background-color` |
| `--rtwiki-selected` (light L 1.0) | `--left-pane-item-selected-background` |
| `--rtwiki-hover` (light `oklch(0 0 0 / 0.032)`) | `--left-pane-item-hover-background` |

The values are quoted as Oklab lightness rather than hex because that is now how
they are authored — see §"The palette is authored in Oklab". The *origins* named in
the right-hand column are still Trilium's own CSS variables, unchanged.

The dark scale is no longer inverted relative to these origins. The earlier
inversion existed because the canvas colour had to be inherited from the editor;
that dependency has been inverted (§6), so the tokens now map straight through.

### The relationship that must hold

In **both** colour schemes the pane is recessed and the document canvas is the
brightest surface:

```
light:  rail (0.91) < pane (0.955) < canvas (1.0)
dark:   rail (0.17) < pane (0.22) < canvas (0.27) < elevated (0.32)
```

This relationship was the root cause of **F1** when it was violated. It is now
asserted for **every theme and every variant** in `tests/theme-registry.test.ts`
(`canvas !== pane` and `rail !== pane`), so adding a theme cannot silently
reintroduce the defect.

### Chrome row overflow: measure, then hand the tail over

Neither chrome row used to say anything when it ran out of room. At 560px the toolbar
was **sliced mid-button** — no scrollbar, no fade, no menu — and the tab row had a
scrollbar it hid, so extra tabs were simply invisible. Trilium's source was read for
both (`tab_row.ts`, and CKEditor's toolbar inside `FormattingToolbar.tsx`) and the two
rows turned out to use *different* solutions, which is what is implemented here.

**Toolbar — a trailing "more" menu.** Controls that do not fit move into one button.
Matches CKEditor's default inside Trilium, and the owner guide records the same intent
("show what fits, drop the rest in").

The split is **measured, not breakpoint-driven**: a `ResizeObserver` sums each control's
natural width and finds where the row runs out. The controls are never reimplemented or
duplicated — the tail is rendered into the menu *whole*, so popover-backed and stateful
controls (the colour and highlight pickers, the link popover) behave identically there.

Three things this cost in debugging, recorded because each is a silent trap:

- `display: contents` on the measurement wrapper gives it **no layout box**, so
  `offsetWidth` reads 0 and every control measures as zero-width — the row always
  "fits" and the button never appears.
- Once a split is applied the tail is no longer in the row, so measuring only what is
  *visible* reports "it fits", clears the split, re-overflows, and loops forever
  (React error #185, maximum update depth). Widths are therefore **cached** from the
  first full render and the decision is made against the complete set.
- `React.Children.toArray` treats a Fragment as a **single opaque child**, so hoisting
  the JSX into a fragment and flattening it produced a one-element list. The fragment's
  `props.children` must be passed instead.

**Tab bar — chevron arrows, not a menu.** Trilium scrolls the row, hides the scrollbar,
and shows 36px chevrons at each edge; there is no overflow menu anywhere in its 1173-line
tab file. Adopted, with the same rationale: tabs stay glanceable, and you do not have to
open a menu to find an open page. Each chevron greys out at the scroll edge, derived from
measured `scrollLeft` rather than assumed.

This only works because tabs also got a **100px minimum width**, matching
`TAB_CONTAINER_MIN_WIDTH`. They previously had `min-width: 0` and simply shrank to
unreadable slivers, so the row never overflowed and the chevrons would have been dead
code. The floor only bites when there are genuinely too many tabs.

**Separators — tint, not a line.** The tab bar's bottom border is gone; the toolbar's
different background tone separates the two rows. Trilium does exactly this: it
explicitly removes CKEditor's toolbar border (`FormattingToolbar.css:9-11`) and relies on
a tint. A hairline survives only on the chevrons' inner edges, where it separates a
control from what it scrolls, and above the status bar.

### The tree pane: stop fighting the library, configure it

The page tree is a **Wunderbaum 0.14.1** treegrid. RTWiki wants a tree. That mismatch
was being paid for in `!important`: eight overrides existed purely to defeat the
library's table-cell model, plus a hand-rolled expander mask, a hand-rolled leaf indent
spacer, and a container focus border disabled by force.

**The structural fix.** Wunderbaum wraps every row's content in `span.wb-col`, styled as
an absolutely-positioned table cell with a fixed inner height. Two declarations
neutralise it:

```css
div.wunderbaum div.wb-row { display: flex; align-items: center; }
div.wunderbaum div.wb-row span.wb-col { position: static; display: contents; }
```

`wb-node` becomes a direct flex child of the row, so vertical centring is ordinary
flexbox and the fixed 28px arithmetic disappears. Selector specificity is raised one level
over the library's own rules rather than using `!important`, because the bundled
stylesheet is imported *after* the module and wins an equal-specificity tie.

**The geometry bug underneath it.** The library hard-codes `ICON_WIDTH = 20` in
JavaScript, adds 20px per nesting level, and **sizes the title's ellipsis against that
figure**. The app was rendering the indent cell at 16px via `--wb-icon-outer-width`. So
every level drifted 4px and the truncation width was computed against the wrong number —
which is why long titles cut off so early. `--wb-icon-outer-width` is now 20px.

Three variables the app had been setting **do not exist in the library** and were read by
nothing: `--wb-node-indent`, `--wb-line-height`, `--wb-indent-guide-color`. Removed. The
stylesheet comment claiming *"padding + expander + gap == indent step"* described a scheme
that was never in effect.

**A second duplication.** `ROW_HEIGHT_PX = 32` in TypeScript mirrors
`--rtwiki-tree-row-height`, because the library needs the number in JS for its viewport
maths and cannot read CSS. A comment asked people to change both together; a test now
asserts the rendered row height, so a mismatch surfaces as a failure rather than as rows
that quietly overlap.

**One plan item was wrong and was dropped.** `wb-fade-expander` was going to be adopted to
reclaim the expander column on leaf rows. Reading the library's stylesheet showed it only
fades the chevron's *colour* to transparent until hover — it would have made the arrows
invisible when the brief was to make them *more* visible. The leaf spacer is now
`margin-left: var(--wb-icon-outer-width)`, one token shared with the cell.

**Type text removed.** `wb-tree-host.ts` painted `<title> <Type>` into the visible title so
a test regex could match `<title> Rich Note`. That cost ~60px of every row while the type
icon already said the same thing. The type is still in the row's accessible name. The one
regex that depended on it now anchors on the title alone.

**Five defects introduced by that work, and their causes.** All were reported from using
the app, and each had a distinct cause:

1. **Drag and drop stopped working.** The library renders *one* span per row carrying
   both `wb-node` and `wb-col`, so `display: contents` on it collapsed the row's only
   child to **zero width**. The row still rendered and still passed a colour check, but
   had no hit area. `span.wb-node` is now a normal flex item (`flex: 1 1 auto`,
   `position: static`) rather than removed from layout.
2. **Home and a page could both read as selected.** The Home row sits outside the tree
   widget, so the library never clears it. It is driven by `data-active` and now reads
   the same selected token as a tree row.
3. **Home had a different selected colour.** It used `--rtwiki-active-fill` (22% blue)
   while tree rows used a different token. Both now read `--rtwiki-tree-selected`.
4. **Selected and hovered rows looked the same.** Softening selection to
   `--rtwiki-selected` was the error: that token is *white* in the light scheme, so a
   selected row became indistinguishable from an unselected one and from the neutral
   hover fill. Selection is an accent tint and hover is neutral; they are now different
   token families by design.
5. **Search field spacing.** Full-bleed with `border-radius: 0` is intended, but
   overriding the input's horizontal padding clipped the placeholder against the search
   icon's reserved section. The inset is left to the input.

**The Home row aligns structurally, not arithmetically.** It carries its own
expander-sized spacer element built from the same tokens the tree's expander cell uses,
so its icon and label land on the same vertical lines as a page row by construction. An
earlier version reproduced the library's arithmetic in `padding-left` and sat 3px off.

**A pre-existing drag bug was fixed as a side effect.** `stability-regressions`'
"before/inside/after drops still commit correctly" was failing on the baseline commit.
The indent mismatch (16px rendered against 20px computed) had been miscalculating
drop-target offsets; with the geometry corrected it passes.

`tree-geometry` grew to **10 tests** covering all of the above: the indent grid, the cell
width, the flex structure, vertical centring, JS/CSS row-height agreement, a real drag
that asserts the move committed, Home/tree alignment, single-selection, the
selected-vs-hover distinction, and the search field's width and inset.

**Three more findings from using the rebuilt app**, each with a measured cause:

- **The tab bar rendered an empty 40px band on the dashboard.** In browser mode there
  are no window caption buttons, so with no tabs open the row was pure dead space above
  the dashboard. The strip is now rendered only when at least one tab exists; native mode
  keeps it unconditionally because the caption buttons live in it.
- **The status bar went bare on the dashboard.** The location breadcrumb was gated on a
  page being open, so on Home it showed only the app name and a readiness line - no
  indication of where you were and no Home control. It now always renders, with the Home
  button and a "Pages" label when there is no page to show a trail for.
- **The active tab read as a floating rounded rectangle.** It sat 34px tall and centred
  in a 40px band, so 6px of canvas ran beneath it and the tab looked like a ring rather
  than merging with the content below. Inactive tabs now hang from the top of the band and
  the active one drops to the band floor, so its panel tone runs straight into the toolbar.

**One audit finding was a false alarm and was deliberately not "fixed".** Arrow-key
navigation was reported broken because pressing ArrowDown left `aria-selected` unchanged.
But `aria-selected` tracks *page selection*, not *keyboard focus*; pressing ArrowDown
twice then Enter opens three different pages, so navigation works. What genuinely was
missing is that **neither ARIA tree pattern was complete**: the container holds DOM focus
and every row is `tabindex=-1`, so nothing told a screen reader where the arrow keys were.
Rows now carry stable ids and the container's `aria-activedescendant` tracks the focused
row.

**Two audit findings were design trades, not defects, and were left alone.** The 24px
permanently reserved for the row-action button is exactly the button's width plus its
offset; removing it would let the button overlap the title on hover, which is worse than
wasting the space. And the action button appearing in the tab order is correct - it is
`display: none` until the row is library-focused, so tabbing into it is the keyboard
affordance, not a leak.

**Two were fixed.** The chevron measured 4.21:1 against the light pane - passing the 3:1
graphical bar but the weakest element on screen, on the very control needed to navigate;
it now mixes most of the way to full text. And a page eleven levels deep had about one
character of name, because each level costs 20px and the tree does not scroll sideways;
titles now have a 72px floor so the ellipsis always has something to show.

The search field was reverted to an inset, fully-bordered, rounded control. Full-bleed
with square corners had been tried and was worse: the border measured 1.49:1 against its
own background, so the field had no visible outline at all.

### The palette is authored in Oklab, not hex

Every surface and text token is now an `oklch()` value. The reason is the ladder:
in hex, a ladder can only be *measured* into evenness, and the first version of
that measurement found the shipped palette was not. In Oklab the first channel **is**
perceptual lightness, so the steps are exact by construction:

```
dark:  rail 0.17  ->  pane 0.22  ->  canvas 0.27  ->  elevated 0.32   (0.05 apart)
light: rail 0.91  ->  pane 0.955 ->  canvas 1.0                        (0.045 apart)
```

The test now reads the L channel directly instead of decoding a hex triple back
into a colour space, and additionally asserts that every token is authored in
`oklch()` — so a hex value cannot quietly reappear.

One landmine this exposed: `preview-document.ts` had a colour allowlist that
accepted only hex, `rgb()` and `hsl()`. OKLCH would have been **rejected**, and the
sandboxed HTML preview would have silently fallen back to a transparent
background — a regression that would have shown up as a mysteriously backgroundless
preview. The allowlist now accepts `oklch()`/`oklab()`, with a test for it.

### Layout lives in CSS, not in inline style objects

The codebase had **15** `style={{ … }}` objects across 12 files. All are gone as
*layout or paint* rules. What remains is 4 custom-property setters, which is the
modern idiom: the component supplies a number, the stylesheet keeps the box model.

| Was | Now |
|---|---|
| `style={{ width: LAYOUT.railWidth, flexShrink: 0 }}` | `width: var(--rtwiki-rail-width)` in CSS |
| `style={{ width: LAYOUT.dividerHitWidth }}` | `width: var(--rtwiki-divider-hit-width)` in CSS |
| `style={{ width, flexBasis: width }}` (resizable pane) | `--rtwiki-pane-width` → CSS owns `width`/`flex-basis` |
| `style={{ paddingLeft: \`${8 + (level - 1) * 12}px\` }}` | `--rtwiki-indent-level` → `calc()` in CSS |
| `style={{ width: \`${zoom * 100}%\` }}` (×2) | `--zoom-level` → CSS owns the width |
| `style={{ width, height }}` (block resize) | `--block-width` / `--block-height` → CSS |
| `style={{ backgroundColor: … }}`, `style={{ background: … }}` | `--swatch-bg` / `--swatch-color` → CSS paints |
| `style={{ display: 'none' }}` (hidden file input) | A `visually-hidden` class — `display: none` also removed the input from the tab order and the accessibility tree |
| `style={{ flex: 1 }}`, `letterSpacing`, `textAlign`, `width: '40%'` | Three new CSS modules for trash, shortcuts and calendar presets |

**One source, two consumers.** `LAYOUT` remains the definition; the theme resolver
publishes it as custom properties (`--rtwiki-rail-width`, `--rtwiki-divider-hit-width`,
`--rtwiki-divider-step-width`, `--rtwiki-mobile-drawer-width`,
`--rtwiki-status-bar-height`, `--rtwiki-workspace-min-width`). The same numbers are
now readable from a stylesheet without becoming a second definition. This also
retires the standing `--rtwiki-statusbar-height: 26px` vs `LAYOUT.statusBarHeight:
28px` mismatch noted in §3.2, because the stylesheet now reads the config rather
than restating it.

`src/web/style-props.ts` exports a single `CSSVars` type, because React's
`CSSProperties` excludes `--*` keys and a cast at each of the four call sites would
be four chances to drift.

### Why the dark-mode values used to be inverted

BlockNote paints its own dark editor background at `#1f1f1f`, and it only understands a binary light/dark scheme. The first fix therefore set the canvas to `#1f1f1f` so the editor read as one continuous surface, accepting that the canvas then matched Trilium's *pane* colour rather than its canvas colour.

That was a reasonable trade for two schemes, but it could not scale: under a third theme the document would have kept painting a fixed grey, because its colour was **derived from the editor** rather than **declared**. The dependency is now inverted — the canvas is a declared token and the editor surface is forced to it — so the tokens map straight through to Trilium's origins.

**Status: implemented.** The per-region tokens are live and the editor binding is
verified by test.

### How the editor surface is bound to the canvas

`.bn-editor` and `.bn-container` are forced to `var(--rtwiki-canvas)` in
`rich-editor.module.css`. Without this the editor would keep painting its own
`#1f1f1f` regardless of the active theme, and the document would ignore every theme
but the default.

The binding is proven by a test that **injects a sentinel canvas value**
(`rgb(1, 2, 3)`) and asserts the editor and the scroll owner both compute to it, in
both schemes. Asserting only that the editor matches the current token would also
pass when the two merely happen to be equal — which is precisely the condition that
hid the original defect. See "the document surface follows the canvas token, not the
editor library" in `tests/browser/rich-workspace.pwspec.ts`.

### Root cause of the document-surface defect (F1, now resolved)

Commit `3232ab6` removed the card frame so the document became one continuous canvas.
The **token** half of the defect was closed later: the ambiguous pair was replaced by
region-named tokens, and the `canvas !== pane` invariant is now asserted for every
theme and variant rather than checked by eye.

The same class of defect remained in two other page types and was fixed separately:

| Surface | Was | Now |
|---|---|---|
| `html-editor.module.css` `.previewPaneFull` | 1px border, 8px radius, panel tone | canvas tone, no frame |
| `html-preview.module.css` `.frame` (the iframe) | 1px border, 6px radius, Mantine body tone | canvas tone, `border: 0` |
| `markdown-workspace.module.css` `.previewPane` | 1px border, 8px radius, panel tone | canvas tone, no frame |

So the HTML page had been a **frame inside a frame**, and both the Markdown boxes were
painted with the panel tone — meaning that in dark mode the content was *darker* than
the page around it and read as a hole rather than as content.

`markdown-workspace.module.css` `.editorPane` deliberately **keeps** its frame and the
panel tone. A text-entry surface has a real usability argument for staying distinct
from the rendered result, so this is a design decision and is excluded from the
document-surface test.

### Packaging: the compiled executable had no frontend

`bun run build` runs `build:web` then `build:server`. The server step compiled
`build/server/RTWiki.exe` and stopped. It never staged the frontend, so the shipped
executable had **no UI at all**.

The reason this was easy to miss: `resolveRuntimePaths` deliberately resolves assets
from the **executable's own directory** in compiled mode
(`src/server/config/index.ts:86-88`):

```
compiled:     <exeDir>/web          -> build/server/web
development:  <repo>/build/web
```

So `build/web` was correct for the dev server and the browser tests, while
`build/server/web` — the only place the packaged app looks — did not exist. The
application started, listened, and returned `{"error":"Not found"}` for every page.
That reads as a product bug rather than a packaging one, and it is the same symptom
that made `build/web` intermittently appear to empty during testing.

`scripts/build.ts` now stages `build/web` into `build/server/web` after compiling,
replacing rather than merging so a stale asset cannot survive into a new build. If
`build/web` is absent it warns loudly rather than silently producing an executable
that serves nothing, because `bun run build:server` on its own is a legitimate way
to rebuild just the executable.

Verified by launching the compiled executable and requesting the root path: HTTP
200, 880 bytes, containing the app mount point.

### The native desktop gap is narrower than it was

The compiled binary now demonstrably serves the frontend. What remains unverified is
the **Tauri desktop shell** itself: the custom caption buttons, window dragging and
the shutdown handshake have only been exercised in a browser against the same
bundle. `tauri build` was not run — there is no Rust toolchain in this environment
— so the packaged Windows shell remains unbuilt.

### The save status indicator lied about pending work

The status bar mapped every state that was not actively saving or failing to
**"Saved"**. Because autosave is debounced by 2000ms, there is a window in which an
edit exists only in memory — and for that entire window the bar announced "Saved".

The cause was in `html-editor.tsx`: the autosave status `'dirty'` fell through to
`'clean'`, and the bar rendered `'clean'` as "Saved". The code comment even recorded
the compromise — *"a dirty page simply hasn't started saving yet, so it presents as
clean there while isDirty carries the real signal"* — but the status bar never received
`isDirty`, so the real signal was discarded.

`StatusSaveState` now has a distinct **`'pending'`** value, rendered as **"Unsaved
changes"**. The union was previously redeclared as a string literal in four places
(`html-editor.tsx`, three times in `page-workspace.tsx`, and `App.tsx`); all four now
import `StatusSaveState` so the states cannot drift apart again.

### Three "heavy" surfaces, corrected

Each of these looked heavier in review than the agreed rule allows, and each turned
out to have a different cause.

**The active tab was distinguished only by a shadow.** It carried
`background: var(--rtwiki-canvas)` plus a hard-coded
`box-shadow: 2px 2px 6px rgba(0,0,0,0.15)`. Because the band behind it is *also*
canvas, the background made no difference at all and the directional drop was the
only thing marking the tab — a raised card sitting on the row. It now takes the
**panel** tone, which is what the toolbar beneath it uses, so the active tab merges
with the content below it. That is the browser idiom, and it is carried entirely by
the surface step. Measured: background `rgb(25, 25, 25)`, shadow `none`.

**The right sidebar was not a panel.** `.panel` used `background: var(--mantine-color-body)`
— the *same tone as the document* — with `border-left: 1px solid` to make it visible
at all. It now takes the panel token, and the border is gone, because colour is the
separator and the border was redundant. This was the one place the "panel is
recessed" rule was actually being violated. Its header keeps a hairline, since within
one surface there is no colour step to read.

**The toast's blue bar was an auto-close countdown, not decoration.** It is a
pseudo-element; measured geometry was `position: absolute`, inset `8px` top and
bottom, `4px` from the left, `6px` wide, `rgb(28, 112, 255)`, `radius 8px` — a
saturated block down the left edge. It is functional, so it was not removed; it was
re-laid as a `2px` line along the bottom edge, which is the conventional place for it
and no longer the loudest thing in the corner of the screen. It is scoped to its own
class so the repositioning cannot leak onto other floating surfaces.

Verified: `height: 2px`, `width: 440px` (full width), pinned to `bottom: 0`.

### `format:check` no longer scans ignored files

The gate ran Biome over the whole tree, including gitignored paths. Playwright's
`test-results/.last-run.json` therefore failed `format:check` after every browser
test run, and the same for scratch scripts. That produced a recurring false failure
that looked like a real formatting problem and cost several confused debugging
cycles. Biome now uses the repository's ignore file, so the gate reports on tracked
source only.

### Four of the five HTML-editor failures were stale test selectors

Only one of the five pre-existing failures was a product defect. The breakdown:

| Failure | Actual cause |
|---|---|
| 3 × "Saved" not visible | One product defect (above) plus a wrong selector: the tests looked for a `<p>` carrying `aria-live="polite"`, but `aria-live` sits on the status region's container, not on the element holding the text |
| "switching pages flushes pending edits" + "the toggle persists…" | **Test bug.** `locator('[aria-label="Home"]')` became ambiguous when the status bar added its own Home button. Now scoped to the rail's navigation landmark |
| "failed saves surface Retry and recover" | **Test bug.** The test clicked `html-editor-retry`, a test id that exists nowhere in the source. Recovery is surfaced by the status bar's `status-retry` control, which flushes the pending save. Retry works correctly |

Result: 9 passing / 5 failing → **15 passing / 0 failing**.

The pattern across all four is worth recording: a selector that was correct when
written became wrong as the shell grew around it. A stale selector and a real defect
produce the same red test, so the cause has to be established from the source rather
than assumed from the failure.

### The sandboxed preview and the browser's base background

The HTML preview renders inside a sandboxed iframe with no same-origin access, so it
cannot read the app's theme. Two browser behaviours had to be handled, and neither was
visible from computed styles alone — only a screenshot showed them:

1. A browser gives an iframe document an **opaque base background** when the document
   declares none, and that base background paints *over* the iframe element's own
   colour. The shell's canvas was therefore hidden behind a light rectangle.
2. Declaring the document `background: transparent` is **not** sufficient. A transparent
   root canvas lets the same base background through from underneath. Verified: with
   the iframe element correctly reporting `rgb(36, 36, 36)` in dark mode and the
   srcdoc correctly declaring transparency, the area still rendered light.

The fix is therefore to state the colour explicitly. `PreviewFrame` resolves the canvas
colour from the active theme registry and passes it to `buildPreviewDocument`, which
emits it as the document's base background. The value is **allowlisted**, not escaped —
it is interpolated into a CSS declaration, so a value that is not recognisably a colour
is discarded and the document falls back to transparent. The block is emitted before
the page's own head and CSS, so a page may still choose its own background.

### The default text colour, and why it is not optional

Making the sandboxed background follow the theme **created** a second defect rather than
ending the first. A page that brings no CSS of its own inherits the browser's default
black text, so on the dark canvas it became unreadable — dark text on a dark
background. Only the screenshot showed it; the computed background was correct
throughout.

The same mechanism therefore also states a default **text** colour, taken from the
theme's `text` token (light L 0.38, dark L 0.85), so a bare page is readable in
both schemes. A page that sets its own `color` still wins, because the shell's block is
emitted first.

This is a deliberate division of responsibility: **the shell states defaults, the page
states its own choices.** The shell owns the surface a page sits on; it does not
restyle a page that has declared its own colours.

Note that `border: 0` on the iframe is load-bearing. Deleting the old `border`
declaration is not enough: the user-agent stylesheet gives every iframe a 2px inset
border, so removing the rule silently restores a frame. The browser test caught this.

### Verification requirement

Every theme change must be verified in **both** colour schemes. A light-only check previously hid a regression where the dark-mode canvas and panel tones were inverted. The rule is now: **always toggle both schemes before declaring a palette change correct.**

## 6. Multi-theme architecture — engine built, one theme registered

The engine is implemented and the Default theme is registered. Catppuccin and Nord
are intentionally absent (Decision 5). The light/dark variant continues to be owned
and persisted by Mantine's own `data-mantine-color-scheme`; only the theme identity
is RTWiki's to store, under the `rtwiki-theme-id` key.

| Piece | Location | State |
|---|---|---|
| Token data, theme registry, `getTheme` | `src/web/theme/registry.ts` | Built |
| Per-scheme resolver, theme selection | `src/web/theme/index.ts` | Built |
| Provider wiring | `src/web/main.tsx` | Built |
| Region-named tokens across 14 stylesheets | `src/web/**/*.module.css` | Built |
| Editor surface bound to the canvas token | `rich-editor.module.css` | Built |
| Theme picker UI | — | **Not built.** One registered theme would make a picker a single-option control |
| Catppuccin, Nord | — | **Not built**, by decision |

Adding a theme is therefore a data entry in `APP_THEMES` plus a picker option — no
component, stylesheet or resolver change.

### Decision 1: Surfaces follow the active theme through declared CSS custom properties

Each theme will supply its own set of `--rtwiki-*` custom properties, keyed by **region** rather than by a single ambiguous name. The rich editor's surface will be forced to the canvas token (`--rtwiki-canvas`) so it is declared rather than inherited from the editor library, which means BlockNote's own background paint is overridden to match the active theme's canvas tone. The ambiguous names `--rtwiki-background` and `--rtwiki-surface` are to be **deleted, not aliased** — an alias would preserve the exact ambiguity that caused F1.

### Decision 2: BlockNote and Mermaid keep operating on Mantine's binary scheme

The editor library (BlockNote) and Mermaid diagram rendering are **not** given per-theme work. They continue to use `useComputedColorScheme('light')` and switch between Mantine's built-in light and dark schemes. This is intentional: each has its own internal theming that would require separate migration per theme, and neither needs it — both already read the binary scheme that the variant selector drives.

**Consequence, accepted:** BlockNote's own `#1f1f1f` dark background is overridden by the canvas binding (§5), so it no longer leaks. Mermaid still picks only `default` or `dark`, so diagram backgrounds may not match a non-default theme exactly. Recorded as a known limitation, not an oversight.

### Decision 3: Themes are data in a registry

Each theme entry supplies a Mantine theme override plus a light and a dark variant. Adding a theme is a **data entry** in `APP_THEMES`, not a refactor. Implemented in `src/web/theme/registry.ts`.

### Decision 4: Selection is a (theme, variant) pair

The tuple is `(themeId, variant)`. The **variant** is owned and persisted by Mantine via `data-mantine-color-scheme`; RTWiki stores only the **themeId**, under `rtwiki-theme-id`, falling back to the default when unset, unknown, or unreadable. An `auto` variant resolves by operating system for the selected theme — that arrives with the picker, not before.

### Decision 5: Approved scope for the first slice

**Engine plus the Default theme only.** Catppuccin and Nord are later additions that must be sourced from their official palettes, not invented. This is a scope decision, not an oversight.

Delivered: the registry module, the per-scheme resolver, provider wiring, the Default theme entry, and the UI labels corrected to plain `Light` / `Dark`.

### Decision 6: Provider theme identity swap — no longer a live risk

The original concern was that swapping the provider's theme identity might remount the tree or flash unstyled content. With a single registered theme the identity never changes, so the risk cannot be observed yet. It returns as a real question **when the picker is added**, and should be verified then with a theme switch, not assumed either way.

### Current reality check

The UI text dictionary no longer names themes that do not exist:

| Key | Value | Referenced by any component? |
|---|---|---|
| `appearanceThemeLight` | `'Light'` | Yes — `settings-workspace.tsx:251` |
| `appearanceThemeDark` | `'Dark'` | Yes — `settings-workspace.tsx:252` |

The `appearanceThemeDark: 'Dark (Catppuccin)'` label and the unreferenced `appearanceThemeNord` key were both removed, because a label naming an unbuilt theme is a claim the code does not support.

**Still ahead of reality:** the default `themePreset` in `layout-preferences.ts` is `'catppuccin'`, and the `ThemePreset` type still admits `'catppuccin'` and `'nord'`. Nothing reads `themePreset` for theming — the engine reads `rtwiki-theme-id` — so it has no effect, but it is misleading persisted state and should be reconciled when the picker lands. Left alone here to keep this change to one thing.

## 7. Open defects and their confirmed mechanisms

### F1 — Document rendered as a framed card in a panel — **RESOLVED** ✅

The real defect was **not** a fill-ratio problem. The document was painted as a rounded card with a visible border and grey gutters, so it read as a widget *inside* a page rather than as the page. Resolved in commit `3232ab6` by making the document one continuous canvas: no border, no radius, and a canvas tone equal to the editor's own content tone in both schemes.

**The "fills only 15% of its region" framing was a measurement error and is withdrawn.** It compared the *content* height (123px — a short note) against the *container* height (832px); the editor wrapper already filled its region at 752px. The fill ratio was never the defect and no fill-ratio fix was made. See the corrections log (§9).

> The defect register [ui-ux-audit-findings.md](ui-ux-audit-findings.md) still titles F1 as the 15% fill-ratio problem. That title is stale and should be corrected to match this section.

### F2 — Mobile toolbar at 390px — **RECORDED MEASUREMENT IS STALE** 🟡

> **Re-measurement required before acting on this.** The numbers below were
> recorded against an older stylesheet. The current
> `rich-toolbar.module.css:52-57` sets `overflow-x: auto`, `overflow-y: hidden` and
> `flex-wrap: nowrap`, with the comment *"Narrow screens scroll the single row;
> never wrap into multiple rows."* That behaviour has been in the tree since
> `d14aec1`, which predates the audit. A bar with `overflow-x: auto` can scroll, so
> `scrollWidth === clientWidth` and `overflow-x: visible` cannot both be true of the
> current code. **Do not implement a fix against these numbers** — re-measure first.

Original audit measurement, retained for reference only:

| Measurement | Value |
|---|---|
| Total toolbar controls | 35 |
| Reachable (fully inside the toolbar box) | 11 |
| Unreachable | 24 |
| `overflow-x` | `visible` |
| `scrollWidth` vs `clientWidth` | 390 vs 390 — could not scroll |

What is still true and worth checking on re-measurement: the right "Page details"
sidebar was rendered as a ~50px sliver with a toggle at this width, rather than
being hidden or becoming a drawer.

**Still unverified, and unchanged:** the original hypothesis was that the controls
were *wrapping* below a fixed-height row and being clipped vertically, rather than
being clipped horizontally. That hypothesis was never empirically confirmed, and
the current `flex-wrap: nowrap` contradicts it. Treat the mechanism as unknown. A
horizontal scroll is also a weaker answer than the upstream pattern — the reference
collapses overflow into a menu (upstream §8) rather than relying on scroll alone,
because scrolling hides the existence of the overflow.

### F3 residual — the rail rendered 2px wider than its slot — **RESOLVED** ✅

The rail measured **42px** inside a 40px column. The cause was arithmetic, not the
width setting: the rail is 40px, its horizontal padding was `4px` on each side,
leaving **32px** of content space, while its action icons are **34px**. The buttons
did not fit their own padding, so the rail took its content width.

Compounding it, the rail's width was never actually enforced when the tree was
open. `LAYOUT.railWidth` sizes the *navbar*, but only in the collapsed case — with
the tree open the rail sits inside a wider navbar and had no width of its own.

Fixed by giving the column its width from `LAYOUT.railWidth` (one source, not a CSS
literal).

### F3 follow-up - the rail was exactly as wide as its buttons - **RESOLVED** ✅

That first fix made the arithmetic work by dropping padding to `3px`, which left
**zero slack**: `3 + 34 + 3 = 40`. The icons sat hard against both rail edges, and any
future button larger than 34px had nowhere to go. The width was also only ever asserted
in one state — the test measured whatever loaded by default and never toggled the tree,
so a collapsed/expanded regression would have been invisible.

**Widened to 48px** with `7px` of padding on each side. 7px is what centres a 34px icon
in a 48px rail; the flex default would otherwise left-align the fixed-width button and
leave 11px of dead space on the right, which reads as an off-centre icon. 48px is also
the conventional icon-rail width, so the rail is no longer a number that only makes
sense internally.

Three tests now cover it: the configured width **with the tree open**, the configured
width **with the tree collapsed**, and a **symmetric edge gap of at least 5px**. The
last one matters because a rail exactly as wide as its buttons passes a naive "does it
fit" check while still looking cramped.

The hard-coded `box-shadow: 2px 0 8px rgba(0,0,0,0.15)` on the rail is also gone.
It is a structural column, not a floating surface, and its separation from the tree is
already a step in surface tone — the same heavy directional drop that was removed
from the active tab.

Verified: rail width **40px**, box-shadow **none**, in both the collapsed and
expanded tree states. Two new tests in `tests/browser/shell-layout.pwspec.ts` assert
both, measured in-page rather than through a bounding box.

### Three shell-layout checks were already failing

`tests/browser/shell-layout.pwspec.ts` fails 3 of its 5 region checks. Confirmed
**pre-existing** by stashing this change and re-running: identical 3 failures, same
test names.

| Failure | Cause |
|---|---|
| "rail spans the full viewport height" | The rail stops at 772px in an 800px viewport — exactly the 28px status bar. The navbar ends above the footer, so the rail does not run beside it |
| "central order is tabs, toolbar, title, document" | **F4.** Waits for `input[aria-label="Title"]`, which does not exist: the title is the document's own H1 |
| "HTML pages keep their own header flow" | Not yet diagnosed |

The first is a genuine open question rather than a test artefact — "full height" is a
stated requirement for the tree pane, and the rail currently stops at the status bar
rather than running the full viewport.

### F9 — Creating a page appeared to do nothing — **RESOLVED** ✅

This was mis-filed for a long time as "10 flaky tests about dialog autofocus". It was
never a focus problem and never flaky. Creating a page from the New Page dialog produced
**no tab, no tree row, and no editor at all** — the page was created (the API returned
`201`) and the app stayed on the dashboard reporting "Saved".

**Mechanism.** `createPage` queues `setSelectedPage(newPage)` to select the page it just
made. Navigation then immediately re-selects the same id, because opening a page also has
to run flush / recents / URL-sync side effects. That second call resolved the id against
a `pages` snapshot taken *before* the insert had been committed, missed, produced
`null`, and wrote it as a **plain value** — which clobbers a selection still queued ahead
of it. The create was silently undone by its own navigation.

Why existing-page navigation always worked: by the time you click a page the list
snapshot is already current, so the lookup succeeds. Only the create path raced itself.

**Fix.** `selectPage` now resolves through an updater function, so it sees the pending
state and keeps an already-correct selection. A different id still resolves from the
list; an id in neither still clears, exactly as before.

The 10 failing tests all funnel through one create helper, which is why every one of them
reported the same symptom. That suite is now 15/15.

This also silently affected **markdown import** (`handleImportMarkdown` uses the same
create-then-re-select pattern), so importing a `.md` file did not open the page either.

**Lesson recorded:** ten failures sharing one symptom was treated as a flaky suite rather
than a single fault. They had one cause, and it sat in the most-used action in the app.
When every failure in a group fails the same way, that is a signal to find the shared
helper, not to assume the environment.

### F4 — A shipped test asserts an element that does not exist — **OPEN** 🟡

`tests/browser/shell-layout.pwspec.ts:132` waits for `input[aria-label="Title"]`. With a rich page open that element count is **0** — the page title is edited as the document's own H1 (the single `[contenteditable="true"]` is the BlockNote editor). There is no separate title input, so this test cannot pass on any machine. It is a stale assertion, not an environment flake.

### F5 — Status bar height — **CORRECTED** ✅

Previously reported as 26-vs-28 drift. That was the same committed-vs-working-tree error as F3. The working tree sets `statusBarHeight: 28`, which matches the rendered footer host (28px). **No defect.** Withdrawn.

### F6 — Toolbar density and grouping — **OPEN** 🟡

35 icon-only controls in one 40px row across the full content width, with no labels and no clear grouping. Scanning cost is high; the active control is distinguished only by a filled background. Compounds F2 at narrow widths.

### F7 — Dark mode ignores the OS preference — **LOW** 🟢

With `prefers-color-scheme: dark` the app still rendered `data-mantine-color-scheme="light"`; the theme only changed via the rail's Theme control. Once dark, contrast is healthy (tree rows and title text both **10.26:1**), so this is an expectation gap, not a legibility defect.

### F8 — Development database polluted with test pages — **RESOLVED** ✅

The sidebar held 364 live pages, 360 of them automated-test artefacts. They were
removed through the HTTP API rather than SQL, so the app's own delete path ran and the
children, attachments and search index were maintained. The endpoint is a **soft**
delete, so everything is in Trash and recoverable.

Only pages carrying the test marker were touched: `uniqueTitle()` in the browser specs
builds titles as `<base> <Date.now()>-<seq>`, so a 13-digit millisecond timestamp
followed by a sequence is unambiguous. Also removed: the `- Copy` duplicates left by
duplicate tests, `ZZProbeCanary` and `Renamed Target`.

**Four pages were deliberately left alone** because they carry no test marker and
could not be identified as test artefacts: `Audit Rich Sample`, `fdsfsd`, `fsdsd` and
`rr`. They await an owner decision.

This also means every screenshot taken after this point shows the real app rather than
forty pages of test noise, which had been making visual judgements harder than
necessary.

## 8. Ordered work plan

The agreed sequence, with reasoning for the order:

| # | Item | Rationale for position |
|---|---|---|
| ~~1~~ | ~~**Theme token foundation** — registry engine, Default theme only~~ | **DONE.** Registry, per-region tokens across 14 stylesheets, editor bound to the canvas token, labels corrected. Guarded by `tests/theme-registry.test.ts` and the sentinel browser test |
| ~~2~~ | ~~**Remaining document frames** — drop the card frame from the HTML editor and markdown editor views~~ | **Done.** Both rendered views are frameless and on the canvas. The HTML page had a frame inside a frame. The Markdown typing view keeps its frame by decision, not oversight |
| 3 | **Mobile toolbar** — re-measure, then decide between scroll and an overflow menu | F2's recorded numbers predate the current stylesheet and must not drive a fix. The upstream pattern collapses overflow into a menu rather than relying on scroll alone |
| 4 | **Application shell** — honour `prefers-color-scheme` (F7); decide the rail's height | F3's rail-width residual is done. The rail stops at the status bar rather than running the full viewport, and "full height" is a stated requirement — so that is a decision, not a bug to guess at |
| 5 | **Tabs** — tab seam into the active tab, filler-based drag region | Tab work would otherwise be re-verified after the shell's geometry settles in item 4. Shell precedes tabs to avoid re-work |
| 6 | **Cosmetic polish** - F6 (toolbar grouping/labels), F4 (stale test) | F8 is done: 360 test pages removed, 4 unidentified pages left for an owner decision. The rest is independent or low-risk |
| 7 | **Theme picker UI** — the control that writes `rtwiki-theme-id`, plus Catppuccin and Nord from their official palettes | Held until a second theme exists; a one-option picker is noise. Verify the provider identity-swap risk here (Decision 6) |

### Out of scope for this cycle

- Catppuccin and Nord theme entries ( Decision 5 in §6)
- BlockNote or Mermaid per-theme adaptation (Decision 2 in §6)
- Any change to `TabStrip` (hard constraint)
- Native desktop behaviour verification (no Rust toolchain available)

## 9. Corrections log

Findings that were raised and then withdrawn after being checked. This exists so the same wrong conclusions are not re-derived.

| Finding | Reason withdrawn | Date |
|---|---|---|
| F3 (rail width drift) | Compared rendered values against the **committed** config while the working tree already set `railWidth: 40`. The config and render agreed once the correct baseline was used. | 2026-09-25 |
| F5 (status bar 26-vs-28 drift) | Same committed-vs-working-tree error as F3. The working tree sets `statusBarHeight: 28`, which matches the rendered footer host. **No defect.** | 2026-09-25 |
| F1 ("canvas fills only 15% of its region") | Compared the **content** height (123px, a short note) against the **container** height (832px). The editor wrapper already filled its region at 752px. The fill ratio was never the defect; the framed-card treatment was. | 2026-09-25 |
| F2 ("cannot scroll", `overflow-x: visible`) | The measurement predates the stylesheet it describes. `rich-toolbar.module.css` has set `overflow-x: auto` and `flex-wrap: nowrap` since `d14aec1`, so the bar could scroll and could not wrap. The recorded mechanism and counts are unreliable. | 2026-09-25 |
| HTML child files "do not save" | Typing into a CSS child file looked lost. | It was not. Reading the stored record directly showed the CSS field saved correctly. Two separate things were mistaken for one: blank CSS on a new page is simply an empty field, and the HTML source view never shows a "Saved" indicator, so a successful save looks like a failure. The indicator is a real, still-open defect. | 2026-09-25 |

## 10. Coverage and known gaps

### What has been measured or verified

Every claim in §3 is **read from source** with a file and line reference, not measured
in a browser. The items below are the ones verified by actually running the app.

- Chrome band geometry (40px) — measured from DOM, confirmed consistent across light/dark
- Tab strip, toolbar, and title row heights (all 40px) — measured
- Rail width (40px in config, 42px rendered due to padding overflow) — measured
- Document surface after the F1 fix — border and radius both `0px`, and the canvas tone equals the editor content tone in both schemes — measured
- **Editor surface follows the declared canvas token** — a sentinel `rgb(1, 2, 3)` injected on `--rtwiki-canvas` is adopted by both `.bn-editor` and the scroll owner, in light and dark — measured
- **HTML and Markdown rendered surfaces are frameless and on the canvas** — asserted in both schemes, including the nested iframe frame — measured
- **The sandboxed HTML preview paints the resolved canvas colour** — unit-asserted on the generated document; confirmed visually in both schemes
- **The compiled executable serves the frontend** — launched `build/server/RTWiki.exe` and requested the root path: HTTP 200, 880 bytes, app mount point present
- `bun run build:web` then `bun run build:server` stages 150 frontend files into `build/server/web`, the only location a compiled app looks
- Markdown dark rendering inspected by screenshot: continuous canvas, themed text, no frame — measured
- No reference to the superseded surface token names remains anywhere in `src/web` — asserted by test
- `canvas !== pane` and `rail !== pane` hold for every registered theme and variant — asserted by test
- Status bar rendered height (28px) — measured
- Dark mode contrast (10.26:1 on tree rows and title text) — measured
- Mantine version (9.6.2) — confirmed via `bun.lock` and `node_modules/@mantine/core`
- `bun run typecheck` — 0 errors
- `bun test` — 469 pass / 0 fail
- `bun run format:check` — 0 errors
- `tests/browser/rich-workspace.pwspec.ts` "Rich document surface" — 3/3 pass
- `tests/browser/window-chrome.pwspec.ts` — 8/8 pass
- `tests/browser/html-editor.pwspec.ts` — **15 pass / 0 fail** (was 9 / 5)
- A pending HTML/CSS/JavaScript edit reports "Unsaved changes" rather than "Saved" before the debounce elapses — asserted in both light and dark
- CSS typed into a child file reaches the stored record and applies in the rendered preview (verified `color: rgb(1, 2, 3)`, `font-size: 40px` inside the frame) — measured
- The rendered preview does not rebuild on its own while idle (0 `srcdoc` mutations over 3s) — measured, ruling out a rebuild loop

**Read from source but not re-measured in a browser:** the §3.2 tree metrics, the §3.3
type scale, the §3.4 radii distribution, and the §3.6 motion inventory. These are
transcribed from the stylesheets, so they record intent rather than rendered output.
Anything in §3 that later proves wrong in a browser should be corrected here the same
way the F1 and F2 entries were.

### What has not been verified in this environment

| Item | Reason |
|---|---|
| Native Tauri shell behaviour | No Rust toolchain available. The compiled **server executable** was verified to serve the frontend (HTTP 200), but the Tauri window, caption buttons and shutdown handshake have only been exercised in a browser against the same bundle |
| Windows `decorations(false)` build | Requires a Tauri build |
| HTML pages, code pages, Calendar/Study, Settings, Trash, Favorites views | Only Rich Note and dashboard were driven |
| Empty, loading and error states | Not driven |
| Keyboard navigation and focus order | Not tested |
| Contrast for every element (tab, tree row, title row, toolbar sampled only) | Only toolbar and tree rows were sampled |
| Pane drag-resize, collapse persistence, keyboard shortcuts | Runtime behaviours not studied |
| Tab overflow scrolling, command palette, contextual toolbar conditional groups | Not driven |

## 11. Verification commands

These are the project's quality gates. Run them before claiming any UI change is complete.

```bash
# Type checking — must pass with 0 errors
bun run typecheck

# Unit + integration tests — all must pass
bun test

# Browser tests (requires a running dev server)
bun test:browser

# Documentation link verifier — catches broken relative links
bun scripts/verify-docs.ts

# Production frontend build (catches TS errors that typecheck misses in some configs)
bun run build
```

The documentation verifier (`scripts/verify-docs.ts`) scans all Markdown files in `docs/`, resolves every relative link, and reports failures. It runs automatically in CI. A change that adds or modifies documentation **must** pass this check before committing.

---

*This document is part of the RTWiki repository. It is updated whenever the UI state changes meaningfully — new defects found, decisions made, or measurements revised. See [AGENTS.md](../AGENTS.md) §13 for the documentation protocol.*
