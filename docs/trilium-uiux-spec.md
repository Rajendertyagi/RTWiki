# TriliumNext — UI/UX Spec Sheet

> Read-only research extract of TriliumNext's compact desktop UI shell.
> Source tree: `D:\Temp\Trilium\apps\client\src`
> Frontend is Preact + legacy jQuery widgets (no `apps/web`; client lives in `apps/client`).
> Two theme generations: **classic** (`theme-dark.css`/`theme-light.css`, font Montserrat) and the
> beta **"Next"** theme (`theme-next-dark.css`/`theme-next-light.css` → `theme-next/base.css`, font Inter).
> This spec uses **Next as primary** and notes classic where they differ.

## 0. Layout shell & composition

Source: `layouts/desktop_layout.tsx`

`DesktopLayout.getRootWidget()` builds the whole shell. Key switches:
- `layoutOrientation === "horizontal"` → `#launcher-pane` is a top bar; vertical (default) → left rail.
- `fullWidthTabBar` = horizontal layout, **or** Electron with window-controls on the left (macOS always).
  When true, the tab bar row renders full-width above the launcher; otherwise it renders inside `#rest-pane`.
- `isNewLayout` = experimental feature `new-layout` enabled. Gates: `FixedFormattingToolbar`,
  `RightPanelContainer`, in-title-row `NoteBadges`/`NoteTitleActions`/`NoteActions`, and `StatusBar`.

Composition (vertical layout, default):

```
RootContainer(.vertical-layout)
└─ (fullWidthTabBar only) FlexContainer.row .tab-row-container  [height 40px, bg var(--launcher-pane-background-color)]
   ├─ #tab-row-left-spacer
   ├─ LeftPaneToggle (horizontal only)
   ├─ <TabHistoryNavigationButtons/>
   ├─ <TabRowWidget/>.full-width
   └─ <RightPaneToggle/> (new-layout only)
└─ (horizontal only) #launcher-pane.horizontal
└─ FlexContainer.row #horizontal-main-container [flex-grow 1]
   ├─ #launcher-pane.vertical (vertical only)
   │   ├─ <GlobalMenu/>
   │   ├─ <LauncherContainer/>
   │   └─ <LeftPaneToggle/>
   ├─ LeftPaneContainer  (#left-pane)
   │   ├─ <QuickSearchWidget/> (vertical only)
   │   ├─ <NoteTreeWidget/>
   │   └─ ...custom left-pane widgets
   ├─ FlexContainer.column #rest-pane [flex-grow 1]
   │   ├─ (NOT fullWidthTabBar) .tab-row-container [height 40px, align-items center]
   │   │   ├─ <TabHistoryNavigationButtons/>
   │   │   ├─ <TabRowWidget/>
   │   │   └─ <RightPaneToggle/> (new-layout)
   │   ├─ <FixedFormattingToolbar/> (new-layout only)
   │   ├─ FlexContainer.row #vertical-main-container [filling, collapsible]
   │   │   ├─ FlexContainer.column #center-pane [filling, collapsible]
   │   │   │   ├─ SplitNoteContainer → per note:
   │   │   │   │   NoteWrapperWidget
   │   │   │   │   ├─ .title-row.note-split-title [css: .title-row > * { margin: 5px }]
   │   │   │   │   │   ├─ <NoteIconWidget/>
   │   │   │   │   │   ├─ <NoteTitleWidget/>
   │   │   │   │   │   ├─ <NoteBadges/> (new-layout) | [MovePane L/R, ClosePane, CreatePane] (classic)
   │   │   │   │   │   ├─ <SpacerWidget baseSize 0 growthFactor 1/>
   │   │   │   │   │   └─ <NoteActions/> (new-layout)
   │   │   │   │   ├─ <Lazy Ribbon/> (classic only)
   │   │   │   │   ├─ <WatchedFileUpdateStatusWidget/>
   │   │   │   │   ├─ <FloatingButtons items=DESKTOP_FLOATING_BUTTONS/> (classic only)
   │   │   │   │   ├─ ScrollingContainer [filling]
   │   │   │   │   │   ├─ <InlineTitle/> (new-layout)
   │   │   │   │   │   ├─ <NoteTitleActions/> (new-layout)
   │   │   │   │   │   ├─ ContentHeader (ReadOnlyNoteInfoBar + SharedInfo) (classic)
   │   │   │   │   │   ├─ <PromotedAttributes/> (classic)
   │   │   │   │   │   ├─ <NoteDetail/>
   │   │   │   │   │   ├─ <NoteList media=screen/>
   │   │   │   │   │   ├─ <SearchResult/>
   │   │   │   │   │   └─ <ScrollPadding/>
   │   │   │   │   ├─ <ApiLog/>
   │   │   │   │   └─ <FindWidget/>
   │   │   ├─ RightPaneContainer (Toc + HighlightsList) (classic) | <RightPanelContainer/> (new-layout)
   │   └─ <StatusBar/> (new-layout, vertical only)
   └─ <StatusBar/> (new-layout, horizontal only)
└─ <CloseZenModeButton/>
└─ <PasswordNoteSetDialog/>
```

`#launcher-pane` is built in `#buildLauncherPane`:
- horizontal: FlexContainer.row `.horizontal`, `height:53px`, [LauncherContainer, GlobalMenu]
- vertical: FlexContainer.column `.vertical`, `width:53px`, [GlobalMenu, LauncherContainer, LeftPaneToggle]

## 1. Utility rail / launcher pane

### 1.1 Geometry (Next theme)
Source: `stylesheets/theme-next/base.css` + `theme-next/shell.css` §LAUNCHER PANE.

| Token / value | Vertical | Horizontal |
|---|---|---|
| Pane size `--launcher-pane-size` | `--launcher-pane-vert-size: 58px` | `--launcher-pane-horiz-size: 54px` |
| Button margin `--launcher-pane-button-margin` | 6px | 8px |
| Button gap `--launcher-pane-button-gap` | 3px | 3px |
| Icon size `--launcher-pane-icon-size` | 150% (font) | 20px |

- Classic layout (style.css): `#launcher-pane` width/height = **53px**; `.right-dropdown-widget` 53px.
- Next: `#launcher-pane.vertical { width:min-width: var(--launcher-pane-size) !important; padding-bottom: var(--launcher-pane-button-gap) }`.
- `#launcher-pane.horizontal { height: var(--launcher-pane-size) !important; align-items:center; border-bottom:1px solid var(--launcher-pane-horiz-border-color) }` (≥992px only; below 992px no bottom border).
- Launcher buttons: `width/height: calc(var(--launcher-pane-size) - 2*var(--launcher-pane-button-margin)) !important; margin: var(--launcher-pane-button-gap) var(--launcher-pane-button-margin)`.
- Vertical launcher: background `--launcher-pane-vert-background-color`, text `--launcher-pane-vert-text-color`.
- Horizontal launcher: background `--launcher-pane-horiz-background-color`, text `--launcher-pane-horiz-text-color`, border `--launcher-pane-horiz-border-color`.
- `#launcher-container` is the scroll host (overflow-y auto vertical / overflow-x auto horizontal). It reserves `--launcher-scrollbar-size` (JS-measured via `useLauncherScrollbarCompensation`) on the opposite edge. Scrollbar thin: `--scrollbar-thickness: 4px`.
- `#launcher-pane .launcher-button`, `.right-dropdown-widget`, `.global-menu` share the square button box.
- `.launcher-button`: `padding:0 !important; border-radius:8px;` flex-centered; `font-size: var(--launcher-pane-icon-size) !important; cursor:default;` transitions bg/color/shadow 300ms ease-out.
  - `:active`, `.show` → `transform: scale(0.9)` (50ms linear).
  - `:hover`, `.right-dropdown-button.show` → `background: var(--launcher-pane-button-hover-background); color: var(--launcher-pane-button-hover-color); box-shadow: var(--launcher-pane-button-hover-shadow)` (100ms ease-in).
  - `:focus-visible` → `outline: 2px solid var(--launcher-pane-button-focus-outline-color)`.
  - `.global-menu-button` — update-available badge: `--update-badge-x-offset:3%; --update-badge-y-offset:-12%`; badge colors `--global-menu-update-available-badge-background-color` / `-color`.
  - Protected-session button `.bx-check-shield` → `color: var(--protected-session-active-icon-color)` (500ms ease-in-out).
  - `.sync-status-icon` top offset 3px; disconnected-with-changes pulses via `@keyframes sync-status-pulse` using `--sync-status-error-pulse-color` (1s steps(10) alternate-reverse infinite).

