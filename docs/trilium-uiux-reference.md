# TriliumNext UI/UX Reference — for RTWiki

**Purpose:** a section-wise reference of how TriliumNext actually builds its shell —
layout, geometry, behaviour, shape and surface — so the RTWiki UI/UX work can be
done against a real reference instead of guesswork.

- **Source:** `D:\Temp\Trilium` (`@triliumnext/client` **v0.105.0**)
- **Theme studied:** `theme-next` (the modern "Next" theme), not the legacy `style.css`
- **Primary files:** `src/layouts/desktop_layout.tsx`,
  `src/stylesheets/theme-next/{shell,base,ribbon,pages,forms,dialogs}.css`,
  `src/stylesheets/theme-next/notes/{text,canvas}.css`,
  `src/stylesheets/theme-next-{light,dark}.css`
- Every value below is quoted from those files with a line reference. Where I have
  **not** read something deeply, it is marked **[shallow]** rather than guessed.

---

## 1. The layout model

Trilium has **two layouts**, switched by the user option `layoutOrientation`:

| Class on root | Option | Launcher pane | Tab bar |
|---|---|---|---|
| `.vertical-layout` | `layoutOrientation = "vertical"` | **vertical strip on the left** | row inside the rest pane, right of the launcher |
| `.horizontal-layout` | `"horizontal"` | **horizontal strip at the top** | full-width row **above** the launcher |

Note the inversion: "vertical" means the *launcher* is vertical, not the tabs.

### DOM skeleton (`desktop_layout.tsx:63-192`)

```
RootContainer                       .vertical-layout | .horizontal-layout
├── [horizontal layout only] tab-row-container      height 40px, full width
├── launcherPane                    53px wide (vertical) | 53px tall (horizontal)
└── horizontal-main-container       row, flex-grow 1
    ├── [vertical layout] launcherPane
    ├── LeftPaneContainer           QuickSearch + NoteTree
    └── rest-pane                   column, flex-grow 1
        ├── [if tab bar not full width] tab-row-container    height 40px
        ├── [new layout] FixedFormattingToolbar
        ├── vertical-main-container row, filling, collapsible
        │   ├── center-pane       column, filling, collapsible
        │   │   └── SplitNoteContainer → NoteWrapper
        │   │       ├── .title-row.note-split-title   margin 5px per child
        │   │       │   NoteIcon · NoteTitle · NoteBadges · Spacer · NoteActions
        │   │       ├── Ribbon (legacy layout only)
        │   │       └── ScrollingContainer           InlineTitle · NoteDetail
        │   └── RightPaneContainer | RightPanelContainer
        └── [vertical layout, new layout] StatusBar
└── [horizontal layout] StatusBar
```

Two independent feature flags shape it:
- **`fullWidthTabBar`** — `launcherPaneIsHorizontal || (isElectron && !hasNativeTitleBar
  && areWindowControlsOnLeft())`. The comment is explicit: when window controls sit
  on the left, a tab bar confined to the rest pane cannot give them room, so they
  end up drawn over the launcher pane instead.
- **`isNewLayout`** — `experimental-feature-new-layout`. Swaps `Ribbon` for
  `InlineTitle` + `NoteTitleActions`, swaps the right pane container, and adds the
  status bar.

---

## 2. Geometry reference

| Element | Value | Source |
|---|---|---|
| Launcher pane (vertical) | **53px** wide | `desktop_layout.tsx:205` |
| Launcher pane (horizontal) | **53px** tall | `desktop_layout.tsx:199` |
| `--launcher-pane-vert-size` | 58px | `base.css` |
| `--launcher-pane-horiz-size` | 54px | `base.css` |
| Tab row container | **40px** | `desktop_layout.tsx:92,118` |
| `--tab-bar-height` | 50px base / **44px** shell / 44px horizontal | `base.css`, `shell.css:1022`, `shell.css:46` |
| `--tab-height` | (tab) centred via `calc((bar - tab)/2)` | `shell.css:1138` |
| `--center-pane-border-radius` | 10px | `base.css` |
| Dropdown radius | 10px | `shell.css:12` |
| Selected-item shadow | 2px base / 4px shell | `base.css`, `shell.css` |
| Note title input radius / inset | 8px / 12px | `shell.css:1443-1444` |
| Note icon button radius | 8px | `shell.css:1452` |
| Note split border | **2px solid transparent** | `shell.css:1379` |
| Launcher icon (vertical) | 150% | `base.css` |
| Launcher icon (horizontal) | 20px | `base.css` |
| Launcher button margin / gap | 6px/8px, gap 3px | `base.css` |
| Tab toggle button | `--icon-button-size: 30px`, ratio `.6` | `shell.css:1026-1027` |
| Right-pane heading | 600 weight, `.85em`, `.3pt` tracking | `shell.css:1969-1974` |
| Right-pane row radius | 4px | `shell.css:1992` |
| Launcher collapsed border | 2px | `shell.css:137` |

