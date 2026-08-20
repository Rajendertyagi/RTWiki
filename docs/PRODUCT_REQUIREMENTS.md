# Product Requirements

This document captures all confirmed requirements for RTWiki. It is the single authoritative source for what the system must do. Later documents — MVP scope, acceptance criteria, roadmap — reference this document rather than restate requirements.

## 1. Operational Model

| # | Requirement | Notes |
|---|------------|-------|
| R-001 | The application must run completely offline. No runtime internet connectivity is required for any core feature. | CDN links, telemetry, or API calls to external services are prohibited. |
| R-002 | The application must require no user accounts, profiles, authentication, or permissions. | A single shared workspace is used by everyone on the PC. |
| R-003 | There must be exactly one shared local workspace per installation. | No multi-tenant or multi-user isolation is required in the MVP. |
| R-004 | The application must be downloadable as a portable Windows artifact. The user must not need to install Bun, Node.js, Docker, a compiler, or any other runtime. | GitHub Actions produces a `.zip` or `.exe` artifact that can be extracted and run directly. |
| R-005 | Future LAN access from phones and tablets must be architecturally possible without redesign. | Localhost binding is the default; LAN binding requires an explicit configuration change (see [SECURITY.md](SECURITY.md)). |

## 2. Page Organization

| # | Requirement |
|---|------------|
| R-006 | Pages must be flexible. No fixed hierarchy such as "study" or "folder" is imposed. |
| R-007 | Pages must support tags for flexible, multi-dimensional organization. |
| R-008 | Pages must support linking to other pages. Backlinks must be visible so users can see which pages reference the current page. |
| R-009 | Users must be able to create, rename, duplicate, and delete pages. |
| R-010 | Deleted pages must move to a recycle bin from which they can be restored. Permanent deletion requires an explicit confirmation action. |

## 3. Editor & Content

| # | Requirement |
|---|------------|
| R-011 | Editing must be block-based. Each content unit (paragraph, heading, list item, image, etc.) is an independent draggable block. |
| R-012 | Users must be able to drag and drop blocks to rearrange them. |
| R-013 | A visual formatting toolbar must be available for common styling actions (bold, italic, heading level, list type, etc.). |
| R-014 | A slash menu must be available to insert new blocks by typing `/`. |
| R-015 | Users must be able to paste content directly from AI chat responses and from web browsers. |
| R-016 | Pasted HTML must be converted into editable BlockNote blocks automatically. |
| R-017 | Pasted Markdown must be converted into editable BlockNote blocks automatically. |
| R-018 | An advanced raw input mode must be available for direct HTML and Markdown entry by experienced users. |
| R-019 | The editor must support the following block types: headings (H1–H3), paragraphs, bullet lists, numbered lists, checklists, blockquotes, tables, and code blocks. |
| R-020 | The editor must support **Cards** — grouped visual containers for related blocks. |
| R-021 | The editor must support **Basic Tabs** — tabbed content within a page. |
| R-022 | The editor must support **inline and block mathematical formulas** rendered using a math library compatible with BlockNote (`@blocknote/math-block`). |
| R-023 | The editor must support **Mermaid diagrams**, including Mermaid mind maps (`@blocknote/diagram-block`). |
| R-024 | The application must support attaching **images, PDFs, and documents** to pages. |
| R-025 | Audio and video files must **not** be supported in the MVP. |

## 4. Search & Navigation

| # | Requirement |
|---|------------|
| R-026 | Full-text search must run locally against all page content. No external search service is used. |
| R-027 | Search results must show page title, a snippet of matching content, and the page's tags. |

## 5. Data Persistence

| # | Requirement |
|---|------------|
| R-028 | Changes must be autosaved with a debounce interval. The user must see a visible save-status indicator. |
| R-029 | Undo and redo must be available at the block level and at the page level. |
| R-030 | Recovery from an interrupted save (crash, power loss) must not result in data loss. The most recent successfully written state must be recoverable. |

## 6. Backup & Restore

| # | Requirement |
|---|------------|
| R-031 | Users must be able to create a backup of the entire workspace as a single archive file. |
| R-032 | Users must be able to restore from a backup archive. The application must validate the archive before restoring. |
| R-033 | Backup metadata (timestamp, size, version) must be stored alongside each backup for reference. |

## 7. Appearance

| # | Requirement |
|---|------------|
| R-034 | The application must support light and dark themes. |
| R-035 | The theme must be switchable from within the application. |
| R-036 | The UI must be clean, responsive, and accessible. Keyboard navigation and visible focus states must be supported. |

## 8. Non-Functional Constraints

| # | Constraint |
|---|-----------|
| R-037 | No CDN or runtime internet dependency. All assets must be bundled locally. |
| R-038 | No secrets (API keys, tokens, passwords) may be committed to the Git repository. |
| R-039 | Error messages presented to the user must be meaningful and understandable by a non-technical person. |

