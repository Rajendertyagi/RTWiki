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
| 2 | **Per-region surface tokens** | §9 and §12 | `--rtwiki-background` is the document canvas; `--rtwiki-surface` is panel chrome. The pane is always recessed relative to the document in both colour schemes. |
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

Defined in `src/web/theme/index.ts` inside `rtwikiCssVariablesResolver`:

| Token | Light value | Dark value | Region |
|---|---|---|---|
| `--rtwiki-rail-bg` | `#e8e8e8` | `#1a1a1a` | Utility rail |
| `--rtwiki-background` | `#ffffff` | `#1f1f1f` | **Document canvas** |
| `--rtwiki-surface` | `#f2f2f2` | `#242424` | Panels (tree, right sidebar, settings) |
| `--rtwiki-surface-raised` | `#ffffff` | `#262626` | Raised panels (dialogs, popovers) |
| `--rtwiki-border` | `#dbdbdb` | `#454545` | Separators |
| `--rtwiki-text` | `#383838` | `#cccccc` | Primary text |
| `--rtwiki-text-muted` | `#666666` | `#bbbbbb` | Muted / secondary text |

### Origin of the values

These are TriliumNext's token values transcribed to RTWiki names ([trilium-uiux-reference.md](trilium-uiux-reference.md), §12):

| RTWiki token | Trilium origin |
|---|---|
| `--rtwiki-background #ffffff` (light) | `--main-background-color: white` |
| `--rtwiki-background #1f1f1f` (dark) | `--left-pane-background-color: #1f1f1f` ⚠ |
| `--rtwiki-surface #f2f2f2` (light) | `--left-pane-background-color: #f2f2f2` |
| `--rtwiki-surface #242424` (dark) | `--main-background-color: #242424` ⚠ |

> **⚠ Inversion in dark mode — now SUPERSEDED.** The dark values are swapped relative to their Trilium origins: `--rtwiki-background` (canvas) is `#1f1f1f` (Trilium's *pane* colour) and `--rtwiki-surface` (panel) is `#242424` (Trilium's *canvas* colour). This was deliberate when made, to avoid a tone seam against BlockNote's own `#1f1f1f` editor. **The multi-theme decision reverses it** (§6): the dark canvas returns to Trilium's `#242424` and the editor is forced to match the declared token instead. Do not preserve the inversion.

### The relationship that must hold

In **both** colour schemes the following ordering must be maintained:

```
light:  rail (#e8e8e8) < surface (#f2f2f2) < canvas (#ffffff)
dark:   rail (#1a1a1a) < canvas (#1f1f1f) < surface (#242424)
```

The pane is always recessed; the document canvas is always the brightest surface (light) or the darkest-but-not-deepest surface (dark). This relationship was the root cause of **F1** when it was violated: the old palette used a single `--rtwiki-surface` token for both regions, which made the canvas match the sidebar tone and produced a grey frame around a white card.

### Why the dark-mode values were inverted, and why that is changing

BlockNote paints its own dark editor background at `#1f1f1f`, and it only understands a binary light/dark scheme. The original fix therefore set the canvas to `#1f1f1f` so the editor read as one continuous surface, accepting that the canvas then matched Trilium's *pane* colour rather than its canvas colour.

That was a reasonable trade for two schemes, but it cannot scale: under a third theme the document would keep painting a fixed grey, because its colour was **derived from the editor** rather than **declared**. The multi-theme decision (§6) reverses the direction of dependency — the canvas becomes a declared token and the editor surface is forced to it. The dark canvas therefore returns to Trilium's `#242424` and the pane to `#1f1f1f`, restoring Trilium's relationship: pane recessed, canvas brighter.

**Status: decided, not yet implemented.** The token names in the table above are also due to be replaced by per-region names (`--rtwiki-canvas`, `--rtwiki-pane`, `--rtwiki-rail`, `--rtwiki-elevated`) as part of the same work.

### Root cause of the document-surface defect (F1, now resolved)

Commit `3232ab6` (fix(ui): make the document one continuous canvas, not a card in a panel) fixed F1 by splitting the single ambiguous `--rtwiki-surface` token into two distinct tokens (`--rtwiki-background` for the canvas, `--rtwiki-surface` for panels) and assigning values that preserve the correct light/dark ordering. The fix was verified by measurement: the canvas now fills its region with no dead-space gutter.

### Verification requirement

Every theme change must be verified in **both** colour schemes. A light-only check previously hid a regression where the dark-mode canvas and panel tones were inverted. The rule is now: **always toggle both schemes before declaring a palette change correct.**

## 6. Multi-theme architecture — DECIDED, not yet built

This section records the decisions that shape the next phase of work. Nothing here is implemented yet; the current app has only light/dark.

### Decision 1: Surfaces follow the active theme through declared CSS custom properties

