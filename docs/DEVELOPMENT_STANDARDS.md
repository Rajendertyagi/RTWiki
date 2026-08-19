# Development Standards

This document defines the enforceable rules that govern how RTWiki code is written, reviewed, and maintained. These standards apply to all phases — MVP and beyond. They are not suggestions; violations block merge.

## 1. General Principles

### 1.1 Define Once, Reuse Everywhere

The project owner's "singleton" principle means every reusable value, function, or component must be defined once and imported everywhere it is needed.

- **One authoritative source per configuration value.** If a port number, file-size limit, colour, or text string is used in more than one place, it lives in a shared constant or configuration object.
- **Shared functions for repeated behaviour.** If a pattern appears in three or more places, extract it into a named utility.
- **Reusable UI components.** Common patterns (buttons, cards, modals, form fields) are extracted into shared components before being used for the second time.
- **Shared schemas and types between frontend and backend.** The `shared/` module is the single source of truth for types such as `Page`, `Block`, `Tag`, `Attachment`, and `SearchResult`.

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

A single `config` object is loaded at application startup from environment variables with documented defaults.

```typescript
// Example structure (not implementation)
const config = {
  server: {
    port: Number(env.PORT) || 8080,
    host: env.HOST || "127.0.0.1",   // localhost by default
  },
  data: {
    directory: env.RTWIKI_DATA_DIR || getDefaultDataDirectory(),
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

| Rule | Detail |
|------|--------|
| **Parameterized queries only** | No string concatenation or template literals for SQL values. Use Drizzle parameter binding. |
| **Versioned migrations** | Every schema change is a numbered migration file. Migrations are applied automatically at startup. |
| **No raw SQL in services** | Use Drizzle query builders. Raw SQL is allowed only inside migration files. |
| **Single database connection** | One connection pool is created at startup. Services receive it as a dependency. |
| **Transactions for multi-step writes** | Page save + FTS5 index update + attachment metadata must be in a single transaction. |

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
| Database tables | `snake_case` | `page_tags`, `search_index` |
| Environment variables | `UPPER_SNAKE_CASE` | `RTWIKI_DATA_DIR`, `PORT` |

## 10. Module Size and Cohesion

- Modules must be small and focused. A module that exceeds 300 lines of non-comment, non-blank code should be split.
- Each module must have an explicit public interface (named exports). Everything else is private to the module.
- Circular dependencies are prohibited. If two modules depend on each other, extract the shared concept into a third module.

## 11. Dependency Management

- All dependency versions are pinned in the lockfile. No `^` or `~` range selectors in `package.json` for production dependencies.
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

## Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — layer boundaries these standards govern
- [SECURITY.md](SECURITY.md) — security-specific standards
- [CI_CD.md](CI_CD.md) — automated checks that enforce these standards
- [DATA_MODEL.md](DATA_MODEL.md) — naming conventions for database entities
