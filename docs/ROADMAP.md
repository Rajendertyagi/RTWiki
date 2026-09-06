# Roadmap

This document outlines the planned feature rollout for RTWiki beyond the MVP. It is a target sequence, not a commitment to specific dates. Phases are ordered by dependency and user value. Only features approved by the owner are included here.

## Phase 0: Planning & Documentation (Current)

Complete. This phase produces the specification, architecture, data model, security requirements, development standards, and acceptance criteria that guide all future work. See the [README](../README.md) for the documentation index.

## Phase 1: MVP (Milestone Sequence)

See [MVP_SCOPE.md](MVP_SCOPE.md) for the detailed milestone plan. The MVP delivers a functional, portable Windows application that meets all acceptance criteria in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md), including the rich-content requirements R-040–R-063.

**Key outcomes of Phase 1:**
- Working block editor with all supported block types
- Page CRUD with autosave and undo/redo
- HTML and Markdown import
- Cards, tabs, formulas, Mermaid diagrams
- Attachments (images, PDFs, documents)
- Local full-text search
- Backup and restore
- Portable Windows executable

## Phase 2: Polish & Robustness

After the MVP is accepted, Phase 2 focuses on hardening and quality improvements that were deferred to keep the MVP timeline aggressive.

| Feature | Description |
|---------|------------|
| Page version history UI | Visual history panel showing previous content states with diff view |
| Advanced search filters | Filter by tag, date range, and presence/absence of specific block types |
| Batch operations | Select and delete multiple pages at once; batch-tag pages |
| Export to Markdown | Export a single page or the entire workspace as Markdown files |
| Keyboard shortcut reference | In-app help panel listing all keyboard shortcuts |
| Performance optimization | Virtualized page list, debounced search input, lazy-loaded heavy components |

## Approved Next Slices (Post-MVP UI/UX, in priority order)

The following five slices are approved for the next implementation cycle, in this exact order. Each is a separate future slice tracked independently. The current workspace-chrome compaction, base Markdown page, and global status bar have passed basic manual testing; the broader automated test suite is deferred to the owner after further manual checking, so none of these slices add tests or run the suite during implementation. Each slice records its user-visible outcome, affected systems, dependencies, storage impact, manual owner checklist, and exclusions.

### Slice 1: Tree Polish Round 2

**User-visible outcome**
A cleaner, more legible page tree: consistent row spacing, clearer expand/collapse chevrons, distinct per-type icons (Rich / HTML / Markdown / Diagram / Mind Map), obvious selection and keyboard focus, a polished dark theme, reliable hover action buttons, a compact context menu, and a graceful narrow-layout collapse.

**Affected systems**
- `src/web/features/sidebar/*` (Sidebar shell, tree host)
- `src/web/features/pages/page-tree*` (Wunderbaum bridge, `wb-tree-host.ts`, tree context menu)
- `src/web/theme/customization.css` (`--rtwiki-tree-*` tokens) and `page-tree.module.css` / `sidebar.module.css`
- `src/web/components/page-type-badge.*` (type icons/labels)

**Dependencies**
- Existing functional tree (expand/collapse, select, rename, drag-move, context actions) and the compact-chrome token set already in place. No backend or schema changes required.

**Storage impact**
- None. Pure UI/CSS. Tree expanded-state persistence already exists via the workspace session (`expandedIds`); no new storage is introduced.

**Manual owner checklist**
- Row spacing/alignment matches the compact-chrome design intent.
- Chevron hit-area is correct (≈24px) and toggles reliably.
- Type icons render distinctly per page type.
- Selection colour matches the shared chrome active-fill token.
- Dark-theme contrast is acceptable (no low-contrast text/borders).
- Hover action button appears without shifting the title.
- Context menu is compact and keyboard-accessible.
- Narrow window (<48em) collapses gracefully with no overflow.
- No behaviour regressions: expand/collapse, select, rename, drag-move, and context actions all still work.

**Exclusions**
- Do **not** change tree behaviour unless a visible defect requires it.
- No new tree features (e.g., multi-select, new node types).
- No backend, schema, or data-model changes.
- No automated tests added during implementation (owner runs the suite later).

### Slice 2: Dashboard Card Improvements

**User-visible outcome**
Dashboard cards become less basic and more useful: a page-type icon, the title, a short safe preview excerpt, a visual preview where appropriate, and clear hover/open/context-menu behaviour — while staying fast and responsive even with many pages.

**Affected systems**
- `src/web/features/dashboard/*` (Dashboard, card component)
- `src/web/components/page-type-badge.*` (icons/labels)
- Content parsing for safe excerpts (`@rtwiki/shared/schemas/html-content`, `markdown-content`)
- `use-pages-controller` (page data access)

**Dependencies**
- Page-type badges already exist. Safe preview text is derived from parsed page content (HTML/Markdown schemas). Visual preview (e.g., a rendered snapshot) only where it is cheap and safe.

