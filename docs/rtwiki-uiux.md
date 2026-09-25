# RTWiki — UI/UX Reference

This is the single authoritative reference for RTWiki's user interface. It records what the app currently looks like, why it looks that way, what has been measured and decided, and what remains to be done. It is not a design brief for a future redesign — it is the living record of the current state and its history.

- **Date:** 2026-09-25
- **Baseline:** Mantine **9.6.2**, chrome band **40px**
- **Method:** real app driven with Playwright/Chromium against a live server; every number below is measured from the rendered DOM unless stated otherwise.
- **Evidence:** `.superpowers/sdd/desktop-chrome-fix/audit/` — `re-audit-desktop.png`, `re-audit-mobile.png`, plus the original `desktop-light.png`, `editor-dark.png`, `mobile-light.png`, `tree-collapsed.png`.

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

## 3. Layout and geometry as built

All shell dimensions are defined in `src/web/config/index.ts` inside the `LAYOUT` constant. Every component reads from this single object. No CSS module repeats these values.

| Element | Value | Source | Note |
|---|---|---|---|
| Tab strip / chrome band height | **40px** | `LAYOUT.tabStripHeight`, `LAYOUT.chromeBandHeight` (§15, `src/web/config/index.ts:15–25`) | The band and the tab row share one value because they are the same DOM row. A taller band (e.g. 50px) left 9–10px of dead space above the tab row. |
| Utility rail width | **40px** | `LAYOUT.railWidth` (§27) | Ultra-compact; holds the home/search/favorites/themes/stop buttons. |
| Page tree pane width (default) | **336px** | `LAYOUT.treePaneWidth` (§31) | User-resizable; min 220px, max 520px. |
| Right sidebar width (default) | **260px** | `LAYOUT.rightSidebarWidth` (§38) | User-resizable; min 220px, max 420px. |
| Status bar height | **28px** | `LAYOUT.statusBarHeight` (§55) | Matches Trilium's StatusBar. Verified by measurement: the rendered footer host is 28px. |
| Divider hit-area width | **6px** | `LAYOUT.dividerHitWidth` (§43) | Visible line is 1px; the rest is invisible pointer tolerance. |
| Overlay z-index | **1000** | `LAYOUT.overlayZIndex` (§53) | Every floating layer (menus, popovers, portals, full-screen workspaces) sits above the AppShell navbar. Exposed as `--rtwiki-overlay-z-index`. |
| Mobile drawer width | **280px** | `LAYOUT.mobileDrawerWidth` (§29) | Decoupled from the desktop tree pane. |
| Workspace minimum width | **480px** | `LAYOUT.workspaceMinWidth` (§36) | The narrow-window collapse threshold derives from this, not from a fixed breakpoint. |
| Block size clamps (min W × H) | **240 × 120** | `LAYOUT.blockMinWidth`, `blockMinHeight` (§57–58) | — |
| Block size clamps (max W × H) | **1600 × 2000** | `LAYOUT.blockMaxWidth`, `blockMaxHeight` (§59–60) | — |

### CSS variable complement

`src/web/theme/customization.css` defines the chrome row heights that individual components read:

| Token | Value | Source | Consumers |
|---|---|---|---|
| `--rtwiki-row-height` | `40px` | `customization.css:54` | Tab strip, toolbars, page header — all share this one equal height |
| `--rtwiki-tab-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:55` | Tab strip |
| `--rtwiki-toolbar-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:56` | Rich editor toolbar |
| `--rtwiki-header-height` | `var(--rtwiki-row-height)` → `40px` | `customization.css:57` | Page title row |
| `--rtwiki-statusbar-height` | **26px** | `customization.css:58` | ⚠ Discrepancy: `LAYOUT.statusBarHeight` is 28px; the CSS variable is 26px. The rendered footer host measures 28px, so the CSS variable does not drive the final height. This is a stale value that should be reconciled. |

