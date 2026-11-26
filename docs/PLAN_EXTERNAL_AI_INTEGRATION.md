# Plan — External AI Integration, Functionality and Data Recovery

**Status:** Proposed — awaiting owner approval and Phase 0 proof-of-fit.
**Baseline:** `docs/` architecture audit (saved as `RTWiki-AI-Integration-Audit.md` outside the repo), corrected by owner review 2026-11-25.
**Branch:** implement on a dedicated branch created from `develop`.
**Scope:** research-derived implementation plan only. This document does not authorise code changes by itself.

---

## 1. Repository state — mandatory warning

At the time this plan was last updated (2026-11-26):

- Local `develop` HEAD is `7e8580f`, **in sync with** `origin/develop`. The earlier snapshot (`de7326a`, four commits ahead of `e865923`) is stale: those commits and the Stage 1 theme work were committed and pushed in `7e8580f`.
- The working tree contains four uncommitted files from the W-005 closeout: `docs/THEME_COVERAGE.md`, `docs/VISUAL_AUDIT_FINAL_REPORT.md`, `docs/theme-waivers.md`, `tests/theme-docs-sync.test.ts`. It also contains untracked documentation: `docs/PENDING_ACTIONABLE.md`, `docs/PLAN_EXTERNAL_AI_INTEGRATION_AUDIT.md`, and this plan.

**Rules:** re-check `git status` at execution time — this snapshot will go stale. Never reset, clean, stash, overwrite or commit files outside the phase scope. Do not assume a clean tree. Other agents may be working concurrently — do not touch files outside the scope listed in each phase.

---

## 2. Guiding principles

1. **One Hono application.** No `/api/v1` tree, no second router, no microservice.
2. **One SQLite database.** No second storage layer, no event store, no external database.
3. **One ingest core.** `src/server/ingest/ingest-file.ts` remains the only content-ingest path. Structured AI content goes through the canonical page-write path, not a parallel pipeline.
4. **One source of truth per value.** Derive everything; never maintain a second hand-written list.
5. **Recovery before write access.** AI write operations are enabled only after deletion is recoverable.
6. **Proportional security.** No accounts, roles, OAuth, token-management UI, cloud auth or elaborate permission system. The threat is AI mistakes, not a hostile local process.
7. **Fail-safe defaults.** Untagged routes are not exposed to AI; unreferenced old attachments are the only auto-purged data.
8. **Smallest complete change.** Reuse existing services, schemas, constants and UI patterns.

---

## 3. Sources of truth (all already exist — no new ones)

| Concern | Existing source | Derivation pattern in use |
|---|---|---|
| Request/response shapes | `src/shared/schemas/*` | Zod schemas shared by UI and server |
| Machine-readable codes | `ImportErrorCode` tuple (`src/shared/schemas/import.ts:11-31`) | One tuple, both consumers |
| Limits and names | `src/shared/constants/index.ts` | One constant per value |
| Block types | `rtwikiBlockSchema` (`src/web/features/rich-editor/schema.ts:30-48`) | `KNOWN_BLOCK_TYPES` derived from schema keys (`:46-48`) |
| Accepted formats | `ACCEPTED_DOCUMENT_FORMATS` | MIME/ext lists derived by `.map()` (`src/shared/attachments/document-formats.ts:196-225`) |
| Schema version | migration calls | `requiredMigrations` derived from calls (`src/server/database/migrations.ts:14-43`) |
| Content validation | `src/server/services/page-service.ts:56-149` | All four page types validated on create and update |
| Ingest | `src/server/ingest/ingest-file.ts` | One core, two consumers |
| AI capability surface | **to be derived from OpenAPI tags** | No capability constant (see §7) |

**Rule for implementers:** if a new value needs to be known in two places, it must be defined once and derived or imported in the other place. A new hand-maintained list is a defect.

---

## 4. Architecture decisions (from the audit, confirmed by owner review)

1. Keep Hono, SQLite, existing services, Zod schemas and existing `/api/*` paths.
2. Fix recovery before enabling AI write operations.
3. Preserve the four page types and their canonical content formats — no new generic format.
4. Keep backup restoration under user control; trash and revisions handle ordinary mistakes.
5. Defer `.rtwiki.zip` and the full ADR-006 eight-stage pipeline.
6. Prefer incremental OpenAPI adoption; `hono-openapi` is the leading candidate but **Phase 0 decides**.
7. AI-safe operations are derived from tagged OpenAPI operations, not a hardcoded allowlist.
8. Permanent deletion requires a deliberate confirmation step and is absent from the AI tool surface.

