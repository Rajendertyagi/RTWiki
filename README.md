# RTWiki

A lightweight, offline-first personal knowledge workspace for a family user. RTWiki runs entirely on a local Windows PC — no accounts, no internet connection, no cloud dependency. Pages are built visually with block-based editing, rich content support, local search, and one-click backup and restore. The final result is a single portable Windows application that anyone can download and run.

## Status

**Planning approved — implementation not started**

All design decisions, architecture, data model, security requirements, development standards, and acceptance criteria have been documented in the `docs/` folder. The approved technology choices are recorded in the Architecture Decision Records. Implementation can begin once the owner gives the go-ahead.

## Key Requirements

- **Completely offline** — no runtime internet dependency
- **No accounts or authentication** — one shared workspace for the whole family
- **Block-based visual editor** — drag-and-drop blocks, slash menu, formatting toolbar
- **Rich content** — headings, lists, checklists, quotes, tables, code blocks, cards, tabs, formulas, Mermaid diagrams, images, PDFs, and document attachments
- **Import and export** — paste from AI responses and websites; import HTML and Markdown
- **Page linking, tags, and search** — flexible organization with local full-text search
- **Autosave, undo/redo, backup and restore**
- **Light and dark themes**
- **Portable Windows executable** — download and run; no install process required
- **No audio or video support**
- **No cloud or AI features**

Full requirements are documented in [PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md).

## Proposed Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono |
| Database | SQLite (Bun SQLite) with FTS5 |
| ORM | Drizzle ORM |
| Frontend | React with TypeScript, Vite |
| Editor | BlockNote (with `@blocknote/math-block` and `@blocknote/diagram-block`) |
| UI Library | Mantine UI |
| HTML Sanitization | DOMPurify |
| Icons | Tabler Icons React |
| Build / CI | GitHub Actions on `windows-latest` |

Exact stable versions for all dependencies will be selected and pinned during the implementation phase. Major versions will never float. Compatibility between React, BlockNote, Mantine, and Vite takes priority over selecting the newest version.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) and the ADRs for details.

## Documentation Index

### Product & Planning

- [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) — complete list of confirmed requirements
- [MVP Scope](docs/MVP_SCOPE.md) — three-day MVP plan and deferred features
- [Roadmap](docs/ROADMAP.md) — phased feature rollout beyond the MVP
- [Acceptance Criteria](docs/ACCEPTANCE_CRITERIA.md) — measurable pass/fail criteria for MVP

### Architecture & Design

- [Architecture](docs/ARCHITECTURE.md) — modular monolith design, layer boundaries, data flow
- [Data Model](docs/DATA_MODEL.md) — entities, relationships, and indexing strategy
- [Security](docs/SECURITY.md) — threat model and security requirements

### Development

- [Development Standards](docs/DEVELOPMENT_STANDARDS.md) — enforceable coding rules and conventions
- [CI / CD](docs/CI_CD.md) — GitHub Actions workflow plan

### Architecture Decision Records

- [ADR Index](docs/adr/README.md)
- [ADR-001: Browser-first Local Application](docs/adr/ADR-001-browser-first-local-application.md) — **Accepted**
- [ADR-002: Bun, Hono, and SQLite](docs/adr/ADR-002-bun-hono-sqlite.md) — **Accepted**
- [ADR-003: React, BlockNote, and Mantine](docs/adr/ADR-003-react-blocknote-mantine.md) — **Accepted**
- [ADR-004: Canonical BlockNote JSON Format](docs/adr/ADR-004-canonical-block-json-format.md) — **Accepted**
- [ADR-005: Portable Data Layout Beside the Executable](docs/adr/ADR-005-portable-data-layout.md) — **Accepted**
