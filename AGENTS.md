# AGENTS.md — Mandatory Agent Protocol for RTWiki

This file governs **every automated coding agent** that works inside the RTWiki
repository. It is the first thing an agent must read and the rule set it must
follow. It summarises enforceable behaviour and links to the detailed project
documents. It does **not** replace those documents — it tells the agent when to
read them and what to do when they disagree.

## 1. Purpose and Precedence

- `AGENTS.md` governs all work performed inside this repository.
- The **current authorized task prompt** defines the immediate scope. An agent must do only what that prompt authorizes.
- **Accepted ADRs** ([ADR index](docs/adr/README.md)) define architecture decisions.
- **Product requirements** ([Product requirements](docs/PRODUCT_REQUIREMENTS.md)) and **acceptance criteria** ([Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)) define expected behaviour.
- **Development standards** ([Development standards](docs/DEVELOPMENT_STANDARDS.md)) and **security requirements** ([Security](docs/SECURITY.md)) are mandatory.
- If any documents conflict, the agent **must stop and report the conflict** instead of silently choosing one. It must not guess which is correct.
- An agent **must not** change an accepted ADR without explicit owner authorization **and** a dedicated ADR update that supersedes it.
- An agent **must not** invent features or expand scope beyond the authorized task.

## 2. Mandatory Pre-Work Protocol

Before writing or changing anything, every agent must:

1. Confirm the repository (`Rajendertyagi/RTWiki`) and the current branch.
2. Inspect `git status` and note the state of the working tree.
3. Preserve existing user changes — never discard uncommitted work silently.
4. Read the documents relevant to its task (this file plus the linked specs).
5. Identify the exact authorized files and scope from the task prompt.
6. Check whether another in-flight change overlaps the same files.
7. Report blockers or contradictions **before** implementation.
8. Never assume permission for unrelated cleanup, refactoring, or formatting.

## 3. Git Protocol

- Use a **dedicated branch** for each implementation or documentation task unless explicitly instructed otherwise.
- Never create a **nested Git repository**.
- Never use destructive commands such as `git reset --hard`, forced checkout, or broad file deletion.
- Do **not** rewrite published history.
- Do **not** force-push.
- Keep commits focused and clearly named (e.g. `docs: add AGENTS.md protocol`).
- Do **not** commit runtime data, logs, secrets, build output, or downloaded dependencies.
- Do **not** merge into `main` unless explicitly authorized.
- Always report the branch name and the commit hash of the work.
- If the working tree is unexpectedly dirty, **stop and report it** before proceeding.

## 4. Scope-Control Protocol

- Implement only explicitly authorized work.
- Prefer the **smallest complete change** that satisfies the task.
- Avoid speculative abstractions and "future-proofing" not requested.
- Avoid unrelated formatting or dependency updates.
- Do **not** add accounts, cloud sync, real-time collaboration, audio, or video. Receiving AI-generated content offline is a core capability; RTWiki core has no AI dependency. A built-in AI chat is a future optional phase with provider-neutral adapters — a local-model adapter may run offline, and a cloud-provider adapter may be used only with explicit opt-in and disclosure of what is sent. It is not part of the MVP.
- Do **not** introduce a native desktop wrapper (Electron/Tauri/Electrobun) or LAN mode during the MVP unless explicitly authorized.
- Do **not** silently replace an accepted library or architecture decision.
- Record any legitimate architecture change through a new ADR.
- Treat rich AI-generated content as a core capability: native custom blocks, a versioned `rt-*` HTML vocabulary, and sandboxed custom HTML/CSS/JS. Custom JavaScript runs only in an isolated sandbox, never in the main application context.
- Route every content import (paste, drop, file, or localhost API) through one shared, centralized import pipeline; do not add parallel import paths. This rule stands; no such pipeline is implemented yet.
- Never silently lose content during import; surface warnings instead of dropping data. Preserve unknown blocks. **Partly met — do not read this as whole.** Preserving unknown blocks: **verified.** `containUnknownBlocks` (`src/web/features/rich-editor/document.ts`) rewrites each unknown block into a `codeBlock` holding its exact JSON behind `UNSUPPORTED_BLOCK_MARKER`, so the original survives every autosave round-trip. The walk is **recursive** (commit `2fc0eb8`) and covers both nesting sites in BlockNote JSON: `children`, and `content.rows[].cells[].content` for table cells, whose `children` is an empty array. Before that it was a flat `map` over the top level, so an unknown block inside a list item or a table cell reached BlockNote's converter, which dereferenced `schema.nodes[block.type]` for an undeclared type, got `undefined`, threw, and the editor never mounted. It is bounded by `MAX_CONTAINMENT_DEPTH = 16`, at which the block is contained whole with its entire subtree as the payload, so nothing is dropped. Surfacing warnings: **not implemented.** `isUnknownBlockPreserved` (`src/web/features/rich-editor/document.ts`) is **imported by nothing in `src/` except a test** — `tests/rich-blocks-compat.test.ts`. No user is ever told their content contained an unknown block. Both requirements stand; the warning half is unbuilt work. The `richHtml` block previously mandated here **was never implemented** — do not write code against it.