### 1.2 Rail content (data-driven)
Source: `widgets/launch_bar/LauncherContainer.tsx`.

The rail is **not** hard-coded: it renders the child notes of the launcher root
(`_lbVisibleLaunchers` desktop / `_lbMobileVisibleLaunchers` mobile) in order. Each child note has label `launcherType` ∈ { `command`, `note`, `script`, `customWidget`, `builtinWidget` }.

`builtinWidget` values (`initBuiltinWidget`): `calendar`, `spacer` (labels `baseSize` default 40, `growthFactor` default 100), `bookmarks`, `protectedSession`, `syncStatus`, `backInHistoryButton`, `forwardInHistoryButton`, `todayInJournal`, `quickSearch`, `mobileTabSwitcher`, `sidebarChat` (only if experimental `llm` enabled), `colorSchemeSwitcher`.

`Launcher` maps: `command`→CommandButton, `note`→NoteLauncher, `script`→ScriptLauncher, `customWidget`→CustomWidget (suppressed in safe mode), `builtinWidget`→initBuiltinWidget.

Global menu (`widgets/buttons/global_menu.tsx`) is a `Dropdown` with button class
`global-menu-button bx bx-menu` (horizontal) or bare `global-menu-button` (vertical, shows the Trilium SVG
logo via `VerticalLayoutIcon`). Menu items (top→bottom): Open new window, Shared notes subtree, Deleted
notes, Space usage (keyboard), Zoom controls (Electron: fullscreen/−/%/+ row; else Fullscreen), Window on top
(Electron), Zen mode (keyboard), Switch to mobile/desktop version, Configure launch bar, **Advanced** submenu
(hidden subtree, search history, backend log, SQL console + history, dev tools [Electron], reload frontend),
Options, Help (kbd), Cheatsheet (kbd), About; + update-available block when newer release detected; + Logout
(browser-only); + Development submenu (experimental feature toggles, dev-only).

## 2. Left pane / note tree

Sources: `stylesheets/tree.css`, `theme-next/shell.css` §TREE PANE, `widgets/note_tree.ts`.

### 2.1 Tree container
- `#left-pane` (LeftPaneContainer). The tree is a **fancytree** widget. Theme Next overrides are scoped to
  `:is(#left-pane, .tree-popup-sidebar)` so the same rules also apply to the tree hosted in the note popup editor.
- `div.tree` → `padding: 3px 6px 40px 6px; animation: fade-in 200ms ease-in`.
- Root row: `.fancytree-container > li:first-child > span { padding-inline-start: 12px }`.
- Indent (base `tree.css`): `.ui-fancytree > li > ul { padding-inline-start: 5px }` (first nesting level),
  `.ui-fancytree ul { padding-inline-start: 20px }` (deeper). **Next** overrides to `padding-inline-start: 10px`
  for all `.ui-fancytree ul` inside the left pane.

### 2.2 Tree row
`span.fancytree-node` (base `tree.css`):
- `display:flex; align-items:center; height:2.4em; padding:4px; border:1px solid transparent; border-radius:5px; cursor:pointer; white-space:nowrap; text-overflow:ellipsis; user-select:none; color: var(--custom-color, inherit)`.
- **Next**: `span.fancytree-node { border:unset; border-radius:6px; cursor:default }` (radius 6px; no visible border).

Sub-elements:
- `.fancytree-expander` — chevron. Hidden unless `.fancytree-folder` (`visibility:hidden` / visible for folders).
  Base glyph `::before { font-family:boxicons; content:"\ea50" (chevron-right); font-size:x-large; line-height:1; position:relative; top:2px; margin-inline-end:5px }`;
  expanded → `content:"\ea4a"` (chevron-down); RTL unexpanded → `\ea4d` (chevron-left). Non-folder rows paint the
  chevron in `--main-background-color` so it is invisible (indent preserved). Loading state: 12px `lds-dual-ring`
  spinner (1.2s linear infinite). **Next**: expander `opacity:0.65; transition:opacity 150ms ease-in`; `:hover`
  → `opacity:1` (300ms ease-out).
- `.fancytree-custom-icon` — 1em×1em, `font-size:1.2em`, flex-centered; `color: var(--custom-color, var(--left-pane-icon-color))`; `margin-top:0` (aligns with caption). Fallback glyph "?".
- `.fancytree-title` — `flex:1; flex-basis:0; overflow:hidden; margin-inline-start:7px; outline:none`.
- `.note-indicator-icon` — clone/shared indicators (real DOM elements for tooltips): `font-family:boxicons; font-size:smaller; margin-inline-start:4px; opacity:0.8; cursor:help`. Clone `::before content:"\eb3d"` (bx-link-alt); shared `content:"\ec03"` (bx-share-alt, `opacity:0.5` when shown in tree). New-layout clone variant uses `\ed82` at `opacity:0.5`.
- `.tree-item-button` — hover-revealed row action buttons: `display:none; font-size:120%; cursor:pointer; margin-inline-start:8px; padding:1px; border:1px solid transparent; border-radius:5px` → `display:inline-block` on row hover (`.unhoist-button` stays visible); `:hover` dotted border `1px dotted var(--main-text-color)`. **Next**: row action buttons and the selected-row custom icon become circular chips: `margin-inline-end:6px; border:unset; border-radius:50%; background: var(--left-pane-item-action-button-background); color: var(--left-pane-item-action-button-color)`; `:hover` → `-hover-background` + `-hover-shadow`; on active-row hover → `--left-pane-item-selected-action-button-hover-shadow`. Selected rows: icon `font-size:.65em`; hovering the row (not the icon) runs `bulk-action-button-blink` (opacity 1↔.3, 500ms linear alternate infinite).
- `.add-note-button` — hidden until row hover.

