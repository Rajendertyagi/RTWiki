# CI / CD

This document describes the planned GitHub Actions workflow for RTWiki. It specifies what the pipeline does, when it runs, and what gates must pass. No workflow YAML is created in this phase.

## 1. Platform

- **Runner:** `ubuntu-latest` for all checks except the Windows executable build, which uses `windows-latest`.
- **Runtime:** Bun is installed by the pipeline itself from a pinned version URL. The user's PC does **not** need Bun, Node.js, Docker, or any compiler installed.

## 2. Trigger Conditions

| Event | Workflow |
|-------|----------|
| Push to `main` | Full pipeline (format, lint, type-check, test, build, package) |
| Pull request to `main` | Full pipeline (same checks, no packaging) |
| Manual dispatch (workflow_dispatch) | Full pipeline including packaging |
| Release tag (`v*`) | Full pipeline + publish to GitHub Releases |

## 3. Pipeline Stages

### Stage 1: Install

```
- Checkout repository
- Install pinned Bun version (e.g., bun-v1.2.0)
- Restore cached node_modules/bun install (frozen lockfile)
- Verify Bun version matches the pinned value
```

### Stage 2: Formatting Check

```
- Run: bun run format:check
- Fails the pipeline if any file is not formatted according to the project formatter (Prettier or Biome)
```

### Stage 3: Lint

```
- Run: bun run lint
- Fails on any lint error. No warnings are allowed to become accepted.
```

### Stage 4: Type Checking

```
- Run: bun run typecheck
- Uses TypeScript strict mode. No `skipLibCheck` bypass.
```

### Stage 5: Unit Tests

```
- Run: bun run test:unit
- Tests are mandatory for the following areas:
  - Database migrations and persistence
  - Autosave and recovery from interrupted saves
  - Backup creation and restore
  - HTML and Markdown import and sanitization
  - Note-package (`.rtwiki.zip`) import, validation, transactional write, and rollback
  - Custom-content sandbox isolation (no same-origin, no network, no parent DOM)
  - Attachment validation and path safety
  - API validation and error handling
- Coverage is collected and reported.
- A global failure percentage will only be introduced after a meaningful baseline exists.
- High line coverage must not replace behavioural acceptance tests.
```

### Stage 6: Integration Tests

```
- Run: bun run test:integration
- Spins up a temporary SQLite database in memory or a temp file.
- Tests page CRUD, attachment upload, search, and backup round-trip.
- Cleans up the temp database after each test suite.
```

### Stage 7: Frontend Build

```
- Run: bun run build:frontend
- Vite production build. Checks for runtime CDN references (custom check).
- Fails if any imported asset resolves to an external URL.
```

### Stage 8: Backend Build

```
- Run: bun run build:backend
- Compiles TypeScript to JavaScript (or Bun emits directly).
- Fails on any compilation error.
```

### Stage 9: Windows Executable Compilation

```
- Runner: windows-latest
- Run: bun run build:exe
- Produces a self-contained Windows executable (.exe) with the Vite-built frontend assets bundled alongside.
- The executable is a single binary that can run without any installed runtime.
```

### Stage 10: Portable Artifact Packaging

```
- Run: bun run package
- Packages the executable and all assets into a versioned .zip artifact.
- Artifact naming convention: RTWiki-{version}-windows-x64.zip
- Version is read from the lockfile or git tag.
```

### Stage 11: Portable Artifact Smoke Test

```
- Extract the .zip artifact to a temporary directory.
- Run the .exe and verify it starts without errors.
- Verify that data/ and logs/ directories are created automatically on first launch.
- Verify the browser opens and the application is reachable.
- Fails the pipeline if the executable does not start or the directories are not created.
```

### Stage 12: Upload Build Artifact

```
- Upload the .zip artifact to GitHub Actions artifacts.
- Artifact is available for 90 days on non-release runs.
```

### Stage 13: GitHub Release (tags only)

```
- Create a GitHub Release with the packaged artifact attached.
- Release notes are generated from the commit messages between tags.
- A checksum file (SHA-256) is also attached for verification.
```

## 4. Quality Gates

The pipeline fails on any of the following conditions:

| Gate | Action on Failure |
|------|------------------|
| Formatting check | Pipeline fails |
| Lint | Pipeline fails |
| Type check | Pipeline fails |
| Unit tests | Pipeline fails |
| Integration tests | Pipeline fails |
| Frontend build | Pipeline fails |
| Backend build | Pipeline fails |
| Windows executable build | Pipeline fails (non-tag PRs only; tag builds continue to package) |
| Portable artifact smoke test | Pipeline fails |
| Bundle size regression > 20% | Warning (does not fail, but alerts the team) |

## 5. Artifacts

| Artifact | Produced By | Naming |
|----------|------------|--------|
| Frontend build | Stage 7 | `dist/` (intermediate) |
| Backend build | Stage 8 | `dist-backend/` (intermediate) |
| Windows executable | Stage 9 | `RTWiki.exe` |
| Portable package | Stage 10 | `RTWiki-{version}-windows-x64.zip` |
| Checksum | Stage 10 | `RTWiki-{version}-windows-x64.zip.sha256` |

## 6. Environment Variables

The workflow uses GitHub Actions secrets for any values that must not be hardcoded:

| Secret | Purpose |
|--------|---------|
| (None required for MVP) | No API keys or tokens are needed |

If future phases require signing or publishing credentials, they will be added as GitHub Secrets at that time.

## 7. Cross-References

- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — the rules the pipeline enforces
- [ARCHITECTURE.md](ARCHITECTURE.md) — what is built and packaged
- [ROADMAP.md](ROADMAP.md) — future phases that may add pipeline stages
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content

## 8. Implemented Quality Gates

The first implemented, runnable quality gate is the documentation verifier:

- **Workflow:** [`.github/workflows/docs-quality.yml`](../.github/workflows/docs-quality.yml) — runs on pull requests, pushes to `main`, and manual dispatch.
- **Script:** [`scripts/verify-docs.ts`](../scripts/verify-docs.ts) — a dependency-free Bun script (requires Bun 1.3.14).
- **Checks:** Markdown link integrity, document structure, required-file presence, ADR status and index entries (all seven ADRs), project-status line, portable-layout rules, and requirement-ID integrity. The verifier also validates the new `AI_CONTENT_IMPORT.md` and `REFERENCE_RESEARCH.md` documents and the [ADR-006](adr/ADR-006-rich-content-and-import-contract.md)/[ADR-007](adr/ADR-007-sandboxed-custom-content.md) records.
- The verifier runs in CI without `bun install` and without any third-party packages.

All other stages in sections 3–6 (format, lint, type-check, tests, builds, packaging) remain planned until implementation begins.
