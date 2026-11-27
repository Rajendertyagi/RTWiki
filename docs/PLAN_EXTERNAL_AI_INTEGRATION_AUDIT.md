# Audit — PLAN_EXTERNAL_AI_INTEGRATION.md

**Audit date:** 2026-11-26 · **Audited document:** [PLAN_EXTERNAL_AI_INTEGRATION.md](PLAN_EXTERNAL_AI_INTEGRATION.md) · **Repo state:** `develop` @ `7e8580f`, synced with `origin/develop`

Read-only audit at the time; every claim below was checked against the current source tree. The plan file was **not modified during the audit**, but all findings were applied to it afterwards (see Resolution below).

## Verdict

**The plan is technically well-grounded and safe to keep as a proposal, but §1 (Repository state) was stale and had to be corrected before any agent acted on it.** All pinned versions, migration numbering, cited line references and "not implemented" claims checked out. No factual defect was found in the technical design; the problems were a stale repo snapshot, imprecise paths, and a few overstatements.

**Resolution:** all four findings below were applied to [PLAN_EXTERNAL_AI_INTEGRATION.md](PLAN_EXTERNAL_AI_INTEGRATION.md) on 2026-11-26 — §1 rewritten to the current snapshot, all cited paths made fully qualified, §7.2 reworded to name both mechanisms, and §6.10 relabelled as an expected behaviour to be verified by a Phase 1 test. The findings are retained here as the audit record.

**Owner-approved refinements (same date):** the owner approved the plan with three targeted changes, all applied — (1) dead-code removal explicitly kept out of scope (§9); (2) the independent pagination and import-readback fixes moved from §7.4 to §6.11 so Phase 2 stays focused; (3) an explicit owner-facing action added in §6.10 and §12 stating that backups created before migrations 014/015 cannot be restored by the new recovery process. Phase 1 was deliberately **not** split; the plan records that it should be split only if the schema/service vs. routes/UI boundary is genuinely clean. §7.1 now states that the derived-manifest SSOT design is a design claim until Phase 0 assertion 7 produces measured evidence.

## Phase 0 acceptance and Phase 1 owner decisions (2026-11-27)

The owner accepted the Phase 0 hard gate and authorised **Phase 1 only**. Phase 2 and Phase 3 remain **unauthorised**. Current work is on `feature/external-ai-integration`, based on `1c017b6`. The five Phase 1 stop conditions were resolved with these exact decisions, now incorporated into [PLAN_EXTERNAL_AI_INTEGRATION.md](PLAN_EXTERNAL_AI_INTEGRATION.md) §6:

1. **Operation-log contract** — operation kinds exactly `page.update`, `page.trash`, `page.restore`, `page.revision.restore`, `page.permanent_delete`, `attachment.trash`, `attachment.restore`, `attachment.permanent_delete`; status exactly `committed` only; actors exactly `local-client`, `system`, `ai`. Revision-reference semantics and API response shape: since no further detail was given, the plan's §6.5 chain rule applies (one operation's `after_revision_id` is the next operation's `before_revision_id`) and `GET /api/recovery/operations` returns `{operations}` with bounded, newest-first ordering; no extra fields were invented. Expiry: older than 30 days. Only these recovery operations are logged — not a general activity log.
2. **Permanent page deletion** — purge all page revisions; purge historical operation records for that page; record one metadata-only permanent-deletion event with no revision references and no content; make revision history unavailable after permanent deletion; perform atomically. [SECURITY.md](SECURITY.md) §8 now distinguishes trashed content and retained revisions (live rows, present in backups) from physically deleted content (purged, absent from backups).
3. **Snapshot** — add `created_at TEXT NOT NULL` to `page_revisions` and preserve it during restoration.
4. **Child movement** — same-parent reordering counts as movement. Add internal `structure_version INTEGER NOT NULL DEFAULT 0` to `pages` in migration 015; increment it whenever `parent_id` or `position` changes, never for ordinary content edits. Store the expected post-promotion structure version in each child snapshot; restore children only if parent AND structure version still match, otherwise leave untouched. Audit every structural-write path, including sibling reindexing.
5. **Hono** — update to `hono@4.13.23` in a separate commit, update the lockfile, run focused regression tests, and re-run all ten Phase 0 assertions with Hono 4.13.23 and `hono-openapi`. Preserve the old 4.13.19 evidence and append new measured results (recorded in [ADR-025](adr/ADR-025-openapi-library-selection.md)). Do not install `hono-openapi` into the production project during Phase 1.

The compiled external-dependency packaging question remains a Phase 2 gate. The historical audit findings below are retained unchanged as the record of the original review.

## Verified accurate

