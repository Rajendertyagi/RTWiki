# RTWiki — Refined UI/UX Architecture Plan & Implementation Roadmap

> **Authoritative Specification Document**
> **Location:** `docs/UI_UX_PLAN.md`
> **Date:** September 25, 2026
> **Scope:** Full-app layout overhaul, Mantine v7 design token integration, TriliumNext compact pane geometry, themes, accessibility, and autonomous execution strategy.

---

## 1. Executive Summary & Design Vision

RTWiki's UI/UX is evolving from a basic functional layout into a **compact, highly dense, professional personal knowledge workspace** inspired by TriliumNext and powered by **Mantine v7**.

### Core Visual Principles:
1. **Zero Wasted Space**: Strict height chains where tab strip, formatting toolbars, title row, and status bar form a compact visual hierarchy with 0px overflow.
2. **Strict Component Boundary Separation**: 
   - **Text Formatting Toolbar**: Contains *only* rich text formatting controls (`B`, `I`, `U`, `S`, Headings, Lists, Code, Math, Diagram).
   - **Page Action Controls**: Placed cleanly in the page header/title row (`Duplicate`, `Delete`, `Favorite`, `Export`).
   - **Sidebar Search**: Integrated seamlessly at the top of the sidebar tree pane with **no bottom separator border line**.
3. **Mantine v7 Theme Token Discipline**: Single source of truth for color palette, surface elevation, and typography across Light, Dark, Catppuccin Mocha, and Nord themes.
4. **Trilium-Grade Status Bar**: Pinned at the viewport bottom displaying path breadcrumbs on the left, and metadata actions (Word/Char count, Backlinks popover, Outgoing links popover, Page Info, Save Status) on the right.

---

## 2. Architecture & Geometry Specs

Derived from `C:\Users\RTPC\.opencode\plan\trilium-uiux-spec.md` and `src/web/config/index.ts`:

```
┌───┬──────────────────────────────────────────────────────────────────────────┐
│ R │ Tab Strip Row (38px / 40px) [Distinct Surface: --mantine-color-dark-8]  │
├───┼──────────────────────────────────────────────────────────────────────────┤
│ A │ Formatting Toolbar Row (36px / 40px) [Surface: --mantine-color-dark-7]   │
│ I ├───┬──────────────────────────────────────────────────────────────────────┤
│ L │ T │ Editor Title & Action Row (40px)                                     │
│   │ R ├──────────────────────────────────────────────────────────────────────┤
│ 5 │ E │                                                                      │
│ 0 │ E │                                                                      │
│ p │   │ Editor Document Canvas (Flex-1 Scrollable)                           │
│ x │ 2 │                                                                      │
│   │ 5 │                                                                      │
│ w │ 0 │                                                                      │
│ i │ p │                                                                      │
│ d │ x │                                                                      │
│ e │   │                                                                      │
├───┴───┴──────────────────────────────────────────────────────────────────────┤
│ Status Bar (26px / 28px) [.status-breadcrumb + .status-actions-row]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Region | Width / Height | Background Token | Key Components |
|---|---|---|---|
| **Utility Rail** | `50px` width | `--bg-rail` (`#101113`) | Brand logo `R`, Pages, Search, Trash, Calendar, Theme, Settings |
| **Tree Sidebar** | `250px` width (resizable) | `--bg-sidebar` (`#141517`) | SearchInput (top, no bottom border), Root NavLink, Wunderbaum Tree |
| **Tab Strip** | `38px` height | `--mantine-color-dark-8` | Open Page Tabs, Active Blue Line, Close Button, `+` New Tab |
| **Formatting Toolbar** | `36px` height | `--mantine-color-dark-7` | Text formatting controls ONLY (B, I, U, S, H1-H3, Lists, Code, Math, Diagram) |
| **Editor Paper** | Flex-1 | `--bg-paper` (`#141517`) | BlockNote / CodeMirror / Mermaid canvas |
| **Status Bar** | `26px` height | `--bg-rail` (`#101113`) | Breadcrumb path (left), Words/Chars, Backlinks, Links, Info, SaveState (right) |

---

## 3. Theme Engine Expansion

RTWiki currently uses Mantine light/dark color scheme resolver in `src/web/theme/index.ts`. We are expanding this to support **4 distinct themes**:

1. **Catppuccin Mocha** (Default Dark - High Contrast)
   - Background: `#1e1e2e` | Surface: `#181825` | Crust: `#11111b` | Accent: `#89b4fa`
2. **Nord Dark** (Cool Minimal Slate)
   - Background: `#2e3440` | Surface: `#3b4252` | Crust: `#434c5e` | Accent: `#88c0d0`
3. **Mantine Dark** (Classic Studio)
   - Background: `#141517` | Surface: `#1a1b1e` | Crust: `#101113` | Accent: `#228be6`
4. **Mantine Light** (Clean Crisp Paper)
   - Background: `#ffffff` | Surface: `#f8fafc` | Crust: `#e2e8f0` | Accent: `#2563eb`

Theme selection will be stored in `layout-preferences.ts` and managed centrally via `AppShell`.

---

## 4. Implementation Steps & File Modifications

### Step 1: Update Configuration Tokens (`src/web/config/index.ts`)
- Update `LAYOUT.railWidth` to `50` (matching compact rail spec).
- Ensure `LAYOUT.statusBarHeight` is `26` and `LAYOUT.tabStripHeight` is `38`.

### Step 2: Refine Theme Tokens & CSS Variables (`src/web/theme/index.ts` & `customization.css`)
- Expand `rtwikiCssVariablesResolver` with theme palette variables for Catppuccin Mocha, Nord, Mantine Dark, and Mantine Light.
- Update `--rtwiki-row-height: 38px`, `--rtwiki-toolbar-height: 36px`, and `--rtwiki-statusbar-height: 26px`.

### Step 3: Polish Sidebar Component (`src/web/layout/sidebar.tsx` & `sidebar.module.css`)
- Remove the bottom border from `.searchSection` so search seamlessly blends into the tree pane top.
- Ensure 28px tree row density with SVG Tabler icons.

### Step 4: Isolate Workspace Formatting Toolbar (`src/web/features/pages/page-workspace.tsx`)
- Ensure `toolbarRow` contains *strictly* text formatting controls (BlockNote `RichToolbar` / CodeMirror tools).
- Confirm all file action buttons (`Duplicate`, `Delete`, `Export`) remain strictly inside `EditorHeader`.

### Step 5: Verify Status Bar Specs (`src/web/features/workspace/status-bar.tsx` & `status-bar.module.css`)
- Ensure breadcrumb path rendering on left and metadata buttons (Words, Backlinks popover, Links popover, Note Info popover) on right.

### Step 6: Verification & Quality Protocol
- Run `bun run typecheck` to confirm zero TypeScript errors.
- Run `bun test` to ensure all 460 tests pass.
- Run `bun scripts/verify-docs.ts` to confirm documentation link integrity.

---

## 5. Verification Checklist

- [x] AGENTS.md Protocol Reviewed & Enforced
- [x] TriliumNext Spec Sheet (`trilium-uiux-spec.md`) Analyzed & Applied
- [x] Zero duplicate or scattered CSS metrics
- [x] TypeScript Strict Mode clean (`bun run typecheck`)
- [x] All Unit & Integration Tests pass (`bun test`)