**Storage impact**
- None. Previews are derived at render time from existing page content; no thumbnails or preview blobs are stored.

**Manual owner checklist**
- Card shows the correct type icon and title.
- Preview text is a safe excerpt: no raw HTML/script execution, no secrets.
- Visual preview (rendered snippet/thumbnail) appears only where safe and inexpensive.
- Hover highlights the card; click opens the page.
- Context menu (open / rename / duplicate / delete) works.
- Large page lists stay smooth (no layout thrash; virtualize if needed).

**Exclusions**
- No new data stored for cards.
- No change to the page content model.
- No in-card editing.
- No automated tests added during implementation.

### Slice 3: Settings Workspace + Live Debug Logs

**User-visible outcome**
A proper Settings page with its own settings sidebar and sections: **Appearance**, **Layout**, **Editor**, and **Debug Logs**. Live Debug Logs are scrollable, support pause/resume and clearing the visible view, level/category filters, and timestamps — and never contain note content or secrets.

**Affected systems**
- New `src/web/features/settings/*` (SettingsWorkspace, settings sidebar, section panels)
- `src/web/diagnostics/debug-log.ts` (expose an in-memory, subscribable live log stream)
- `src/web/layout/utility-rail.tsx` (the current gear is a debug toggle — replace/augment with a Settings entry)
- `src/web/features/workspace/layout-preferences.*` (persist Appearance/Layout/Editor prefs)
- `UI_TEXT` additions

**Dependencies**
- Debug logging already writes `logs/rtwiki-debug.jsonl` via `debug-log.ts` (which already excludes note content). Mantine color-scheme and theme tokens already exist for the Appearance section to reuse.

**Storage impact**
- Settings preferences persist to the existing local preference store (localStorage / layout-preferences); no new page or note content is stored.
- Debug logs continue to write to `logs/` on disk. The Live view reads an in-memory buffer only; "clear visible log view" clears the view, not the file. Logs must never include note content or secrets (already enforced by `DEBUG_MODE.md`).

**Manual owner checklist**
- Settings entry from the rail opens a page with a left settings sidebar.
- Appearance, Layout, Editor, and Debug Logs sections are present.
- Debug Logs live-updates as actions occur.
- Pause/resume stops/starts live updates; Clear empties the visible list.
- Level (debug/info/warn/error) and category filters work; timestamps are shown.
- Verify no page content or secrets appear in log output.
- Appearance/Layout/Editor changes persist across reload.

**Exclusions**
- The **Data / Backup** section is reserved for a later slice — do **not** build it now.
- Do not store note content or secrets in logs.
- Do not change the underlying debug file format.
- No automated tests added during implementation.

### Slice 4: Markdown Polish

**User-visible outcome**
Safe `.md` import and export, Markdown templates, preview refinements, and clear Markdown-specific editing behaviour. Raw HTML stays disabled.

**Affected systems**
- `src/web/features/markdown/*` (markdown-workspace, markdown-render, import/export)
- Shared import pipeline (ADR-006) and `markdown-content` schema
- `UI_TEXT` additions (templates, labels)

**Dependencies**
- The Markdown page type already supports edit/preview. The shared import pipeline (HTML/Markdown import) already exists. `.md` round-trip must stay safe (DOMPurify; no HTML/script execution).

**Storage impact**
- None new. Templates are code constants; import/export are file operations and are not stored in the database.

**Manual owner checklist**
- `.md` import produces a valid Markdown page with no script execution (sanitized).
- `.md` export round-trips content faithfully.
- Templates create pages with sensible starter content.
- Preview renders correctly (headings, lists, code, tables, links).
- Editing behaviour is clearly Markdown (not rich blocks).
- Raw HTML is disabled/escaped in preview — no XSS via imported Markdown.

**Exclusions**
- Keep raw HTML disabled in Markdown (do not enable HTML rendering).
- Do not change the canonical storage format (BlockNote JSON / v2). Markdown is a dedicated, source-editable page type with preview; import/export are additional capabilities, not its only purpose.
- No automated tests added during implementation.

### Slice 5: Rich Document Improvements

**User-visible outcome**
Linked child-page cards (embed/navigate to child pages from a rich document), better Formula / Diagram / Mind Map presentation, and subject/chapter templates — without redesigning the whole rich editor.

**Affected systems**
- `src/web/features/rich-editor/*` (formula, diagram, mindmap blocks; linked child-page card block; insert menus; templates)
- `VISUAL_BLOCKS.md` reference and the rich-content schema (new linked-page block type, backward-compatible)
- Existing wiki-links / backlinks (`WIKI_LINKS.md`) as the foundation for linked child-page cards

**Dependencies**
- BlockNote plus `@blocknote/math-block` and `@blocknote/diagram-block` are already integrated. Wiki-links/backlinks already exist. A templates mechanism is required for subject/chapter starters.

**Storage impact**
- A new linked child-page card block extends the existing BlockNote JSON (rich content) schema in a backward-compatible way. Templates are constants. No new database tables.