### 2.3 Selection / active / hover states (Next)
- `span.fancytree-node:hover { background: var(--left-pane-item-hover-background) }`.
- Active: `.fancytree-node.fancytree-active` → `position:relative; background:transparent; color: var(--custom-color, var(--left-pane-item-selected-color))`; a `::before` (z-index -1) paints the rounded selected background `var(--custom-bg-color, var(--left-pane-item-selected-background))` inset by `--left-pane-item-selected-shadow-size` (2px; 4px when also selected), `border-radius:6px; box-shadow: var(--left-pane-item-selected-shadow); animation: left-pane-item-select 200ms ease-out`. Active title `font-weight:normal` (vs base bold).
- Selected (ctrl/cmd multi-select): `.fancytree-node.fancytree-selected` sets `--left-pane-item-selected-shadow-size:4px`; its `::after` (z-index -2) fills `inset:0; background: var(--selection-background-color)` (`#3399FF70` in both Next themes) with a 100ms fade.
- Protected node: `.fancytree-node.protected > .fancytree-custom-icon:after` overlays a lock glyph `content:"\eb4a"; font-size:14px; font-family:boxicons; bottom:0; inset-inline-end:0; transform:translateX(25%); background: var(--left-pane-background-color); border-radius:50%` (RTL: `translateX(-25%)`). Base (tree.css) instead applies `filter: drop-shadow(2px 2px 2px var(--main-text-color))` on the icon; selected protected nodes hide the lock.
- Label CSS classes: `.underline`, `.dotted`, `.bold` on title; `.muted` and `.archived` `opacity:0.6`.
- `#context-menu-container { --menu-item-icon-vert-offset: -1px }` (tree context menu).
- `.fancytree-node.fancytree-menu-target { box-shadow: inset 0 0 0 1px var(--main-border-color) }`.

### 2.4 Drag & drop markers
`#fancytree-drop-marker.fancytree-drop-after/before`: `width:100px; position:absolute !important; height:0`.
- Line: `::before { content:""; position:absolute; inset-inline:0; top: calc(-1px + var(--drop-marker-shift)); height:2px; border-radius:1px; background: var(--muted-text-color) }`.
- End cap: `::after { position:absolute; inset-inline-start:-2px; top: calc(-4px + var(--drop-marker-shift)); width:8px; height:8px; border:2px solid var(--muted-text-color); border-radius:50%; background: var(--main-background-color) }` (hollow ring).
- `--tree-drop-marker-shift` is measured per row by `publishDropMarkerShift()` in `note_tree.ts`; "drop-before" uses the negated shift.

### 2.5 Tree actions toolbar (floating, bottom-right of the tree) — Next
Tokens (`base.css`): `--tree-actions-toolbar-horizontal-margin:8px; -vertical-margin:8px; -padding-size:4px; -collapsed-width:40px; -expand-button-size:25px`.
- Collapsed `.tree-actions`: `max-width:40px; inset-inline-end:8px; bottom:8px; overflow:hidden; border:1px solid transparent; padding:4px; padding-inline-end:40px; background:transparent;` with 400ms ease-out transitions on max-width/background/border.
- Expanded (`.tree-actions:hover`): `max-width:200px; border-color: var(--dropdown-border-color); background: var(--menu-background-color); backdrop-filter: blur(10px) saturate(6); box-shadow: 0 5px 10px rgba(0,0,0,var(--dropdown-shadow-opacity))`.
- Buttons inside: `border:unset; color: var(--menu-item-icon-color); opacity:0` when collapsed; on toolbar hover `opacity:1` (250ms ease-in); button `:hover` → `var(--hover-item-background-color)`.
- Floating expand button `.tree-actions::after`: glyph `content:"\eab4"; font-size:18px; width/height:25px; border-radius:50%; background: var(--left-pane-item-action-button-background); color: var(--left-pane-item-action-button-color); backdrop-filter: blur(10px); box-shadow: 2px 2px 6px var(--left-pane-background-color); position:absolute; top:50%; transform:translateY(-50%);` horizontally centred in the 40px collapsed strip. Expanded: transparent bg, `color: var(--menu-item-icon-color)`, `opacity: var(--menu-item-disabled-opacity)`.
- Tree settings popup `.tree-settings-popup`: `border:1px solid var(--dropdown-border-color); padding:25px; background: var(--menu-background-color); backdrop-filter: blur(10px) saturate(6); box-shadow: 0 10px 20px rgba(0,0,0,var(--dropdown-shadow-opacity))`; heading `h4 { margin-bottom:.75em; font-size:1.5em; line-height:1 }`.

## 3. Tab bar

Sources: `widgets/tab_row.ts`, `theme-next/shell.css` §TAB BAR, `style.css`, `base.css`.

### 3.1 Sizing constants (tab_row.ts)
- `TAB_CONTAINER_MIN_WIDTH = 100`, `TAB_CONTAINER_MAX_WIDTH = 240`, `MARGIN_WIDTH = 5`.
- `SCROLL_BUTTON_WIDTH = 36`, `NEW_TAB_WIDTH = 36`.
- `MIN_FILLER_WIDTH = 50` (desktop) / `15` (mobile).
- Size states: `TAB_SIZE_SMALL = 84`, `TAB_SIZE_SMALLER = 60`, `TAB_SIZE_MINI = 48` (attributes `is-small` / `is-smaller` / `is-mini` set on the tab element).

### 3.2 Geometry (Next)
- `--tab-bar-height: 50px` (`base.css`); **horizontal layout overrides to 44px** (`shell.css` `body.layout-horizontal`). Tab height `--tab-height: 36px`.
- `#rest-pane > div.component:first-child { height: var(--tab-bar-height) !important }`; `.tab-row-widget, .tab-row-container { background: transparent !important; height: var(--tab-bar-height) !important }`.
- `.tab-row-widget-container { height: var(--tab-height) !important }`.
- Vertical layout vertically centres the 36px tabs in the 50px bar: `body.layout-vertical .tab-row-widget > * { margin-top: calc((var(--tab-bar-height) - var(--tab-height)) / 2) }`.
- Horizontal layout top-aligns: `body.layout-horizontal .tab-row-container { padding-top: calc(var(--tab-bar-height) - var(--tab-height)) }`; `body.layout-horizontal .tab-row-widget, .tab-row-widget-container { margin-top:0; position:relative; overflow:hidden }`.
- Toggle (left-pane collapse) button: `.tab-row-container .toggle-button { --icon-button-size:30px; --icon-button-icon-ratio:.6; margin: 3px 6px auto 8px !important }`.
- Borders: `body.layout-horizontal .tab-row-container { border-bottom: 1px solid var(--launcher-pane-horiz-border-color) }`; `body.layout-vertical.electron.platform-darwin .tab-row-container { border-bottom: 1px solid var(--subtle-border-color) }`.
- Linux native title bar heights follow the tab bar centre line (shell.css comment: 3 + 30/2 = 18 → `--native-titlebar-height: 36px` vertical / `52px` horizontal).

### 3.3 Tab element structure (TAB_TPL in tab_row.ts)
```
.note-tab [data-ntx-id]        (position:absolute; width set per-tab by JS; attrs: active, pinned, is-small, is-smaller, is-mini)
└─ .note-tab-wrapper          (absolute; flex; height 36px; padding 7px 5px 7px 11px; border-radius 8px; overflow hidden; pointer-events all; bg var(--tab-background-color, --inactive-tab-background-color))
   ├─ .note-tab-drag-handle  (absolute inset; z-index 50 — the full-tab interaction layer)
   ├─ .note-tab-icon         (note type icon; base margin-end 3px; Next 5px; active → --active-tab-icon-color)
   ├─ .note-tab-title        (flex:1; ellipsis; contains .note-tab-segment spans for multi-split titles)
   ├─ .note-tab-pin-indicator (bx bx-pin; 22px square; display:none unless [pinned]; pointer-events none)
   └─ .note-tab-close        (bx bx-x; 22px circle; hidden when [pinned])
```
Row also contains: `.tab-scroll-button-left` / `.tab-scroll-button-right` (hidden by default),
`.tab-row-widget-scrolling-container > .tab-row-widget-container` (holds tabs + `.tab-row-container-anchor`
(36px-tall invisible click target that follows the tab group)), `.note-new-tab`, `.tab-row-filler`
(`min-width:50px; flex-grow:1; -webkit-app-region: drag`; hidden on mobile).

