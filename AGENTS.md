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
- Do **not** add accounts, cloud sync, AI integration, audio, video, or real-time collaboration.
- Do **not** introduce a native desktop wrapper (Electron/Tauri/Electrobun) or LAN mode during the MVP unless explicitly authorized.
- Do **not** silently replace an accepted library or architecture decision.
- Record any legitimate architecture change through a new ADR.

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
- Database: **Bun SQLite** (`bun:sqlite`)
- ORM: **Drizzle ORM**
- Frontend: **React** + **Vite**
- Editor: **BlockNote** with `@blocknote/math-block` and `@blocknote/diagram-block`
- UI: **Mantine**
- HTML sanitization: **DOMPurify**
- Search: **SQLite FTS5**

The agent must:

- Use **strict TypeScript** everywhere.
- Keep clear **frontend, API, service, and persistence** boundaries.
- Share schemas and types between frontend and backend.
- Treat **BlockNote JSON** as the canonical page storage; HTML and Markdown are conversion formats only (see [ADR-004](docs/adr/ADR-004-canonical-block-json-format.md)).
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
- Include the database and attachments in backups; **exclude logs** from backups.
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

The `2000 ms` autosave debounce and `50 MB` attachment limit are **provisional centralized defaults** — define them once in configuration and never repeat the values across the codebase.

## 9. Security Protocol

Preserve the security model in [Security](docs/SECURITY.md):

- **Localhost-only** binding by default (`127.0.0.1`); never bind `0.0.0.0` unless explicitly authorized.
- **DOMPurify** sanitization for all imported/pasted HTML before it reaches the editor or database.
- **Mermaid strict security mode** (no script execution, no external resource loading).
- Extension, MIME, and size **validation** for attachments; safe generated filenames; path-traversal protection.
- No execution of uploaded documents; serve attachments as static content only.
- No arbitrary scripts from pasted HTML.
- Enforce request and upload limits.
- Set security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, `Referrer-Policy`, `Cache-Control`).
- Enable SQLite foreign keys and integrity checks; wrap multi-step operations in transactions.
- Validate a backup **before** restoring; reject corrupted or incompatible archives.
- Logs must contain no private content.

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
- Authoritative references: [Product requirements](docs/PRODUCT_REQUIREMENTS.md), [MVP scope](docs/MVP_SCOPE.md), [Architecture](docs/ARCHITECTURE.md), [Data model](docs/DATA_MODEL.md), [Development standards](docs/DEVELOPMENT_STANDARDS.md), [Security](docs/SECURITY.md), [CI/CD](docs/CI_CD.md), [Roadmap](docs/ROADMAP.md), [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md), [ADR index](docs/adr/README.md).

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