| Plan claim | Evidence |
|---|---|
| Pinned `hono@4.13.19`, `zod@4.6.7`, TypeScript `7.0.2` | `package.json` dependencies/devDependencies — exact match |
| No OpenAPI or AI code exists yet | `grep` for `ai-safe`, `ai/tools`, `openapi`, `generateSpecs`, `describeRoute` across `src/` → no matches. Phase 0 is genuinely greenfield. |
| Latest migration is 013, so 014/015 are the next numbers | `src/server/database/migrations.ts` ends at `013_create_import_sources` (`:395`); `requiredMigrations` derived from calls (`:34-43`) |
| `app.ts:329-332` converts every thrown error to a generic 500 | Verified verbatim — `app.onError` returns `c.json({ error: 'Internal server error' }, 500)` |
| `pages.ts:60-62` pagination bug | Verified — `Number(c.req.query('limit')) || 50`, `Number(...) || 0` |
| `pages.ts:256-269` permanent delete has no confirmation | Verified — `DELETE /:id/permanent` calls `permanentlyDeletePage` directly |
| `import.ts:176-184` post-commit readback returns 500 | Verified — readback of page/attachment/provenance with a 500 on any miss |
| `schedule-service.ts:226-229` preset `replace` runs unqualified deletes | Verified — `deleteAllScheduleEntries` + `deleteAllReminders` |
| `schedule-presets.ts:79-96` apply route | Verified |
| `page-service.ts:56-149` validation, `:168-171` `searchContentForPage` | Verified (actual path `src/server/services/page-service.ts`) |
| `page-repository.ts:248-283` soft delete, `:303-352` restore | Verified (actual path `src/server/repositories/page-repository.ts`) |
| `attachment-references.ts:79-97` `attachmentTextForContent` | Verified |
| `attachment-retention.ts:66` 30-day constant, `:141-170` sweep | Verified |
| `rich-editor/schema.ts:30-48` schema + derived `KNOWN_BLOCK_TYPES` | Verified |
| `import.ts:11-31` `ImportErrorCode` tuple | Verified |
| `document-formats.ts:196-225` derived MIME/ext lists | Verified (actual path `src/shared/attachments/document-formats.ts`) |
| `POST /api/settings/server/restart` documented but never registered | Verified — only a comment at `src/server/routes/settings.ts:46`; no route |
| No UI consumer calls `DELETE /api/attachments/:id` | Verified — `src/web` only POSTs to `/api/attachments` and GETs `/text`; no delete call |
| Quality gates `format:check`, `lint`, `typecheck`, `test`, `build:web`, `build:server`, `verify-docs` exist | Verified in `package.json` scripts |

## Stale or incorrect

1. **§1 Repository state is stale (highest priority).** It states HEAD `de7326a`, four commits ahead of `origin/develop` (`e865923`), with 11 pre-existing modified theme files and a rule to "never commit or overwrite those files." Current state: HEAD `7e8580f`, **in sync** with `origin/develop`; those theme files were committed and pushed in `7e8580f`. An agent following §1 would refuse to commit work that is already committed and would misreport the branch state. **Action:** rewrite §1 to the current snapshot, or delete it and reference `git status` at execution time.

2. **§3 / §6 paths are imprecise.** `page-service.ts`, `page-repository.ts` and `document-formats.ts` are cited without their directories. Actual paths: `src/server/services/page-service.ts`, `src/server/repositories/page-repository.ts`, `src/shared/attachments/document-formats.ts`. **Action:** use full paths so implementers do not have to search.

3. **§7.2 "all irreversible operations use one mechanism" is overstated.** The same section immediately notes that backup restore and shutdown keep their existing token gate. So there are two mechanisms: `?confirm=permanent` for deletes/preset-replace, and the per-process token for restore/shutdown. **Action:** say "all irreversible *delete/replace* operations use `?confirm=permanent`; restore and shutdown retain the token gate."

4. **§6.10 backup-refusal claim is a prediction, not a measured fact.** It says backups taken before migrations 014/015 will be refused by `backup/validation.ts:110-153`. That follows from the derived `requiredMigrations` design, but it has not been executed. **Action:** label it as expected behaviour to be verified by a test in Phase 1, not as an established result.

## Gaps and risks worth tightening

- **§5 Phase 0 assertion 7 (tag introspection) is the real hard gate.** The plan already identifies the fallback (a registration-time registry). Good. Keep the rule that this must be decided in Phase 0 — if it slips to Phase 2, §7.1's "derived, not hardcoded" guarantee is unenforceable.
- **§6.3 legacy fallback** is correctly called an alternate path, not a prefix. This is the right call: pages already in trash have no snapshot, and refusing them would regress existing behaviour. Ensure the Phase 1 tests include the pre-015 case (the plan does, at §6.8).
- **§6.4 condition (c)** — not purging an attachment referenced only by a retained revision — is the subtlest rule in the plan and is easy to drop. It deserves a dedicated test (the plan has one at §6.8) and a comment in code explaining why revisions survive permanent deletion.
- **§7.4 small fixes** were originally bundled into Phase 2. The pagination and import-readback fixes are independent of OpenAPI; they were moved to §6.11 (Phase 1) at the owner's request, leaving only preset confirmation in §7.4.
- **§12 "do not hand all phases to one agent"** is consistent with AGENTS.md §10 (implementation/verification separation). Keep it.

## Alignment with repository rules

The plan's guiding principles (§2) match AGENTS.md: one Hono app, one SQLite DB, one ingest core, no auth/LAN/native-wrapper changes, no new source of truth, recovery before write access. Its non-goals (§9) match the documented built state (FTS5 never queried, paste/API import rejected, `.rtwiki.zip` deferred). No conflict with an accepted ADR was found.

## Bottom line

- **Safe to keep as a proposal.** No technical claim was found to be wrong.
- **Resolved before execution:** §1 stale repo snapshot; full paths in §3/§6; §7.2 two-mechanism wording; §6.10 prediction vs. measured fact. All four were applied to the plan (see Resolution above).
- **Do not start Phase 0 without owner approval** — the plan says so in its header Scope: "This document does not authorise code changes by itself."
