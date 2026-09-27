# Development Standards

This document defines the enforceable rules that govern how RTWiki code is written, reviewed, and maintained. These standards apply to all phases — MVP and beyond. They are not suggestions; violations block merge.

## 1. General Principles

### 1.1 Define Once, Reuse Everywhere

The project owner's "singleton" principle means every reusable value, function, or component must be defined once and imported everywhere it is needed.

- **One authoritative source per configuration value.** If a port number, file-size limit, colour, or text string is used in more than one place, it lives in a shared constant or configuration object.
- **Shared functions for repeated behaviour.** If a pattern appears in three or more places, extract it into a named utility.
- **Reusable UI components.** Common patterns (buttons, cards, modals, form fields) are extracted into shared components before being used for the second time.
- **Shared schemas and types between frontend and backend.** The `shared/` module is the single source of truth for types used by both sides. **Measured:** only `Page` exists as a shared type (`src/shared/contracts/pages.ts:3`), alongside `PageType`, `CreatePageRequest`, `UpdatePageRequest` and `PageListResponse`. `Tag` and `SearchResult` have **0 matches** in `src/shared/`; there is no shared `Block` type; and `Attachment` appears once, in a comment (`document-formats.ts:56`), not as a type. An earlier version of this line named all five as existing, which was wrong. `ARCHITECTURE.md:132` repeats the same claim and is **outside the scope of this correction** — reported, not edited.

### 1.2 True Singletons — Only Where Technically Appropriate

The following may be process-wide single instances:

| Singleton | Reason |
|-----------|--------|
| Typed immutable application configuration | Loaded once at startup; never mutated |
| Database connection / lifecycle manager | One connection pool per process |
| Structured logger | One writer to the log stream |

The following are **explicitly prohibited** as globals:

- Editor instances (scoped to the active page)
- Application services (passed as explicit dependencies)
- State managers (use React state, context, or a local store scoped to a component tree)

## 2. TypeScript Rules

| Rule | Detail |
|------|--------|
| **Strict mode enabled** | All `tsconfig.json` strict flags must be on. No overriding `strict: false`. |
| **No `any` without justification** | Every use of `any` must have an inline comment explaining why it is necessary and what type it should eventually be. |
| **Explicit return types** | All top-level functions and exported member functions declare their return type. |
| **No implicit `any`** | `noImplicitAny` is enabled. Every parameter and variable must have an explicit type when the compiler cannot infer it. |
| **Prefer `as` over `!`** | Non-null assertions (`!`) are prohibited. Use type predicates, nullable types, or runtime checks instead. |

## 3. No Magic Values

| Prohibited | Required |
|-----------|----------|
| Hardcoded file paths (`"C:\\data\\rtwiki"`) | Read from central configuration |
| Hardcoded ports (`3000`) | Read from `config.server.port` |
| Hardcoded limits (`10485760`) | Named constants (`MAX_ATTACHMENT_SIZE`) |
| Hardcoded colours (`"#1a1a1a"`) | Mantine theme tokens (`theme.colors.dark[9]`) |
| Magic strings (`"heading"`, `"saved"`) | Enum or union type constants |
| Magic numbers (`500`, `30`) | Named constants with documented units |

## 4. Configuration

A single `config` object is loaded at application startup. The executable directory is resolved once at startup and all paths are derived from it. No environment-variable override exists for the data directory.

```typescript
// Example structure (not implementation)
const exeDir = getExecutableDirectory(); // resolved once, cached at startup

const config = {
  server: {
    port: Number(env.PORT) || 8080,
    host: env.HOST || "127.0.0.1",   // localhost by default
  },
  data: {
    directory: path.join(exeDir, "data"),
    database: "rtwiki.sqlite",
    attachments: "attachments",
    backups: "backups",
  },
  logs: {
    directory: path.join(exeDir, "logs"),
    filename: "rtwiki.log",
  },
  attachments: {
    maxFileSizeBytes: Number(env.MAX_ATTACHMENT_SIZE) || 50 * 1024 * 1024,
    allowedExtensions: [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".docx", ".odt", ".txt", ".md"],
  },
  autosave: {
    debounceMs: Number(env.AUTOSAVE_DEBOUNCE_MS) || 2000,
  },
};
```

