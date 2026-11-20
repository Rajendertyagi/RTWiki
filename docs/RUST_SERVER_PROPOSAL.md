# Proposal: a Rust API server

**Status: proposal only. Nothing has been decided and nothing is scheduled.**

This document records an option the owner asked to keep on the table: replacing the Bun server
with a Rust one, primarily for a smaller executable. It is written so the option survives without
anyone having to remember the conversation, and so that a future decision starts from measurements
rather than from enthusiasm.

It is **not** an ADR. [ADR-002](adr/ADR-002-bun-hono-sqlite.md) remains accepted and in force; this
document does not supersede it, propose superseding it, or change any current behaviour.

## Summary

| Question | Answer as of this writing |
|---|---|
| Is the current arrangement broken? | No. It builds, it is tested, it ships as a portable artifact. |
| Is this work being done now? | No. Deferred, deliberately, by the owner's decision. |
| What would be gained? | A materially smaller executable, and removing Bun as a runtime dependency. |
| What would it cost? | Re-implementing and re-verifying 8,547 lines of server behaviour. |
| Is the data at risk? | Not if staged. The database is plain SQL and contains nothing Bun-specific. |
| What would make us drop this? | Section "When to abandon this" below. |

## Why the question was asked

The owner is not concerned with the security posture of a personal, localhost-only notes
application, and said so explicitly. That removes one of the usual arguments and leaves the
strongest remaining one: **executable size**.

## What is unmeasured, and must stay labelled as such

The figures below marked **estimate** are **not measurements**. No build of the Windows executable
was run to produce them, and they must not be quoted as facts.

| Claim | Status |
|---|---|
| A Bun-compiled `RTWiki.exe` is roughly 90–100 MB | **Estimate.** Not measured. |
| A lean Rust (axum + rusqlite) executable would be roughly 5–10 MB | **Estimate.** Not measured. |
| The difference is the main practical argument for this proposal | **Estimate, and unverified** |

**Measure this before deciding anything.** A single build of the current executable, and its size
and startup time on the target machine, would either confirm the motivation or dissolve it. That is
hours of work, not weeks, and it is the cheapest step available. Until it is done, this proposal
rests on a guess about its own main benefit.

## Measured facts about the current server

These *were* measured, by reading the source:

| Fact | Value |
|---|---|
| Server source | 41 TypeScript files, **8,547 lines** |
| API endpoints | **43** route handlers |
| Database | **11 tables**, 629 lines of hand-written SQL migrations |
| ORM | **None.** All SQL is hand-written and parameterised |
| Largest areas | Attachments 1,631 · routes 1,094 · services 919 · backup 898 · repositories 885 · database 807 |

### Why the data layer makes this tractable

There is no ORM, and nothing in the schema depends on a JavaScript runtime. The database is a
standard SQLite file with ordinary tables. A Rust server using `rusqlite` opens **the same file,
unchanged**. That property is the single most important fact in this document: it is what allows the
work to be staged without ever putting existing notes at risk.

## Rust is already in this repository

This option is not as greenfield as it first appears. `src-tauri/` already contains **772 lines of
Rust**, including `sidecar.rs` (230 lines), whose job is to launch the server sidecar and talk to it.
The documented desktop design is a Rust `RTWiki.exe` shell that spawns the Bun `RTWikiServer.exe` as
a sidecar and loads the loopback URL.

Consequences worth recording:

- The Rust toolchain is already required and installed by CI (`windows-latest`).
- `serde` and `serde_json` are already dependencies, and Tauri brings `tokio` transitively.
- **A Rust→Bun process boundary already exists and already works.** A Rust server is a change of
  what sits behind that boundary, not the introduction of a new shape.

## Crate mapping

`axum + rusqlite` covers only the HTTP and database layers. The full set that would be needed:

| Crate | Replaces | Purpose |
|---|---|---|
| `axum` | Hono | Routing and middleware |
| `rusqlite` | `bun:sqlite` | SQLite; opens the existing database file |
| `tokio` | Bun's event loop | Async runtime (already present transitively) |
| `tower-http` | hand-written header code | CSP and security headers; static serving of `build/web` |
| `serde` / `serde_json` | hand-written JSON | Request and response shapes (already dependencies) |
| `tracing` | custom logger | Bounded rotation and path redaction |
| `time` or `chrono` | `dayjs` | Scheduling |
| `uuid` | generated ids | Identifiers |