## 5. Define Once, Reuse Everywhere

The owner requires a single, authoritative definition for every reusable value, function, and component (the "singleton" principle, correctly understood):

- Follow DRY while avoiding premature abstraction.
- Maintain **one source of truth** for each configuration value and business rule.
- Reuse shared functions, schemas, services, and UI components.
- Do **not** duplicate validation or data-access logic.
- Do **not** scatter paths, limits, routes, labels, colours, or timing values across files.
- Use centralized typed configuration, Mantine theme tokens, and a UI text dictionary.
- Avoid uncontrolled global mutable state.

**Literal process-wide single instances** are appropriate only for:

- Immutable application configuration (loaded once at startup).
- Database connection and lifecycle manager.
- Structured logger.

Editor instances must be scoped to the active page. Ordinary services must use **explicit dependencies** rather than hidden global access (see [Development standards](docs/DEVELOPMENT_STANDARDS.md)).

## 6. Architecture Protocol

RTWiki is a **modular monolith** built on the accepted architecture ([ADR-002](docs/adr/ADR-002-bun-hono-sqlite.md), [ADR-003](docs/adr/ADR-003-react-blocknote-mantine.md)):

- Runtime: **Bun**
- Backend: **Hono**
- Database: **Bun SQLite** (`bun:sqlite`), accessed through hand-written parameterised SQL. **There is no ORM.** Drizzle ORM was named in [ADR-002](docs/adr/ADR-002-bun-hono-sqlite.md) and never adopted.
- Frontend: **React** + **Vite**
- Editor: **BlockNote** with `@blocknote/math-block`. The diagram, mind-map, callout, linked-page and document blocks are **first-party**, under `src/web/features/rich-editor/blocks/`. `@blocknote/diagram-block` was named in [ADR-003](docs/adr/ADR-003-react-blocknote-mantine.md) and never adopted.
- UI: **Mantine**
- HTML sanitization: **DOMPurify**
- Search: `GET /api/pages?q=`, matching the `search_index` table with `LIKE`. The FTS5 virtual table exists (`src/server/database/migrations.ts:37`) and is **never queried**. Do not describe search as FTS5-backed.

Architecture claims are reconciled under [ADR-018](docs/adr/ADR-018-documented-vs-built.md). **Where this file or any other document disagrees with the code, the code is authoritative** — read the source, and report the discrepancy instead of trusting the prose. Work that is required but unbuilt is labelled `Planned — not implemented.`

The agent must:

- Use **strict TypeScript** everywhere.
- Keep clear **frontend, API, service, and persistence** boundaries.
- Share schemas and types between frontend and backend.
- Treat **BlockNote JSON** as the canonical page storage; HTML and Markdown are conversion formats only (see [ADR-004](docs/adr/ADR-004-canonical-block-json-format.md)).
- Use a **modular block architecture**: each rich block type is owned by its own module (type id, schema, editor, viewer, parser, serializer) registered in a block registry. A single composition root wires the registries together; avoid central switch statements over block types (see [ADR-006](docs/adr/ADR-006-rich-content-and-import-contract.md)). **This requirement is not yet met.** `src/web/features/rich-editor/schema.ts` is a hand-maintained six-spec list, which is the central registration this rule forbids. That file is known debt, not the pattern to copy: a new block belongs in its own module, and the registry is owed.
- Lazy-load heavy diagram/math features.
- Add no unnecessary framework or infrastructure.
- Pin **stable, compatible** dependency versions in the lockfile; **no floating major versions** (see [Development standards](docs/DEVELOPMENT_STANDARDS.md)).

## 7. Portable Filesystem Protocol

Runtime data must live in exactly this structure beside the executable (see [ADR-005](docs/adr/ADR-005-portable-data-layout.md)):

```text
RTWiki/
├── RTWiki.exe
├── data/
│   ├── rtwiki.sqlite
│   ├── attachments/
│   └── backups/
└── logs/
    └── rtwiki.log
```

Mandatory rules:

- Derive all paths from the **executable location**, never the current working directory.
- Do **not** use `AppData`, `%LOCALAPPDATA%`, or an environment-variable data override.
- Do **not** silently fall back to another directory if the executable folder is not writable — show a clear error and stop.
- Define directory and file names **once** (in the config module).
- Create missing directories at startup.
- Check write access and show a clear error if the folder is protected.
- Keep SQLite **WAL** and **SHM** files inside `data/`.
- Include the database and attachments in backups; **exclude logs** from backups. This rule stands; no backup or restore feature is implemented yet. The `data/backups/` directory is created at startup and stays empty, so an agent must not assume a backup exists or that `VACUUM INTO` is in use.
- Rotate and limit logs; never log private page or pasted content.

## 8. Coding Standards

- TypeScript **strict mode**; no unjustified `any`.
- No magic strings or numbers — use named constants and enum/union types.
- Small modules with clear responsibilities; explicit interfaces at module boundaries.
- Reusable components; no inline CSS except documented runtime-calculated exceptions.
- Use **Mantine theme tokens** for visual values; use a **central UI text dictionary** for user-facing strings.
- Consistent naming (see [Development standards](docs/DEVELOPMENT_STANDARDS.md)).
- Parameterized database queries only; versioned migrations; transactions for multi-step writes.
- Central error handling with meaningful, non-technical user-facing errors.
- Safe filenames and path handling; atomic file operations where practical.
- Debounced autosave with a visible save-status indicator.
- Comments that explain **decisions**, not obvious syntax; no swallowed exceptions.
- No runtime CDN dependency; no secrets in source control.

The `2000 ms` autosave debounce and `50 MB` attachment limit are **provisional centralized defaults** — define them once in configuration and never repeat the values across the codebase. Both are real: `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` and `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` in `src/shared/constants/index.ts`. The `50 MB` figure is the **attachment** limit only; the configuration defines no import-package size cap, and an agent must not invent one.

## 9. Security Protocol

Preserve the security model in [Security](docs/SECURITY.md):

