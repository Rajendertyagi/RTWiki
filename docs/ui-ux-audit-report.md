# RTWiki UI/UX Audit Report & Implementation Plan

> Generated: 2026-09-24
> Scope: Read-only audit of current web application. No files were modified.

---

## Executive Summary

RTWiki is a local-first, offline note-taking workspace built on BlockNote + Mantine + Hono + Bun SQLite. The application has solid architecture (soft-delete infrastructure, autosave, search FTS, responsive layout) but significant UX gaps compared to established note-taking products (Obsidian, Notion, Trilium, Logseq).

**Top findings:**
1. Delete confirmation is misleading — data IS soft-deleted but the UI says "cannot be undone"
2. No tag system, no favorites, no trash view — organization scales poorly past ~30 notes
3. Editor has a visible border/frame that makes it look like a widget rather than the page itself
4. Toolbar overflows on narrow screens requiring horizontal scroll
5. No centralized keyboard shortcut documentation
6. Dark mode has insufficient depth contrast between layers

---

## 1. Current User Flow

| Action | Path |
|--------|------|
| Create note | Utility rail "+" → New Page dialog (type + template) → page opens in workspace → autosave begins |
| Find note | Utility rail "Search" icon → sidebar search box **or** Ctrl+K → Quick Finder modal (recent/title/content groups) |
| Organize notes | Sidebar tree → right-click context menu (new child/after, move, rename, duplicate, delete) → drag-and-drop reorder |
| Edit a note | Click page in tree → PageWorkspace mounts → editor-specific surface (BlockNote / CodeMirror / Mermaid) → toolbar above title → content area → status bar below |

---

## 2. Issues by Category

### Overall Information Architecture

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 1 | High | App-wide | No persistent top-level branding after first load. The utility rail is purely icon-only; new users have no textual anchor for what app they're in. | Add a compact text label "RTWiki" above or below the home icon in the rail, or show it on hover as a persistent tooltip with the app name. |
| 2 | Medium | Dashboard | The dashboard title "Pages" + count is buried under the tab strip with no clear separation from the editor chrome. At a glance it's unclear whether you're on the dashboard or inside a note. | Add a subtle visual distinction — a darker chrome bar behind the dashboard header, or a breadcrumb "Dashboard > Pages" in the status bar when on root. |
| 3 | Medium | App-wide | The tab strip has no visual separator from the main content area below it, making it hard to perceive where tabs end and content begins. | Add a 1px border-bottom to the tab strip matching `--rtwiki-border`, or increase the chrome contrast slightly. |

### Sidebar and Navigation

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 4 | High | Sidebar | The page tree has no empty-state guidance and no visible affordance for how to create the first root page besides right-clicking empty space. | Add a subtle "Right-click empty space to create" hint text at the bottom of the tree when empty, or add a "+" button in the tree header. |
| 5 | High | Sidebar | The search input in the sidebar has no visible clear button and no keyboard shortcut indicator. When results are empty, it shows "No pages match your search" but there's no way to quickly clear the search without clicking away. | Add an `X` clear button to the search input when a query is active, and bind Escape to clear + blur. |
| 6 | Medium | Sidebar | The tree "Root" entry uses an `IconHome` but the utility rail also has a home icon — two competing "go home" affordances with no visual differentiation. | Make the tree Root entry visually distinct (e.g., a house icon with a different style), or remove it entirely since the rail home button already exists. |
| 7 | Medium | Sidebar | The tree does have focus indicators on rows (`.wb-row.wb-focus` with blue inset shadow at line 176 of `page-tree.module.css`). Focus visibility is working. | Verified as working. No action needed. |

### Note Hierarchy and Organization

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 8 | Critical | App-wide | **No permanent trash/delete undo.** The delete confirmation dialog says "This action cannot be undone." However, the server **already implements soft-delete** (`deleted_at` column in migration 001, `softDeletePage()` in `page-repository.ts:176`). Data is preserved but completely invisible — there is no trash UI, no restore endpoint, and no way to recover. | Add a trash view accessible from the utility rail. Add restore and "delete permanently" actions. Update the delete confirmation text to reflect that deletion is reversible. |
| 9 | High | App-wide | **No tag system.** All organization is purely hierarchical tree position. Users with many notes will lose the ability to find related notes across different tree branches. | Add a lightweight tag system (freeform tags stored in page metadata) with a tag cloud view or filtered tree. |
| 10 | High | App-wide | **No favorites/starred.** Users cannot pin important pages to a persistent top-level collection regardless of tree position. | Add a star/favorite toggle on pages (editor header or tree context menu) and a "Favorites" section at the top of the tree or a separate rail icon. |
| 11 | Medium | Sidebar | No "note count per parent" in the tree. In a large hierarchy, it's impossible to gauge the size of a section at a glance. | Show a subtle count badge next to parent nodes (e.g., "Subject (12)"). |