> **Rule enforced by audit (F5):** there must never be two conflicting numbers for the same dimension. The `statusBarHeight` in `LAYOUT` (28) and the CSS variable (26) are a known mismatch. The rendered output is correct (28px); the CSS variable is stale.

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
| `--rtwiki-canvas` | `#ffffff` | `#242424` | **Document canvas** |
| `--rtwiki-pane` | `#f2f2f2` | `#1f1f1f` | Panels (tree, right sidebar, settings) |
| `--rtwiki-rail` | `#e8e8e8` | `#1a1a1a` | Utility rail |
| `--rtwiki-elevated` | `#ffffff` | `#262626` | Raised surfaces (hover fills, selected rows) |
| `--rtwiki-border` | `#dbdbdb` | `#454545` | Separators |
| `--rtwiki-text` | `#383838` | `#cccccc` | Primary text |
| `--rtwiki-text-muted` | `#666666` | `#bbbbbb` | Muted / secondary text |
| `--rtwiki-hover` | `rgba(0, 0, 0, 0.032)` | `#ffffff0d` | Hover fills |
| `--rtwiki-selected` | `#ffffff` | `#ffffff25` | Selected tree rows |

The previous ambiguous pair — one token for the document and another for panels,
which converged on the same tone in dark — has been **deleted, not aliased**. An
alias would have preserved the ambiguity. A test asserts the old names appear
nowhere in `src/web`.

### Origin of the values

TriliumNext's palette, transcribed to RTWiki's region names
([trilium-uiux-reference.md](trilium-uiux-reference.md), §9 and §12):

| RTWiki token | Trilium origin |
|---|---|
| `--rtwiki-canvas` (light `#ffffff`, dark `#242424`) | `--main-background-color` |
| `--rtwiki-pane` (light `#f2f2f2`, dark `#1f1f1f`) | `--left-pane-background-color` |
| `--rtwiki-rail` (light `#e8e8e8`) | `--launcher-pane-vert-background-color` |
| `--rtwiki-selected` (light `#ffffff`) | `--left-pane-item-selected-background` |
| `--rtwiki-hover` (light `rgba(0,0,0,0.032)`) | `--left-pane-item-hover-background` |

The dark scale is no longer inverted relative to these origins. The earlier
inversion existed because the canvas colour had to be inherited from the editor;
that dependency has been inverted (§6), so the tokens now map straight through.

### The relationship that must hold

In **both** colour schemes the pane is recessed and the document canvas is the
brightest surface:

```
light:  rail (#e8e8e8) < pane (#f2f2f2) < canvas (#ffffff)
dark:   rail (#1a1a1a) < pane (#1f1f1f) < canvas (#242424) < elevated (#262626)
```

This relationship was the root cause of **F1** when it was violated. It is now
asserted for **every theme and every variant** in `tests/theme-registry.test.ts`
(`canvas !== pane` and `rail !== pane`), so adding a theme cannot silently
reintroduce the defect.

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

### F2 — Mobile loses 24 of 35 toolbar controls at 390px — **OPEN** 🔴

| Measurement | Value |
|---|---|
| Total toolbar controls | 35 |
| Reachable (fully inside the toolbar box) | 11 |
| Unreachable | 24 |
| `overflow-x` | `visible` |
| `scrollWidth` vs `clientWidth` | 390 vs 390 — **cannot scroll** |

**Confirmed by measurement.** The toolbar does not scroll and offers no overflow menu, so the clipped controls cannot be reached at all. The right "Page details" sidebar is also still rendered as a ~50px sliver with a toggle at this width, rather than being hidden or becoming a drawer.

**Unverified hypothesis:** container queries on the toolbar parent would reflow the controls into a second line before viewport-based media queries, because the toolbar's own width shrinks independently of the viewport (the tree pane can absorb space). This has not been tested in the current environment. Do not present this as a finding.

### F3 — Rail width inconsistency — **CORRECTED** ✅

An earlier version of the audit reported three conflicting rail values (60 / 40 / 42). That was wrong: it compared rendered values against the committed config while the working tree already set `railWidth: 40`. With that in place the navbar and the config agree.

**Residual, minor:** the rail element still measures 42px inside a 40px navbar (padding `var(--mantine-spacing-xs) 4px` plus content), so it overflows by 2px. Worth tightening; not a visible defect.

### F4 — A shipped test asserts an element that does not exist — **OPEN** 🟡

`tests/browser/shell-layout.pwspec.ts:132` waits for `input[aria-label="Title"]`. With a rich page open that element count is **0** — the page title is edited as the document's own H1 (the single `[contenteditable="true"]` is the BlockNote editor). There is no separate title input, so this test cannot pass on any machine. It is a stale assertion, not an environment flake.

