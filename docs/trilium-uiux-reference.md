# TriliumNext UI/UX Reference — for RTWiki

**Purpose:** a section-wise reference of how TriliumNext actually builds its shell —
layout, geometry, behaviour, shape, colour and type — so the RTWiki UI/UX work can be
done against a real reference instead of guesswork. Every value is quoted from source
with a file or line reference; anything not read deeply is marked, not guessed.

- **Source:** `D:\Temp\Trilium` — `@triliumnext/client` **v0.105.0**
- **Theme studied:** `theme-next` (the modern "Next" theme), not the legacy `style.css`
- **Files:** `src/layouts/desktop_layout.tsx`, `src/layouts/mobile_layout.{tsx,css}`,
  `src/stylesheets/theme-next/{shell,base,ribbon,pages,forms,dialogs}.css`,
  `src/stylesheets/theme-next/notes/{text,canvas}.css`,
  `src/stylesheets/theme-next-{light,dark}.css`

---

## 1. Layout model

Two layouts, switched by the user option `layoutOrientation`:

| Root class | Option | Launcher | Tab bar |
|---|---|---|---|
| `.vertical-layout` | `"vertical"` | vertical strip, **left** | row inside the rest pane, right of the launcher |
| `.horizontal-layout` | `"horizontal"` | horizontal strip, **top** | full-width row **above** the launcher |

The naming inverts intuition: "vertical" describes the *launcher*, not the tabs.

### DOM skeleton (`desktop_layout.tsx:63-192`)

```
RootContainer                       .vertical-layout | .horizontal-layout
├── [horizontal only] tab-row-container       40px, full width
├── launcherPane                     53px wide (vertical) | 53px tall (horizontal)
└── horizontal-main-container        row, flex-grow 1
    ├── [vertical only] launcherPane
    ├── LeftPaneContainer            QuickSearch + NoteTree
    └── rest-pane                    column, flex-grow 1
        ├── [if tab bar not full width] tab-row-container     40px
        ├── [new layout] FixedFormattingToolbar
        ├── vertical-main-container  row, filling, collapsible
        │   ├── center-pane          column, filling, collapsible
        │   │   └── SplitNoteContainer → NoteWrapper
        │   │       ├── .title-row.note-split-title      margin 5px per child
        │   │       │   NoteIcon · NoteTitle · NoteBadges · Spacer · NoteActions
        │   │       ├── Ribbon (legacy layout only)
        │   │       └── ScrollingContainer              InlineTitle · NoteDetail
        │   └── RightPaneContainer | RightPanelContainer
        └── [vertical only, new layout] StatusBar
└── [horizontal layout] StatusBar
```

Two feature flags shape it:

- **`fullWidthTabBar`** — `launcherPaneIsHorizontal || (isElectron && !hasNativeTitleBar
  && areWindowControlsOnLeft())`. The in-code comment is explicit: when window controls
  sit on the left, a tab bar confined to the rest pane cannot give them room, so they
  are drawn over the launcher instead.
- **`isNewLayout`** (`experimental-feature-new-layout`) — swaps `Ribbon` for
  `InlineTitle` + `NoteTitleActions`, swaps the right-pane container, adds the status bar.

---

## 2. Geometry