## 9. Rich-Content Import & AI-Generated Notes

RTWiki is built to receive rich study notes produced by external AI tools. The application ingests that content through a single shared pipeline (paste, file drop, file import, or a localhost-only API) and stores it as canonical BlockNote JSON. Content may use one of three richness levels: native RTWiki custom blocks (L1), a versioned RTWiki `rt-*` HTML vocabulary (L2), or sandboxed custom HTML/CSS/JS (L3). See [AI Content Import](AI_CONTENT_IMPORT.md), [ADR-006](adr/ADR-006-rich-content-and-import-contract.md), and [ADR-007](adr/ADR-007-sandboxed-custom-content.md).

| # | Requirement |
|---|------------|
| R-040 | The application must support a local AI-generated note workflow: an external AI tool produces a rich page that RTWiki imports, validates, previews, and stores as canonical BlockNote JSON without requiring a network. |
| R-041 | All content entry paths — paste, file drop, file import, and the localhost import API — must share one centralized import pipeline (adapter → validation → sanitize → asset localization → convert → preview → canonical JSON → transactional save). |
| R-042 | The application must support a native rich-content block model (L1): first-class BlockNote custom blocks for cards, tabs, callouts, grids, formulas, Mermaid diagrams, and images. |
| R-043 | The application must support a versioned RTWiki HTML vocabulary (L2, `rt-*` elements and attributes) for rich structures that map to native blocks or are preserved as sanitized HTML. |
| R-044 | The application must support optional per-page custom HTML/CSS/JS (L3) rendered in an isolated sandbox (iframe) with no same-origin access to the application. |
| R-045 | The application must provide a RTWiki note-package (`.rtwiki.zip`) as the preferred interchange format for AI-generated pages, containing a manifest, content, optional HTML/CSS/JS, and assets. |
| R-046 | The note-package manifest must declare a schema `version` and a list of pages; the importer must validate the manifest before any content is written. |
| R-047 | Import must localize referenced images and assets into `data/attachments/` and rewrite references to the localized storage path. |
| R-048 | Import must be transactional: either all pages and assets are written, or none. A failed import must not leave partial data behind. |
| R-049 | Import must support rollback: a failed or rejected import must not alter existing pages; the prior workspace state must remain intact. |
| R-050 | The importer must reject packages that exceed configured size limits (ZIP-bomb protection) and must prevent path traversal in archive entry names. |
| R-051 | Cards must be supported as a first-class nested container block (L1) that groups related blocks. |
| R-052 | Tabs must be supported as a first-class container block (L1) with switchable panels. |
| R-053 | Callouts must be supported as a first-class block with a type/severity and inline content. |
| R-054 | Grids (multi-column responsive layout) must be supported as a first-class block (L1). |
| R-055 | Mathematical formulas must render via `@blocknote/math-block` (inline and block). |
| R-056 | Mermaid diagrams, including mind maps, must render via `@blocknote/diagram-block`. |
| R-057 | When conversion of rich HTML/Markdown to canonical JSON is not lossless, the original rich-HTML source must be stored as a typed `richHtml` block inside `pages.content` (see [AI Content Import](AI_CONTENT_IMPORT.md)) so no content is silently lost. |
| R-058 | Unknown or unrecognized block types must be preserved (stored) rather than deleted; they must render with a safe fallback and be flagged for review. |
| R-059 | Per-page custom CSS must be scoped (encapsulated) so it cannot affect the rest of the application; it must not apply outside the page that defines it. |
| R-060 | Per-page custom JavaScript must run only inside a sandboxed iframe; it must have no same-origin, database, or filesystem access and no network egress. |
| R-061 | The application must show a preview of imported content before saving, displaying the sanitized output and any warnings (unknown blocks, stripped scripts). |
| R-062 | Imported custom content (CSS/JS) must be disableable by a user setting; active content (scripts) must be off by default and toggleable. |
| R-063 | The RTWiki core application must not depend on any external AI service or network at runtime; receiving AI-generated content occurs only through local files or the localhost import API. A future optional AI chat may use either a local-model adapter (offline) or an explicitly-selected cloud provider (opt-in, with disclosure of what is sent and no committed credentials); the core app and all offline features work without any AI or network. |

## Cross-References

- [MVP_SCOPE.md](MVP_SCOPE.md) — what is included in the milestone plan
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) — measurable pass/fail criteria for each requirement
- [ROADMAP.md](ROADMAP.md) — planned expansion beyond the MVP
- [SECURITY.md](SECURITY.md) — security requirements that protect these capabilities
- [DATA_MODEL.md](DATA_MODEL.md) — the data structures that implement these requirements
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and shared import pipeline
- [REFERENCE_RESEARCH.md](REFERENCE_RESEARCH.md) — comparable tools and libraries researched
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