**Notable:** the launcher is set to 53px inline but the CSS tokens say 58/54px, and
the tab row is 40px inline against a `--tab-bar-height` of 44/50px. Trilium carries
its own small drift between inline widget styles and token values. Do not copy that
pattern — RTWiki's `LAYOUT` block already avoids it, and keeping one number per
dimension is the rule to preserve.

---

## 3. The tab row — the answer to RTWiki's chrome

This is the section that maps most directly onto RTWiki's window band.

**Height model.** The row is `--tab-bar-height` tall; individual tabs are
`--tab-height` and are **centred inside it**:

```css
body.layout-vertical .tab-row-widget > * { margin-top: calc((var(--tab-bar-height) - var(--tab-height)) / 2); }
body.layout-horizontal .tab-row-container { padding-top: calc(var(--tab-bar-height) - var(--tab-height)); }
```

So the row is a fixed band and the tabs float within it. RTWiki's band is currently
one row at exactly 40px with the tab row filling it — simpler, and fine, as long as
the two heights are not allowed to disagree (which is exactly the 50px bug just fixed).

**The active-tab seam.** The row carries a bottom border that is *interrupted* by the
active tab, so the line appears to run into the active tab rather than under it:

```css
.tab-row-container .note-tab[active]:before { inset-inline-start: -32768px; inset-inline-end: calc(100% - 1px); }
.tab-row-container .note-tab[active]:after  { inset-inline-start: 100%; width: 100vw; }
```

RTWiki's active tab currently fills its slot with a solid background and a top
border. Trilium's treatment (line running to the tab edges, active tab transparent)
is the browser idiom and reads lighter at small sizes.

**Drag regions — the pattern to copy.** The row is a drag surface, and everything
interactive inside it is explicitly opted out:

```css
body.layout-horizontal .tab-row-container,
body.layout-vertical .tab-row-widget,
body.layout-vertical #left-pane .quick-search { -webkit-app-region: drag; }

body.layout-horizontal .tab-row-container > *,
body.layout-vertical .tab-row-widget > *:not(.tab-row-filler),
body.layout-vertical #left-pane .quick-search > * { -webkit-app-region: no-drag; }
```

There is an explicit **`.tab-row-filler`** element that is the drag handle, and every
other child is `no-drag`. This is structurally simpler than RTWiki's current approach
(an absolutely positioned drag backdrop *behind* the row, with content at a higher
z-index). Both are valid; the filler approach avoids a stacking-context fight and
scales better, because there is no overlap to reason about.

Note `#left-pane .quick-search` is also a drag surface — the search box area moves
the window. RTWiki does not do this.

**Row contents** (from the layout): `TabHistoryNavigationButtons` (back/forward),
`TabRowWidget`, scroll buttons left/right, a new-tab button, and pane toggles.

---

## 4. The note canvas — the answer to F1

This is the single most important section for RTWiki.

```css
#center-pane .note-split {
    padding-top: 2px;
    background-color: var(--note-split-background-color, var(--main-background-color));
    transition: border-color 150ms ease-out;
    border: 2px solid transparent;
}
```

**The note normally has no frame at all.** A 2px border exists but is *transparent*.
It only becomes visible when a split is the active one in a multi-split view:

```css
#center-pane > .split-note-container-widget:has(> .note-split.visible ~ .note-split.visible) > .note-split.active {
    border-color: var(--link-selection-outline-color);
}
```

So the border is a **focus indicator**, not decoration. That is the opposite of
RTWiki, where the document wrapper always carried a visible 1px border and an 8px
radius — which is what made it read as a widget.

**Radius is conditional, not constant:**