Each theme will supply its own set of `--rtwiki-*` custom properties, keyed by **region** rather than by a single ambiguous name. The rich editor's surface will be forced to the canvas token (`--rtwiki-canvas`) so it is declared rather than inherited from the editor library, which means BlockNote's own background paint is overridden to match the active theme's canvas tone. The ambiguous names `--rtwiki-background` and `--rtwiki-surface` are to be **deleted, not aliased** — an alias would preserve the exact ambiguity that caused F1.

### Decision 2: BlockNote and Mermaid keep operating on Mantine's binary scheme

The editor library (BlockNote) and Mermaid diagram rendering will **not** be given per-theme work. They continue to use `useComputedColorScheme('light')` (or the equivalent) and switch between Mantine's built-in light and dark schemes. This is intentional: these libraries have their own internal theming that would require a separate migration per theme. The decision is to scope the first slice narrowly and leave them untouched.

**Risk:** this means BlockNote's dark background (`#1f1f1f`) will persist regardless of which theme is active, and Mermaid will always use either `default` (light) or `dark`. The canvas token workaround (see §5) masks this for BlockNote; Mermaid may show a slight tone mismatch at diagram boundaries in non-default themes. This is an accepted limitation of the first slice.

### Decision 3: Themes are data in a registry

Each theme entry supplies:
- A Mantine theme override (colours, radii, shadows)
- A light variant (CSS custom property map)
- A dark variant (CSS custom property map)

Adding a theme is a **data entry** — a new registry object — not a refactor. The composition root wires the registry into the theme provider.

### Decision 4: Selection is a (theme, variant) pair

The user's selection is a tuple: `(themeName, variant)`. The `auto` option resolves `variant` by reading `prefers-color-scheme` from the operating system for the selected theme. The current UI has only a binary light/dark toggle; the variant selector and `auto` option are not yet present.

### Decision 5: Approved scope for the first slice

**Build the engine and register the Default theme only.** Catppuccin and Nord are later additions that must be sourced from their official palettes, not invented. This is a scope decision, not an oversight.

The engine consists of:
- A theme registry module
- A theme provider that reads the (theme, variant) pair and applies the corresponding Mantine override + CSS variable map
- The Default theme entry (based on the current light/dark tokens in `src/web/theme/index.ts`)

### Decision 6: Known risk — provider theme identity swap

Swapping the provider's theme identity may cause a remount or a flash of unstyled content (FOUC). This needs to be verified empirically. If it occurs, the fix is to batch the theme change (apply CSS variables and Mantine override in a single transaction) rather than letting React reconcile them separately.

### Current reality check

The UI text dictionary in `src/web/config/index.ts` contains labels for themes that do not exist:

| Key | Value | Referenced by any component? |
|---|---|---|
| `appearanceThemeDark` | `'Dark (Catppuccin)'` | Yes — `settings-workspace.tsx:252` |
| `appearanceThemeNord` | `'Nord Dark'` | **No** — no component reads this key |
| `appearanceThemeLight` | `'Light'` | Yes — `settings-workspace.tsx:251` |

The `appearanceThemeNord` label is **ahead of reality**: it exists in the dictionary but is never surfaced in the UI. This is not a bug (the label costs nothing), but it is worth noting so a future agent does not assume Nord is implemented.

The default `themePreset` in `layout-preferences.ts` is `'catppuccin'`, but no Catppuccin theme exists. On a fresh install this default is silently accepted by the preferences parser (it is a valid `ThemePreset` value) but has no effect because the theme registry only knows about Default.

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
| 1 | **Theme token foundation** — build the theme registry engine, register the Default theme only | This is the dependency for everything else. Colours flow from it; without it the remaining work has no stable surface to build on. |
| 2 | **Remaining document frames** — drop the card frame from the HTML editor and markdown editor views | F1 is resolved; the remaining editors still frame their content as cards. This is a direct continuation of the canvas work and depends on the token foundation (each theme must declare its own canvas tone). |
| 3 | **Mobile toolbar** — add overflow affordance; hide right sidebar below `sm` | F2 is the highest-traffic remaining defect. Does not depend on themes. |
| 4 | **Application shell** — tighten rail overflow (F3 residual), honour `prefers-color-scheme` (F7) | Small polish items that benefit from the token foundation being in place (so they use declared tokens rather than hardcoded values). |
| 5 | **Tabs** — tab seam into the active tab, filler-based drag region | Tab work would otherwise be re-verified after the shell's geometry settles in item 4. Shell precedes tabs to avoid re-work. |
| 6 | **Cosmetic polish** — F6 (toolbar grouping/labels), F4 (stale test), F8 (dev database cleanup) | Everything else is independent or low-risk. |

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
- Status bar rendered height (28px) — measured
- Dark mode contrast (10.26:1 on tree rows and title text) — measured
- Mobile toolbar reachability at 390px (11 of 35 controls reachable) — measured
- Mantine version (9.6.2) — confirmed via `bun.lock` and `node_modules/@mantine/core`
- `bun run typecheck` — 0 errors
- `bun test` — 460 pass / 0 fail
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
