# MVP Scope

This document defines the boundary of the Minimum Viable Product (MVP) and lists features that are intentionally deferred to later phases. The MVP is organized as a sequence of internal milestones (Foundation, Rich Content, and Hardening/Packaging). The milestone ordering is a planning target, not a promise of elapsed calendar time.

## MVP In-Scope

The MVP implements every requirement in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — including the rich-content requirements **R-040 through R-063** — except those explicitly listed as deferred below.

### Milestone 1: Foundation & Editor

| Area | Deliverable |
|------|------------|
| Project foundation | Repository structure, `.gitignore`, documentation (this phase) |
| Application shell | Main layout, navigation, theme toggle, sidebar |
| Block editor | BlockNote integration, drag-and-drop, slash menu, formatting toolbar |
| Page CRUD | Create, read, update, delete pages with SQLite persistence |
| Autosave | Debounced autosave with visible save-status indicator |
| Initial GitHub Actions build | Basic pipeline that builds frontend and backend on `windows-latest` |
| Modular block foundation | Block registry, import-adapter registry, composition root, and per-block module skeleton (enables R-042/R-041) |

### Milestone 2: Rich Content & Import

| Area | Deliverable |
|------|------------|
| HTML import | Paste or import HTML → automatic conversion to editable BlockNote blocks |
| Markdown import | Paste or import Markdown → automatic conversion to editable BlockNote blocks |
| Source input mode | Advanced raw HTML and Markdown input mode for experienced users |
| Native block schema | RTWiki-extended, versioned BlockNote custom-block schema (L1) |
| Cards | First-class nested card container block (R-051) |
| Basic tabs | First-class tabbed container block (R-052) |
| Callouts | First-class callout block with type/severity (R-053) |
| Grids | First-class multi-column responsive grid block (R-054) |
| Formulas | Inline and block mathematical formulas via `@blocknote/math-block` (R-055) |
| Mermaid diagrams | Static Mermaid diagrams including mind maps via `@blocknote/diagram-block` (R-056) |
| Allowed attachments | Image, PDF, and document attachment upload and display (R-024) |
| Versioned `rt-*` HTML | RTWiki HTML vocabulary (L2) for rich structures and sanitized fallback (R-043) |
| Shared import pipeline | One pipeline for paste, drop, and file import (adapter → validation → sanitize → asset localization → convert → preview → canonical JSON → transactional save) (R-041) |
| AI note workflow | Import of AI-generated rich pages via paste and the `.rtwiki.zip` note-package (R-040, R-045, R-046) |
| Note-package import | Manifest validation, transactional write, rollback, ZIP-bomb and path-traversal protection (R-045, R-046, R-048, R-049, R-050) |
| Asset localization | Images and assets rewritten into `data/attachments/` (R-047) |
| Lossless handling | Preview before save, retain rich-HTML fallback source, preserve unknown blocks (R-057, R-058, R-061) |

### Milestone 3: Search, Hardening, Sandbox & Packaging

| Area | Deliverable |
|------|------------|
| Full-text search | SQLite FTS5-powered local search across all page content |
| Backup | Single-archive workspace backup with metadata |
| Restore | Validated backup restore |
| Error handling | Centralized error boundaries, user-friendly error messages |
| UI polish | Responsive layout refinements, focus states, accessibility audit |
| Scoped custom CSS | Per-page scoped CSS (L3), disabled by default and toggleable (R-059, R-062) |
| Sandboxed custom JS | Per-page JavaScript in an isolated iframe, disabled by default (R-060, R-062) |
| Localhost import API | Documented-but-implemented target `POST /api/v1/import/pages`, loopback-only (R-041, R-044, R-063) |
| Offline render | All imported content (native, `rt-*`, sandboxed) renders fully offline |
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
| Global JS plugins / marketplace | Per-page sandboxed JS is the MVP boundary; trusted-global customization and a marketplace are future, disabled-by-default capabilities (see [ADR-007](adr/ADR-007-sandboxed-custom-content.md)). |
| Cloud AI chat / local-model inference | Receiving AI-generated content is in scope; a built-in chat is a future, network-free phase (see [ROADMAP.md](ROADMAP.md)). |
| Cloud sync | Not planned. The workspace is a single portable local store. |

## Cross-References

- [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) — full requirement list
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — measurable criteria for MVP verification
- [ROADMAP.md](ROADMAP.md) — planned post-MVP phases
- [SECURITY.md](SECURITY.md) — security requirements that apply throughout
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
