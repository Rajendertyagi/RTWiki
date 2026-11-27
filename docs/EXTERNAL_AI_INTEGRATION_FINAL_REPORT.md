# External AI Integration — Final Report (Phases 0–3)

**Repository:** Rajendertyagi/RTWiki · **Branch:** `feature/external-ai-integration` · **Branch HEAD at time of writing:** `0d8ddb4` · **Report date:** 2026-11-27

This report records the completed implementation and independent verification of Phases 0–3 of [PLAN_EXTERNAL_AI_INTEGRATION.md](PLAN_EXTERNAL_AI_INTEGRATION.md). It is a factual record of work actually performed. No merge into `develop` was performed.

## 1. Commit sequence

| # | Commit | Purpose |
|---|--------|---------|
| 1 | `36f867d` | Hono 4.13.19 → 4.13.23 pin + lockfile + focused regression |
| 2 | `274bf1e` | Phase 0 accepted; ADR-025 → Accepted; five owner decisions; SECURITY.md corrected |
| 3 | `16ea626` | Phase 1 recovery implementation (32 files) |
| 4 | `322b08f` | Phase 1 restore-semantics correction |
| 5 | `bec1c06` | Phase 2 AI capability surface (19 files) |
| 6 | `3ded2e3` | Phase 3 import preview/confirm (15 files) |

The six commits above are the **implementation** commits; `3ded2e3` was the branch HEAD when this report was first written. Two documentation-only commits followed and did not change any implementation behaviour: `20faaa0` added this report, and `0d8ddb4` added the verified test matrix in [EXTERNAL_AI_TEST_MATRIX.md](EXTERNAL_AI_TEST_MATRIX.md). The branch HEAD is therefore `0d8ddb4`, not `3ded2e3`. No implementation work was added after `3ded2e3`.

**Deviation:** Phase 2 and Phase 3 corrections were folded into their implementation commits rather than separate commits. Splitting them now would require history rewriting, which is prohibited.

## 2. Phase 0 — OpenAPI proof (accepted)

- Disposable probe outside the repo tested both `hono-openapi@1.6.0` and `@hono/zod-openapi@1.6.3` against all ten plan assertions, under Bun and an actually compiled binary.
- Tag introspection passed: `describeRoute` tags survive into `generateSpecs()` for a parent and an `app.route()`-mounted child; two cached reads byte-identical. No registration-time registry fallback was needed.
- Decision: select `hono-openapi@1.6.0`. ADR-025 records the measured evidence and is **Accepted** for the library selection only — it does not authorize Phase 2 integration.
- Hono 4.13.23 re-test: all ten assertions still pass; original 4.13.19 evidence preserved under `evidence/hono-4.13.19/`.

## 3. Phase 1 — Reliable recovery

### Owner decisions applied
- Operation log: exactly 8 recovery kinds, `committed` only, 3 actors, 30-day expiry, recovery-only (not a general activity log).
- Permanent deletion: purge all revisions and historical operation rows, write one metadata-only event, atomic; history unavailable afterwards.
- `page_revisions.created_at TEXT NOT NULL` added and preserved on restore.
- `pages.structure_version INTEGER NOT NULL DEFAULT 0`; increments on `parent_id`/`position` changes only; child snapshots store expected post-promotion version; same-parent reorders count as movement.

### Implemented
Migrations 014/015; revision capture and two-path restore (revision-backed + legacy fallback); living-page undo; atomic transaction boundaries covering snapshot, page write, search index, links, child promotion and operation log; CAS preserved; retention prune; soft-delete attachments with trash endpoints, full filtering contract, 30-day retention with revision-reference protection; import readback fix; startup prune wiring; Trash Attachments tab and page-history panel.

### Correction
`322b08f` separated trash restore from explicit revision restore: the normal endpoint rejects a living page (404, no mutation); the explicit revision endpoint still works for living pages using only the requested revision ID.

## 4. Phase 2 — AI capability surface

### OpenAPI integration
- `hono-openapi@1.6.0` pinned exactly; `hono@4.13.23` preserved; root app remains plain `Hono`.
- Spec generated once, cached, served at `GET /openapi.json`; two reads byte-identical; parent and mounted-child routes present with tags.
- Existing middleware, Host/origin guards, body limits, media-type checks, error shapes and cache policies unchanged (`git diff -w` confirms handlers changed only by `describeRoute` wrappers).