### 3.4 Tab colors / states (Next tokens)
- Inactive: bg `--inactive-tab-background-color` (transparent both themes); text `--inactive-tab-text-color`
  (dark `#7c7c7c`, light `#4e4e4e`); hover bg `--inactive-tab-hover-background-color` (dark `#ffffff0f`, light `#00000016`).
- Active: base applies `font-weight:bold`; **Next** overrides `font-weight: unset !important`; bg
  `--active-tab-background-color` (dark `#ffffff1c`, light `white`); text `--active-tab-text-color`
  (dark `#ffffffcd`, light `black`); `box-shadow: var(--active-tab-shadow)`; transitions bg 150ms ease-out / shadow 300ms ease-out; `z-index:5`.
- `--active-tab-shadow` dark: `3px 3px 6px rgba(0,0,0,.2), -1px -1px 3px rgba(0,0,0,.4)`; light:
  `3px 3px 6px rgba(0,0,0,.1), -1px -1px 3px rgba(0,0,0,.05)`. Dragging adds `--active-tab-dragging-shadow`
  (base shadow + `0 0 20px rgba(0,0,0,.4 / .1)`).
- `.note-tab .note-tab-wrapper::after` — a 3px top strip `background: var(--workspace-tab-background-color)`
  (workspace tab colour from the hoisted note; `.note-tab .note-tab-wrapper { --tab-background-color: initial !important }` so the theme token wins).
- Horizontal layout (chrome-style): `.note-tab-wrapper { border:1px solid transparent; border-bottom-color:transparent; box-shadow:unset }`; active tab `border:1px solid var(--launcher-pane-horiz-border-color); border-bottom-color:transparent`; bottom radii 0.
- Size-state behaviour: `[is-small]` removes the title start margin; `[is-smaller]` close button `margin-inline-start:auto`; `[is-mini]` wrapper padding 2px, non-active mini hides the close button, active mini centres it.
- Split segments: `.note-tab[active] .note-tab-segment:not(.note-tab-segment-active) { opacity:0.55; font-weight:normal }`.
- Just-added animation: `.note-tab-was-just-added { top:10px; animation: note-tab-was-just-added 120ms forwards ease-in-out }` (slides down to top:0).
- Dragging: `.tab-row-widget-is-sorting .note-tab.note-tab-is-dragging .note-tab-wrapper { transform: scale(0.85); box-shadow: var(--active-tab-dragging-shadow) !important }`; drag handle `cursor: grabbing`.

### 3.5 New-tab button
- Base: `.note-new-tab { display:flex; align-items:center; justify-content:center; flex:0 0 36px; height:36px; padding:1px; font-size:24px; cursor:pointer }` content "+".
- **Next** re-skins it as a circular button: `--new-tab-button-size: 24px` (base.css). `.note-new-tab::before`
  draws a 24px circle `border-radius:50%; background: var(--new-tab-button-background)` (dark `#fff0`, light
  `#d8d8d8`), centred in the 36px box; `::after` draws the close glyph `content:"\ebc0"; font-family:boxicons;
  font-size: calc(var(--new-tab-button-size)*0.75); color: var(--new-tab-button-color)` (dark `#ffffff96`,
  light `#3a3a3a`) centred. `:hover` → `--new-tab-button-hover-background` (+ white/black text) +
  `--new-tab-button-shadow`; `:active` → both pseudo-elements `transform: scale(0.85)` (75ms).
  `margin-inline-start: 3px`; original "+" hidden via `color:transparent`.

### 3.6 Overflow scroll buttons
`.tab-scroll-button-left/right`: `display:none; flex:0 0 36px; height:36px; padding:1px; cursor:pointer`.
Left `color: var(--active-tab-text-color); box-shadow: inset -1px 0 0 0 var(--main-border-color)`;
right mirrored `inset 1px 0 0 0`. `.disabled` → `color: var(--inactive-tab-text-color); box-shadow:none;
pointer-events:none`. Shown (via `setScrollButtonVisibility`) whenever `(100+5)*tabCount > availableWidth`;
clicking scrolls the container ±210px (`behavior:"smooth"`). Wheel over the bar auto-scrolls horizontally.

### 3.7 Behaviour (tab_row.ts)
- **Middle-click closes a tab**: `mousedown` on `.note-tab` with `e.which === 2` →
  `tabManager.removeNoteContext(ntxId)`. (Middle-click on the *tree* opens the note in a new tab — `note_tree.ts`.)
- **Reorder**: one Draggabilly per tab (`axis:"x"`, `handle:".note-tab-drag-handle"`, containment = tab
  container). During `dragMove` the tab follows the pointer (clamped to the container) and live reorders to the
  nearest slot via `animateTabMove` (fires `tabReorder`); pinned/unpinned zones enforced by
  `clampDragDestination`. On `dragEnd` the tab animates back to its laid-out slot (120ms ease-in-out) and the
  layout is re-run. Edge hovering auto-scrolls ±105px.
- **Drag to new window**: in `dragMove`, `Math.abs(moveVector.y) > 100` on a non-pinned tab →
  `triggerCommand("moveTabToNewWindow")`.