The frontend is **not affected** by any of this. It remains React and TypeScript, compiled by Vite
into `build/web` and served as static files.

## What must be re-implemented and re-verified

Being listed is not the same as being understood. Each of these exists for a documented reason, and
a rewrite that omits one reintroduces a gap that nothing would notice:

- Host-header allowlist. The only control that stops **DNS rebinding**, where the browser sends no
  `Origin` and no `Sec-Fetch-Site`.
- Cross-origin rejection on every state-changing method. This is what stops an ordinary cross-origin
  `POST`, which a `Host` allowlist alone does not.
- `Content-Type: application/json` enforcement, which removes the CORS-simple `text/plain` path.
- `Cache-Control: no-store` for `/api/*`, without which a cached page list could be shown after the
  page was deleted.
- Attachment validation: extension, MIME type, size, generated filenames, path-traversal defence.
- Backup validation **before** restoring: integrity check, foreign-key check, and migration-set
  comparison in both directions. A corrupt archive must be refused before anything moves.
- The per-process shutdown token required by restore.

## Staged plan

A big-bang rewrite is specifically not recommended: it is longer, and it puts existing notes at risk
during it. The stages below keep the Bun server running as a fallback throughout, and operate on the
same database file at every step.

| Stage | Work | Gate to proceed |
|---|---|---|
| 0 | **Measure.** Build the current executable; record size and startup time. | If size is acceptable, stop here. This is the cheapest stage and may end the proposal. |
| 1 | A Rust server that opens the database **read-only** and serves `build/web`. Answers `GET /health`. | It reads real existing notes correctly. Bun still runs. |
| 2 | Read-only endpoints (`GET /api/pages`, page by id, search). | Responses compared byte-for-byte against the Bun server for identical inputs. |
| 3 | Writes, including the 2000 ms autosave debounce. | Persisted sizes and content match. |
| 4 | Attachments, backup/restore, scheduler. | Each area verified against current behaviour. |
| 5 | Security guards last: host allowlist, origin, headers. | Existing security tests re-run against the Rust server. |
| 6 | Retire the Bun server, if desired. | Nothing regressed. |

Stage 0 is the one to do first regardless of intent. Stage 1 touches no data — read-only — so the
notes cannot be harmed by it.

## Effort

**Estimate: roughly 2–4 weeks** of focused work for one competent developer, with stages 0–2 being a
small fraction of that total. This is a judgement, not a measured figure, and it should be treated as
a reason to measure first rather than a commitment.

## When to abandon this

Recorded in advance so the decision is not re-litigated every few months. Any one of these is
sufficient reason to close the proposal and keep Bun:

1. **Stage 0 shows the executable size is acceptable.** The entire motivation is the size.
2. **Stages 0–2 reveal the existing behaviour is harder to reproduce faithfully than it looks**,
   particularly backup validation and the autosave debounce.
3. **A maintainability concern outweighs the size benefit.** Bun is young, and the owner flagged it
   as unfamiliar. That is a real cost of the current arrangement, and it should be weighed openly
   rather than assumed away in either direction.
4. **The project needs other work more.** This is deferrable with no loss of function.

The current application works and is not in distress. Deferring this costs nothing.

## Related documents

- [ADR-002](adr/ADR-002-bun-hono-sqlite.md) — the accepted Bun decision, still in force
- [ADR-005](adr/ADR-005-portable-data-layout.md) — the portable layout a Rust server would have to honour
- [ADR-018](adr/ADR-018-documented-vs-built.md) — where documentation and code disagree
- [ARCHITECTURE.md](ARCHITECTURE.md) — the desktop shell and sidecar design
- [DATA_MODEL.md](DATA_MODEL.md) — the schema specification a port would be written against
- [SECURITY.md](SECURITY.md) — the controls listed above, with their reasons