| Element | Value | Source |
|---|---|---|
| Launcher pane (vertical) | **53px** wide | `desktop_layout.tsx:205` |
| Launcher pane (horizontal) | **53px** tall | `desktop_layout.tsx:199` |
| `--launcher-pane-vert-size` | 58px | `base.css` |
| `--launcher-pane-horiz-size` | 54px | `base.css` |
| Tab row container | **40px** | `desktop_layout.tsx:92,118` |
| `--tab-bar-height` | 50px base / **44px** shell / 44px horizontal | `base.css`, `shell.css:1022`, `shell.css:46` |
| Tab centring | `calc((bar − tab) / 2)` | `shell.css:1138` |
| `--center-pane-border-radius` | 10px | `base.css` |
| Dropdown radius | 10px | `shell.css:12` |
| Selected-item shadow size | 2px base / 4px shell | `base.css`, `shell.css` |
| Note title input radius / inset | 8px / 12px | `shell.css:1443-1444` |
| Note icon button radius | 8px | `shell.css:1452` |
| Note split border | **2px solid transparent** | `shell.css:1379` |
| Launcher icon (vertical / horizontal) | 150% / 20px | `base.css` |
| Launcher button margin / gap | 6px / 8px, gap 3px | `base.css` |
| Tab toggle button | `--icon-button-size: 30px`, ratio `.6` | `shell.css:1026` |
| Right-pane heading | 600, `.85em`, `.3pt` | `shell.css:1969-1974` |
| Right-pane row radius | 4px | `shell.css:1992` |
| Launcher collapsed border | 2px | `shell.css:137` |
| Left-pane item selected shadow | `1px 1px 2px rgba(0,0,0,.2)` | `theme-next-light.css` |
| Left-pane item hover | `rgba(0,0,0,.032)` | `theme-next-light.css` |
| Launcher button hover shadow | `4px 4px 4px rgba(0,0,0,.075)` | `theme-next-light.css` |

**Antipattern to avoid:** Trilium sets the launcher to 53px and the tab row to 40px as
*inline widget styles*, while CSS tokens say 58/54px and 44/50px. It carries its own
small drift. RTWiki's single `LAYOUT` block is the better model — one number per
dimension, and no parallel token set.

---

## 3. Tab row

**Two-height model.** The row is `--tab-bar-height`; tabs are `--tab-height` and are
centred inside it:

```css
body.layout-vertical .tab-row-widget > * { margin-top: calc((var(--tab-bar-height) - var(--tab-height)) / 2); }
body.layout-horizontal .tab-row-container { padding-top: calc(var(--tab-bar-height) - var(--tab-height)); }
```

**The active-tab seam.** The row's bottom border is interrupted by the active tab, so
the line appears to run *into* it:

```css
.tab-row-container .note-tab[active]:before { inset-inline-start: -32768px; inset-inline-end: calc(100% - 1px); }
.tab-row-container .note-tab[active]:after  { inset-inline-start: 100%; width: 100vw; }
```

**Drag regions — the pattern worth copying.** The row is a drag surface and everything
interactive inside opts out explicitly:

```css
body.layout-horizontal .tab-row-container,
body.layout-vertical .tab-row-widget,
body.layout-vertical #left-pane .quick-search { -webkit-app-region: drag; }

body.layout-horizontal .tab-row-container > *,
body.layout-vertical .tab-row-widget > *:not(.tab-row-filler),
body.layout-vertical #left-pane .quick-search > * { -webkit-app-region: no-drag; }
```

There is an explicit **`.tab-row-filler`** as the drag handle. This is structurally
simpler than a stacked drag backdrop: no overlap, no z-index ordering to reason about.
Note also that **`#left-pane .quick-search` is a drag surface** — RTWiki does not do this.

**Row contents:** `TabHistoryNavigationButtons` (back/forward), `TabRowWidget`,
scroll buttons left/right, new-tab button, pane toggles.

---

## 4. Note canvas — the reference for F1

```css
#center-pane .note-split {
    padding-top: 2px;
    background-color: var(--note-split-background-color, var(--main-background-color));
    transition: border-color 150ms ease-out;
    border: 2px solid transparent;
}
```

**The note normally has no frame.** The 2px border exists but is *transparent*. It
only appears when a split is the **active** one in a multi-split view:

```css
#center-pane > .split-note-container-widget:has(> .note-split.visible ~ .note-split.visible) > .note-split.active {
    border-color: var(--link-selection-outline-color);
}
```

So the border is a **focus indicator**, not decoration.

**Radius is conditional, never constant:**

| Condition | Effect |
|---|---|
| first visible split | `border-start-start-radius: var(--note-split-top-border-radius)` (10px) |
| new layout, first split | also `border-end-start-radius` |
| classic toolbar visible | `--note-split-top-border-radius: 0` |
| left pane collapsed | `--note-split-top-border-radius: 0` |
| status-bar panel open | `--note-split-bottom-border-radius: 0` |