---

## 5. Phase 0 — Prove the OpenAPI choice (hard gate)

**Objective:** verify the package decision against the actual pinned stack before any dependency is installed or route is migrated.

**Location:** throwaway directory outside the repository (e.g. `D:\Coding\OpenCode\user\tmp\opencode\openapi-fit\`). Do not touch the repo.

**Pinned versions:** `hono@4.13.19`, `zod@4.6.7`, candidate packages pinned exactly (no floating ranges).

**Assertions — all must pass:**

1. Existing middleware still runs (custom header survives; `secureHeaders` output present).
2. An existing service object is called unchanged by the new route.
3. Invalid request input produces RTWiki's existing `{error}` 400 shape — not a 500. This is a **behavioural** requirement, not an assumption about library internals: `src/server/app.ts:329-332` currently converts every thrown error to a generic 500, so if the chosen library returns or throws anything else, an explicit adapter/hook/error mapping must be added. Record the actually observed behaviour for both candidates.
4. Multipart `File` upload validates and reaches the handler.
5. Wrong media type is rejected (415 for `@hono/zod-openapi`; document the equivalent for `hono-openapi`).
6. `GET /openapi.json` contains both the parent route and a route mounted through `app.route()` — one combined document.
7. **Route metadata is introspectable from the generated spec** — specifically that `describeRoute` tags survive into `generateSpecs()` output and the cached spec can be read deterministically. This is what makes §7 possible.
8. `tsc --noEmit` passes with the repo's TypeScript 7.0.2.
9. `bun build --compile` artifact passes the same assertions (catches the `.openapi()` bundling caveat).
10. Existing **unannotated** routes with manual validation still behave identically — no regression from adding OpenAPI middleware to the app.

**Risk to test, not assume:** the `onError` fallback at `src/server/app.ts:329-332` maps any thrown error to 500. Whether a candidate library throws `HTTPException` or returns a 400 directly must be measured in the probe, then handled explicitly.

**Decision rule:** if `hono-openapi` passes, adopt it. If it fails and `@hono/zod-openapi` passes, adopt the latter **only with explicit owner approval** for converting the root app and all ten route modules. If neither passes, stop and report — do not invent a third approach.

**Deliverable:** an ADR under `docs/adr/` recording the measured result, not the comparison table.

**Files in repo:** one new ADR only. No `package.json`, `bun.lock`, or route changes.

**Acceptance:** ADR accepted; all ten assertions pass under Bun and the compiled binary.

**Risk:** tag introspection may not be reachable. Fallback: a registry that routes register into at definition time — still derived, still no hardcoded list. This must be decided in Phase 0, not discovered in Phase 2.

---

## 6. Phase 1 — Reliable recovery (highest product priority)

**Objective:** make accidental deletion recoverable without replacing the database from a backup. This phase alone satisfies the owner's acceptance criterion.

### 6.1 Database changes (in existing `src/server/database/migrations.ts`)

The required-migration set is derived from the migration calls themselves — do not add a hand-maintained list.

**Migration 014 — soft-deletable attachments**

```sql
ALTER TABLE attachments ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_attachments_deleted_at ON attachments(deleted_at);
```

Keep the `data` BLOB intact on soft delete. No table rebuild.

**Migration 015 — recovery data**

```sql
CREATE TABLE page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  page_type TEXT NOT NULL,
  parent_id TEXT,
  position INTEGER NOT NULL,
  search_content TEXT,
  children_snapshot TEXT,
  links_snapshot TEXT,
  capture_kind TEXT NOT NULL,
  actor TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_page_revisions_page_version ON page_revisions(page_id, version DESC);
CREATE INDEX idx_page_revisions_captured_at ON page_revisions(captured_at);

CREATE TABLE operation_log (
  id TEXT PRIMARY KEY,
  operation_kind TEXT NOT NULL,
  target_page_id TEXT,
  target_attachment_id TEXT,
  before_revision_id TEXT,
  after_revision_id TEXT,
  actor TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_operation_log_created_at ON operation_log(created_at);
```

No foreign keys to `pages` or `attachments` — follows the `import_sources` precedent so recovery data survives permanent deletion.

`capture_kind`, `operation_kind` and `status` are **not free text**. Define them once as `as const` tuples/unions in shared code (following the `ImportErrorCode` pattern at `src/shared/schemas/import.ts:11-31`), validate at service boundaries, and store the same string values in SQLite. Routes, UI and tests import those constants — they never restate the literals.

### 6.2 Complete deletion snapshot

The current restore (`src/server/repositories/page-repository.ts:303-352`) loses hierarchy, links, original position and search fidelity, and has no tests. The snapshot must be captured **inside the soft-delete transaction** (`src/server/repositories/page-repository.ts:248-283`):

- `title`, `content`, `page_type`, `parent_id`, `position`, `version`, `created_at` — the page row itself. `created_at` is preserved on restore; `updated_at` is set to the restore time.
- `search_content` — extracted searchable text via the shared `searchContentForPage` (`src/server/services/page-service.ts:168-171`), **not** raw JSON.
- `children_snapshot` — JSON array of `{id, parent_id, position}` for **direct** living children at deletion time, captured in **pre-promotion order** (`position ASC, rowid ASC`) with their original `parent_id` (the deleted page) and original positions. Grandchildren need no snapshot: they remain under their promoted parent, which returns with it.
- `links_snapshot` — outgoing link targets from `page_links`.

### 6.3 Restore algorithm

Two distinct paths. Both run in **one `BEGIN IMMEDIATE` transaction** and abort before any mutation if their required data is missing.

**A. Revision-backed restore (preferred)** — used when a pre-delete revision exists:

1. Load the pre-delete revision.
2. Restore the page row: `deleted_at = NULL`, original `parent_id` if that parent is living (otherwise `NULL`), original `position` after making room at the target level. Preserve `created_at`; set `updated_at` to restore time.
3. Re-index using the stored `search_content`.
4. Re-insert outgoing links from `links_snapshot`.
5. For each child in `children_snapshot`, in recorded order: re-parent it back to the restored page **only if** it is still living **and** its current parent is still the grandparent it was promoted to. Children moved elsewhere by the user, or independently deleted, are left alone. Remove eligible children from the promoted parent's sibling list, **compact the remaining siblings**, then insert under the restored page at the recorded position, making room there. Deterministic order is `position ASC, rowid ASC`.
6. Apply the same make-room/compaction logic at root level — this fixes the root-page collision (`src/server/repositories/page-repository.ts:258,269-275`).
7. Bump `version` so concurrent writers receive a 409.

**B. Legacy fallback (pre-015 trash, no revision)** — an **alternate path**, not a prefix to A. Pages trashed before migration 015 have no snapshot; never refuse to restore them. Use the current best-effort row-based behaviour (`src/server/repositories/page-repository.ts:303-352`), preserving `created_at`, setting `updated_at` to restore time, bumping `version`, and re-indexing best-effort. Mark the result as reduced fidelity: **do not fabricate** children, links or original positions. Do not run steps A3–A6 against data that does not exist.

### 6.4 Attachment recovery — exact policy

Constants in `src/shared/constants/index.ts`:

- `TRASHED_ATTACHMENT_RETENTION_DAYS = 30`

Rules:

- `DELETE /api/attachments/:id` becomes a **soft delete** (sets `deleted_at`, keeps bytes). This changes existing semantics; there is no UI consumer today, so the blast radius is small.
- `POST /api/attachments/:id/restore` clears `deleted_at`.
- `DELETE /api/attachments/:id/permanent?confirm=permanent` is the explicit purge (row + BLOB in one transaction, logged by id only). The same `?confirm=permanent` rule applies to every irreversible delete (see §7.2).
- **Filtering contract — all of these must be implemented and tested:** normal `GET /api/attachments/:id`, `/view`, `/text`, `listAttachments()` and `attachmentTextForContent()` (`src/server/attachments/attachment-references.ts:79-97`) exclude `deleted_at IS NOT NULL`; trash endpoints include **only** deleted rows; the living-orphan sweep ignores soft-deleted rows; the trashed-attachment purge uses its own rule. A soft-deleted attachment is not downloadable by its normal id — only through the trash path.
- Startup purge of a trashed attachment happens **only if all**: (a) `deleted_at` is older than 30 days, (b) no page — living **or** trashed — references its URL in content, and (c) no **retained revision snapshot** references its URL. Condition (c) is required because revisions store `content`/`search_content` and survive permanent deletion by design; an attachment referenced only by a recoverable revision must not be purged, or restoring that revision would silently lose the asset.
- The existing living-orphan sweep (30 days, `src/server/attachments/attachment-retention.ts:66,141-170`) keeps its behaviour but must skip soft-deleted rows so it cannot hard-delete them before their own trash window expires.
- Restore clears `deleted_at`, immediately returning the attachment to the living-attachment rule.

### 6.5 Revision retention — no dangling references

Constants in `src/shared/constants/index.ts`:

- `MAX_PAGE_REVISIONS_PER_PAGE = 10`
- `RECOVERY_RETENTION_DAYS = 30`

Rules:

- One prune routine at startup, in one transaction, in this dependency-safe order:
  1. Identify expired `operation_log` rows and delete them.
  2. Delete a revision **only if** it is (a) not the newest revision for its page, (b) older than the retention/cap policy, **and** (c) referenced by **no remaining** `operation_log` row. A revision may be referenced by several operations (one op's `after_revision_id` is the next op's `before_revision_id`), so deleting it because its "owning" op expired would leave a live op dangling.
  3. Assert after pruning that no `operation_log` row references a missing revision; fail the prune and roll back if the assertion fails.
- The newest revision per page is never pruned, so "undo last change" always works.
- Undo validates the snapshot exists before mutating anything. If expired → `410 Gone` with `recovery_data_expired`; the UI says "this change is too old to undo." **Never report silent success.**
- Capture points: before update (previous row), before soft delete, before restore. There is **no import-overwrite path today** (`POST /api/import` only creates pages, `src/server/routes/import.ts:149-187`); do not add a capture point for a path that does not exist. If an overwrite path is added later, add its capture point in the same change.

### 6.6 New endpoints

| Method + path | Purpose | Response |
|---|---|---|
| `GET /api/attachments/trash` | List soft-deleted attachments | `{attachments,total}` |
| `POST /api/attachments/:id/restore` | Restore bytes | `{attachment}` |
| `DELETE /api/attachments/:id/permanent?confirm=permanent` | Purge (UI-only) | `{ok:true}` |
| `GET /api/pages/:id/revisions` | Bounded history | `{revisions}` |
| `POST /api/pages/:id/revisions/:revId/restore` | Undo | `{page}` |
| `GET /api/recovery/operations` | Recent operations | `{operations}` |

The existing `DELETE /api/pages/:id/permanent` (`src/server/routes/pages.ts:256-269`) also gains the `?confirm=permanent` requirement. The rule is global for **all** irreversible deletes, not just the new attachment purge.

### 6.7 UI

- Trash view: add an **Attachments** tab with restore and purge.
- Minimal page history panel: list revisions, preview, restore.
- The "recent AI changes" panel is **optional** and deferred; trash + revisions already meet the acceptance criterion.

### 6.8 Tests (must assert behaviour, not just database rows)

- Restore a deleted parent with children: hierarchy, child positions, links and search text all recovered.
- Restore a deleted parent whose child was moved elsewhere: child stays where the user put it.
- Restore a deleted parent whose parent is also deleted: falls back to root without data loss.
- Root-page soft-delete with children: no position collision.
- Trashed attachment referenced by a trashed page: survives the purge sweep.
- Trashed attachment unreferenced and young: survives.
- Trashed attachment unreferenced and old: purged.
- Restored attachment: survives.
- Undo with an expired revision: `410 recovery_data_expired`, no mutation.
- Prune: no operation-log row references a missing revision, including the case where one revision is referenced by several operations.
- A page trashed **before** migration 015 is still restorable after the migration (reduced fidelity, no data loss).
- Multi-child restore: children return in recorded order, promoted siblings are compacted, no position holes at root or under a parent.
- Soft-deleted attachment is not served by `GET /:id`, `/view`, `/text`, not listed normally, not searchable, and not reclaimed by the living-orphan sweep.
- Attachment referenced **only** by a retained revision snapshot is not purged; restoring that revision keeps the asset.
- Pagination: `limit` outside `1..100` and negative `offset` return 400 rather than bypassing the window.
- Import post-commit readback returns 201 with page, attachment and provenance — no 500 after a successful commit (§6.11).
- A backup created before migrations 014/015 is refused by the schema validator with `schema-missing-migration`, and no restore occurs (§6.10 owner action).

### 6.9 Acceptance

Every accidental-delete scenario (page, child hierarchy, attachment, overwritten content) is recoverable **without** replacing the database from a backup.

### 6.10 Risks

- **Owner action — required before Phase 1 ships:** explicitly tell the owner that **backups created before migrations 014/015 cannot be restored by the new recovery process**. The schema validator (`src/server/backup/validation.ts:110-153`) will refuse them because `requiredMigrations` is derived from the migration calls. This is expected and correct, but it is a user-visible limitation: such backups are historical artifacts only, and any restore need must be handled with a build that still understands the old schema. Verify the refusal with a Phase 1 test and record the owner notification in the Phase 1 report.
- Changing `DELETE /api/attachments/:id` from hard to soft delete is a semantic change; verify no hidden consumer exists before merging.
- Pages already in trash at migration time have no snapshot. The legacy fallback in §6.3 must be implemented and tested, or existing trash recovery regresses.

### 6.11 Independent small fixes (shipped with Phase 1)

These two fixes are unrelated to recovery but are independent of OpenAPI, so they ship with Phase 1 rather than Phase 2. They may be committed separately from the recovery work if that keeps review clean; do not create a new phase for them.

- Bound `GET /api/pages` pagination: `limit` must be an integer in `1..100`, `offset` an integer `>= 0`; invalid values return 400. Currently `Number(...) || 50/0` lets a negative limit bypass the 50-row window and allows unbounded positive limits (`src/server/routes/pages.ts:60-62`).
- Fix the import post-commit readback that returns 500 after a successful commit (`src/server/routes/import.ts:176-184`).

---

## 7. Phase 2 — AI capability surface (derived, not hardcoded)

**Objective:** let external AI tools use RTWiki's real capabilities, with irreversible operations absent from the tool surface.

### 7.1 Tool manifest derivation

- Tag AI-safe routes with `describeRoute({ tags: ['ai-safe'], ... })` (or the equivalent confirmed in Phase 0).
- `GET /api/ai/tools` is generated by filtering the OpenAPI document on that tag. Tool names, descriptions and request schemas come from the existing route metadata — no separate list, no duplicated descriptions.
- **Untagged routes are not exposed.** A new dangerous route added without the tag is automatically excluded (fail-safe).
- The same tag drives OpenAPI grouping, so documentation and tools cannot disagree.
- If Phase 0 proves tags are not introspectable, use a registry that routes register into at definition time. Still derived; still no hardcoded list.

**Validation status:** the derived-manifest design above is a design claim, not a validated result. It is fully validated only when Phase 0 assertion 7 produces measured evidence that route tags survive into the generated spec (or that the registration-time fallback works). Do not describe the capability surface as proven before then.

### 7.2 Enforcement boundary — honest statement

- **Tool layer (primary):** the AI has no tool for permanent delete, backup restore, shutdown, settings writes or preset `replace`. This is real enforcement at the integration layer.
- **HTTP layer (secondary):** **all irreversible delete/replace operations** use one mechanism — the query parameter `?confirm=permanent`. Without it → `400 confirmation_required`. This applies to `DELETE /api/pages/:id/permanent`, `DELETE /api/attachments/:id/permanent`, and preset `mode:'replace'` (`src/server/routes/schedule-presets.ts:79-96`, `src/server/services/schedule-service.ts:226-229`). The UI's confirm modal sends it. This prevents accidental calls; it is a deliberate speed bump, **not** a security boundary. Do not introduce a second confirmation mechanism for deletes/replaces. Confirmation is read from the **query parameter only** — `applyPresetSchema` and other request bodies stay unchanged; the route returns `400 confirmation_required` when `mode === 'replace'` and the query parameter is missing or wrong.
- **Existing token gate** stays on backup restore and shutdown.
- **Explicit non-goal:** full isolation between a local AI client and the user would require authentication, which is out of scope. Do not claim otherwise in docs.

### 7.3 Content handling

- All four page types keep their canonical formats; `content` is a JSON-encoded string.
- OpenAPI request/response schemas **reuse the existing Zod schemas** in `src/shared/schemas/` — no redefinition.
- Rich semantic validation derives allowed values from the block modules (e.g. callout variants exported from `blocks/callout.tsx`) rather than restating enums. Unknown block types remain accepted for forward compatibility; preservation via `UNSUPPORTED_BLOCK_MARKER` stays intact.
- `POST /api/pages/batch` creates multiple related pages in one transaction by reusing `createPageCore`. It is **not** a new ingest path.

### 7.4 Small fix folded in here

The pagination and import-readback fixes were moved to §6.11 because they are independent of OpenAPI; only the preset confirmation belongs to this phase.

- Add confirmation to preset `mode:'replace'` (`src/server/services/schedule-service.ts:226-229`).

### 7.5 Tests

- Tool manifest equals the set of tagged operations; adding an untagged route does not expose it.
- All four page types can be created through the API and render in the editor.
- Batch creation is atomic.
- Destructive endpoints reject calls without `?confirm=permanent`.

### 7.6 Acceptance

An external AI can create, read, search, update, move, duplicate, link, trash and restore pages; import files; upload and read attachments; and read schedules/settings — while having no tool for irreversible operations.

---

## 8. Phase 3 — Import orchestration (optional, later)

Previewable multi-page creation and related-page workflows using the existing content and ingestion services. `.rtwiki.zip` is reconsidered **only through a separate ADR** that supersedes ADR-024.

---

## 9. Explicit non-goals and remaining gaps

- `.rtwiki.zip` note-package and the full ADR-006 eight-stage pipeline — deferred; not implemented.
- Paste and `source.kind:'api'` import — explicitly rejected by the ingest core.
- FTS5-backed search — the virtual table exists but is never queried; search is `LIKE`. Do not describe it as FTS5.
- Tags, dedicated search endpoint, global request ceiling, unknown-block user warnings — not implemented.
- `POST /api/settings/server/restart` — documented but never registered; restart is Tauri IPC.
- No auth, roles, cloud sync, LAN mode, audio/video, or native wrapper changes.
- **Dead-code removal is out of scope.** The unused FTS5 virtual table, the documented-but-unregistered `POST /api/settings/server/restart`, and the other stale artifacts listed above are recorded as gaps, not cleanup targets. Removing them is a separate, separately authorised task; do not expand any phase to include it.

---

## 10. Verification protocol

Per AGENTS.md §10, implementation and verification are separate:

1. Implementation agent changes only the authorised phase scope and reports commands run.
2. Project manager reviews the report.
3. A separate verification prompt is issued; verification is read-only unless explicitly authorised.
4. Failures lead to a separate correction task.

Quality gates (CI): `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun test`, `bun run build:web`, `bun run build:server`, `bun scripts/verify-docs.ts`. Do not weaken a failed gate.

---

## 11. Documentation obligations

- Add/update an ADR for the OpenAPI decision (Phase 0) and for any architecture change.
- Update `AGENTS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DATA_MODEL.md` and `ADR-018` where they are stale relative to the built code — using the "verified / partial / not implemented" discipline required by AGENTS.md §13.
- Run `bun scripts/verify-docs.ts` after any documentation or Markdown link change.

---

## 12. Phase summary

| Phase | Objective | Repo files | Gate |
|---|---|---|---|
| 0 | Prove OpenAPI choice | one new ADR | all ten probe assertions pass |
| 1 | Reliable recovery + two independent fixes (§6.11) | migrations, repository/service, recovery routes, trash UI, tests, pagination and import-readback fixes | every accidental-delete scenario recoverable |
| 2 | AI capability surface | route tags, tools endpoint, semantic validation, batch endpoint, preset confirmation | tool manifest derived; no hardcoded list |
| 3 | Import orchestration | batch/preview UI | separate ADR for `.rtwiki.zip` |

**Owner action before Phase 1 ships:** notify the owner that backups created before migrations 014/015 cannot be restored by the new recovery process (§6.10).

**Phase 1 stays a single phase.** Split it into schema/service then routes/UI only if those boundaries are genuinely clean; do not split merely to produce more commits.

**Do not hand all phases to one agent as an unrestricted task.** Execute one phase at a time, with review between phases.