### F5 — Status bar height — **CORRECTED** ✅

Previously reported as 26-vs-28 drift. That was the same committed-vs-working-tree error as F3. The working tree sets `statusBarHeight: 28`, which matches the rendered footer host (28px). **No defect.** Withdrawn.

### F6 — Toolbar density and grouping — **OPEN** 🟡

35 icon-only controls in one 40px row across the full content width, with no labels and no clear grouping. Scanning cost is high; the active control is distinguished only by a filled background. Compounds F2 at narrow widths.

### F7 — Dark mode ignores the OS preference — **LOW** 🟢

With `prefers-color-scheme: dark` the app still rendered `data-mantine-color-scheme="light"`; the theme only changed via the rail's Theme control. Once dark, contrast is healthy (tree rows and title text both **10.26:1**), so this is an expectation gap, not a legibility defect.

### F8 — Development database polluted with test pages — **APPROVED FOR CLEANUP** 🟢

The sidebar lists `ShellA…ShellE`, `Runtime Error …`, `Broken note`, `Flush/Save/Reload probe`, `Overnight …`, `ZZProbeCanary`, `Audit Rich Sample`. The majority were created by automated test runs writing into the developer database.

## 8. Ordered work plan

The agreed sequence, with reasoning for the order:

| # | Item | Rationale for position |
|---|---|---|
| ~~1~~ | ~~**Theme token foundation** — registry engine, Default theme only~~ | **DONE.** Registry, per-region tokens across 14 stylesheets, editor bound to the canvas token, labels corrected. Guarded by `tests/theme-registry.test.ts` and the sentinel browser test |
| 2 | **Remaining document frames** — drop the card frame from the HTML editor and markdown editor views | F1 is resolved; the remaining editors still frame their content as cards. Now unblocked: each theme declares its own canvas tone, so the frame can be removed against a stable token |
| 3 | **Mobile toolbar** — add overflow affordance; hide right sidebar below `sm` | F2 is the highest-traffic remaining defect. Does not depend on themes |
| 4 | **Application shell** — tighten rail overflow (F3 residual), honour `prefers-color-scheme` (F7) | Small polish items that use the declared tokens rather than hardcoded values |
| 5 | **Tabs** — tab seam into the active tab, filler-based drag region | Tab work would otherwise be re-verified after the shell's geometry settles in item 4. Shell precedes tabs to avoid re-work |
| 6 | **Cosmetic polish** — F6 (toolbar grouping/labels), F4 (stale test), F8 (dev database cleanup) | Everything else is independent or low-risk |
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

## 10. Coverage and known gaps

### What has been measured or verified

- Chrome band geometry (40px) — measured from DOM, confirmed consistent across light/dark
- Tab strip, toolbar, and title row heights (all 40px) — measured
- Rail width (40px in config, 42px rendered due to padding overflow) — measured
- Document surface after the F1 fix — border and radius both `0px`, and the canvas tone equals the editor content tone in both schemes — measured
- **Editor surface follows the declared canvas token** — a sentinel `rgb(1, 2, 3)` injected on `--rtwiki-canvas` is adopted by both `.bn-editor` and the scroll owner, in light and dark — measured
- No reference to the superseded surface token names remains anywhere in `src/web` — asserted by test
- `canvas !== pane` and `rail !== pane` hold for every registered theme and variant — asserted by test
- Status bar rendered height (28px) — measured
- Dark mode contrast (10.26:1 on tree rows and title text) — measured
- Mobile toolbar reachability at 390px (11 of 35 controls reachable) — measured
- Mantine version (9.6.2) — confirmed via `bun.lock` and `node_modules/@mantine/core`
- `bun run typecheck` — 0 errors
- `bun test` — 469 pass / 0 fail
- `bun run format:check` — 0 errors
- `tests/browser/rich-workspace.pwspec.ts` "Rich document surface" — 3/3 pass
- `tests/browser/window-chrome.pwspec.ts` — 8/8 pass

### What has not been verified in this environment

| Item | Reason |
|---|---|
| Native Tauri shell behaviour | No Rust toolchain available; this is browser-mode geometry against the same bundle |
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