The radius exists only when the note is genuinely a floating page. When a toolbar
spans above it, or the pane goes full-bleed, it is dropped so content meets chrome
cleanly.

**The title is not a form field:**

```css
.note-title-widget input { --input-background-color: transparent; border-radius: 8px; padding-inline-start: 12px; }
```

**Entrance:** `note-entrance`, 100ms linear opacity fade — fast enough to feel
responsive rather than decorative.

---

## 5. Launcher pane

- 53px flex column: `GlobalMenu`, `LauncherContainer`, `LeftPaneToggle`
- Icon 150%, margin 6px, gap 3px
- Own **thin scrollbar** with JS-measured padding, with a comment explaining the
  padding is set from JS so WebKit shows a persistent bar
- Collapsed in vertical layout → 2px inline-end border (`#0000000d` light, `#0009` dark)

---

## 6. Left pane — search and tree

- `QuickSearchWidget` above `NoteTreeWidget`
- Search is a **background-rectangle model** (inner background element changing on
  hover/focus), not a bordered input
- Tree has a toolbar with **collapsed and expanded states** plus a floating expand
  button, a selected-item bulk-action button, a protected-note indicator, a context
  menu, and an explicit `left-pane-item-select` animation
- **Selection is white + a shadow** (`1px 1px 2px rgba(0,0,0,.2)`), not a solid fill

---

## 7. Right pane

- `--right-pane-background-color`; children `fade-in 200ms ease-in`
- Card headers: no border, title 600/`.85em`/`.3pt` in `--right-pane-heading-color`
- Rows: 4px radius, 150ms transition, 300ms on hover, `:active` → `transparent`
- Replaced by `RightPanelContainer` in the new layout

---

## 8. Formatting toolbar

Not `ribbon.css` — that styles **note metadata** (promoted attributes, file/image
properties, note info, owned attributes, similar notes). The formatting toolbar is the
CKEditor **classic toolbar**, themed via `--classic-toolbar-*-layout-background-color`
and `--ck-editor-toolbar-button-*` tokens, mounted as `Ribbon` (legacy) or
`FixedFormattingToolbar` (new layout).

**Its responsive idiom is container queries, not viewport media queries:**

```css
@container info-section (max-width: 800px) { /* reflow to flex-wrap with gap */ }
```

A component reflows by **its own width**. This is the technique to reach for on
RTWiki's toolbar rather than viewport breakpoints.

---

## 9. Colour system

Trilium uses a strict `--<component>-<role>-<state>` vocabulary. **There is no global
"surface" token** — each region names its own background, and tokens often resolve
differently per orientation (`...-vert-` vs `...-horiz-`).

### Light (`theme-next-light.css`)

| Token | Value |
|---|---|
| `--main-background-color` | `white` |
| `--main-text-color` | `black` |
| `--main-border-color` | `#dbdbdb` |
| `--subtle-border-color` | `rgba(0,0,0,0.1)` |
| `--left-pane-background-color` | `#f2f2f2` |
| `--left-pane-text-color` | `#383838` |
| `--left-pane-item-selected-background` | `white` |
| `--left-pane-item-selected-color` | `black` |
| `--left-pane-item-hover-background` | `rgba(0,0,0,0.032)` |
| `--launcher-pane-vert-background-color` | `#e8e8e8` |
| `--launcher-pane-horiz-background-color` | `#fafafa` |
| `--muted-text-color` | `#666` |
| `--hover-item-background-color` | `#0000001a` |
| `--active-item-background-color` | `#ddd` |
| `--input-background-color` | `#00000012` |
| `--input-focus-outline-color` | `#00000063` |
| `--menu-background-color` | `#ffffffd9` |
| `--dropdown-border-color` | `#ccc` |
| `--dropdown-shadow-opacity` | `0.2` |

### Dark (`theme-next-dark.css`)

