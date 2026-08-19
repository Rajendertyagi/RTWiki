# Roadmap

This document outlines the planned feature rollout for RTWiki beyond the MVP. It is a target sequence, not a commitment to specific dates. Phases are ordered by dependency and user value.

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

## Phase 3: LAN and Multi-Device Access

This phase adds the capability for family members to access their wiki from phones and tablets on the same home network. This requires an explicit opt-in configuration change (see [ADR-001](adr/ADR-001-browser-first-local-application.md)).

| Feature | Description |
|---------|------------|
| LAN server mode | Optional binding to `0.0.0.0` with a configurable port |
| Mobile-responsive layout | Touch-friendly block editing, collapsed sidebar, larger touch targets |
| Real-time collaboration | WebSocket-based live editing with conflict resolution (Operational Transformation or CRDT) |
| Conflict resolution UI | When two devices edit the same page, present a merge dialog to the user |

**Note:** Real-time collaboration is explicitly deferred from the MVP (see [MVP_SCOPE.md](MVP_SCOPE.md)). Phase 3 is a significant engineering effort and is placed here only because the architecture must support it from the start.

## Phase 4: Visual Mind Map Editor

This phase replaces static Mermaid mind maps with a fully interactive visual editor using React Flow. Mermaid mind maps remain available as a quick-insert option.

| Feature | Description |
|---------|------------|
| React Flow mind-map editor | Drag-and-drop node editor with connecting edges |
| Sync with page content | Changes in the mind-map editor update the corresponding page blocks and vice versa |
| Export mind map as image | PNG/SVG export of the current mind-map view |

## Phase 5: Advanced Export Formats

This phase adds output formats for sharing and archiving.

| Feature | Description |
|---------|------------|
| PDF export | Single-page or whole-workspace PDF export with proper formatting |
| DOCX export | Microsoft Word-compatible export |
| ODT export | LibreOffice-compatible export |
| Print stylesheet | Clean print layout for individual pages |

## Phase 6: Media Support

This phase adds audio and video block types.

| Feature | Description |
|---------|------------|
| Audio block | Embed and play audio files (MP3, WAV) within a page |
| Video block | Embed and play video files (MP4, WebM) within a page |
| Video thumbnail generation | Auto-generate a thumbnail frame from uploaded videos |

## Phase 7: Cloud Sync (Optional)

This phase adds optional cloud synchronization for users who want to access their wiki from multiple PCs. This is the only phase that introduces an external dependency, and it must remain opt-in so that offline-only users are unaffected.

| Feature | Description |
|---------|------------|
| Encrypted cloud sync | End-to-end encrypted sync to a user-provided cloud storage backend |
| Conflict resolution | Automatic resolution of edits made on different machines |
| Selective sync | Choose which pages to sync (useful for large workspaces) |

## Phase 8: AI Integration (Optional)

This phase adds optional AI-assisted features. Like cloud sync, this must be opt-in and must not affect offline operation.

| Feature | Description |
|---------|------------|
| AI-assisted page generation | Generate a draft page from a topic prompt using a local or cloud AI model |
| AI summarization | Summarize a page's content with one click |
| Smart tag suggestions | Suggest relevant tags based on page content |

## Decision Points

Each phase beyond Phase 1 requires an explicit owner decision before starting. The roadmap is a living document — phases may be added, removed, or reordered based on user feedback and technical discoveries during earlier phases.

## Cross-References

- [MVP_SCOPE.md](MVP_SCOPE.md) — what is in and out of the MVP
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — MVP success criteria
- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — full requirement list
- [ARCHITECTURE.md](ARCHITECTURE.md) — architectural decisions that enable future phases