- **Localhost-only** binding by default (`127.0.0.1`); never bind `0.0.0.0` unless explicitly authorized.
- **DOMPurify** sanitization before any HTML reaches the editor or the database. **Scope, measured:** DOMPurify is imported in exactly one place, `src/web/features/markdown/markdown-render.ts:1`, and called at `:136` — it covers the **Markdown render path only**. It does not cover pasted HTML, the raw-HTML page, or diagram output. Those are covered by: the raw-HTML page's own sandboxed `<iframe>` plus its own CSP meta (`src/web/features/html/preview-document.ts:236`); and `src/web/features/rich-editor/blocks/svg-sanitize.ts` plus Mermaid's internal sanitiser for diagrams ([ADR-012](docs/adr/ADR-012-diagram-rendering-and-sanitisation.md)). The requirement stands for the uncovered paths; they are recorded as unbuilt work in [Security](docs/SECURITY.md) §2.3. There is also **no centralized import pipeline**, so a "pasted HTML" path is not yet a code path — see `AGENTS.md` §4.
- Use Mermaid's documented default `securityLevel: "strict"` to encode HTML tags in diagram text and disable click functionality. Enforce broader sanitization and external-resource restrictions through RTWiki's CSP, asset, and network policies. **These are the real controls, and they are verified:** `src/web/features/rich-editor/blocks/mermaid-render.ts:80,90` sets `securityLevel: 'strict'` and `htmlLabels: false`. The 21 `DIAGRAM_TEMPLATES` (`src/web/features/rich-editor/insert-blocks.ts:33-149`) are **not** a security boundary — a user can type arbitrary Mermaid into a diagram block's textarea (`src/web/features/rich-editor/blocks/mermaid-block-view.tsx:248-250`) or the Mermaid page's (`src/web/features/visual-pages/mermaid-workspace.tsx:520-523`). Do not describe the template list as a control.
- Extension, MIME, and size **validation** for attachments; safe generated filenames; path-traversal protection.
- No execution of uploaded documents; serve attachments as static content only.
- No arbitrary scripts from pasted HTML.
- Custom HTML/CSS/JS supplied in a note-package runs only inside an isolated sandbox (iframe) with no same-origin, database, or filesystem access and no network egress (see [ADR-007](docs/adr/ADR-007-sandboxed-custom-content.md)). **Verified:** `sandbox="allow-scripts"` without `allow-same-origin` (opaque origin), plus its own stricter CSP meta — `src/web/features/html/preview-document.ts:236`. Note the custom content is authored on a **page**, not yet via an import package; the note-package route does not exist.
- Enforce request and upload limits. **Partly enforced — do not read this as whole.** Enforced: `bodyLimit` on the attachment routes (`src/server/attachments/attachment-routes.ts:6,144`), so an oversized upload is rejected before its body is buffered; `MAX_PAGE_JSON_BODY_BYTES` (4 MB, `src/shared/constants/index.ts:20`); and the per-pane HTML/CSS/JS byte caps (2 MiB / 512 KiB / 512 KiB), which are genuinely live via `byteBoundedString` in `src/shared/schemas/html-content.ts:39-47`. **Not enforced: `MAX_REQUEST_SIZE`.** It is declared at `src/shared/constants/index.ts:16`, imported at `src/server/config/index.ts:13`, typed at `:30` and assigned at `:53` — and read by nothing. It is **dead configuration**: a 100 MB figure that no request path consults. Do not cite it as a limit, and do not treat its presence as a control.
- Set security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Cache-Control`). **Partly enforced.** Covered: Hono's `secureHeaders` at `src/server/app.ts:67-68` with the CSP directives at `:53-64` — and note that middleware sets no `Cache-Control` of its own, so it does not cover that header. `Cache-Control` is set at exactly four sites: `src/server/static.ts:113` (`no-store` on the SPA document, which is what keeps a cached body from being paired with a later response's nonce) and `:204` (hashed assets, `immutable`), plus `attachment-routes.ts:214,282` (`private, no-cache`). **Not covered: the entire JSON API.** `GET /api/pages`, `GET /api/pages/:id`, `GET /api/pages?q=`, `GET /api/attachments/:id/text`, and the `onError` (`app.ts:213`) and `notFound` (`app.ts:218`) handlers all return page or error data with **no cache directives at all**. The mandate stands; the API surface is unbuilt work.
- Enable SQLite foreign keys and integrity checks; wrap multi-step operations in transactions. **Verified:** `PRAGMA foreign_keys = ON` (`src/server/database/index.ts:98`) and `PRAGMA integrity_check` (`:130`).
- Validate a backup **before** restoring; reject corrupted or incompatible archives. **Not implemented.** 0 matches for a backup or restore feature in `src/`; `data/backups/` is created at startup and stays empty. The requirement stands; treat the gap as unbuilt security work, per [ADR-018](docs/adr/ADR-018-documented-vs-built.md).
- Logs must contain no private content. **Verified:** bounded rotation and path redaction in `src/server/diagnostics/`; see [Security](docs/SECURITY.md) §10.

**LAN binding** requires a separate authorized phase and security review (see [ADR-001](docs/adr/ADR-001-browser-first-local-application.md)).

## 10. Development and Verification Separation

This project separates implementation from verification (see [CI/CD](docs/CI_CD.md) and the owner's workflow):

1. The project manager provides an **implementation-only** prompt.
2. The implementation agent changes only the authorized scope and returns a report.
3. The project manager reviews the report.
4. A separate **verification prompt** is issued.
5. The verification agent performs **read-only** checks unless a correction prompt explicitly authorizes edits.
6. Failures lead to a separate **correction task**.

An implementation agent **must not** claim independent verification it did not perform. It must accurately report the commands it ran, the checks it skipped, and known limitations.

## 11. Quality Protocol

Future required quality gates (enforced in CI, [CI/CD](docs/CI_CD.md)):

- Formatting, linting, type checking
- Risk-based unit tests, integration tests
- Frontend production build, backend build
- Windows executable compilation
- Portable-artifact smoke test
- Coverage collection (no arbitrary initial global threshold)

Critical behaviour that **requires** tests:

- Database migrations and persistence
- Autosave and recovery
- Backup and restore
- Import and sanitization
- Attachment validation and path safety
- API validation and error handling

Do **not** weaken or bypass a failed quality gate.

## 12. GitHub Actions Protocol

- Builds run on **GitHub-hosted runners**; the portable Windows executable is compiled on `windows-latest`.
- Use a **pinned Bun version**; install with a **frozen lockfile**.
- The user's PC needs **no Bun, Node.js, or compiler** installed.
- Produce a **portable ZIP** artifact (executable + assets, no runtime data or logs).
- A required quality gate failure **must block publication**.
- No unreviewed GitHub Actions permission expansion; use **least-privilege** workflow permissions.

## 13. Documentation Protocol

- Update the relevant documentation when behaviour or architecture changes.
- Keep [README.md](README.md) concise; keep detailed information in `docs/`.
- Use **relative links** between documents.
- Use **Mermaid** for relationship or architecture diagrams.
- Keep terminology consistent across documents.
- Add or update an **ADR** for architectural decisions.
- Never mark implementation complete when only documentation exists.
- **"Verified" requires full enforcement, and only for the claim as written.** Write it when the whole statement holds. Where a control is partial, enumerate what *is* and *is not* enforced and name the file for each — never round a partial check up to a whole one. A label on a partly-true claim tells every future agent a protection exists when it does not, which is worse than no label. **"Defined" is not "enforced":** a constant that is declared, exported, typed and assigned but read by nothing is dead configuration, and must be labelled as such rather than cited as a limit.
- Run the permanent documentation verifier whenever documentation or Markdown links change: `bun scripts/verify-docs.ts` (runs automatically in CI — see [CI/CD](docs/CI_CD.md)).
- Authoritative references: [Product requirements](docs/PRODUCT_REQUIREMENTS.md), [MVP scope](docs/MVP_SCOPE.md), [Architecture](docs/ARCHITECTURE.md), [Data model](docs/DATA_MODEL.md), [Development standards](docs/DEVELOPMENT_STANDARDS.md), [Security](docs/SECURITY.md), [CI/CD](docs/CI_CD.md), [Roadmap](docs/ROADMAP.md), [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md), [AI content import](docs/AI_CONTENT_IMPORT.md), [Reference research](docs/REFERENCE_RESEARCH.md), [ADR index](docs/adr/README.md). See also [ADR-006](docs/adr/ADR-006-rich-content-and-import-contract.md) and [ADR-007](docs/adr/ADR-007-sandboxed-custom-content.md).

## 14. Completion-Report Protocol

Every **change** agent must report:

- Branch
- Commit hash
- Files changed
- Purpose of each change
- Commands and checks run
- Results
- Checks not run and why
- Known risks or limitations
- Deviations from the prompt
- Confirmation that unrelated files were not changed

Every **verification** agent must report exact file and line references for failures and **must not** fix them unless separately authorized.
