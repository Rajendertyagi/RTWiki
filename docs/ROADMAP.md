# Roadmap

This document outlines the planned feature rollout for RTWiki beyond the MVP. It is a target sequence, not a commitment to specific dates. Phases are ordered by dependency and user value. Only features approved by the owner are included here.

## Phase 0: Planning & Documentation (Current)

Complete. This phase produces the specification, architecture, data model, security requirements, development standards, and acceptance criteria that guide all future work. See the [README](../README.md) for the documentation index.

## Phase 1: MVP (Three-Day Target)

See [MVP_SCOPE.md](MVP_SCOPE.md) for the detailed day-by-day plan. The MVP delivers a functional, portable Windows application that meets all acceptance criteria in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

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

## Decision Points

Each phase beyond Phase 1 requires an explicit owner decision before starting. The roadmap is a living document — phases may be added, removed, or reordered based on user feedback and technical discoveries during earlier phases.

## Cross-References

- [MVP_SCOPE.md](MVP_SCOPE.md) — what is in and out of the MVP
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — MVP success criteria
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — full requirement list
- [ARCHITECTURE.md](ARCHITECTURE.md) — architectural decisions that enable future phases