| Condition | Effect |
|---|---|
| first visible split | `border-start-start-radius: var(--note-split-top-border-radius)` (10px) |
| new layout, first split | also `border-end-start-radius` |
| classic toolbar visible | `--note-split-top-border-radius: 0` |
| left pane collapsed | `--note-split-top-border-radius: 0` |
| status bar panel open | `--note-split-bottom-border-radius: 0` |

The radius is tied to **whether the note is actually a floating page**. When a
toolbar spans above it, or the pane is full-bleed, the radius is dropped so the
content meets the chrome cleanly. RTWiki's fixed radius cannot express this.

**The title is not a form field:**

```css
.note-title-widget input { --input-background-color: transparent; border-radius: 8px; padding-inline-start: 12px; }
```

Transparent input background, so the title reads as document text, not a field. The
icon button next to it also drops its border and uses the same 8px radius.

**Entrance animation** is a 100ms linear opacity fade — fast enough to feel
responsive rather than decorative.

---

## 5. Launcher pane (the rail)

- 53px, flex column (vertical layout) holding `GlobalMenu`, `LauncherContainer`,
  `LeftPaneToggle`
- Icon size 150%, button margin 6px, gap 3px
- Has its own **thin scrollbar** with JS-measured padding, and a comment explaining
  that the padding is set from JS so WebKit shows a persistent bar
- When collapsed in vertical layout, gets a 2px inline-end border
  (`left-pane-collapsed-border-color`, `#0000000d` in light)

RTWiki comparison: rail is 40px (`LAYOUT.railWidth`) and its `nav` element measures
42px because CSS pads it by content — a 2px overflow into a 40px navbar (F3 residual).

---

## 6. Left pane — search and tree

**[shallow]** — mapped the section boundaries but not every rule.

- `QuickSearchWidget` sits at the top of the left pane, above `NoteTreeWidget`
- The search box is a "background rectangle" model (`.quick-search` with an inner
  background element that changes on hover/focus) rather than a bordered input
- The tree root, selected-item bulk-action button, protected-note indicator, context
  menu, and a **toolbar with collapsed and expanded states** (floating expand button)
- Selected items use a shadow token (`--left-pane-item-selected-shadow-size`), not a
  solid fill
- `@keyframes left-pane-item-select` — there is an explicit selection animation

---

## 7. Right pane

- Background `--right-pane-background-color`
- Children fade in: `animation: fade-in 200ms ease-in`
- Card headers: no border, title at 600/`.85em`/`.3pt` in a dedicated
  `--right-pane-heading-color`
- Rows: 4px radius, 150ms colour transition on normal state, 300ms on hover,
  `:active` returns to `transparent`
- The new layout replaces this with `RightPanelContainer`

RTWiki's right pane ("Page details" with Outline / Backlinks / Page Info) is the
direct analogue and currently uses a permanent card framing. The section headers
there should use the small-caps-ish 600/`.85em` treatment rather than plain labels.

---

## 8. Formatting toolbar

Not `ribbon.css` — that file styles **note metadata** (promoted attributes, file and
image properties, note info, owned attributes, similar notes). The formatting toolbar
is the CKEditor **classic toolbar**, themed through `--classic-toolbar-*-layout-
background-color` and `--ck-editor-toolbar-button-*` tokens, and mounted either as
`Ribbon` (legacy) or `FixedFormattingToolbar` (new layout).

**[shallow]** — I have the token names and mount points but have not audited the
button inventory, grouping, or overflow behaviour. This is the area to study before
RTWiki's F2 (24 of 35 controls unreachable on mobile). Trilium's `ribbon.css` does
show the responsive idiom it uses elsewhere:

```css
@container info-section (max-width: 800px) { ... reflow to flex-wrap with gap ... }
```

**Container queries**, not viewport media queries, for component-level
responsiveness. That is a materially better approach for a toolbar than RTWiki's
current viewport breakpoints.

---

## 9. Surface and colour system

Trilium uses a large token vocabulary. Names follow a strict
`--<component>-<role>-<state>` convention rather than a generic scale:

```
--window-background-color        --note-split-background-color
--left-pane-background-color     --right-pane-background-color
--launcher-pane-vert/horiz-background-color
--hover-item-background-color    --hover-item-text-color
--active-tab-background-color    --floating-button-background-color
--link-selection-outline-color   --subtle-border-color
--muted-text-color                --menu-text-color
--ck-editor-toolbar-button-on-background
```

