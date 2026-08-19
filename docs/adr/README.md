# Architecture Decision Records

Architecture Decision Records (ADRs) capture significant design decisions made during the project, along with the reasoning behind them and the consequences of those decisions. ADRs are living documents — they can be updated as the project evolves, but changing an accepted ADR requires a new ADR that explicitly supersedes it.

## ADR Index

| ID | Title | Status |
|----|-------|--------|
| [ADR-001](ADR-001-browser-first-local-application.md) | Browser-First Local Application | **Accepted** |
| [ADR-002](ADR-002-bun-hono-sqlite.md) | Bun, Hono, and SQLite | **Accepted** |
| [ADR-003](ADR-003-react-blocknote-mantine.md) | React, BlockNote, and Mantine | **Accepted** |
| [ADR-004](ADR-004-canonical-block-json-format.md) | Canonical BlockNote JSON Format | **Accepted** |
| [ADR-005](ADR-005-portable-data-layout.md) | Portable Data Layout Beside the Executable | **Accepted** |

## How to Read an ADR

Each ADR follows a consistent template:

- **Status** — Proposed, Accepted, or Deprecated
- **Context** — The problem or situation that led to the decision
- **Decision** — What was decided
- **Alternatives Considered** — Other options that were evaluated
- **Consequences** — What becomes easier or harder because of this decision
- **Risks** — Known downsides and how they will be mitigated
- **Revisit Conditions** — Circumstances that would trigger a re-evaluation of this decision

## Cross-References

- [ARCHITECTURE.md](../ARCHITECTURE.md) — the architecture document that these ADRs inform
- [README.md](../../README.md) — project overview and documentation index