| Token | Value |
|---|---|
| `--main-background-color` | `#242424` |
| `--main-text-color` | `#ccc` |
| `--main-border-color` | `#454545` |
| `--subtle-border-color` | `#313131` |
| `--left-pane-background-color` | `#1f1f1f` |
| `--left-pane-text-color` | `#aaaaaa` |
| `--left-pane-item-selected-background` | `#ffffff25` |
| `--left-pane-item-hover-background` | `#ffffff0d` |
| `--muted-text-color` | `#bbb` |
| `--hover-item-background-color` | `#ffffff16` |
| `--active-item-background-color` | `#777` |
| `--input-background-color` | `#ffffff12` |
| `--left-pane-collapsed-border-color` | `#0009` |

### The relationship that matters

Light: **pane `#f2f2f2` is darker than the `#ffffff` canvas.** Dark: **pane `#1f1f1f`
is darker than the `#242424` canvas.** In both schemes the pane is *recessed* and the
document is the brightest surface.

**This is the key to the RTWiki palette work — see §12.**

---

## 10. Typography

- `--main-font-family: "Inter", sans-serif`; `--main-font-size: normal`
- Deliberately minimal: there is **no global heading or body scale** in the Next theme.
  Sizing comes from CKEditor's own defaults plus small local adjustments
  (`.9em`, `.85em`, `1.4em`, `0.7em` for captions/labels)
- Section labels use a consistent small treatment: **600 weight, `.85em`, `.3pt`
  letter-spacing** (right-pane headings, and the uppercase `.65rem` / `1pt` treatment
  for card legends in `ribbon.css`)
- **No text-measure constraint** was found in `base.css` or `shell.css` — the note
  spans its pane. This is a canvas-style choice, not an oversight. *(Confirm against
  `notes/text.css` before relying on it.)*
- Body text is `1em`; the one `48px` in `text.css` is a specific large element, not a scale

---

## 11. Shape, separators, motion

| Concern | Trilium |
|---|---|
| Radii | 10px panes/dropdowns · 8px inputs and icon buttons · 4px list rows |
| Separators | 1px, colour-only, **conditionally applied** |
| Note frame | transparent 2px, shown only when active in a split |
| Transitions | 150ms state · 300ms hover · 100ms note entrance · 200ms pane fade |
| Entrance | opacity/filter fade, never a slide or scale |

The consistent principle: **radii and borders are conditional on layout context**,
never unconditional decoration.

---

## 12. The RTWiki hex finding

The uncommitted RTWiki palette introduced with the 9.6.2 work contains:

```
light: --rtwiki-background #ffffff, --rtwiki-surface #f2f2f2
dark:  --rtwiki-background #242424, --rtwiki-surface #1f1f1f
```

Those are **not arbitrary**. They are Trilium's values:

| RTWiki token | Trilium origin |
|---|---|
| `--rtwiki-background #ffffff` | `--main-background-color: white` |
| `--rtwiki-background #242424` (dark) | `--main-background-color: #242424` |
| `--rtwiki-surface #f2f2f2` | **`--left-pane-background-color`** |
| `--rtwiki-surface #1f1f1f` (dark) | **`--left-pane-background-color`** |

So the palette was transcribed correctly. **The mistake was applying the *left-pane*
token globally as `--rtwiki-surface`** — which is exactly what handed the document
canvas a pane tone and produced the F1 regression (grey frame around a white card, in
a document that matched the sidebar exactly).

**The fix is structural, not cosmetic:** split the single `--rtwiki-surface` into
per-region tokens named the way Trilium names them, and assign Trilium's values to the
correct regions. The palette is already right; only the addressing is wrong.

**Open decision:** BlockNote paints its own dark editor background at `#1f1f1f` —
which is Trilium's *pane* colour, not its canvas (`#242424`). So either the document
token follows BlockNote (current RTWiki fix) or BlockNote's background is overridden to
match Trilium's canvas. Worth an explicit decision; both are defensible.