**There is no single global "surface" token.** Each region names its own background,
and the same token resolves differently per orientation (`...-vert-` vs
`...-horiz-`). This is the opposite of RTWiki, where one `--rtwiki-surface` is
applied to 14 files — which is precisely what caused the F1 regression, where the
document was handed the panel tone.

**Recommendation for RTWiki:** replace the single ambiguous `--rtwiki-surface` with
per-region tokens, the way Trilium does. The F1 bug existed because "surface" could
mean panel or document and nothing enforced which.

Themes are separate files (`theme-next-light.css`, `theme-next-dark.css`), and
background effects (Windows Mica, macOS vibrancy) override the same tokens rather
than adding a parallel system.

---

## 10. Shape, separators and motion

| Concern | Trilium |
|---|---|
| Radii | 10px panes/dropdowns, 8px inputs and icon buttons, 4px list rows |
| Separators | 1px, colour-only, conditionally applied (e.g. toolbar removes the note radius) |
| Note frame | transparent 2px, shown only when active in a split |
| Transitions | 150ms for state, 300ms for hover, 100ms note entrance, 200ms pane fade-in |
| Easing | mostly `ease-in-out` / `ease-out` |

The consistent idea: **radii and borders are conditional on layout context**, never
unconditional decoration.

---

## 11. Behaviours worth adopting

1. **Drag regions via an explicit filler + `no-drag` children** (§3) instead of a
   stacked backdrop.
2. **The search box is a window drag surface** (§3) — free draggable area.
3. **Container queries for component responsiveness** (§8) instead of viewport
   breakpoints, so a toolbar reflows by its own width.
4. **Borders as focus indicators, not frames** (§4).
5. **Tab seam that flows into the active tab** (§3).
6. **Zen mode** — `CloseZenModeButton` plus an animated toolbar entrance
   (`zen-formatting-toolbar-entrance`, 300ms `translateY(200%) → 0`).
7. **Full-width tab bar when window controls sit on the left** (`fullWidthTabBar`) —
   directly relevant to RTWiki's custom caption buttons.
8. **Native titlebar overlay awareness** — Linux `--native-titlebar-height` 36px, 52px
   in horizontal layout, with the caption buttons centred against the tab row's
   centre line (`3 + 30/2 = 18`). RTWiki's caption buttons are 46×40 and sit in the
   band; Trilium solves the same alignment problem with an explicit calculation.

---

## 12. Coverage — what I have *not* studied

Marked so the next pass is targeted rather than assumed done:

- **[shallow]** Left pane: full search-box and note-tree rule set, selection animation
- **[shallow]** Formatting toolbar: button inventory, grouping, overflow, CKEditor theming
- **[not read]** `text.css` (26 KB) — heading scale, paragraph rhythm, code blocks,
  tables, the text measure / line length
- **[not read]** `theme-next-light.css` / `-dark.css` (22 KB each) — the actual colour
  values; I have token *names* and structure, not the palette
- **[not read]** `pages.css`, `forms.css` (32 KB), `dialogs.css`
- **[not read]** `mobile_layout.tsx` / `mobile_layout.css`
- **[not read]** Legacy `style.css`, `theme-light.css`, `theme-dark.css`
- **not studied** runtime behaviour: pane drag-resize, collapse persistence, keyboard
  shortcuts, tab overflow scrolling, command palette

---

## 13. Direct implications for RTWiki

Ordered by expected gain, each grounded in something measured above:

1. **Drop the document frame entirely** (§4). Make the border transparent-by-default
   and radius conditional. RTWiki has already removed the rich editor's frame; the
   same reasoning applies to the HTML editor and markdown workspace, which still use
   `--rtwiki-surface` with a visible border.
2. **Replace `--rtwiki-surface` with per-region tokens** (§9). This is the structural
   fix for F1's root cause, not a per-component patch.
3. **Adopt the filler drag pattern for the band** (§3) and make the tab strip a drag
   surface like the search box.
4. **Switch the toolbar to container queries** (§8) and give it an overflow affordance
   (F2).
5. **Use the small heading treatment in the right pane** (§7).
6. **Recentre the caption buttons against the band** using Trilium's explicit
   centre-line calculation (§11.8) rather than relying on `align-items: center` with
   mismatched heights.
7. **Keep one number per dimension** (§2). Trilium's own 53-vs-58 and 40-vs-44 drift
   is the anti-pattern; RTWiki's `LAYOUT` block is the better model and should not
   acquire a parallel token set.
