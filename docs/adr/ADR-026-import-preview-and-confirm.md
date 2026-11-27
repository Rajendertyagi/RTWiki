# ADR-026: Import Preview and Confirm

| Field | Value |
|-------|-------|
| **Status** | **Accepted** — Phase 3 import orchestration authorised by the owner (plan §8, `docs/PLAN_EXTERNAL_AI_INTEGRATION.md:366-368`). Acceptance covers the preview/confirm flow described here only |
| **Date** | 2026-11-27 |
| **Supersedes** | Only the single sentence "No preview step. Import stays one-shot; no upload → preview → confirm flow is authorized." at [ADR-024](ADR-024-one-ingest-pipeline-and-structured-import.md):200. Every other statement in ADR-024 is unchanged |
| **Related** | [ADR-024](ADR-024-one-ingest-pipeline-and-structured-import.md), [ADR-006](ADR-006-rich-content-and-import-contract.md), [ADR-025](ADR-025-openapi-library-selection.md), [Plan — External AI Integration](../PLAN_EXTERNAL_AI_INTEGRATION.md) §7.1 and §8, [AGENTS.md](../../AGENTS.md) §4, §5, §9 |

## Context

[ADR-024](ADR-024-one-ingest-pipeline-and-structured-import.md) established one server-side
ingest module (`src/server/ingest/ingest-file.ts`) with two thin HTTP consumers and deliberately
deferred the full eight-stage [ADR-006](ADR-006-rich-content-and-import-contract.md) pipeline. Its
owner-decision section recorded, at `:200`: "No preview step. Import stays one-shot; no upload →
preview → confirm flow is authorized." That statement was accurate when ADR-024 was accepted
(2026-11-22).

The owner has since authorised Phase 3 — import orchestration — in
`docs/PLAN_EXTERNAL_AI_INTEGRATION.md:366-368` (§8), which calls for "previewable multi-page
creation" using the existing content and ingestion services. Phase 3 implements exactly an
upload → preview → confirm flow. ADR-024 is Accepted and cannot be edited directly (AGENTS.md §1),
so this ADR supersedes **only** that one sentence and leaves the rest of ADR-024 intact.

The design must not create a second ingest pipeline (AGENTS.md §4), must not add hidden global
state (AGENTS.md §5), and must not expose the new orchestration routes to the AI tool surface,
which is derived from OpenAPI operation tags (plan §7.1, [ADR-025](ADR-025-openapi-library-selection.md)).

## Decision

Split the existing single ingest pipeline into two explicit stages and add a preview/confirm
orchestration over them. There is still **one** detection/conversion implementation; the two
stages are the same code the ordinary import path already calls.

### 1. `prepareImport()` — validation, detection, conversion, no database writes

`prepareImport()` (`src/server/ingest/ingest-file.ts:89`) performs source validation, detection,
conversion and descriptor building. It performs **no database reads or writes**
(`src/server/ingest/ingest-file.ts:83-88`), which is what lets `POST /api/import/preview` run the
real pipeline without creating anything. Failure is a structured value, never a thrown error.
The existing `ingestFile()` (`src/server/ingest/ingest-file.ts:387`) is now `prepare` + `commit`,
so the original `POST /api/import` and attachment consumers are behaviourally unchanged.

### 2. An in-memory, bounded preview store between the two stages

`createPreviewStore()` (`src/server/ingest/preview-store.ts:38`) holds prepared descriptors in the
Hono app instance — not on disk and not in SQLite. A preview is **consumed on read** (`take`
deletes it, `src/server/ingest/preview-store.ts:64-70`), so a second confirm cannot duplicate the
pages. Both entry count and age are bounded by shared constants
(`IMPORT_PREVIEW_TTL_MS` = 10 minutes, `IMPORT_PREVIEW_MAX_ENTRIES` = 32,
`src/shared/constants/index.ts:69-70`); expired entries are swept and the oldest is evicted when
full. Eviction only discards an uncommitted preview, never committed data. The store is an
explicit dependency, not a process-wide singleton (AGENTS.md §5).

### 3. `commitPreparedImports()` — one transaction, reusing the existing write helpers

`POST /api/import/confirm` (`src/server/routes/import.ts:346`) consumes the preview id, revalidates
the server-produced descriptor with `CreatePageSchema`, and calls `commitPreparedImports()`
(`src/server/ingest/ingest-file.ts:364`). That function opens one `BEGIN IMMEDIATE` and commits
every prepared item as a single unit, reusing `createPageCore` (`src/server/ingest/ingest-file.ts:308`),
`insertAttachment` (`:273`) and `insertImportSource` (`:314`) — the same helpers the original
single-file path uses. A failure in any item rolls the whole batch back, so no partial import is
observable. An optional `parentId` at confirm overrides the one captured at preview.

### 4. Routes and UI

- `POST /api/import/preview` (`src/server/routes/import.ts:266`) returns a JSON-safe descriptor
  (title, page type, byte size, original name, MIME type, warnings) plus a one-time `previewId`.
- `POST /api/import/confirm` (`src/server/routes/import.ts:346`) commits the batch and returns the
  created pages and all advisory warnings.
