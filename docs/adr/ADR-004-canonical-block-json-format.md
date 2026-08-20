# ADR-004: Canonical BlockNote JSON Format

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki stores page content in a database. The content can be created in several ways:
- Direct editing in the BlockNote editor
- Pasting HTML from a browser or AI response
- Pasting Markdown text
- Importing an HTML or Markdown file
- Entering raw HTML or Markdown in source input mode

The question is: what format should be stored in the database as the canonical representation of a page's content?

## Decision

**BlockNote JSON is the canonical saved format.** Every page's `content` column stores a **versioned, RTWiki-extended BlockNote JSON** document. HTML and Markdown are converted to and from BlockNote JSON at the API boundary — they are never stored directly in the database. Rich structures are represented as **typed custom blocks** (cards, tabs, callouts, grids, formulas, diagrams) defined in the block registry. This decision is extended, not reversed, by [ADR-006](ADR-006-rich-content-and-import-contract.md).

The data flow is:

```
User input (editor / paste / import / source mode)
        ↓
   BlockNote JSON    ← saved to database
        ↓
   BlockNote JSON    ← read from database
        ↓
   Rendered in editor
```

When HTML or Markdown is imported, the conversion happens immediately and only the resulting BlockNote JSON is persisted. When exporting (future phase), BlockNote JSON is converted back to the target format.

When converting rich HTML or Markdown to canonical JSON is **not lossless**, the original rich-HTML source is **retained** as a typed `richHtml` block inside `pages.content` so no content is silently lost. **Unknown or unrecognized block types are preserved, not deleted** — they are stored and rendered with a safe fallback, and flagged for review. BlockNote JSON remains the single source of truth for rendering and search; this decision is extended, not reversed, by [ADR-006](ADR-006-rich-content-and-import-contract.md) and [ADR-007](ADR-007-sandboxed-custom-content.md).

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| Store raw HTML in the database | HTML is ambiguous (who wrote it? what sanitization was applied?). Diffing and merging HTML is fragile. Searching HTML content requires parsing on every query. |
| Store raw Markdown in the database | Markdown loses structural information (e.g., inline styles, custom attributes). Converting Markdown to an editable format on load is lossy. |
| Store both HTML and BlockNote JSON | Doubles storage. Creates synchronization problems. The canonical format should be one, not two. |
| Store a custom XML-like format | Reinvents the wheel. BlockNote JSON is a well-defined, stable format with tooling support. |

## Consequences

**Positive:**
- One format to validate, search, version, and migrate.
- BlockNote JSON is structured and machine-readable, making search indexing and diffing straightforward.
- Import and export are transformation problems at the boundary, not storage problems.
- The editor and the database speak the same language, eliminating round-trip serialization bugs.
- Future features (page versioning, diff views, export) are simpler because the canonical form is structured.

**Negative:**
- Importing HTML or Markdown requires a conversion step that may not be 100% faithful to the original (e.g., custom HTML classes are lost).
- The BlockNote JSON schema is tied to the BlockNote version. Schema migrations may be needed when BlockNote upgrades.

**Neutral:**
- The conversion step is an implementation detail. The user experiences a seamless import regardless of the source format.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| BlockNote JSON schema changes in a future version | Medium | Version the content schema. Migrate old content on application startup. Keep the migration logic in a dedicated module. |
| Import conversion loses formatting details | Medium | Document known limitations. Allow users to switch to source input mode for fine-grained control. |
| BlockNote JSON is larger than equivalent HTML | Low | The size difference is negligible for typical wiki pages. Compression can be applied at the database level if needed. |

## Revisit Conditions

This decision should be revisited if:
- BlockNote changes its JSON schema in a way that makes migration impractical.
- A requirement emerges that necessitates storing raw HTML (e.g., preserving exact third-party HTML formatting).
- Performance testing shows that BlockNote JSON is significantly larger or slower to process than an alternative format.

## Cross-References

- [ARCHITECTURE.md](../ARCHITECTURE.md) — canonical format decision
- [DATA_MODEL.md](../DATA_MODEL.md) — entities that store BlockNote JSON
- [DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md) — coding standards
- [SECURITY.md](../SECURITY.md) — sanitization at the boundary
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](ADR-007-sandboxed-custom-content.md) — sandboxed custom content