### Note Editor Experience

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 12 | High | Rich Editor | **The BlockNote editor is wrapped in a visible bordered container** (`border: 1px solid`, `border-radius: md`) defined in `rich-editor.module.css:32-33`. This makes it look like a widget inside the page rather than the page itself. Modern note apps (Notion, Obsidian) render the editor as the full page content with no visible frame. | Remove the border and rounded corners from `.blockNoteWrapper`. Let the content fill the full workspace width with only subtle padding. |
| 13 | High | Rich Editor | **The toolbar is very wide and shows ALL formatting options at once.** On a typical 1280px window it overflows and requires horizontal scrolling (`.bar { overflow-x: auto; flex-wrap: nowrap }` at `rich-toolbar.module.css:52-56`). 12+ tools crammed into one row. | Group less-frequent actions (text color, highlight, alignment) into a "More" dropdown. Keep only the most common 6-8 actions visible at all times. Follow Notion's progressive disclosure pattern. |
| 14 | Medium | Rich Editor | The right sidebar (outline + backlinks) takes up 260px by default, which on a 1280px window leaves only ~700px for the editor — tight for a BlockNote document with a toolbar above. | Reduce the default right sidebar width to 220px, or make it collapsible by default with a one-click expand. |
| 15 | Low | Rich Editor | The block resize handles (for diagrams/mindmaps) are functional but the visual feedback during drag is minimal — no dimension readout or preview line. | Add a floating tooltip showing current dimensions (W×H) during resize. |
| 16 | Medium | HTML Editor | The HTML editor shows three tabs (HTML / CSS / JS) but there's no split-view option so users can see code and preview simultaneously. | Add a split-view option for the HTML editor. |

### Folders, Tags, Attributes, and Backlinks

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 17 | Critical | App-wide | **No tag system.** See issue #9. This is the single biggest organizational gap. | Implement tags as highest-priority organizational feature after trash. |
| 18 | Medium | Status Bar | Backlinks and outgoing links are shown as counts in the status bar but require hovering to see details. There's no persistent backlink panel. | Make the backlinks popover expandable to a full panel, or add a dedicated "Connections" tab in the right sidebar. |
| 19 | Low | Right Sidebar | The outline navigation in the right sidebar has no scroll-to-visible behavior guarantee when the outline entry is outside the current viewport. | Ensure clicking an outline entry scrolls the editor to that heading and keeps it in view. |

### Search and Command Palette

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 20 | High | Quick Finder | The Ctrl+K finder only searches within the local page collection. It has no command palette capability — you cannot trigger actions (create note, change theme, open settings) from it. | Expand the finder into a full command palette: `/` prefix or split mode (search vs. commands). |
| 21 | Medium | Quick Finder | The finder shows up to 6 results per group (recent/title/content) but there's no indication of how many total results exist. | Show a count footer: "12 results" or "Show all 47 pages". |
| 22 | Low | Quick Finder | Recent pages are persisted to localStorage (bounded to 20) via `src/web/util/recent-pages.ts`. This **does work across sessions** — the audit finding about "session-only" recents was incorrect. The limitation is that recents are not surfaced in the sidebar tree. | Expose the existing recent-pages data in a "Recent" section of the sidebar tree. |

### Daily Notes and Templates

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 23 | High | App-wide | No daily notes feature. While the calendar/study timetable exists, there's no automatic daily note creation or link-back to the calendar. | Add a "Daily Note" page type that auto-creates with today's date as the title and links to the calendar. |
| 24 | Medium | New Page Dialog | Templates exist (Blank, Subject, Chapter, Revision Sheet) but they're only available for Rich Notes. HTML and Markdown pages have no templates. | Extend templates to all page types. |
| 25 | Low | New Page Dialog | The template selection requires an extra click (open dialog → select template → create). Power users who always want blank notes must navigate this extra step. | Add a keyboard shortcut (e.g., Ctrl+N) that creates a blank note directly, bypassing the dialog. |

### Favorites, Recent Notes, and Trash

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 26 | Critical | App-wide | **No trash UI or restore.** See issue #8. | Add trash view + restore. |
| 27 | High | Sidebar | **No "Recent Notes" section in the sidebar.** The `recent-pages.ts` utility exists and works, but its data is only consumed by the Quick Finder modal. Users must use Ctrl+K or manually navigate the tree to find recently used pages. | Add a "Recent" section at the top of the page tree showing the last 5-10 opened pages with timestamps. |
| 28 | Medium | Dashboard | The dashboard shows all pages in a flat grid with no grouping by recency, type, or folder. For users with 50+ pages, this becomes overwhelming. | Add a "Recent" view toggle on the dashboard, or group pages by their tree parent with collapsible sections. |