### Compiled dependency gate (mandatory)
- `--external zod-to-json-schema` is a **build-time-only** workaround for a guarded, unreachable Zod-3 fallback import inside `@standard-community/standard-json`; it is not a runtime dependency.
- `zod-to-json-schema` and `@hono/zod-openapi` are not runtime dependencies; `z` is imported from `zod` per official Zod 4 guidance.
- `scripts/verify-compiled-openapi.ts` stages the compiled exe + web with **no `node_modules`** and proves `/openapi.json`, tag survival, manifest equality and a working write: **13 passed, 0 failed**.

### AI operations exposed (20, all tag-derived)
Page create/list/search/get/update/move/duplicate/trash/restore, batch create, import, attachment upload/get/text, schedule reads, settings reads.

**Excluded:** permanent page/attachment delete, backup restore, shutdown, settings writes, preset apply/replace, trash listing, revision history/undo, attachment `/view`, attachment trash/restore, schedule writes, and Phase 3 preview/confirm (deliberately untagged).

### Batch and confirmation
- `POST /api/pages/batch` uses `createPageCore` in one `BEGIN IMMEDIATE`; success creates all, any invalid item rolls back all.
- Preset `mode:'replace'` requires `?confirm=permanent` → `400 confirmation_required`; request bodies unchanged; token gates intact.

### Corrections
Single-sourced the OpenAPI version from `APP_VERSION`; strengthened dangerous-operation absence tests; made the compiled gate path portable.

## 5. Phase 3 — Import preview/confirm

- `prepareImport()` extracted from the single ingest core: detection + conversion with **no Database parameter** and no writes. `ingestFile = prepare + commit`, so single-file import is unchanged.
- `POST /api/import/preview` stores a bounded, process-local descriptor (32 entries / 10 min, consumed on read) and returns a JSON-safe preview. Verified zero writes to pages, attachments, provenance and search index.
- `POST /api/import/confirm` revalidates with existing Zod schemas, then commits all pages in one transaction via `createPageCore`, `insertAttachment` and `insertImportSource`. A later-item failure rolls back everything.
- UI: preview modal lists proposed pages with warnings; Confirm commits, Cancel sends no request.
- Preview/confirm are untagged, so they stay out of the AI tool manifest (fail-safe).
- ADR-026 (Accepted) supersedes only ADR-024's stale "No preview step" sentence; ADR-024 itself was not edited. `.rtwiki.zip` remains deferred and requires its own superseding ADR.

## 6. Quality gates — all PASS

| Gate | Result |
|---|---|
| `bun run format:check` | PASS — 530 files, no fixes |
| `bun run lint` | PASS — 0 errors, 60 pre-existing warnings |
| `bun run typecheck` | PASS |
| `bun test` | **2161 pass / 0 fail**, 15204 assertions, 143 files |
| `bun run build:web` | PASS |
| `bun run build:server` | PASS |
| `bun scripts/verify-docs.ts` | PASS — 79 files, 651 links, 0 failures |
| `bun scripts/verify-compiled-e2e.ts` | PASS — 79 passed / 0 failed |
| `bun run test:compiled-images` | PASS — ALL PASS |
| `bun run test:compiled-openapi` | PASS — 13 passed / 0 failed |

## 7. Independent verification

- **Phase 2:** PASS. Three findings corrected (SSOT version, dangerous-operation test strength, portable gate path).
- **Phase 3:** PASS. One finding corrected via ADR-026; React key collision fixed.
- Both verifiers were separate read-only agents and modified nothing. Implementation and verification were never performed by the same agent.

## 8. Remaining limitations

- Preview store is process-local, bounded and consumed on read; a restart or failed confirm requires re-previewing.
- Aggregate multipart body cap applies to the whole preview request; two individually-valid files can exceed it.
- `.rtwiki.zip` remains deferred, requiring a separate ADR superseding ADR-024.
- No authentication or isolation from hostile local processes is claimed; `?confirm=permanent` is an accidental-operation safeguard, not a security boundary.
- Backups created before migrations 014/015 cannot be restored by the new recovery process (owner notified in Phase 1).

## 9. Scope confirmation

No Phase 2/3 work leaked into earlier commits; no auth, LAN binding, second database, second ingest pipeline, `.rtwiki.zip`, generic content format, unrelated dependency update or dead-code removal. All existing commits and unrelated work preserved. No merge into `develop` was performed.