- Client helpers: `previewImport()` (`src/web/services/import-api.ts:90`) and `confirmImport()`
  (`:113`). Cancellation is a local state clear with no request (`src/web/App.tsx:545`); confirm
  commits and surfaces every warning (`src/web/App.tsx:550`). The preview modal is
  `src/web/features/pages/import-preview-modal.tsx:32`.

### 5. Deliberately untagged — out of the AI tool manifest

Neither new route carries an `ai-safe` OpenAPI tag (`src/server/routes/import.ts:263-264,344`).
Because the AI tool surface is derived from operation tags (plan §7.1,
[ADR-025](ADR-025-openapi-library-selection.md)), leaving them untagged keeps preview and confirm
out of the derived tool manifest until a future owner decision explicitly authorises exposing
them. This is a deliberate scope boundary, not an oversight.

### 6. `.rtwiki.zip` remains deferred

The note-package path is **not** built by this ADR. Plan §8
(`docs/PLAN_EXTERNAL_AI_INTEGRATION.md:368`) requires that `.rtwiki.zip` be reconsidered **only
through a separate ADR that supersedes ADR-024**. This ADR supersedes only the one-shot sentence
at ADR-024:200 and does not authorise the note-package path or the full ADR-006 eight-stage
pipeline.

## What this supersedes, precisely

| Earlier claim | Status now |
|---------------|-----------|
| ADR-024:200, "No preview step. Import stays one-shot; no upload → preview → confirm flow is authorized." | **Superseded.** An upload → preview → confirm flow is now built and authorised by plan §8. ADR-024 is unchanged everywhere else |

No other sentence, table row, or section of ADR-024 is changed by this ADR. In particular its
"full ADR-006 pipeline is still unbuilt" finding, its provenance and transaction decisions, and
its deferred `.rtwiki.zip` decision all stand.

## Behavioural evidence

`tests/import-preview-confirm.test.ts` exercises the flow over real HTTP with the app-wide guards
mounted:

- `:125` — preview returns a descriptor and writes nothing.
- `:147` — cancellation (no confirm call) leaves the database untouched.
- `:158` — invalid input at preview is rejected with the existing error shape and no writes.
- `:193` — confirm creates every page, attachment, provenance row and parent relationship.
- `:235` — confirm honours an explicit `parentId` override.
- `:258` — a parent that becomes invalid between preview and confirm rolls the whole batch back.
- `:288` — an unknown or reused preview id is refused without writing.
- `:321` — a drifted descriptor is revalidated and rolls back before any write.

## Consequences

**Positive**

- Users can review proposed pages and warnings before anything is committed; cancelling creates
  nothing.
- Multi-file imports commit atomically: a failure in one item leaves no partial state.
- The single ingest pipeline is preserved — preview and confirm reuse `prepareImport` and the
  existing write helpers rather than duplicating detection or conversion.
- The new routes stay out of the AI tool manifest by default.

**Negative / accepted costs**

- Prepared bytes are held in process memory for up to the TTL; a restart discards pending
  previews and the client must preview again. This is bounded and never a source of truth.
- A preview id is one-time: a failed confirm requires previewing again.
- Two new HTTP routes and a client modal are added integration surface; they must stay untagged
  until explicitly authorised for the AI tool surface.

## Alternatives Considered

- **Keep import one-shot (ADR-024:200).** Rejected: the owner authorised Phase 3 preview/confirm
  in plan §8; this ADR supersedes only that sentence.
- **Persist previews in SQLite or on disk.** Rejected: previews are uncommitted, disposable state;
  the database must remain the only source of truth, and a durable store would need cleanup and
  recovery rules for no benefit.
- **Duplicate detection/conversion in the preview route.** Rejected: AGENTS.md §4 forbids a second
  import path; the two stages reuse the one ingest module.
- **Tag preview/confirm `ai-safe`.** Rejected: not authorised; the derived tool manifest must not
  gain orchestration routes without an explicit owner decision.
- **Build `.rtwiki.zip` now.** Rejected: plan §8 requires its own superseding ADR; out of scope.

## Risks

- The preview store is process-local and non-durable. Mitigation: bounded, consumed-on-read, and
  never authoritative; the client re-previews after a restart or a failed confirm.
- A descriptor could drift between preview and confirm. Mitigation: confirm revalidates it with
  `CreatePageSchema` before opening the transaction (test at `:321`).
- Exposing these routes to the AI tool surface later would change the capability surface.
  Mitigation: they remain untagged; exposure requires a new owner decision and ADR.

## Revisit Conditions

- The owner authorises exposing preview/confirm to the AI tool surface. That requires tagging the
  routes and a new ADR recording the decision.
- `.rtwiki.zip` note-package support is authorised. Plan §8 requires a new ADR that supersedes
  ADR-024 for that path specifically.
- The full ADR-006 eight-stage pipeline is authorised. That still requires a new ADR changing
  ADR-006 first, as ADR-024 records.
- Preview volume or byte size makes the in-memory store a memory concern; the bounds in
  `src/shared/constants/index.ts:69-70` must then be revisited with measurement.