> **RESOLVED.** The second option was chosen, and the structural fix above is done.
> RTWiki now declares per-region tokens (`--rtwiki-canvas`, `--rtwiki-pane`,
> `--rtwiki-rail`, `--rtwiki-elevated`), maps them straight through to the Trilium
> origins in this table, and forces the editor surface to the declared canvas token.
> The dark scale is therefore no longer inverted: the canvas is `#242424` and the pane
> is `#1f1f1f`, matching the relationship in §9. See
> [rtwiki-uiux.md](rtwiki-uiux.md) §5 and §6 for the built result and the reasoning.

---

## 13. Behaviours worth adopting

1. **Filler-based drag regions** (§3) instead of a stacked backdrop.
2. **The search box is a window drag surface** (§3) — free draggable area.
3. **Container queries** (§8) for component responsiveness.
4. **Borders as focus indicators, not frames** (§4).
5. **Tab seam flowing into the active tab** (§3).
6. **Zen mode** — `CloseZenModeButton` plus an animated toolbar entrance
   (`zen-formatting-toolbar-entrance`, 300ms `translateY(200%) → 0`).
7. **Full-width tab bar when window controls sit on the left** (`fullWidthTabBar`) —
   directly relevant to RTWiki's custom caption buttons.
8. **Caption-button alignment by explicit centre-line calculation** (Linux
   `--native-titlebar-height` 36px / 52px horizontal; centre `3 + 30/2 = 18`), because
   the row height and the control height deliberately differ.
9. **Background effects as token overrides** (Windows Mica / tabbed, macOS
   under-window / hud) rather than a parallel system.

---

## 14. Mobile

`mobile_layout.css` is **498 bytes** — a handful of tweaks. Mobile is a **variant of
the same shell**, selected by a `body.mobile` class that appears throughout
`shell.css` (`body.mobile #root-widget`, `body.mobile #detail-container .note-split`,
`body.mobile .dropdown-menu`), with its own DOM in `mobile_layout.tsx`. There is no
second design system. *(The mobile DOM itself is marked not read.)*

---

## 15. Coverage — honestly marked

**Read and extracted:** layout model, DOM skeleton, geometry, tab row, note canvas,
launcher, right pane, colour palette (light + dark), ribbon, part of the left pane.

**Partial:** left pane search and tree rules (section boundaries mapped, not every
rule); classic formatting toolbar (token names and mount points, not the button
inventory or overflow behaviour).

**Not read:** `notes/text.css` typography detail (26 KB) · `forms.css` (32 KB) ·
`dialogs.css` · `pages.css` · `mobile_layout.tsx` DOM · legacy `style.css` /
`theme-light.css` / `theme-dark.css`.

**Not studied (runtime):** pane drag-resize, collapse persistence, keyboard shortcuts,
tab overflow scrolling, command palette, the contextual toolbar's conditional groups.

---

## 16. Ordered implications for RTWiki

| # | Action | Grounded in | Note |
|---|---|---|---|
| ~~1~~ | ~~Split `--rtwiki-surface` into per-region tokens; assign Trilium's values per region~~ | §9, §12 | **Done.** Region-named tokens live in a registry; the ambiguous names are deleted, not aliased |
| ~~2~~ | ~~Decide the dark document tone vs BlockNote's `#1f1f1f`~~ | §12 | **Done.** The editor surface is bound to the declared canvas token, so the tone is declared rather than inherited |
| 3 | Drop the remaining document frames (HTML editor, markdown still framed) | §4 | Border transparent by default; radius conditional |
| 4 | Filler-based drag region for the band; make the tab strip a drag surface | §3 | Replaces the stacked backdrop |
| 5 | Toolbar to container queries + an overflow affordance | §8 | F2: 24 of 35 controls unreachable at 390px |
| 6 | Small heading treatment in the right pane | §7, §10 | 600 / `.85em` / `.3pt` |
| 7 | Caption buttons aligned by explicit centre line | §13.8 | Not `align-items: center` with mismatched heights |
| 8 | Tab seam into the active tab | §3 | Browser idiom |
| 9 | Keep one number per dimension | §2 | Do not acquire a parallel token set |