**Provisional defaults** — The autosave debounce interval (`2000 ms`) and maximum attachment size (`50 MB`) are provisional defaults. They are defined once in the centralized configuration object and may be adjusted after MVP usability testing. Changing them must not require modifying multiple modules.

All modules import from this object. No module reads environment variables directly.

## 5. UI Standards

### 5.1 Mantine Theme Tokens

All colours, spacing, typography, shadows, and border radii must come from the Mantine theme. Inline CSS values are prohibited except for rare runtime-calculated exceptions that are documented with a comment.

```typescript
// ✅ Correct
color={theme.colors.blue[6]}
radius={theme.radius.md}

// ❌ Prohibited
style={{ color: "#3b82f6", borderRadius: "8px" }}
```

### 5.2 UI Text Dictionary

All user-facing strings live in a single dictionary module. Even if the MVP is English-only, the dictionary structure must support future localization.

```typescript
// shared/ui-text.ts
export const uiText = {
  page: {
    created: "Page created",
    saved: "Saved",
    saving: "Saving…",
    errorCreating: "Could not create page. Please try again.",
  },
  // …
};
```

### 5.3 No Inline CSS

All styles are defined in Mantine theme tokens, CSS modules, or Emotion styled-components. Inline `style={{ }}` props are prohibited.

### 5.4 Accessibility

- Every interactive element must have a visible focus state.
- Keyboard navigation must be available for all primary workflows (create page, edit, search, navigate sidebar).
- ARIA labels are required on icon-only buttons.
- Colour contrast must meet WCAG AA minimums.

## 6. Database Standards

**There is no ORM.** Drizzle ORM was named in [ADR-002](adr/ADR-002-bun-hono-sqlite.md) and never adopted: absent from `package.json` and `bun.lock`, 0 imports in `src/`. The rule below is re-stated in terms of what actually enforces it — **parameter binding** — because that is the property that matters, and it is enforced by the code doing the binding, not by a library.

| Rule | Detail | Status |
|------|--------|--------|
| **Parameterized queries only** | No string concatenation or template literals for SQL **values**. Pass values as bound parameters (`$1` / `?`) to `bun:sqlite`. Identifiers and keywords may be literal SQL; values may not. | **Enforced in practice** — bound parameters throughout `src/server/repositories/` and `src/server/services/` |
| **Versioned migrations** | Every schema change is a numbered migration, applied automatically at startup | **Built** — `src/server/database/migrations.ts` |
| **SQL is hand-written** | There is no query builder. SQL lives in `src/server/repositories/` and `src/server/services/`, **not** only inside migrations — the earlier "raw SQL is allowed only inside migration files" was false | Re-stated above |
| **Single database connection** | One connection is created at startup; services receive it as a dependency | **Built** — `src/server/database/index.ts` |
| **Transactions for multi-step writes** | A multi-step write must be one transaction | **Partly** — `transaction(...)` is used in repositories/services. The FTS5 index update named in the earlier version is **not** a real path: `search_index_fts` is created (`migrations.ts:37`) and never queried; writes go to the base table `search_index` |

## 7. Error Handling

- **Centralized error boundary** in the React UI catches unhandled errors and displays a user-friendly message.
- **Meaningful error messages** for non-technical users. Never expose stack traces, file paths, or internal error codes to the user.
- **No silent error suppression.** Every `catch` block must log the error (to structured logs) and surface a user-facing message.
- **Typed error classes** in the backend (`AppError`, `NotFoundError`, `ValidationError`, `ConflictError`) are used instead of generic `throw new Error()`.

## 8. Logging

- Structured JSON lines format.
- Log levels: `error`, `warn`, `info`, `debug`.
- Sensitive data (page content, attachment filenames, user-provided text) is **never** logged.
- Log entries include: timestamp, level, module, message, correlation ID (for tracing a request).