- `staticClick` (no movement) → `activateTabContext(ntxId)` (restores the tab's remembered last-focused split).
- Right-click context menu: Pin/Unpin, Close, Close other tabs, Close right tabs, Close all tabs,
  Reopen last tab, Move tab to new window, Copy tab to new window.
- Tab title = composite of all splits in the tab, joined by `TAB_TITLE_SEPARATOR` (•), focused split
  emphasised; the full HTML string is kept on `data-tab-title` and read live by the handle's Bootstrap
  tooltip. Close button has its own tooltip. Both: `placement:bottom`, `delay.show:500`, html, container
  `<body>`. Tooltips are disabled for the whole drag to avoid stranded popovers.
- Workspace tint: `updateTab` sets `--workspace-tab-background-color` on the wrapper from the hoisted note's
  `workspaceTabBackgroundColor` and adds the note's type/mime CSS classes.

### 3.8 Electron / window-controls plumbing (style.css + shell.css)
- `#tab-row-left-spacer` is a drag region. macOS: `body.electron.platform-darwin #tab-row-left-spacer { width: env(titlebar-area-x) }` (rooms the traffic lights exactly where the OS draws them).
- Non-macOS Electron: `body.electron:not(.platform-darwin) .tab-row-container { padding-inline-start: env(titlebar-area-x,0px); padding-inline-end: calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,100vw)) }` (clears the Window Controls Overlay on whichever side the desktop puts it).
- `body.electron.platform-darwin:not(.native-titlebar) .tab-row-container { padding-inline-start: 1em }`.
- Drag regions in Next: `-webkit-app-region: drag` on `body.layout-horizontal .tab-row-container`,
  `body.layout-vertical .tab-row-widget`, `body.layout-vertical #left-pane .quick-search`; all direct
  children set `no-drag`.
- `.tab-row-widget { contain: inline-size }`.

## 4. Toolbars / note header

### 4.1 Quick search box (top of left pane)
Sources: `widgets/quick_search.ts` (markup + embedded classic styles), `theme-next/shell.css` §QUICK SEARCH BOX.
- Markup: `.quick-search.input-group.input-group-sm` containing
  `.input-group-prepend > button.btn.btn-outline-secondary.search-button (bx bx-search)` +
  `.dropdown-menu.tn-dropdown-list` (`.quick-search-results` + `.quick-search-footer` with a "show in full search"
  link), and a CodeMirror field `.form-control.form-control-sm.search-string` (single-line).
- Classic embedded styles: box `padding:10px; height:50px`; dropdown menu `max-height:80vh; min-width:400px;
  max-width:720px; box-shadow:-30px 50px 93px -50px black`; items `padding:12px 16px; line-height:1.4` with a
  1px delimiter line between; result title weight 500; attribute snippet `.75em` at opacity .5; content snippet
  `.85em` on `--accented-background-color`; highlighted terms underlined via `--note-list-view-search-result-*`
  vars; fuzzy matches `color: var(--quick-search-result-fuzzy-highlight-color)` (dark `#efb075`, light
  `#e47b19`) dotted underline. Pagination: initial batch 15, "load more" 10 at 50px from bottom.
- **Next** restyle (shell.css): box `flex-direction:row-reverse; align-items:center; height:unset;`
  padding 8px all sides; the visible rectangle is `::before` `border:2px solid transparent; border-radius:6px;
  background: var(--quick-search-background)` (dark `#ffffff12`, light `#00000012`); hover →
  `--quick-search-hover-background`; focus-within → `border-color: var(--quick-search-focus-border); background:
  var(--quick-search-focus-background)`. Input is transparent, `padding-inline-start:15px`.
  Search button: `25×25` circle, `margin-inline-end:8px`, colour `--quick-search-color`
  (dark `#ffffff52`, light `#06060682`); with a value present it flips to the light chip
  (`--left-pane-item-action-button-background` + `-color`), hover → `-hover-background`. Items `padding:8px 12px`.

### 4.2 Classic ribbon (tab strip + action bodies)
Source: `widgets/ribbon/Ribbon.css` (+ `theme-next/shell.css` §RIBBON & NOTE HEADER).
- `.ribbon-container { margin-bottom:5px; position:relative; z-index:998 }`; when the content header floats it
  becomes `position:sticky; top: var(--content-header-height, 100px)`.
- Top row `.ribbon-top-row { display:flex; min-height:36px }` holding the centered tab strip
  `.ribbon-tab-container { display:flex; flex-direction:row; justify-content:center; margin-inline-start:10px; flex-grow:1; flex-flow:row wrap }`.
- `.ribbon-tab-title`: `color: var(--muted-text-color); border-bottom:1px solid var(--main-border-color);
  min-width:24px; flex-basis:24px; max-width:max-content; flex-grow:10; font-size:0.9em; padding-top:2px;
  display:flex; align-items:center`. Active tab: `color: var(--main-text-color); border-bottom:3px solid
  var(--main-text-color); white-space:nowrap; ellipsis`; first tab gets `padding-inline-start:10px`. Tab icons
  `font-size:150%`.
- `.ribbon-tab-spacer`: `flex-basis:0; min-width:0; max-width:35px; flex-grow:1; border-bottom:1px solid
  var(--main-border-color)`; last spacer `max-width:10000px` (pushes the strip centred).
- `.ribbon-body { border-bottom:1px solid var(--main-border-color); margin:0 5px 0 10px }`, shown only when
  `.active`.
- New layout disables the strip: `body.experimental-feature-new-layout .ribbon-top-row { min-height:0 }`,
  `.ribbon-container { display:flex; flex-direction:column-reverse; border:0 }` and all tab/body borders removed.
- Classic formatting toolbar: `#rest-pane > .classic-toolbar-widget { margin-bottom:2px;
  border-start-start-radius: var(--note-split-top-border-radius) (vertical) }`; bg
  `--classic-toolbar-vert-layout-background-color` (dark `#ffffff0d`, light `#ffffffa1`) or
  `--classic-toolbar-horiz-layout-background-color` (= main background). When visible it zeroes
  `--note-split-top-border-radius`.

### 4.3 Note header (title row + actions)
Sources: `widgets/layout/TitleRow.css`, `widgets/ribbon/NoteActions.tsx/.css`, `theme-next/shell.css` §NOTE TITLE.
- Row: `.title-row.note-split-title` FlexContainer(row) with `.title-row > * { margin:5px }` (JS cssBlock).
  Desktop padding `padding-inline-end:3px` (aligns the "create new split" button under the ⋯ menu button).
- Compact variant `.title-row.tn-title-row-compact`: `height:32px; min-height:unset`; `.note-icon-widget`
  flex-centered 32px tall, `margin-inline-end:8px`; title input `--note-title-padding-inline:0`; icon + title
  `font-size:1em`.
- Note icon button (`.note-icon-widget button.note-icon`): `border:none; border-radius:8px`; hover →
  `--icon-button-hover-background/-color`; `.show` (dropdown open) →
  `--ck-editor-toolbar-dropdown-button-open-background`; icon popup items 8px radius.
- Title input (`.note-title-widget input`): `--input-background-color: transparent; border-radius:8px;
  padding-inline-start:12px`. Base metrics `--note-title-size:18px`, `--note-icon-size:16px` (6px icon padding)
  from `widgets/note_title.css`; container <600px: title 1.25rem, badges become 2em icon-only squares and are
  hidden while the title is focused.
- **Classic** header actions (`ribbon-button-container`, NoteActions.css): `display:flex;
  border-bottom:1px solid var(--main-border-color); margin-inline-end:5px; align-items:center; height:36px;
  gap:10px`. Contents (classic): `.note-actions` (35×35, dropdown `min-width:15em`) with the vertical-dots menu
  button `bx bx-dots-vertical-rounded`, plus a Revisions button (`bx bx-history`).
- **New layout**: `body.experimental-feature-new-layout .ribbon-button-container` → `border-bottom:0; margin:0;
  --button-gap:5px; gap:var(--button-gap)`; `.note-actions-custom` (custom note actions) `display:flex;
  align-items:center; height:36px; gap:5px`, last button `margin-inline-end:.5em`. Order:
  NoteActionsCustom, MovePaneButton(left/right), ClosePaneButton, CreatePaneButton.
- Note menu button (new layout): `bx bx-dots-horizontal-rounded`; `.note-actions { --menu-item-icon-vert-offset: -2.5px }`.
  Menu contents (`NoteActions.tsx`): code-properties (word wrap on/off/auto), read-only "Edit note",
  Find in note, Attachments, Note map (new layout), Attributes (mobile), Basic properties block (new layout:
  Shared / Protect / Bookmark toggles, Note type, Editability, Template, Full content width toggles),
  Import/Export (+ PNG/SVG for mermaid/mindMap, XLSX/CSV for spreadsheet), Print/PDF,
  Revisions / Save revision / Save named revision, Convert to attachment, Re-render, Board properties,
  **Advanced** submenu (open externally, open custom, source view, convert format, compress images, OCR text,
  open on server, dev-only items), Delete note (destructive `bx bx-trash`).

### 4.4 Floating buttons (classic only)
`.floating-button` overlay at the note edge; tokens: `--floating-button-background-color` (dark `#494949d2`,
light `#eaeaeacc`), hover `--floating-button-hover-background` + white/black, shadow `--floating-button-shadow-color`,
show/hide mini-buttons styled from the left-pane action-button tokens. Show on hover of the content edge; hide
button `.floating-button-hide-button` (`--floating-button-hide-button-background/-color`).

### 4.5 Note badges (new layout, in title row)
`NoteBadges` renders `<div class="note-badges">` (see §4.x below for full spec).

## 4.x NoteBadges & NoteTitleActions (new-layout items)

### 4.x.1 `NoteBadges` (`widgets/layout/NoteBadges.tsx` + `.css`)
Rendered **only** when `body.experimental-feature-new-layout` (desktop_layout.tsx `.optChild(isNewLayout, <NoteBadges/>)`;
also a child of `TitleRow` via `isNewLayout`). Classic layout shows the same component in the title row; the new
layout places it between title and actions.

- Container `.note-badges { display:flex; gap:5px; min-width:0; flex-shrink:1; overflow:hidden; --badge-radius:12px }`.
- Badge order (fixed): `SaveStatusBadge` → `ReadOnlyBadge` → `OfficePreviewBadge` → `ShareBadge` →
  `ClippedNoteBadge` → `ExecuteBadge` → `SnippetBadge` → `ActiveContentBadges`.
- Base badge token (theme-next `base.css` L286, applies to Bootstrap `.badge`):
  `--bs-badge-color: var(--badge-text-color)` (i.e. `--muted-text-color`), `--bs-badge-font-weight:500`,
  `background: var(--badge-background-color)`, `text-transform:uppercase; letter-spacing:.2pt`.
- Per-type colour hook (NoteBadges.css): each variant sets `--color` to a dedicated token:

| Badge class | Token | Dark value | Light value |
|---|---|---|---|
| `.temporarily-editable-badge` | `--badge-temporaraily-editable-background-color` ⚠ (token name has this exact typo) | `#297331` | `#35a64c` |
| `.read-only-badge` | `--badge-read-only-background-color` | `#af4340` | `#c8302c` |
| `.office-preview-badge` | `--badge-office-preview-background-color` | `#3f5470` | `#566d87` |
| `.share-badge` | `--badge-share-background-color` | `#4d4d4d` | `#6b6b6b` |
| `.clipped-note-badge` | `--badge-clipped-note-background-color` | `#295773` | `#2284c0` |
| `.doc-url-badge` | `--badge-doc-url-background-color` | `#1e5c42` | `#2e7d5e` |
| `.execute-badge` | `--badge-execute-background-color` | `#604180` | `#7b47af` |
| `.snippet-badge` | `--badge-snippet-background-color` | `#4d4d4d` | `#6b6b6b` |
| `.active-content-badge` | `--badge-active-content-background-color` | `rgb(12,68,70)` | `rgb(27,164,168)`; `.disabled { opacity:.5 }` |

- `.save-status-badge`: states `saved | saving | unsaved | error`; default `opacity:.4`
  (`--default-opacity`), `transition:opacity 250ms ease-in`, text `--main-text-color`;
  `.error` → `--dropdown-item-icon-destructive-color` + `opacity:1`; `.saved` → `fadeOut` keyframe
  (opacity `.4→0`) `250ms ease-in 5s forwards` + `pointer-events:none` ("Saved ✓" blip disappears after 5 s);
  motion-safe override `body#trilium-app.motion-disabled` → `fadeOut 0s 5s`.
  Icons: `bx bx-check` / `bx bx-loader bx-spin` / `bx bx-pencil` / `bx bxs-error`.
- Inside badges (`.ext-badge`): `min-width:0`; `.text` gets `overflow:hidden; text-overflow:ellipsis; min-width:0`;
  share toggle switch `--switch-track-height:8px; --switch-track-width:30px`.
- Zen mode hides all badges except read-only: `body.zen .note-badges > *:not(.read-only-badge) { display:none }`
  (style.css L2460). Mobile compact (<600px): badges become square icon-only `--size:2em` and are hidden while the
  title input is focused.

### 4.x.2 `NoteTitleActions` (`widgets/layout/NoteTitleActions.tsx` + `.css`)
Also gated on `body.experimental-feature-new-layout`. Renders `<div class="title-actions">` containing, in order:
`PromotedAttributes` (collapsible; keyboard event `toggleRibbonTabPromotedAttributes`), `SearchProperties`
(search-type notes only, collapsible "Search parameters"), `EditedNotes` (collapsible `.edited-notes`, shown when
the `dateNote` label exists; body `display:flex; flex-wrap:wrap; gap:.3em` of `.badge` note-links, hover →
`--link-hover-background/-color`), and `NoteTypeSwitcher` (default view mode only).

`.title-actions` (new layout): `display:flex; width:100%; max-width: var(--max-content-width); flex-direction:column;
gap:.5em; padding-inline: var(--content-margin-inline)` (indirection through `--title-actions-padding-start/end`);
`padding-block:.75em` when not empty; centred (`margin-inline:auto`) under `body.prefers-centered-content` when
not `.full-content-width`; on desktop the collapsibles/switcher get `padding-inline: calc(24px − var(--title-actions-padding-*))`
so they align with the 24px-guttered title row.

### 4.x.3 `Breadcrumb` (`widgets/layout/Breadcrumb.tsx` + `.css`)
Used by the status bar (new layout) and the mobile header.
- `.breadcrumb { position:relative; display:flex; margin:0; font-size:.9em; gap:.25em; flex-wrap:nowrap; overflow:hidden; --badge-radius:6px }`.
- `.badge-hoisted` (hoisted-note marker): `--color: var(--input-background-color)`, text `--main-text-color`.
- Links `a.tn-link`: `color: var(--custom-color, inherit)`; ellipsis; hover bg `--icon-button-hover-background`.
- `.archived` segment: `opacity:.6`.
- Segments (`> span, > span > span`): flex `min-width:0`; separator `.tn-icon { margin-inline:6px }`; inner `a`
  block `max-width:150px; flex-shrink:2; ellipsis; font-weight:normal; no underline`.
- Last segment `a`: `max-width:300px; flex-shrink:1`; `.breadcrumb-last-item` (and dropdown items) `max-width:300px;
  ellipsis; color: var(--custom-color, inherit) !important`; last-item link `font-weight:600`, no underline.
- Dropdown child list (`ul.breadcrumb-child-list`): column, no list markers, leading icon `opacity:.75`.
- Editable crumbs: `input { padding:0 10px; width:200px }`. Trailing `.filler { flex-grow:1; height:23px }`.
- Separator `.icon-action.breadcrumb-separator { font-size:.9rem; transform:translateY(8%) }`, glyph `::before`
  at `opacity:.75`.
- Inside the status bar row the breadcrumb gets `flex-grow:1; --icon-button-size:23px` (StatusBar.css L16–19).

## 5. Status bar (new layout only) + theme token summary

### 5.1 Status bar — structure
Source: `widgets/layout/StatusBar.tsx` + `StatusBar.css`. Exists **only** under
`body.experimental-feature-new-layout`; the classic layout has no status bar (note info lives in the ribbon /
floating buttons). It is the last child of `#rest-pane` (vertical layout) or of the root row (horizontal layout).

```
.status-bar  [cls +status-bar-panel-open when a bottom panel is open]
├─ .bottom-panel.attribute-list        (optional, when attributesShown; CKEditor mounted lazily on first open)
├─ .bottom-panel.similar-notes-pane    (optional, when similarNotesShown)
└─ .status-bar-main-row
   ├─ .breadcrumb                      (flex-grow:1)
   └─ .actions-row                     (flex, gap .1em, padding .1em)
      ├─ CodeNoteSwitcher              (code notes only; mime list + type switch)
      ├─ TabWidthSwitcher              (code notes only; spaces/tabs, widths 1/2/3/4/6/8, reindent)
      ├─ LanguageSwitcher              (text notes only; locale list)
      ├─ NotePaths                     (non-hidden notes; "N locations" dropdown)
      ├─ AttributesButton              (toggles the attributes bottom panel)
      ├─ AttachmentCount               (only when count > 0; triggers showAttachments)
      ├─ BacklinksBadge                (only when count > 0; 300–500px dropdown)
      └─ NoteInfoBadge                 (info dropdown)
```

Buttons: `.btn.select-button.focus-outline` with `<Icon>&nbsp;<span class="text">`; `padding:0 .5em !important;
background:transparent; border:0; display:flex; align-items:center`; hover/active/dropdown-open/focus →
`background: var(--input-background-color)`; `.status-bar-dropdown-button::after { content:unset }` (no arrow).
Dropdowns open **upward**: `placement:"top"`, `strategy:"fixed"`, no animation. `.dropdown-note-info { padding:1em }`;
`.dropdown-note-paths .note-paths-widget { padding:.5em }`; `.dropdown-backlinks { min-width:300px; max-width:500px;
max-height:60vh; overflow-y:auto; --menu-padding-size:.9em }`.

### 5.2 Status bar CSS metrics
- `.status-bar-main-row { min-height:28px; display:flex; align-items:center; background:
  var(--left-pane-background-color); padding-inline:.25em; font-size:.85em }`; in the horizontal layout it gains
  `border-top:1px solid var(--main-border-color)`.
- `.attribute-list` (bottom panel body): `font-size:.9em`; label `.attributes-panel-label { opacity:.5;
  margin-inline-end:4px; font-weight:600 }`; editor `padding-inline:0 100px`; errors `padding:4px 0;
  color: var(--dropdown-item-icon-destructive-color); font-style:italic`.
- Note-info value list (new layout): `--row-block-margin:.2em`; `list-style:none; display:table`; `li { display:table-row }`;
  `> strong { display:table-cell; padding:var(--row-block-margin) 0; opacity:.5 }`; `> span { display:table-cell;
  padding-left:2em; user-select:text }`.

### 5.3 Bottom panels (attributes / similar notes)
`.bottom-panel { margin:0 !important; padding:0 }`; horizontal-layout + background-effects → solid
`var(--right-pane-background-color)`.
- `.bottom-panel-title-bar { display:flex; padding:6px 12px; background: var(--bottom-panel-title-bar-background-color); align-items:center; gap:4px }`
  - caption `.bottom-panel-title-bar-caption { flex-grow:1; text-transform:uppercase; letter-spacing:.3pt; font-weight:600; font-size:.85em }`
  - `.status-bar-sidebar-link { display:flex; gap:4px; font-size:.85em }` — "edit in sidebar" link (`bx bx-sidebar` flipped, icon 1.2em), text underlines on hover; opens the right-pane tab in **peek** mode.
  - icon actions `.icon-action { --icon-button-size:24px; --icon-button-icon-ratio:0.8; border-radius:50% }` (`?` help + `×` close).
- `.bottom-panel-content { padding:8px 12px; background: var(--bottom-panel-background-color);
  border-bottom:1px solid var(--main-border-color); border-end-start-radius: var(--center-pane-border-radius);
  max-height:40vh; overflow-y:auto; animation: fade-in 200ms ease-in }`.
- Delimiter: `body.desktop.experimental-feature-new-layout .vertical-layout #center-pane .note-split {
  border-bottom:1px solid var(--status-bar-border-color) }`; the first visible split also gets
  `border-end-start-radius: var(--note-split-bottom-border-radius)` + `clip-path: inset(0 round 0 0 0 var(--note-split-bottom-border-radius))`
  on its scrolling container. While a panel is open (`status-bar-panel-open`) the split's bottom radius zeroes
  (shell.css L131), and when the left pane is hidden the top radius zeroes (L126).

### 5.4 Gutter
`.gutter { background: var(--gutter-color) !important; transition:background 150ms ease-out }`;
`:hover { background: var(--gutter-hover-color) !important; transition:background 300ms ease-in }`.
Values: both Next themes `--gutter-color: transparent`; hover dark `#626262`, light `#bfbfbf`. When the left
pane is collapsed a 2px `--left-pane-collapsed-border-color` border appears on the vertical launcher
(dark `#0009`, light `#0000000d`).

### 5.5 Geometry tokens (theme-next/base.css + shell.css)
| Token | Value |
|---|---|
| `--launcher-pane-vert-size` | 58px |
| `--launcher-pane-vert-icon-size` | 150% |
| `--launcher-pane-vert-button-margin` / `-gap` | 6px / 3px |
| `--launcher-pane-horiz-size` | 54px |
| `--launcher-pane-horiz-icon-size` | 20px |
| `--launcher-pane-horiz-button-margin` / `-gap` | 8px / 3px |
| `--tab-bar-height` | 50px (44px in `body.layout-horizontal`) |
| `--tab-height` | 36px |
| `--new-tab-button-size` | 24px |
| `--center-pane-border-radius` | 10px (`--note-split-bottom-border-radius` mirrors it) |
| `--overlay-button-border-radius` | 6px |
| `--tree-actions-toolbar-*` | margins 8px, padding 4px, collapsed width 40px, expand button 25px |
| `--dropdown-border-radius` | 10px (`:root`, shell.css) |
| `--dropdown-backdrop-filter` | blur(20px) saturate(6) |
| `--tooltip-border-radius` / `--tooltip-font-size` | 6px / 0.9rem |
| `--tooltip-box-shadow` | `-1px -1px 2px var(--tooltip-shadow-color), 2px 2px 8px var(--tooltip-shadow-color)` |
| `--left-pane-item-selected-shadow-size` | 2px |
| Native title bar (Linux) | 36px vertical / 52px horizontal |
| Note title metrics | `--note-title-size:18px`, `--note-icon-size:16px`, 6px icon padding |
| Compact title row | 32px |
| Ribbon top row / note actions row | 36px min-height / 36px height |

### 5.6 Theme tokens — Next DARK (`theme-next-dark.css`)
| Group | Token(s) | Value |
|---|---|---|
| Base | `--theme-style` | dark |
| Main | `--main-background-color` | #242424 |
| Main | `--main-text-color` | #ccc |
| Main | `--main-border-color` | #454545 |
| Main | `--subtle-border-color` | #313131 |
| Dropdowns | `--dropdown-border-color` | #404040 |
| Dropdowns | `--menu-text-color` / `--menu-background-color` | #e3e3e3 / #222222d9 |
| Dropdowns | `--menu-background-color-no-backdrop` | #1b1b1b |
| Left pane | `--left-pane-background-color` | #1f1f1f |
| Left pane | `--left-pane-text-color` / `--left-pane-icon-color` | #aaaaaa / #c5c5c5 |
| Left pane | `--left-pane-item-hover-background` | #ffffff0d |
| Left pane | `--left-pane-item-selected-background` / `-color` | #ffffff25 / #dfdfdf |
| Left pane | `--left-pane-item-selected-shadow` | 1px 1px 2px rgba(0,0,0,.6) |
| Launcher (vert) | `--launcher-pane-vert-background-color` / `-text-color` | #1a1a1a / #909090 |
| Launcher (vert) | `--launcher-pane-vert-button-hover-background` | #ffffff1c |
| Launcher (horiz) | `--launcher-pane-horiz-background-color` / `-text-color` | #282828 / #b8b8b8 |
| Launcher (horiz) | `--launcher-pane-horiz-border-color` | rgb(22,22,22) |
| Gutter | `--gutter-color` / `--gutter-hover-color` | transparent / #626262 |
| Tabs | `--active-tab-background-color` | #ffffff1c |
| Tabs | `--active-tab-text-color` / `--active-tab-icon-color` | #ffffffcd / #a9a9a9 |
| Tabs | `--inactive-tab-text-color` | #7c7c7c |
| Tabs | `--tab-close-button-hover-background` | #a45353 |
| Tabs | `--new-tab-button-background` / `-color` | #fff0 / #ffffff96 |
| Menus | `--menu-item-delimiter-color` / `--menu-item-keyboard-shortcut-color` | #ffffff1c / #ffffff8f |
| Inputs | `--input-background-color` | #ffffff12 |
| Inputs | `--input-focus-outline-color` | #ffffff57 |
| Links | `--link-color` | #95c3d9 |
| Quick search | `--quick-search-background` / `-color` | #ffffff12 / #ffffff52 |
| Quick search | `--quick-search-focus-border` | #80808095 |
| Quick search | `--quick-search-result-highlight-color` / `-fuzzy-highlight-color` | #a4d995 / #efb075 |
| Status bar | `--status-bar-border-color` | #ffffff17 |
| Bottom panel | `--bottom-panel-background-color` / `-title-bar-background-color` | #11111180 / #3F3F3F80 |
| Badges | `--badge-background-color` / `--badge-text-color` | #ffffff1a / var(--muted-text-color) |
| Text | `--muted-text-color` | #bbb |
| Selection | `--selection-background-color` | #3399FF70 |
| Scrollbars | `--scrollbar-thumb-color` / `-hover-color` | #fdfdfd5c / #ffffff7d |
| Tooltips | `--tooltip-background-color` / `-foreground-color` | rgba(67,67,67,.86) / #ffffffeb |
| Cards | `--card-background-color` / `-hover-color` | #ffffff12 / #ffffff20 |
| Mermaid | `--mermaid-theme` | dark |

### 5.7 Theme tokens — Next LIGHT (`theme-next-light.css`)
| Group | Token(s) | Value |
|---|---|---|
| Base | `--theme-style` | light |
| Main | `--main-background-color` | white |
| Main | `--main-text-color` | black |
| Main | `--main-border-color` | #dbdbdb |
| Main | `--subtle-border-color` | rgba(0,0,0,.1) |
| Left pane | `--left-pane-background-color` | #f2f2f2 |
| Left pane | `--left-pane-text-color` | #383838 |
| Left pane | `--left-pane-item-hover-background` / `--left-pane-item-selected-background` | rgba(0,0,0,.032) / white |
| Launcher (vert) | `--launcher-pane-vert-background-color` / `-text-color` | #e8e8e8 / #000000bd |
| Launcher (horiz) | `--launcher-pane-horiz-background-color` | #fafafa |
| Gutter | `--gutter-hover-color` | #bfbfbf |
| Tabs | `--active-tab-background-color` | white |
| Tabs | `--active-tab-text-color` / `--inactive-tab-text-color` | black / #4e4e4e |
| Tabs | `--tab-close-button-hover-background` | #c95a5a |
| Tabs | `--new-tab-button-background` / `-color` | #d8d8d8 / #3a3a3a |
| Menus | `--menu-text-color` / `--menu-background-color` | #272727 / #ffffffd9 |
| Menus | `--menu-background-color-no-backdrop` | #fdfdfd |
| Inputs | `--input-background-color` | #00000012 |
| Inputs | `--input-focus-outline-color` | #00000063 |
| Links | `--link-color` | #0076af |
| Quick search | `--quick-search-background` / `-color` | #00000012 / #06060682 |
| Quick search | `--quick-search-result-highlight-color` / `-fuzzy` | #c65050 / #e47b19 |
| Status bar | `--status-bar-border-color` | #00000026 |
| Bottom panel | `--bottom-panel-background-color` / `-title-bar-background-color` | #ffffff8c / #94949414 |
| Text | `--muted-text-color` | #666 |
| Selection | `--selection-background-color` | #3399FF70 |
| Scrollbars | `--scrollbar-thumb-color` / `-hover-color` | #0000005c / #00000066 |
| Tooltips | `--tooltip-background-color` / `-foreground-color` | rgba(0,0,0,.818) / #ffffffeb |
| Cards | `--card-background-color` / `-hover-color` | #0000000d / #0000001c |
| Mermaid | `--mermaid-theme` | default |

Shared by both Next themes: `--selection-background-color: #3399FF70`.

### 5.8 Classic dark tokens (reference)
`theme-dark.css` (Montserrat/JetBrainsLight): main bg #333, text #ccc, border #aaa, muted #bbb, menu bg #222;
left/launcher pane bg #1f1f1f text #aaaaaa; active tab bg #666 text #ccc; inactive tab bg #444 text #bbb;
selection #3399FF70; scrollbars #333/#666; links lightskyblue; buttons: transparent bg, 1px #ccc border,
radius 5px. Classic `#launcher-pane` is 53px (JS-set, not token-driven); Next themes override to 58/54px via
tokens. Classic has **no** status bar, no `--new-tab-button-size`, and tabs use the base `tab_row.ts` styles
directly (no chrome restyle).

## Appendix A — file map
| Area | File(s) |
|---|---|
| Shell composition | `apps/client/src/layouts/desktop_layout.tsx` |
| Launcher rail (JS) | `apps/client/src/widgets/launch_bar/LauncherContainer.tsx` |
| Global menu | `apps/client/src/widgets/buttons/global_menu.tsx` |
| Note tree (behaviour) | `apps/client/src/widgets/note_tree.ts` |
| Note tree (base CSS) | `apps/client/src/stylesheets/tree.css` |
| Tab bar (widget + constants) | `apps/client/src/widgets/tab_row.ts` |
| Quick search | `apps/client/src/widgets/quick_search.ts` |
| Note actions / ribbon | `apps/client/src/widgets/ribbon/NoteActions.tsx/.css`, `Ribbon.css` |
| Status bar | `apps/client/src/widgets/layout/StatusBar.tsx/.css` |
| Note badges | `apps/client/src/widgets/layout/NoteBadges.tsx/.css` |
| Title row / breadcrumb | `apps/client/src/widgets/layout/TitleRow.css`, `Breadcrumb.tsx/.css` |
| Next geometry tokens | `apps/client/src/stylesheets/theme-next/base.css` |
| Next shell metrics | `apps/client/src/stylesheets/theme-next/shell.css` |
| Next dark tokens | `apps/client/src/stylesheets/theme-next-dark.css` |
| Next light tokens | `apps/client/src/stylesheets/theme-next-light.css` |
| Classic dark tokens | `apps/client/src/stylesheets/theme-dark.css` |
| Classic layout plumbing | `apps/client/src/stylesheets/style.css` |

## Appendix B — caveats
- The repo is **TriliumNext**, not legacy Trilium: there is no `apps/web`; the client is `apps/client`.
- All of §4.x (NoteBadges, NoteTitleActions, FixedFormattingToolbar, RightPanelContainer, StatusBar) and the
  chrome-style tab restyle live behind the **experimental `new-layout` feature flag**. The classic experience is
  the default and has no status bar.
- Rail buttons are **data-driven** (launcher notes under `_lbVisibleLaunchers`), not hard-coded widgets; only
  the *types* they resolve to are fixed.
- Two theme generations coexist. Values above are the Next set; classic differs in fonts (Montserrat), launcher
  width (53px), tab styling (no circular new-tab button), and border radii (5px vs 6–10px).
- `--tab-bar-height` and tab geometry are CSS-var driven, so a replica can re-skin without touching the widget
  constants (100/240/36/5).
- Selection colour `#3399FF70` is identical across both Next themes and the classic themes.


