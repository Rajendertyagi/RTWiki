# MVP Scope

This document defines the boundary of the Minimum Viable Product (MVP) and lists features that are intentionally deferred to later phases. The MVP is planned as an aggressive three-day target sequence, not as a promise of elapsed calendar time.

## MVP In-Scope

The MVP implements every requirement in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) **except** those explicitly listed as deferred below.

### Day 1 Target

| Area | Deliverable |
|------|------------|
| Project foundation | Repository structure, `.gitignore`, documentation (this phase) |
| Application shell | Main layout, navigation, theme toggle, sidebar |
| Block editor | BlockNote integration, drag-and-drop, slash menu, formatting toolbar |
| Page CRUD | Create, read, update, delete pages with SQLite persistence |
| Autosave | Debounced autosave with visible save-status indicator |
| Initial GitHub Actions build | Basic pipeline that builds frontend and backend on `windows-latest` |

### Day 2 Target

| Area | Deliverable |
|------|------------|
| HTML import | Paste or import HTML → automatic conversion to editable BlockNote blocks |
| Markdown import | Paste or import Markdown → automatic conversion to editable BlockNote blocks |
| Source input mode | Advanced raw HTML and Markdown input mode for experienced users |
| Cards | Visual card container blocks grouping related content |
| Basic tabs | Tabbed content blocks within a page |
| Formulas | Inline and block mathematical formulas via `@blocknote/math-block` |
| Mermaid diagrams | Static Mermaid diagrams including mind maps via `@blocknote/diagram-block` |
| Allowed attachments | Image, PDF, and document attachment upload and display |

### Day 3 Target

| Area | Deliverable |
|------|------------|
| Full-text search | SQLite FTS5-powered local search across all page content |
| Backup | Single-archive workspace backup with metadata |
| Restore | Validated backup restore |
| Error handling | Centralized error boundaries, user-friendly error messages |
| UI polish | Responsive layout refinements, focus states, accessibility audit |
| Portable Windows artifact | Compiled `.exe` packaged with all frontend assets in a distributable `.zip` |
| MVP quality verification | Run against all acceptance criteria in [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) |

## Definite Out of Scope (MVP)

The following capabilities are **explicitly excluded** from the MVP. They may appear in a future roadmap phase only after the MVP is accepted.

| Deferred Feature | Reason for Deferral |
|-----------------|---------------------|
| React Flow visual mind-map editor | Complex; Mermaid mind maps cover the MVP use case. Evaluated in a later phase. |
| Native desktop wrapper (Electron, Tauri, Electrobun) | Browser-first approach is simpler and sufficient for MVP. Evaluated in a later phase. |
| LAN / mobile access | Requires explicit configuration change; out of scope for initial release. Planned for a later phase. |
| Accounts, profiles, authentication, permissions | Single shared workspace is the MVP model. Not planned. |
| Real-time collaboration | Multi-user concurrency is a significant engineering effort. Not planned. |
| Advanced page-version interface | Versioning is supported internally; a history UI is a later phase. |
| PDF, DOCX, ODT export | Export is an output format; keeping the MVP focused on creation. Evaluated in a later phase. |
| Audio and video support | Explicitly out of scope. Not planned. |

## Cross-References

- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — full requirement list
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — measurable criteria for MVP verification
- [ROADMAP.md](ROADMAP.md) — planned post-MVP phases
- [SECURITY.md](SECURITY.md) — security requirements that apply throughout