## 9. Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case` | `page-service.ts`, `attachment-route.ts` |
| Types / interfaces | `PascalCase` | `Page`, `BlockNoteContent` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_ATTACHMENT_SIZE` |
| Functions | `camelCase` | `createPage()`, `sanitizeHtml()` |
| Components | `PascalCase` | `PageList`, `BlockEditor` |
| Database tables | `snake_case` | `search_index` — **verified** at `src/server/database/migrations.ts:29`. The earlier example `page_tags` **does not exist**; tags are not an implemented feature |
| Environment variables | `UPPER_SNAKE_CASE` | `PORT`, `HOST`, `MAX_ATTACHMENT_SIZE` |

## 10. Module Size and Cohesion

- Modules must be small and focused. A module that exceeds **300 lines of non-comment, non-blank code** should be split.
- Each module must have an explicit public interface (named exports). Everything else is private to the module.
- Circular dependencies are prohibited. If two modules depend on each other, extract the shared concept into a third module.

**Known debt, recorded rather than relaxed.** The 300-line threshold is a target, and the codebase does not currently meet it: **18 modules exceed it**, measured by counting non-comment, non-blank lines across `src/**/*.ts,tsx`. The largest are `src/web/App.tsx` (858), `rich-toolbar.tsx` (617), `html-editor.tsx` (545), `wb-tree-host.ts` (513) and `settings-workspace.tsx` (513).

**The threshold is not being lowered to fit the code, and the debt is not being hidden by deleting the rule.** A new module over 300 lines should be split at creation. Reducing the 18 existing modules is unstarted work, and none of them is a security or correctness risk on its own — the risk would be in *claiming* the rule is met.

## 11. Dependency Management

**The pin is the lockfile, and CI enforces it.** `bun install --frozen-lockfile` runs on every job (`.github/workflows/build.yml:27,52`), so a `package.json` range is a *request* and `bun.lock` is the actual pin. It records the resolved version and integrity hash — `dayjs@1.11.23`, `dompurify@3.4.15` — so a build cannot float.

- **No floating major versions.** A caret may sit on a minor (`^6.5.2` may resolve to `6.9.0`) but must never permit a major jump. This is the same rule as `AGENTS.md` §6, stated in the terms that are actually enforceable.
- **The lockfile is the single source of truth for versions.** Changing a version means changing `bun.lock` deliberately, never as a side effect of an install.
- **Exact pins are preferred** and are the norm: 45 of 48 production dependencies are exact. Three use a caret, and each is within its major — `@codemirror/lang-markdown` `^6.5.2`, `dayjs` `^1.11.23`, `dompurify` `^3.4.15`. These are the accepted exceptions, not a pattern to copy; prefer an exact pin for a new dependency.
- No runtime CDN assets. All JavaScript and CSS must be bundled locally.
- No undocumented or unreviewed dependencies. Every new package requires a brief justification comment in `package.json`.

## 12. Comments

- Comments explain **why**, not **what**. Do not restate the code.
- Decision comments reference the relevant ADR or requirement.
- TODOs must include a ticket reference or author name.

## 13. Prohibited Patterns

| Pattern | Why |
|---------|-----|
| `setTimeout` for debounce without cleanup | Memory leak and stale state |
| `window.localStorage` for page content | Limited size, synchronous blocking, not portable |
| Global mutable state objects | Unpredictable behaviour, hard to test |
| Multiple `new Database()` calls | Connection pool exhaustion |
| `eval()` or `Function()` constructors | Security risk |
| Direct filesystem access outside services | Bypasses validation and logging |

## 14. Modular Block and Extension Architecture

Rich content is implemented as a set of cooperating modules discovered through registries, not through central switch statements. **Requirements below; the first two are not yet met.**

- **Block registry. Required, not implemented.** Every rich block type (cards, tabs, callouts, grids, formulas, diagrams, images, and any future type) is to be owned by its own module declaring a unique type id, a schema (Zod/BlockNote), an editor component, a viewer/renderer, a parser (source → block), a serializer (block → source), and an optional unknown-block fallback. **Measured: no registry exists.** 0 matches for `blockRegistry` / `BLOCK_REGISTRY` in `src/`. `src/web/features/rich-editor/schema.ts:28-37` is a hand-maintained `BlockNoteSchema.create().extend({ blockSpecs: { mathBlock, callout, diagram, mindMap, linkedPage, documentBlock } })` — six named specs, which is the central registration this rule forbids. The block *modules* do exist under `src/web/features/rich-editor/blocks/`; what is missing is the registry that discovers them. **A new block belongs in its own module, and the registry is owed.**
- **Single composition root. Required, not implemented.** One module is to read all registries and wire the editor, renderer, import pipeline, and search extractor together. No such module exists today.
- **No central switch over block types.** Dispatch is to be performed by looking up registry metadata by type id; do not add `if/else` or `switch` ladders keyed on block type.
- **Lifecycle rules (continue accepted practice).** One configuration object, one database connection/lifecycle manager, one structured logger. Editor instances are scoped to the active page; services use explicit dependencies (no hidden globals).
- **Custom content isolation.** Custom HTML/CSS/JS (L3) is rendered only in a sandbox that has no same-origin, database, or filesystem access and no network egress. Active content is off by default. No custom script may run in the main application context.
- **Import is centralized. Required, not implemented.** All entry paths (paste, drop, file, localhost API) are to go through one import pipeline; do not add parallel import code. **Measured: no import pipeline exists** — 0 matches for an import, adapter or sanitise module in `src/`, and no paste handler (0 matches for `handlePaste` / `transformPasted` / `clipboard`). `src/shared/schemas/html-content.ts` and `markdown-content.ts` are page-content *schemas*, not import adapters. The consequence for security is in [SECURITY.md](SECURITY.md) §2.3: because no such path exists, no pasted or imported HTML is sanitized by RTWiki today. The rule stands so that building one cannot bypass it.

## 15. Markdown and Sanitisation

**Scope: this section governs the Markdown render path only.** DOMPurify is imported in exactly one file in `src/` — `markdown-render.ts:1`, called at `:136`. It does **not** cover pasted HTML, the raw-HTML page, or diagram output; those have their own controls, itemised in [SECURITY.md](SECURITY.md) §2.1. Do not describe DOMPurify as covering them.

- **One engine, one grammar.** Markdown is parsed by `micromark` with `micromark-extension-gfm`, composed once at module scope in `markdown-render.ts`. The outline parses with `mdast-util-from-markdown`, which shares the grammar. Do not add a second Markdown parser, and do not parse headings with a regular expression — see [ADR-017](adr/ADR-017-markdown-engine-micromark.md).
- **Inline maths is delimited by GitHub's adjacency rule, by a local construct.** `math-inline-github-rule.ts` replaces the package's inline construct because `micromark-extension-math` decides by marker count and cannot express the rule; display maths and the KaTeX renderer remain the package's. Both halves are asserted separately, so a reader is not misled into thinking one library does both — see [ADR-017](adr/ADR-017-markdown-engine-micromark.md).
- **Never carry untrusted text in an attribute.** DOMPurify strips any attribute whose value matches `-->`, `]>`, or `</script`. Diagram and other source text is carried as element **text content**, never as a `data-` attribute, and the sanitiser is never weakened with `SAFE_FOR_XML: false` to accommodate one.
- **Raw HTML in Markdown is inert by design.** The parser escapes it. Do not add an extension that re-enables raw HTML passthrough without a new ADR; it moves the whole security burden back onto the sanitiser.
- **Extensions must not change unhandled output.** An extension that intercepts one construct must leave every other construct byte-identical to stock micromark, and a table-driven test must prove it.
- **Sanitiser policy lives in one exported constant.** `MARKDOWN_SANITIZE_OPTIONS` is exported so it can be asserted directly: a profile change is a security change and must be covered by tests that feed it hostile markup, not only by tests that pass well-formed input through it.

## Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — layer boundaries these standards govern
- [SECURITY.md](SECURITY.md) — security-specific standards
- [CI_CD.md](CI_CD.md) — automated checks that enforce these standards
- [DATA_MODEL.md](DATA_MODEL.md) — naming conventions for database entities
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
