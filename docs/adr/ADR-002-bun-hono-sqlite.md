# ADR-002: Bun, Hono, and SQLite

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki needs a backend runtime, an HTTP framework, and a database. The constraints are:

- The user's PC must not have any runtime installed. The build pipeline (GitHub Actions) produces a self-contained executable.
- The database must be file-based, zero-configuration, and embedded — no separate database server process.
- The stack must support TypeScript natively to avoid a compile step on the user's machine.
- Development should be fast with minimal tooling overhead.
- The stack must support SQLite FTS5 for full-text search without external dependencies.

## Decision

RTWiki uses the following technology stack for the backend:

| Layer | Technology | Role |
|-------|-----------|------|
| Runtime | **Bun** | JavaScript/TypeScript runtime and package manager. Provides fast startup, built-in test runner, and native TypeScript support. |
| Backend Framework | **Hono** | Lightweight HTTP framework for Bun. Provides routing, middleware, and a clean API. Supports streaming and has a small bundle size. |
| Database | **Bun SQLite** (`bun:sqlite`) | Built-in SQLite binding for Bun. No separate server process. File-based database stored beside the executable. |
| ORM | **Drizzle ORM** | Type-safe query builder with schema definitions. Generates parameterized queries automatically. Supports SQLite dialect including FTS5. |

The database file is stored at `<exe_directory>/data/rtwiki.sqlite`. SQLite WAL (Write-Ahead Logging) mode is enabled for crash safety. The WAL and SHM files remain in the same `data/` directory.

Exact stable versions for Bun, Hono, Bun SQLite, and Drizzle ORM will be selected and pinned during the implementation phase, based on mutual compatibility and the requirements of this ADR.

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| Node.js + Express + sqlite3 | Node.js must be installed on the user's PC (violates the no-runtime requirement). `sqlite3` requires native compilation. |
| Node.js + Fastify + Prisma | Same Node.js runtime issue. Prisma requires a preinstall binary download, which complicates the offline build. |
| Deno + dbgen | Smaller ecosystem. Less mature ORM support. The project owner's environment is Windows-focused and Bun has stronger Windows tooling support. |
| Python + FastAPI + SQLite | Would require Python on the user's PC. Adds a second language to the stack unnecessarily. |
| Go + SQLC + SQLite | Strong choice for performance but introduces a compiled language. The project is primarily TypeScript/React and keeping one language reduces cognitive load. |

## Consequences

**Positive:**
- Single language (TypeScript) across the entire stack.
- No runtime installation required — Bun is bundled into the GitHub Actions build output.
- Fast development cycle with Bun's built-in tools (formatter, linter, test runner, package manager).
- SQLite is extremely lightweight — a single file, no server process, easy to back up.
- Drizzle ORM provides type safety and automatic migration support.
- Hono's middleware model maps cleanly to the security and logging requirements.

**Negative:**
- Bun is younger than Node.js. Ecosystem compatibility is good but not universal — some packages may not have Bun builds.
- Bun SQLite is a relatively new binding. Edge-case behaviour with complex SQLite features may require investigation.
- The community is smaller, so troubleshooting resources are fewer than for Node.js.

**Neutral:**
- Drizzle ORM requires a pinned stable version to avoid unexpected breaking changes (addressed by the pinned version policy in [DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md)).

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| A needed package lacks a Bun-compatible build | Low | Evaluate each new dependency for Bun compatibility before adding it. Prefer packages with explicit Bun support. |
| Bun SQLite FTS5 support is incomplete | Low | Test FTS5 functionality thoroughly during the MVP. If gaps are found, fall back to raw SQL queries via Bun SQLite's `execute` method. |
| Bun runtime behaviour differs from Node.js in edge cases | Low | Run the application through the full acceptance criteria on Windows. Document any Bun-specific workarounds. |

## Revisit Conditions

This decision should be revisited if:
- A critical dependency is unavailable for Bun and cannot be replaced.
- Performance profiling shows Bun is a bottleneck and a compiled language would provide sufficient benefit to justify the added complexity.
- Bun releases a breaking change that affects the application in an unresolvable way.