### Keyboard Shortcuts

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 29 | High | App-wide | **Keyboard shortcuts are undocumented.** The tree context menu shows some shortcuts (F2, Ctrl+D, Del, Ctrl+Enter, Ctrl+Shift+Enter) via `<Kbd>` components, but there is no centralized help panel or `?` keybinding. New users discover them by accident. | Add a "Keyboard Shortcuts" help panel (press `?` to open) listing all shortcuts grouped by context. Include this in the Settings workspace. |
| 30 | Medium | Rich Editor | BlockNote's built-in shortcuts (Mod+B for bold, Mod+I for italic) work, but the custom slash menu (`/`) has no keyboard indicator. Users don't know they can type `/` to insert blocks. | Show a subtle placeholder hint in empty blocks: "Type / for blocks, or start typing…" |
| 31 | Medium | Sidebar | The tree supports Delete, Ctrl+D (duplicate), Ctrl+Enter (new child), Ctrl+Shift+Enter (new sibling after) — shown in the context menu but not discoverable from the tree itself. | Document in the shortcut help panel (see #29). |
| 32 | Low | App-wide | No shortcut to toggle the tree pane. The rail has a button but no keyboard shortcut. | Bind a shortcut (e.g., Ctrl+\ or Ctrl+B) to toggle the tree pane visibility. |

### Mobile and Responsive Behavior

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 33 | High | App-wide | The mobile experience is severely limited. The navbar collapses to a drawer on `<sm` (48em = 768px), but the drawer contains both the utility rail AND the tree, making navigation cumbersome. There's no bottom tab bar or mobile-optimized layout. | Design a proper mobile layout with a bottom navigation bar (Home, Search, Calendar, Settings) and a full-screen tree drawer. |
| 34 | High | Dashboard | On mobile, the dashboard grid collapses to a single column but the cards still have the same padding and icon sizes, making them look sparse and wasteful. | Redesign dashboard cards for mobile: larger tap targets, condensed metadata, and a list-view option. |
| 35 | Medium | Rich Editor | The right sidebar collapses at 919px viewport width but there's no visible affordance telling the user it collapsed — the editor just expands to fill space with no explanation. | Show a subtle "Sidebar hidden on narrow screens" tooltip or a persistent expand button in the editor margin. |
| 36 | Low | Tab Strip | On mobile, the tab strip is hidden (it's in the main content area which gets crowded). There's no mobile tab management. | Consider a mobile-only tab switcher in the utility rail or a swipe-based tab navigation. |

### Loading, Empty, and Error States

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 37 | Medium | Dashboard | The loading state shows a spinner + "Loading pages..." text, but there's no skeleton placeholder. Users see a blank screen briefly before content appears. | Replace the spinner with skeleton placeholders matching the card grid layout. |
| 38 | Medium | Rich Editor | When the editor is loading (lazy-loaded BlockNote), a generic skeleton is shown but there's no progress indication. For slow connections, users may think the app is frozen. | Show a subtle progress bar or "Loading editor…" text during the lazy load. |
| 39 | High | App-wide | Error states are functional but austere. The `AppErrorBoundary` shows "Something went wrong. Reload to continue." with no recovery path other than a full reload. | Add more granular error handling: network errors show a "Retry connection" button, parse errors show the offending content snippet. |
| 40 | Low | Sidebar | The empty tree state shows "No pages yet. Create your first page to get started." but the create button is only in the utility rail ("+" icon). The empty state text references an action the user can't easily see. | Move the "Create first page" CTA into the empty tree state itself, or make the empty state text match the available actions. |

### Accessibility and Keyboard Navigation

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 41 | Critical | Sidebar | The Wunderbaum tree uses custom DOM. While focus styles exist (`.wb-row.wb-focus`), the ARIA attributes (`role="treeitem"`, `aria-level`, `aria-expanded`, `aria-selected`) depend on Wunderbaum's internal rendering and should be audited for completeness. | Audit and fix ARIA: ensure every tree row has proper roles. Link the context menu with `aria-controls`. |
| 42 | High | Utility Rail | The utility rail icons have tooltips but no visible focus ring when navigated via keyboard. Tab order through the rail is not tested. | Add visible `:focus-visible` outlines to all rail ActionIcons. Test the full Tab/Shift+Tab navigation sequence. |
| 43 | High | Quick Finder | The modal uses `role="listbox"` with `role="option"` but the active item highlight is purely visual (CSS class) — there's no `aria-activedescendant` on the listbox or live region for screen reader announcements. | Add `aria-activedescendant` to the results container, pointing to the currently highlighted row. Announce the active item via `aria-live`. |
| 44 | Medium | App-wide | The app uses Mantine's `focusRing: 'auto'` which is correct. Custom components (tree rows, toolbar buttons) have focus styles. This area is mostly well-handled. | Verify all custom components have `:focus-visible` styles during implementation review. |
| 45 | Low | Editor Header | The title is editable on double-click or F2, but there's no visual indicator that the title is editable. Users may not discover this interaction. | Add a subtle pencil icon next to the title on hover, or show a "Double-click to rename" hint on first visit. |

### Visual Hierarchy, Typography, Spacing, Colors

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 46 | Medium | App-wide | The color palette is extremely minimal: only blue as primary. There's no secondary accent color for visual distinction between page types, status states, or interactive elements. | Introduce a secondary color (e.g., amber or teal) for accents, status indicators, and page-type badges. |
| 47 | High | Dashboard | Page cards use a type-colored icon tile and a type-accented footer chip (`.cardType`). Colors are driven by `data-page-type` attribute. This is actually well-implemented. | The type coloring is good. Consider adding a colored left-border accent to each card for even faster scanning. |
| 48 | Medium | App-wide | Typography uses the system font stack. Heading levels in the editor (H1/H2/H3) have distinct sizes through BlockNote's theme. | The typography is adequate. Consider adding Inter as the primary font (already loaded by BlockNote) with JetBrains Mono for code blocks. |
| 49 | Medium | App-wide | **Dark mode is flat.** `theme/index.ts:20-27`: Background `#1a1a1a`, Surface `#242424`, Raised `#2a2a2a` — only 3-5% luminance difference between layers. No depth hierarchy. | Increase contrast: Background `#0f1117`, Surface `#1a1b26`, Raised `#232433`, Borders `#2e3044`. Blue-tinted dark palette for better depth perception. |
| 50 | Low | App-wide | The dark mode color tokens are defined once in `theme/index.ts` and applied consistently via CSS variables. The system is correct; only the values need adjustment. | See #49. |

### Performance-Related UI Concerns

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 51 | Medium | Sidebar | The page tree reloads its entire data on every page creation/deletion/rename (the `useEffect` on `pages` calls `host.reload()` in `page-tree.tsx:206`). For trees with 200+ pages, this causes visible flicker. | Implement selective updates: only add/remove/reorder affected nodes instead of full reload. |
| 52 | Low | Dashboard | The dashboard re-renders the entire page card grid whenever any single page changes. | Memoize `PageCard` components with `React.memo` to prevent unnecessary re-renders. |
| 53 | Medium | Rich Editor | The word count recalculates on every editor change by walking the entire document. For very long documents (100+ blocks), this runs on every keystroke. | Throttle the word count update to once per 500ms. |
| 54 | Low | App-wide | The autosave debounce is 2000ms. There's a "Saving..." / "Saved" indicator in the status bar. This is working correctly. | No action needed. |

### Sync, Offline, and Conflict-State Indicators

| # | Severity | Component | Problem | Recommendation |
|---|----------|-----------|---------|----------------|
| 55 | Medium | App-wide | RTWiki is localhost-only with no sync capability. There's no visual indicator of this limitation. | Add a clear "Local only" badge in the status bar or settings. Be transparent about the offline-first nature. |
| 56 | High | Status Bar | The save state shows "Saving..." / "Saved" / "Save failed" but there's no conflict resolution UI. If two edits happen close together, there's no merge or conflict prompt. | Add a conflict detection mechanism: if the server-side version differs from the client's base, show a "Changes conflict" dialog. |
| 57 | Medium | App-wide | No version history. Once a page is saved, there's no way to view or restore previous versions. | Add automatic version snapshots (keep last 10 versions per page) with a "History" panel. |
| 58 | Low | Settings | The port configuration requires a restart to take effect. The "Restart now" button is present but easy to miss. | Add a persistent banner at the top of the settings page when a port change is pending. |

---

## 3. Current User Flow (Detailed)

### Creating a note
Utility rail → "+" icon → New Page dialog (type + template) → page opens in workspace → autosave begins

### Finding a note
Utility rail → "Search" icon → sidebar search box **or** Ctrl+K → Quick Finder modal (Recent / Title / Content groups, 6 per group cap)

### Organizing notes
Sidebar tree → right-click context menu (new child/after, move, rename, duplicate, delete) → drag-and-drop reorder

### Editing a note
Click page in tree → PageWorkspace mounts → editor-specific surface (BlockNote / CodeMirror / Mermaid) → toolbar above title → content area → status bar below

---

## 4. Top 10 UX Problems

| Rank | Problem | Severity | Impact |
|------|---------|----------|--------|
| 1 | **No trash/restore UI** — delete confirmation says "cannot be undone" but data IS soft-deleted. No way to recover. | Critical | Users will be terrified to delete anything; high anxiety around mistakes |
| 2 | **No tag system** — only tree hierarchy for organization | Critical | Scales poorly past ~30 notes; no cross-tree relationships |
| 3 | **No daily notes** — no automatic date-based note creation | High | Missed core note-taking paradigm used by Obsidian/Logseq users |
| 4 | **Editor has a visible border/frame** — looks like a widget, not the page | High | Undermines the "fullscreen writing" feel; competitors don't do this |
| 5 | **Toolbar is too wide** — horizontal scrolling required on most screens | High | 12+ tools crammed into one row; poor discoverability |
| 6 | **No documented keyboard shortcuts** — power users can't adopt the app | High | Forces mouse-only interaction; excludes keyboard-first users |
| 7 | **No favorites/starred** — no way to pin important pages | High | Users must remember tree positions to find important notes |
| 8 | **Mobile layout is an afterthought** — drawer stacks rail+tree awkwardly | High | Unusable on tablets; no touch-optimized interactions |
| 9 | **No version history** — edits are permanent and irreversible | Medium | Loss of trust in the editor; no recovery from bad edits |
| 10 | **No sync indicator** — users may assume cloud backup exists | Medium | Data loss risk if device fails; no multi-device workflow |

---

## 5. Recommended Navigation Structure

```
┌─────────────────────────────────────────────────────────────┐
│  [Rail]  │  [Tree Pane]              │  [Workspace]         │
│          │                           │                      │
│  🏠 Home │  Root                     │  ┌─ Tab Strip ─────┐ │
│  🔍 Find │  ─────────────────        │  │ Note 1 │ Note 2 │ │
│  ➕ New  │  ⭐ Favorites             │  └──────────────────┘ │
│  📅 Cal  │  📋 Recent                │                      │
│  🗑️ Trash│  ─────────────────        │  ┌─ Title ─────────┐ │
│  ⚙️ Set  │  📁 Projects              │  ├─ Toolbar ───────┤ │
│          │    ├── Work (12)          │  │                │ │
│          │    │   ├── Meeting Notes │  │  Editor Area   │ │
│          │    │   └── Roadmap       │  │                │ │
│          │    └── Personal          │  └────────────────┘ │
│          │      ├── Diary           │  [Status Bar]        │
│          │      └── Ideas           │                      │
└───────────────────────────────────────┴──────────────────────┘
```

**Rail additions:**
- **Favorites** (⭐) — persistent pinned pages, always visible
- **Trash** (🗑️) — soft-deleted pages with restore option
- **Dashboard** (📊) — explicit entry point (currently implicit via Home)

**Tree additions:**
- Collapsible folder sections with page counts
- "Recent" virtual section at top (last 5 opened pages)
- "Favorites" virtual section (starred pages)

---

## 6. Recommended Note Editor Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Tabs: Note 1 | Note 2 | Note 3          [+]]                  │
├─────────────────────────────────────────────────────────────────┤
│  ←  My Note Title                    [⋮]                       │
├─────────────────────────────────────────────────────────────────┤
│  [B] [I] [U] [S]  |  [H1] [H2] [H3]  |  [☰] [☰] [☰]  |  [+]  │  ← Primary toolbar (8-10 items)
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  # Main Heading                                                  │
│                                                                 │
│  Regular text paragraph with inline **bold** and `code`.        │
│  Internal [[link]] to another page.                              │
│                                                                 │
│  > Callout block with important information                     │
│                                                                 │
│  - Bullet point                                                  │
│  - Another point                                                 │
│                                                                 │
│  [Diagram block ████████████]     [Linked page card]            │
│                                                                 │
│                                                                  │
│                          ↑ editor scrolls here                   │
│                                                                 │
├───────────────────────────────────┬─────────────────────────────┤
│                                   │  📋 Page Details           │
│                                   │  ──────────────────        │
│                                   │  Outline:                  │
│                                   │    • Main Heading          │
│                                   │    • Sub section           │
│                                   │  ──────────────────        │
│                                   │  Backlinks (3):            │
│                                   │    • Related note          │
│                                   │    • Another note          │
│                                   │  ──────────────────        │
│                                   │  Created: Jan 15, 2026     │
│                                   │  Modified: 2 hours ago     │
│                                   │  Tags: #project #urgent    │
│                                   │  Type: Rich Note           │
├───────────────────────────────────┴─────────────────────────────┤
│  Rich Note  │  Home > Projects > Work  │  342w · 2h ago  │ Saved│
└─────────────────────────────────────────────────────────────────┘
```

**Key changes from current:**
- Toolbar collapsed to primary actions only; secondary actions in `+` dropdown
- Editor has no border/frame — full-bleed content
- Title is always editable (click to edit, not double-click)
- Right sidebar shows tags (new feature) in addition to outline/backlinks
- Status bar retains breadcrumb + metadata but is more compact

---

## 7. Visual Design Direction

### Typography

| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 | 1.75rem (28px) | 700 | 1.3 |
| H2 | 1.375rem (22px) | 600 | 1.35 |
| H3 | 1.125rem (18px) | 600 | 1.4 |
| Body | 0.9375rem (15px) | 400 | 1.6 |
| Caption/Meta | 0.8125rem (13px) | 400 | 1.4 |
| Mono | 0.875rem (14px) | 400 | 1.5 |

Font: Keep system-ui stack but Inter is already loaded by BlockNote. Consider JetBrains Mono for code blocks.

### Color Palette

**Light mode:**
| Token | Value | Use |
|-------|-------|-----|
| Background | `#f8f9fa` | App background |
| Surface | `#ffffff` | Cards, panels |
| Surface Raised | `#f0f1f3` | Active tabs, hover |
| Border | `#e2e4e7` | Separators |
| Text Primary | `#1a1b1e` | Body text |
| Text Muted | `#6b7280` | Meta, placeholders |
| Primary | `#2563eb` | Actions, links |
| Accent | `#f59e0b` | Highlights, tags |
| Success | `#10b981` | Save state |
| Error | `#ef4444` | Errors, delete |

**Dark mode (proposed):**
| Token | Value | Current | Delta |
|-------|-------|---------|-------|
| Background | `#0f1117` | `#1a1a1a` | Deeper, blue-tinted |
| Surface | `#1a1b26` | `#242424` | More contrast |
| Surface Raised | `#232433` | `#2a2a2a` | Visible depth |
| Border | `#2e3044` | `#3a3a3a` | Subtle but present |
| Text Primary | `#e4e4e7` | `#e8e8e8` | Slightly warmer |
| Text Muted | `#71717a` | `#888888` | Better reading |
| Primary | `#60a5fa` | `#2f80ff` | Lighter for dark bg |
| Accent | `#fbbf24` | N/A | New accent |

### Spacing System
Use an 8px base grid: 4, 8, 12, 16, 24, 32, 48, 64px. Current spacing is mostly compliant but inconsistent in the sidebar (uses `gap: 2` which is 4px — fine, but some places use `gap: "sm"` = 12px inconsistently).

### Border Radius
| Element | Current | Proposed |
|---------|---------|----------|
| Cards | `md` (8px) | `10px` |
| Inputs | default | `8px` |
| Buttons | default | `6px` |
| Toolbar | none | `0px` (full-width, no radius) |
| Popovers/Menus | `md` (8px) | `8px` (unchanged) |

### Icon Style
Current: Tabler Icons (outline style, 1.5px stroke). This is good and consistent. No change needed. Consider adding filled variants for active states.

### Dark Mode Direction
Move toward a blue-tinted dark palette (like Obsidian/VSC) for better depth perception. The current dark mode (`#1a1a1a` / `#242424`) is too flat with insufficient contrast between surface layers.

---

## 8. Page-by-Page Redesign Plan

### Dashboard
- **Current:** Flat grid of cards, title + count header, search in sidebar
- **Redesign:** Add view toggle (Grid / List), group cards by parent folder with collapsible sections, add "Recent" sort option, skeleton loading states, empty state with prominent CTA

### Rich Note Editor
- **Current:** Bordered editor container, wide toolbar, right sidebar with outline/backlinks
- **Redesign:** Full-bleed editor (no border), progressive toolbar (primary + "More"), tags in right sidebar, reading-mode toggle

### HTML Editor
- **Current:** Three source tabs + preview, CodeMirror-based
- **Redesign:** Split-view option (code + preview side-by-side), syntax-highlighted preview, integrated terminal for JS output

### Calendar / Study Timetable
- **Current:** Mantine Schedule component, palette drag-drop, presets panel
- **Redesign:** Keep as-is (well-implemented), add "Today" quick-jump button, link events to notes more visibly

### Settings
- **Current:** Tabbed workspace (Appearance, Layout, Editor, Debug Logs, Scheduler, Desktop)
- **Redesign:** Add "Keyboard Shortcuts" tab, add "Data & Backup" tab, reorganize Layout into visual drag-demo

### Quick Finder
- **Current:** Modal with Recent/Title/Content groups, keyboard navigation, 6 per group cap
- **Redesign:** Expand to command palette (search + actions), show result count, persistent recent history

### Page Tree
- **Current:** Wunderbaum tree, right-click context menu, inline rename
- **Redesign:** Add page count badges, favorite stars, recent section, search clear button, keyboard focus indicators

---

## 9. Best Improvements to Implement First (P0)

1. **Add trash/restore UI** — eliminates deletion anxiety, fundamental trust builder
2. **Remove editor border/frame** — immediate visual upgrade, matches modern expectations
3. **Add keyboard shortcuts help panel** — unlocks power-user adoption
4. **Add favorites/starring** — quick access to important pages, no tree navigation needed
5. **Add search clear button** — small but frequently-used interaction fix

---

## 10. Features to Postpone

1. **Daily notes** — requires significant architecture (date-based page creation, calendar integration); implement after tags and trash are stable
2. **Version history** — requires database schema change and storage strategy; defer to post-MVP
3. **Mobile redesign** — the desktop experience must be polished first; mobile can be a subsequent phase
4. **Sync/backup UI** — out of scope for local-first MVP; focus on export/import until sync is planned
5. **Rich template system expansion** — current templates are sufficient; expand after core editing is solid

---

## 11. Prioritized Implementation Roadmap

### Phase 1: UI-Only Improvements (Low Risk, No Data Changes)
These are relatively low risk and can be implemented in parallel:

- [ ] Fix delete confirmation text (remove "cannot be undone")
- [ ] Add visible RTWiki branding to utility rail
- [ ] Improve dashboard/header visual separation
- [ ] Add border under the tab strip
- [ ] Add search clear button to sidebar
- [ ] Improve tree focus states (audit existing styles)
- [ ] Remove the editor frame (border + radius on `.blockNoteWrapper`)
- [ ] Reduce editor toolbar clutter (progressive disclosure)
- [ ] Improve dark-mode contrast (update color tokens)
- [ ] Add loading skeletons to dashboard
- [ ] Add keyboard shortcut help panel (`?` keybinding)
- [ ] Add "Recent" section to sidebar using existing `recent-pages.ts`

### Phase 2: Trust and Organization (Medium Risk, Requires Data Changes)
Implement these carefully because they may affect the data model:

- [ ] **Trash and restore** — server already soft-deletes; add trash UI, restore endpoint, permanent delete
- [ ] **Tags** — new DB column or junction table, tag input in editor, tag filter in sidebar
- [ ] **Favorites** — new column or JSON flag, star toggle in editor header and tree
- [ ] **Page count badges** — aggregate children count per parent node in tree
- [ ] **Search result counts** — show total count in Quick Finder
- [ ] **Empty state improvements** — move CTA into empty tree state

### Phase 3: Navigation (Post-Phase 2)
After the core organization works:

- [ ] Expand Ctrl+K into a command palette (search + actions)
- [ ] Add daily notes
- [ ] Add dashboard grouping by folder
- [ ] Persistent recent history in finder (already works via localStorage)
- [ ] Improve mobile navigation
- [ ] Add version history later

---

## 12. Validated Findings (Code-Verified)

### Confirmed: Soft-Delete Infrastructure Exists
- `src/server/database/migrations.ts:19` — `deleted_at TEXT` column on pages table
- `src/server/repositories/page-repository.ts:176` — `softDeletePage()` function promotes children on delete
- `src/server/routes/pages.ts:231-247` — DELETE endpoint calls `softDeletePage()`
- `src/shared/contracts/pages.ts:14` — `deletedAt: string | null` in Page interface
- **Gap:** Zero UI for viewing trashed pages or restoring them

### Confirmed: Recent Pages Already Persisted
- `src/web/util/recent-pages.ts` — localStorage-backed, 20-item bounded list
- Used by Quick Finder but NOT by the sidebar tree
- **Gap:** No "Recent" section in the page tree

### Confirmed: Editor Border is Visible
- `src/web/features/rich-editor/rich-editor.module.css:32-33`:
  ```css
  border: 1px solid var(--rtwiki-border, var(--mantine-color-default-border));
  border-radius: var(--mantine-radius-md);
  ```
- **Gap:** Border makes editor look like a widget, not the page

### Confirmed: Toolbar Overflows
- `src/web/features/rich-editor/rich-toolbar.module.css:52-56`:
  ```css
  .bar { overflow-x: auto; overflow-y: hidden; flex-wrap: nowrap; }
  ```
- **Gap:** Single-row toolbar requires horizontal scroll on most screens

### Confirmed: No Tag System
- Zero matches for tags in any shared contract, repository, or UI component
- No DB column, no schema, no UI
- **Gap:** Foundational organizational feature missing

### Confirmed: No Favorites
- Zero matches for favorite/star/pin in contracts or UI
- **Gap:** No way to pin important pages

### Confirmed: Delete Confirmation is Misleading
- `UI_TEXT.deleteConfirmation` (config/index.ts:107):
  > "Are you sure you want to delete this page? This action cannot be undone."
- **Gap:** Data IS preserved (soft-deleted), but the UI tells users it isn't

### Confirmed: Dark Mode Is Flat
- `src/web/theme/index.ts:20-27`:
  ```js
  dark: {
    '--rtwiki-background': '#1a1a1a',
    '--rtwiki-surface': '#242424',
    '--rtwiki-surface-raised': '#2a2a2a',
    '--rtwiki-border': '#3a3a3a',
  }
  ```
- Luminance difference between background and surface is ~3% — insufficient for depth perception

### Confirmed: Search Has No Clear Button
- `src/web/layout/sidebar.tsx:109` renders `<SearchInput>` with no clear/X button
- **Gap:** No way to quickly clear search without clicking away

### Partially Outdated: Tree Focus States
- Tree rows DO have focus styles (`:global(div.wb-row.wb-focus)` at line 176 of `page-tree.module.css`)
- Blue inset shadow is used (not outline) so it can never be clipped by overflow
- **Status:** Working. No action needed.

### Confirmed: Chrome Separation Exists
- `--rtwiki-chrome-bg`, `--rtwiki-chrome-border`, `--rtwiki-chrome-pad-x` CSS variables are defined in `theme/customization.css:47-51`
- Dashboard header, tab strip, editor header, and status bar all use these variables
- **Status:** The separation infrastructure exists. The visual contrast could be improved but the system is in place.

---

## 13. Dependencies & Risk Assessment

| Task | Dependencies | Risk | Data Changes | Estimated Effort |
|------|-------------|------|-------------|-----------------|
| Trash UI + Restore | None (server already soft-deletes) | **Low** | None — uses existing `deleted_at` | 2-3 days |
| Editor border removal | None | **Low** | CSS only | 30 min |
| Toolbar cleanup | None | **Low** | CSS + TSX restructuring | 1 day |
| Search clear button | None | **Low** | TSX only | 30 min |
| Dark mode contrast | None | **Low** | CSS tokens only | 30 min |
| Keyboard shortcut help | None | **Low** | New component, no data | 1 day |
| Recent section in sidebar | `recent-pages.ts` already exists | **Low** | None — uses existing utility | 1 day |
| Delete confirmation fix | None | **Low** | String change only | 10 min |
| Tags system | Requires DB migration | **Medium** | New `page_tags` table or `tags` column | 3-4 days |
| Favorites | Requires DB migration | **Medium** | New `is_favorite` column | 1-2 days |
| Command palette expansion | Quick Finder exists | **Low** | TSX only | 1-2 days |
| Daily notes | Calendar exists | **Medium** | New page type + auto-creation logic | 3-4 days |
| Version history | Requires snapshot strategy | **High** | New table + storage strategy | 5+ days |
| Mobile redesign | Desktop must be stable | **High** | Layout overhaul | 1-2 weeks |

---

## 14. Best First Target

**Start with Task 1 (Trash UI)** and **Task 2 (Editor border removal)** in parallel:

1. **Trash UI** eliminates the biggest trust issue — users can delete without fear of permanent loss
2. **Editor border removal** is the highest-impact visual upgrade — takes 10 minutes of CSS change
3. Both are low-risk, independent, and address the two most damaging UX problems identified

---

## 15. Phase 1 Detailed Task Breakdown

### Task 1.1: Fix Delete Confirmation
- **File:** `src/web/config/index.ts`
- **Change:** Update `UI_TEXT.deleteConfirmation` from "This action cannot be undone." to "This page will be moved to Trash. You can restore it later."
- **Effort:** 5 minutes

### Task 1.2: Remove Editor Border
- **File:** `src/web/features/rich-editor/rich-editor.module.css`
- **Change:** Remove `border` and `border-radius` from `.blockNoteWrapper` (lines 32-33)
- **Effort:** 10 minutes

### Task 1.3: Add Search Clear Button
- **File:** `src/web/components/search-input.tsx`
- **Change:** Add clear button when `value.length > 0`, bind Escape to clear
- **Effort:** 30 minutes

### Task 1.4: Improve Dark Mode Contrast
- **File:** `src/web/theme/index.ts`
- **Change:** Update dark color tokens per the proposed palette
- **Effort:** 15 minutes

### Task 1.5: Add Keyboard Shortcut Help
- **Files:** New `src/web/features/shortcuts/shortcut-help.tsx`, update `src/web/App.tsx`
- **Change:** New modal component, bind `?` key to toggle
- **Effort:** 1 day

### Task 1.6: Add Recent Section to Sidebar
- **Files:** `src/web/features/sidebar/page-tree.tsx`, `src/web/layout/sidebar.tsx`
- **Change:** Add "Recent" section above tree using existing `recent-pages.ts`
- **Effort:** 1 day

### Task 1.7: Progressive Toolbar
- **File:** `src/web/features/rich-editor/rich-toolbar.tsx`
- **Change:** Group secondary actions into dropdown, keep primary 8 actions visible
- **Effort:** 1 day

### Task 1.8: Add Trash View
- **Files:** New `src/web/features/trash/trash-view.tsx`, update `src/web/App.tsx`, add API endpoint
- **Change:** Trash icon in rail, list trashed pages with restore/delete-permanently actions
- **Effort:** 2-3 days

---

*End of audit report. No files were modified during this audit.*