**Manual owner checklist**
- Linked child-page cards render with title/type and open the child on click.
- Formula blocks render clearly (KaTeX) and edit smoothly.
- Diagram / Mind Map blocks present cleanly with clear edit/preview.
- Subject/chapter templates create well-structured starter documents.
- No regression in core rich editing; existing documents still load.

**Exclusions**
- Do **not** redesign the whole rich editor.
- Do not make breaking changes to the BlockNote JSON canonical format.
- Keep all existing block types working.
- No automated tests added during implementation.

## Phase 3: LAN Access from Other Devices

This phase adds the capability for family members to open and read the same shared workspace from phones and tablets on the home network. The user accesses the application through their device's browser by navigating to the PC's LAN address. This requires an explicit opt-in configuration change (see [ADR-001](adr/ADR-001-browser-first-local-application.md)).

LAN access means reading and editing the same workspace from another device. It does **not** imply real-time collaborative editing, separate user accounts, or cloud synchronization.

| Feature | Description |
|---------|------------|
| LAN server mode | Optional binding to `0.0.0.0` with a configurable port |
| Mobile-responsive layout | Touch-friendly block editing, collapsed sidebar, larger touch targets |

**Note:** Real-time collaboration is not planned. If multiple users edit the same page simultaneously from different devices, the last save wins with no conflict resolution. This is acceptable for the intended family-use scenario.

## Phase 4: Visual Mind Map Editor

This phase replaces static Mermaid mind maps with a fully interactive visual editor using React Flow. Mermaid mind maps remain available as a quick-insert option.

| Feature | Description |
|---------|------------|
| React Flow mind-map editor | Drag-and-drop node editor with connecting edges |
| Sync with page content | Changes in the mind-map editor update the corresponding page blocks and vice versa |
| Export mind map as image | PNG/SVG export of the current mind-map view |

## Phase 5: Export Format Evaluation

This phase evaluates whether to add output formats for sharing and archiving. The owner will decide which, if any, to implement.

| Feature | Description |
|---------|------------|
| PDF export evaluation | Single-page or whole-workspace PDF export with proper formatting |
| DOCX export evaluation | Microsoft Word-compatible export |
| ODT export evaluation | LibreOffice-compatible export |
| Print stylesheet | Clean print layout for individual pages |

## Phase 6: Native Desktop Wrapper Evaluation

This phase evaluates whether a native desktop wrapper would provide sufficient value to justify the additional build complexity. The browser-first approach remains the default distribution method.

| Consideration | Description |
|---------------|------------|
| Wrapper evaluation | Assess Electron, Tauri, or similar options against the browser-first approach |
| System tray integration | Native tray icon, keyboard shortcuts, file associations |
| Native menus and dialogs | OS-native window chrome and file-picker dialogs |

The outcome of this evaluation may result in no wrapper being adopted, a lightweight wrapper being adopted, or further evaluation in a later phase.

## Phase 7: Optional AI Chat and Page Generation

This phase adds an **optional** AI chat and page-generation assistant. RTWiki core has **no AI dependency**: all current features work offline without any AI or network. The assistant is a future, opt-in capability.

- Receiving AI-generated content is already a core capability (Phases 0–1). This phase adds a conversational surface that helps the owner draft and refine pages, then imports the result through the same shared pipeline.
- A future **local-model adapter** may run entirely offline on the owner's PC (no network required).
- A future **cloud-provider adapter** may also be supported: it requires explicit opt-in, clear disclosure of what is sent, no automatic transmission, and no committed credentials. An external provider may require its own account; RTWiki itself still has no account system.
- Both adapters register in the composition root (see [ADR-006](adr/ADR-006-rich-content-and-import-contract.md)) and use the same rich-content contract. AI must preview changes before applying them.
- Cloud sync remains **not planned**. No vendor is hard-coded; the AI chat is not part of the MVP.

| Feature | Description |
|---------|------------|
| AI chat panel (optional) | Optional side panel that drafts or edits page content and imports it through the shared pipeline |
| Page generation from prompt | Produce a structured RTWiki page (native blocks where possible) and preview before save |
| Local-model adapter (future) | Pluggable AI-provider adapter registered in the composition root; off by default |
| Cloud-provider adapter (future, opt-in) | Pluggable adapter for an explicitly-selected cloud provider; requires opt-in, disclosure, and no committed credentials |

See [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) for the import contract and [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) for the pipeline.

## Decision Points

Each phase beyond Phase 1 requires an explicit owner decision before starting. The roadmap is a living document — phases may be added, removed, or reordered based on user feedback and technical discoveries during earlier phases.

## Cross-References

- [MVP_SCOPE.md](MVP_SCOPE.md) — what is in and out of the MVP
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — MVP success criteria
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — full requirement list
- [ARCHITECTURE.md](ARCHITECTURE.md) — architectural decisions that enable future phases
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
