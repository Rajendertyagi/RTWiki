# Visual MVP Tracker

This document tracks the phased implementation of RTWiki's first usable visual interface. It is the permanent source of truth for Visual MVP progress.

## Purpose

The Visual MVP delivers a focused vertical slice: a Windows-buildable application where the owner can open the app, create pages personally, and judge the UI. This is not the full rich-content roadmap — it is the minimum needed for visual evaluation.

## Owner Decisions

| Decision | Value | Date |
|----------|-------|------|
| Workspace starts empty | Yes — no sample Physics page, tutorial, demo note, or seeded content | 2026-08-20 |
| Owner creates first page | Yes — owner judges the UI personally | 2026-08-20 |
| Page types | Rich Note + Custom HTML Page | 2026-08-20 |
| HTML editor tabs | Separate HTML, CSS, JavaScript editors | 2026-08-20 |
| JavaScript default | Disabled by default per page | 2026-08-20 |
| JavaScript isolation | Runs only inside isolated iframe sandbox | 2026-08-20 |
| No custom code in main context | Custom CSS/JS never executes in RTWiki's main application context | 2026-08-20 |
| No local Bun/Node execution | All builds and tests run on GitHub-hosted runners only | 2026-08-20 |
| Portable artifact per phase | Every usable phase produces a portable Windows artifact where practical | 2026-08-20 |
| UI feedback before advanced features | Owner reviews each artifact before advancing | 2026-08-20 |

## Explicit Exclusions

The following are **not** in scope for the Visual MVP:

- AI chat / external AI provider integration
- Cloud sync / accounts / authentication
- Audio / video support
- Real-time collaboration
- LAN access
- Export formats (PDF, DOCX, ODT)
- Plugin marketplace
- Native cards/tabs/formula/Mermaid custom blocks beyond BlockNote defaults
- Global custom CSS/JS
- Attachments beyond existing safe support
- Recycle bin UI (soft-delete is implemented; restore UI deferred)

## Phase Table

| Phase | Name | Status | Commit SHA | CI Run | Artifact |
|-------|------|--------|------------|--------|----------|
| 0 | Discovery and Tracker | Owner approved | 0c1010b | #71 | — |
| 1 | Page Persistence and CRUD API | Owner approved | fe8f418 | [#79](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376828943) | build/#79 |
| 2 | Visual Workspace and Page Management | Correction 3 pending CI | 00c3678 | [#32393535423](https://github.com/Rajendertyagi/RTWiki/actions/runs/32393535423) | RTWiki-0.1.0-windows-x64 |
| 3 | Rich Note Editor and Autosave | Not started | — | — | — |
| 4 | Sandboxed HTML/CSS/JavaScript Pages | Not started | — | — | — |
| 5 | Polish and Release Candidate | Not started | — | — | — |

### Status Definitions

| Status | Meaning |
|--------|---------|
| Not started | Phase not yet begun |
| In progress | Actively working on this phase |
| Implemented | Code written, committed, awaiting CI |
| CI verified | All CI gates passed |
| Owner approved | Owner has reviewed artifact and approved advancement |
| Blocked | Cannot proceed; see Blockers section |

## Phase 0 — Discovery and Tracker

### Scope
- Verify main SHA
- Create feature branch
- Read all source, docs, ADRs, package files
- Consult official documentation for BlockNote, Mantine, DOMPurify, iframe sandbox, CSP
- Determine current capabilities and gaps
- Create this tracker
- Add tracker link to README
- Record proposed module map for Phases 1–5
- Do **not** change application code

### Acceptance Criteria
- [ ] Main SHA verified: `06763e471fa1895064aadd61ac577b6e3c27b8b0`
- [ ] Branch `feature/visual-mvp` created from remote main
- [ ] All 18 source files read and understood
- [ ] All architecture/security/data-model docs read
- [ ] Official docs consulted for BlockNote, Mantine, DOMPurify, iframe sandbox, CSP
- [ ] Missing dependencies identified and recorded
- [ ] This tracker created
- [ ] README updated with tracker link
- [ ] Documentation Quality CI passes

### Planned Files
```
docs/VISUAL_MVP_TRACKER.md (new)
README.md (modified — add tracker link)
```

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| docs/VISUAL_MVP_TRACKER.md | Added | 4c80980 |
| README.md | Modified (+4 -0) | 4c80980 |
| .github/workflows/docs-quality.yml | Modified (add feature/** trigger) | 44a9343 |
| .github/workflows/build.yml | Modified (add feature/** trigger) | 44a9343 |

### Known Limitations
- BlockNote, DOMPurify, @mantine/hooks are not yet installed — added in Phase 1/3
- Existing CI targets `feature/mvp-foundation` — trigger update deferred to Phase 1
- `format-fix.yml` is temporary and should be cleaned up

## Phase 1 — Page Persistence and CRUD API

### Scope
- Versioned migration: add `page_type TEXT NOT NULL DEFAULT 'rich'` to `pages`
- Shared page contracts and Zod validation schemas
- Page repository (database access module)
- Page service (business logic)
- Page API routes (Hono)
- Backend tests for CRUD, search, duplicate, soft-delete

### Acceptance Criteria
- [x] Migration 002 adds `page_type` column, idempotent
- [x] Page type enum: `rich` | `html`
- [x] GET /api/pages — list, search, sort by updated_at
- [x] POST /api/pages — create with type, title, content
- [x] GET /api/pages/:id — get single page
- [x] PATCH /api/pages/:id — update title, content, page_type
- [x] POST /api/pages/:id/duplicate — duplicate page
- [x] DELETE /api/pages/:id — soft-delete
- [x] All queries parameterized, no SQL in route handlers
- [x] API validation with Zod at boundary
- [x] Error responses: `{ error: string }` no paths/stacks
- [x] Backend tests pass (49/49)
- [x] Existing foundation tests still pass (22/22)

### Planned Files
```
src/shared/contracts/pages.ts (new)
src/shared/schemas/pages.ts (new)
src/server/database/migrations.ts (modified — add migration 002)
src/server/repositories/page-repository.ts (new)
src/server/services/page-service.ts (new)
src/server/routes/pages.ts (new)
src/server/app.ts (modified — mount page routes)
tests/pages.test.ts (new)
```

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| src/shared/contracts/pages.ts | Added | 770d401 |
| src/shared/contracts/errors.ts | Added | 770d401 |
| src/shared/schemas/pages.ts | Added | 770d401 |
| src/shared/constants/pages.ts | Added | 770d401 |
| src/server/repositories/page-repository.ts | Added | 770d401, fe8f418 |
| src/server/services/page-service.ts | Added | 770d401 |
| src/server/routes/pages.ts | Added | 770d401 |
| src/server/database/migrations.ts | Modified (+21) | 770d401 |
| src/server/app.ts | Modified (+8) | 770d401 |
| tests/pages.test.ts | Added (27 tests) | 770d401, fe8f418 |
| docs/VISUAL_MVP_TRACKER.md | Added | 71b00e3 |

### Commit Log

| SHA | Message | CI |
|-----|---------|-----|
| 770d401 | feat: add page persistence and CRUD API | [#72](https://github.com/Rajendertyagi/RTWiki/actions/runs/32374762568) fail (format) |
| de2061c | fix: format Phase 1 files for Biome compliance | [#73](https://github.com/Rajendertyagi/RTWiki/actions/runs/32374774870) fail (format) |
| e960b95 | fix: Biome formatting compliance (no trailing commas, LF, trailing newlines) | [#74](https://github.com/Rajendertyagi/RTWiki/actions/runs/32375392596) fail (format) |
| 3f1b26c | fix: wrap long lines for Biome 100-char limit | [#75](https://github.com/Rajendertyagi/RTWiki/actions/runs/32375812086) fail (format) |
| 03764c7 | fix: add trailing newlines to satisfy Biome format check | [#76](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376050356) fail (format) |
| 2d7e5c8 | fix: replace non-null assertions with optional chaining in tests | [#77](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376333346) fail (format) |
| 25cf369 | fix: remove trailing blank line in test file for Biome compliance | [#78](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376513139) fail (format) |
| fe8f418 | fix: use SQLQueryBindings type and cast optional content for JSON.parse | [#79](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376828943) **PASS** |
| 71b00e3 | docs: update tracker with Phase 1 CI-verified status | [#80](https://github.com/Rajendertyagi/RTWiki/actions/runs/32377325868) **PASS** |

### Known Limitations

- Drizzle ORM is listed in ARCHITECTURE.md but not yet installed — raw SQL with parameterized queries used instead (consistent with existing migrations)
- No recycle bin restore UI — soft-delete implemented, restore UI deferred
- No page version history UI — version counter implemented, UI deferred
- No attachment upload UI — infrastructure deferred
- No backup/restore UI — infrastructure deferred
- No full-text search UI — FTS5 infrastructure exists, search integration deferred
- BlockNote math-block and diagram-block not yet installed — available from BlockNote defaults only
- `format-fix.yml` workflow is temporary — should be cleaned up in Phase 5

## Phase 2 — Visual Workspace and Page Management

### Scope
- Mantine AppShell layout
- Responsive sidebar with search, page list, new-page button, theme toggle
- Dashboard with empty state, create buttons, page cards
- Page-type selection dialog
- Editor header with title, type badge, save status, rename, duplicate, delete
- Delete confirmation modal
- Loading/error/empty states
- Centralized UI text dictionary and theme tokens
- Reusable components
- No rich editor yet, no HTML editor yet

### Acceptance Criteria
- [x] AppShell with sidebar and main content area
- [x] Sidebar: logo, search, page list with type indicators, new-page button, theme toggle
- [x] Dashboard: empty state with "Create Rich Note" and "Create HTML Page" buttons
- [x] Page cards/list ordered by most recently updated
- [x] Search filters pages by title
- [x] New-page dialog with title input and type selection
- [x] Editor header: editable title, type badge, save status (Saving…/Saved/Error)
- [x] Rename, duplicate, delete actions in editor header
- [x] Delete confirmation modal
- [x] Loading and error states for all async operations
- [x] All strings in centralized UI text dictionary
- [x] All styles use Mantine theme tokens (no inline style)
- [x] Portable Windows artifact produced

### Planned Files
```
src/web/App.tsx (modified — replace health dashboard with workspace)
src/web/config/index.ts (modified — expanded UI text dictionary)
src/web/theme/index.ts (modified — extended theme if needed)
src/web/services/api.ts (modified — page API client)
src/web/features/dashboard/dashboard.tsx (new)
src/web/features/dashboard/empty-state.tsx (new)
src/web/features/dashboard/page-card.tsx (new)
src/web/features/pages/editor-header.tsx (new)
src/web/features/pages/new-page-dialog.tsx (new)
src/web/features/pages/delete-confirm-modal.tsx (new)
src/web/components/app-shell.tsx (new)
src/web/components/sidebar.tsx (new)
src/web/components/save-status.tsx (new)
src/web/components/theme-toggle.tsx (new)
src/web/components/search-input.tsx (new)
```

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| src/web/config/index.ts | Modified (expanded UI_TEXT, kept STATUS_TEXT alias) | c21e56c |
| src/web/main.tsx | Modified (+ Mantine CSS import) | c21e56c |
| src/web/services/pages-api.ts | Added | c21e56c |
| src/web/hooks/use-pages-controller.ts | Added (AbortController + seq + 300 ms debounce + mutation status) | c21e56c, be16b08 |
| src/web/components/page-type-badge.tsx | Added | c21e56c |
| src/web/components/search-input.tsx | Added | c21e56c |
| src/web/components/theme-toggle.tsx | Added | c21e56c |
| src/web/components/save-status.tsx | Added (mutation status only) | c21e56c |
| src/web/layout/app-shell.module.css | Added | c21e56c |
| src/web/layout/sidebar.module.css | Added | c21e56c |
| src/web/layout/app-shell.tsx | Added | be16b08 |
| src/web/layout/sidebar.tsx | Added | be16b08 |
| src/web/features/dashboard/dashboard.module.css | Added | be16b08 |
| src/web/features/dashboard/empty-state.tsx | Added | be16b08 |
| src/web/features/dashboard/page-card.tsx | Added | be16b08, e7429cd |
| src/web/features/dashboard/dashboard.tsx | Added | be16b08 |
| src/web/features/pages/new-page-dialog.tsx | Added | be16b08 |
| src/web/features/pages/delete-confirm-modal.tsx | Added | be16b08 |
| src/web/features/pages/editor-header.tsx | Added | be16b08 |
| src/web/features/pages/editor-header.module.css | Added | be16b08 |
| src/web/features/pages/page-workspace.tsx | Added | be16b08 |
| src/web/features/pages/page-workspace.module.css | Added | be16b08 |
| src/web/App.tsx | Rewritten (small composition root + inline Alert feedback) | be16b08 |
| src/server/repositories/page-repository.ts | Modified (+ rowid secondary sort for deterministic ordering) | 82688e0 |
| src/server/static.ts | Rewritten (path.relative containment, structured logging, 404 for missing assets, SPA fallback only for extensionless routes) | d3a18dc |
| src/server/app.ts | Modified (pass logger to serveStatic) | d3a18dc |
| src/server/bootstrap.ts | Rewritten (probeExistingInstance health check, single-instance detection with 2s timeout) | 4c6cef6 |
| src/server/index.ts | Rewritten (handle !runtime.server exit, wrap startup errors with logging) | 4c6cef6 |
| src/server/launcher.ts | Modified (wrap launcher errors with context) | 4c6cef6 |
| tests/foundation.test.ts | Rewritten (comprehensive static serving + single-instance tests) | 4c6cef6 |
| .github/workflows/build.yml | Modified (strengthened smoke test: MIME verification, byte comparison, single-instance test) | 4c6cef6 |
| src/web/features/dashboard/page-card.tsx | Rewritten (native `<button>` via `component="button"`, menu click isolation, keyboard Enter/Space) | 00c3678 |
| src/web/features/dashboard/dashboard.module.css | Rewritten (hover/focus-visible states, cardTitle pointer-events, button resets) | 00c3678 |
| src/web/layout/sidebar.tsx | Rewritten (Trilium-inspired: Home entry at top, prominent New Page, compact NavLink list, active selection) | 00c3678 |
| src/web/layout/sidebar.module.css | Modified (added actionsSection border-bottom) | 00c3678 |
| src/web/layout/app-shell.tsx | Modified (header 44px, navbar 280px) | 00c3678 |
| src/web/features/pages/page-workspace.tsx | Modified (removed redundant Title, cleaner layout) | 00c3678 |
| src/web/features/pages/page-workspace.module.css | Modified (min-height for 44px header) | 00c3678 |
| src/server/static.ts | Modified (removed noisy "Serving static asset" info log per owner requirement) | 00c3678 |
| src/web/hooks/pages-controller-utils.ts | Added (pure helpers: findSelectionAfterDeletion, syncSelectionWithPages, findPageById, filterPagesByQuery) | 00c3678 |
| tests/pages-controller.test.ts | Added (10 utility tests + 6 API integration tests against real Hono server) | 00c3678 |
| src/web/features/dashboard/page-card.tsx | Rewritten (ghost button overlay pattern: non-interactive Card wrapper, transparent <button> covering full card, sibling Menu button with z-index, no nested interactive elements) | correction 3 |
| src/web/features/dashboard/dashboard.module.css | Rewritten (position: relative on card, .cardOpenButton absolute overlay, .cardContent z-index, .cardMenuWrapper z-index) | correction 3 |
| src/web/layout/sidebar.tsx | Modified (added onStop prop, red power IconPower ActionIcon in footer section) | correction 3 |
| src/web/layout/sidebar.module.css | Added (stopSection, stopButton opacity hover) | correction 3 |
| src/web/App.tsx | Modified (shutdown state: token fetch, StopConfirmModal, stopped/error display) | correction 3 |
| src/web/features/shutdown/stop-confirm-modal.tsx | Added (Mantine Modal with warning text, Cancel/Stop buttons) | correction 3 |
| src/web/config/index.ts | Modified (added stopRtwiki, stopConfirmTitle, stopConfirmMessage, stopButton, stopSuccessMessage, stopError) | correction 3 |
| src/shared/constants/index.ts | Modified (added SHUTDOWN_TOKEN_HEADER) | correction 3 |
| src/server/routes/shutdown.ts | Added (module-level mutable token/handler, GET /token, POST /, same-origin validation, idempotent) | correction 3 |
| src/server/app.ts | Modified (mount shutdown routes once at module level) | correction 3 |
| src/server/bootstrap.ts | Modified (generate shutdownToken, setShutdownHandler, logger.close in shutdown) | correction 3 |
| scripts/build.ts | Added (Bun.build() JS API with conditional Windows PE metadata) | correction 3 |
| tests/shutdown.test.ts | Added (6 tests: token endpoint, unauthorized POST, wrong token, GET rejection, authorized shutdown, token not logged) | correction 3 |
| .github/workflows/build.yml | Modified (extended smoke test: shutdown API security, authorized shutdown, orphan check) | correction 3 |

### Commit Log

| SHA | Message | CI |
|-----|---------|-----|
| c21e56c | feat(web): add UI foundation — config, pages API, controller hook, and reusable components | [#32382282660](https://github.com/Rajendertyagi/RTWiki/actions/runs/32382282660) fail (format) |
| be16b08 | feat(web): add visual workspace — AppShell, sidebar, dashboard, and page management | [#32382282660](https://github.com/Rajendertyagi/RTWiki/actions/runs/32382282660) fail (format) |
| 489e559 | fix: biome format compliance for Phase 2 | [#32382531143](https://github.com/Rajendertyagi/RTWiki/actions/runs/32382531143) fail (lint) |
| e7429cd | fix: use semantic button for page card title to satisfy a11y lint | [#32382729554](https://github.com/Rajendertyagi/RTWiki/actions/runs/32382729554) fail (test) |
| 82688e0 | fix: ensure deterministic page ordering with secondary rowid sort | [#32382949820](https://github.com/Rajendertyagi/RTWiki/actions/runs/32382949820) **PASS** |
| 8e8c62d | docs: update tracker with Phase 2 CI-verified status, commit log, and artifact | (docs) |
| d3a18dc | fix: serve frontend assets with correct MIME types — Windows path separator fix, structured logging, 404 for missing assets | [#32389657109](https://github.com/Rajendertyagi/RTWiki/actions/runs/32389657109) **PASS** |
| 4c6cef6 | fix: handle existing RTWiki instance and strengthen smoke test — single-instance detection, EADDRINUSE handling, asset MIME smoke test | [#32389657109](https://github.com/Rajendertyagi/RTWiki/actions/runs/32389657109) **PASS** |
| 00c3678 | fix: resolve dashboard card-open defect and Trilium-inspired layout — native button a11y, sidebar Home entry, compact nav, controller/state tests, remove noisy asset logging | [#32393535423](https://github.com/Rajendertyagi/RTWiki/actions/runs/32393535423) **PASS** |

### Known Limitations

- No rich editor yet — placeholder workspace shows title, type badge, save status, and actions; content editing deferred to Phase 3.
- No HTML/CSS/JS editor tabs — html page type can be created and listed but not edited beyond title.
- No content autosave — save-status reflects title/API mutation (Saving…/Saved/Error with 2 s reset), not content autosave; no misleading permanent "Saved" state.
- Search is title/content via API `q` param with 300 ms debounce, AbortController, and request sequencing; older results cannot overwrite newer.
- No Mantine Notifications — all feedback via inline Alert/status from existing Mantine components.
- CSS modules + Mantine theme/CSS variables used for layout; no `style={...}` and no scattered numeric colors/spacing.
- `App.tsx` is a small composition root delegating to `usePagesController`.
- Portable artifact produced on every successful build; smoke test verifies exe + web assets + portable layout per ADR-005.
- Dashboard cards use ghost-button overlay pattern for accessible full-card click with separate menu button. No nested interactive elements.
- Sidebar uses Trilium-inspired persistent nav pattern with visible Stop RTWiki power icon in footer. No nested hierarchy, tabs, draggable tree, backlinks, or cloning.
- Windows PE metadata (title, description) set via `Bun.build()` JS API when compiled natively on Windows. On Linux cross-compilation, metadata is skipped — process shows as "Bun" in Task Manager.
- Shutdown token is per-process and not persisted. If the server crashes, the token is lost (which is acceptable — the server is already stopped).

### Root Cause Analysis and Corrections (Owner-reported defects)

**Defect 1 — White page (assets served as index.html):**
- **Root cause**: `src/server/static.ts` used `node:path.normalize()` which converts forward slashes to backslashes on Windows. The `withinRoot` check `resolved.startsWith(root + '/')` always fails on Windows because `root` has backslashes but the separator appended is `/`. Every request fell through to SPA fallback, serving `index.html` with `text/html` MIME for all assets.
- **Fix** (`d3a18dc`): Rewrote containment check using `path.relative()` (separator-agnostic). Added structured logging for asset-not-found and path-rejected. Limited SPA fallback to extensionless navigation routes only.

**Defect 2 — Second instance fatal error:**
- **Root cause**: `src/server/bootstrap.ts` attempted `Bun.serve()` without first probing for an existing RTWiki instance. When two instances were launched, the second crashed with EADDRINUSE.
- **Fix** (`4c6cef6`): Added `probeExistingInstance()` that sends GET `http://127.0.0.1:<port>/health` with a 2-second timeout. If the response contains `app: "RTWiki"`, the probe returns `{ server: null, db: null, detected: true }` and bootstrap exits cleanly with `process.exit(0)`.

**Defect 3 — Logging gaps:**
- **Fix** (`d3a18dc`, `4c6cef6`): Added structured JSONL logging for: asset-not-found (404), path-rejected, SPA-fallback, single-instance-exit, port-occupied-by-different-app (EADDRINUSE), browser-open-failure. All log through the existing logger module.

**Test coverage added:**
- `tests/foundation.test.ts`: 13 static serving tests (MIME types, byte counts, 404 for missing assets, SPA fallback for extensionless only, query strings, URL-encoded paths, path traversal rejection) + 6 single-instance tests (detection, --no-open, unrelated occupant, resource leak, normal start).
- `.github/workflows/build.yml`: Smoke test now parses all `<script src>` and `<link href>` from index.html, verifies non-HTML MIME, compares byte sizes via `RawContentStream.Length`, and tests single-instance detection.

**Defect 4 — Dashboard card-open defect:**
- **Root cause**: The `PageCard` component rendered an `UnstyledButton` for the card title and a separate `Menu.Target` (ActionIcon) for the three-dot menu. Both were independent interactive elements on the same `Card`. The original implementation attempted `stopPropagation` on the menu to prevent the card click from firing, but the structure was fragile — the card's clickable area was ambiguous, and keyboard interaction (Enter/Space) was not handled. The `UnstyledButton` used `role="button"` with `tabIndex={0}` on a `div`, which also violated Biome's `useSemanticElements` lint rule.
- **Fix** (`00c3678`): Restructured the entire card as a native `<button>` element via Mantine's `Card` with `component="button"`. This gives native keyboard handling, focus management, and correct semantic meaning for free. The three-dot menu is wrapped in a `stopPropagation` container so menu clicks/keystrokes don't propagate to the card's open action. Added CSS button resets (`background: transparent`, `font: inherit`, `color: inherit`, `width: 100%`) and hover/focus-visible states.

**Defect 5 — Trilium-inspired layout adjustment:**
- **Requirement**: Owner requested Trilium-inspired persistent left nav pattern (Home/dashboard entry at top, prominent New page, compact searchable page list, selected-page indication, main workspace on the right).
- **Research**: Fetched TriliumNext official site (triliumnext.eu), GitHub repo (github.com/TriliumNext/Trilium), and docs (docs.triliumnotes.org). Adopted interaction model only — no branding, logos, copyrighted assets, source code, exact theme/colors, or unlicensed icons.
- **Fix** (`00c3678`): Sidebar now has Home `NavLink` at the top (active when `selectedId === null`), prominent New Page button, compact page list using `NavLink` with `leftSection` icon and `rightSection` type badge, selected-page highlight via `active` prop. Header height reduced from 56px to 44px. Navbar width reduced from 300px to 280px.

**Defect 6 — Noisy asset logging:**
- **Root cause**: `src/server/static.ts` logged every successful static asset serve at info level, producing excessive noise in the JSONL log.
- **Fix** (`00c3678`): Removed the `Serving static asset` info log. Only failure/rejection logs remain (path traversal, asset-not-found, unexpected failure, SPA fallback).

**Test coverage added (correction 2):**
- `tests/pages-controller.test.ts`: 10 pure utility tests (`findSelectionAfterDeletion`, `syncSelectionWithPages`, `findPageById`, `filterPagesByQuery`) + 6 API integration tests (create page, list pages, update page, duplicate page, delete page, search pages) against a real Hono server instance.
- Total test count: **88 tests** across 3 files (was 49 in correction 1), 190 expect() calls, 0 failures.

**Defect 7 — Card accessibility (button-inside-button invalid HTML):**
- **Root cause**: The correction 2 fix used `<Card component="button">` which renders as a `<button>` element. The `<Menu>` nested inside renders `<ActionIcon>` (another `<button>`). This creates button-inside-button — invalid HTML per the spec. The `stopPropagation` handlers masked the problem but did not fix the DOM structure.
- **Fix**: Restructured using the "ghost button" overlay pattern. The card is a non-interactive `<div>` wrapper. A transparent `<button>` covers the entire card area for the "open" action (position: absolute, inset: 0). The three-dot menu is a sibling `<button>` with higher z-index (`position: relative; z-index: 2`). Content uses `pointer-events: none` so clicks pass through to the ghost button. No interactive element is nested inside another. Both controls are natively keyboard accessible (Tab to focus, Enter/Space to activate).

**Defect 8 — Missing visible Stop RTWiki control:**
- **Requirement**: Owner requires a visible mechanism to stop the RTWiki server from the browser, with a confirmation dialog, located outside the page list, using Mantine components, with Cancel/Stop buttons.
- **Fix**: Added a red power icon (`IconPower`) `ActionIcon` in the sidebar footer section (above the app name). Click opens a `StopConfirmModal` (Mantine `Modal` with warning text, Cancel and Stop buttons). On confirm, the frontend obtains a per-process shutdown token from `GET /api/shutdown/token` and sends it in a `POST /api/shutdown` request with the custom header `X-RTWiki-Shutdown-Token`. On success, the UI displays "RTWiki has stopped. You may close this browser tab."

**Defect 9 — No secure local shutdown API:**
- **Requirement**: POST-only shutdown endpoint with per-process unpredictable token, custom header validation, same-origin check, no CORS, no token in URLs/logs/DB, idempotent execution.
- **Fix**: Created `src/server/routes/shutdown.ts` with module-level mutable state pattern. Routes are mounted once on the Hono app; each `bootstrap()` call updates the token and handler via `setShutdownHandler()`. Security model:
  - `GET /api/shutdown/token` — returns the token (same-origin via Origin/Referer check)
  - `POST /api/shutdown` — validates token in `X-RTWiki-Shutdown-Token` header + same-origin, then responds 200 and executes shutdown asynchronously (server.stop → closeDatabase → logger.close → process.exit)
  - `GET /api/shutdown` — returns 405 (method not allowed)
  - Same-origin validation checks Origin/Referer for `127.0.0.1` or `localhost`
  - Token generated via `crypto.randomUUID()` at bootstrap, never logged
  - Idempotent — second POST returns 503 if shutdown already started

**Defect 10 — Logger not flushed on shutdown:**
- **Root cause**: The `shutdown()` function in `bootstrap.ts` called `server.stop()` and `closeDatabase()` but never called `logger.close()`, which flushes the buffer and marks the logger as closed.
- **Fix**: Added `await logger.close()` as the final step in the shutdown sequence, after database close and before process exit.

**Defect 11 — Windows process identity:**
- **Requirement**: Set Windows PE metadata (product name, description) so the process shows as "RTWiki" in Task Manager instead of "Bun".
- **Research**: Confirmed from Bun 1.3.14 official docs that `Bun.build()` JS API supports `compile.windows.{title, description, version, publisher, copyright}`. CLI only documents `--windows-icon` and `--windows-hide-console`. Metadata flags require native Windows compilation (not cross-compilation).
- **Fix**: Created `scripts/build.ts` using `Bun.build()` JS API with platform detection (`process.platform === 'win32'`). On Windows (native compile in CI `windows-smoke` job), metadata is set: title "RTWiki", description, version "0.1.0", publisher "RTWiki". On Linux (cross-compile in CI `verify` job), metadata is skipped. Updated `package.json` `build:server` to use the script.

**Test coverage added (correction 3):**
- `tests/shutdown.test.ts`: 6 tests — GET /api/shutdown/token returns token, POST without token rejected (403), POST with wrong token rejected (403), GET on POST endpoint returns 405, POST with correct token accepted (200 + server stops), token not logged (UUID format verification).
- Extended `.github/workflows/build.yml` smoke test: POST without token rejected, GET returns 405, token obtained, wrong token rejected, authorized shutdown stops server cleanly, no orphan processes.
- Total test count: **94 tests** across 4 files (was 88 in correction 2).

## Phase 3 — Rich Note Editor and Autosave

### Scope
- BlockNote-based rich editor (one instance per active page)
- Load/store canonical BlockNote JSON
- Editable page title
- Autosave with centralized 2000 ms debounce
- Saving/Saved/Error visible states
- Safe page switching (flush/cancel pending saves)
- Rich JSON round-trip tests
- No sample content, no advanced custom blocks

### Acceptance Criteria
- [ ] BlockNote editor renders for rich pages
- [ ] Headings, paragraphs, lists, code blocks, tables, blockquotes editable
- [ ] Content stored as canonical BlockNote JSON
- [ ] One editor instance per active page, disposed on unmount/switch
- [ ] Title editable inline
- [ ] Autosave debounced at 2000 ms
- [ ] Save status: Saving… → Saved, or Error on failure
- [ ] Switching pages flushes pending save
- [ ] Rapid navigation does not overwrite newer content
- [ ] Portable Windows artifact produced

### Planned Files
```
src/web/features/rich-editor/rich-editor.tsx (new)
src/web/features/rich-editor/use-autosave.ts (new)
tests/rich-editor-roundtrip.test.ts (new)
```

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| docs/VISUAL_MVP_TRACKER.md | Added | 4c80980 |
| README.md | Modified (+4 -0) | 4c80980 |
| .github/workflows/docs-quality.yml | Modified (add feature/** trigger) | 44a9343 |
| .github/workflows/build.yml | Modified (add feature/** trigger) | 44a9343 |

## Phase 4 — Sandboxed HTML/CSS/JavaScript Pages

### Scope
- HTML/CSS/JavaScript editor tabs
- JavaScript disabled by default, per-page toggle
- Live preview in sandboxed iframe
- Full-page preview mode
- Direct paste and .html file import
- Shared import adapter (extract body, inline style/script, reject externals)
- DOMPurify sanitization
- Isolated iframe: sandbox="allow-scripts" only when JS enabled, never allow-same-origin
- Restrictive iframe CSP: default-src 'none'
- Escape srcdoc and script-closing sequences
- Visible "Sandboxed preview" indicator and JS-enabled warning
- Sandbox security tests

### Acceptance Criteria
- [ ] HTML/CSS/JS editor tabs for html-type pages
- [ ] JavaScript disabled by default, toggle per page
- [ ] Live preview renders in sandboxed iframe
- [ ] Full-page preview mode available
- [ ] Paste and .html file import work
- [ ] Import extracts body/style/script into appropriate editors
- [ ] External scripts/resources rejected with warning
- [ ] DOMPurify sanitizes imported HTML
- [ ] iframe sandbox: allow-scripts only when JS enabled
- [ ] iframe never has allow-same-origin
- [ ] iframe CSP: default-src 'none'
- [ ] srcdoc escaping handles script-closing sequences
- [ ] "Sandboxed preview" indicator visible
- [ ] JS-enabled warning visible
- [ ] No custom CSS/JS leaks into main RTWiki context
- [ ] Portable Windows artifact produced

### Planned Files
```
src/web/features/html-editor/html-editor.tsx (new)
src/web/features/html-editor/code-editor-tab.tsx (new)
src/web/features/html-editor/sandboxed-preview.tsx (new)
src/web/features/html-editor/html-import.ts (new)
src/web/features/html-editor/sandbox-document.ts (new)
src/shared/contracts/html-content.ts (new)
src/shared/schemas/html-content.ts (new)
tests/html-editor.test.ts (new)
tests/sandbox-security.test.ts (new)
```

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| docs/VISUAL_MVP_TRACKER.md | Added | 4c80980 |
| README.md | Modified (+4 -0) | 4c80980 |
| .github/workflows/docs-quality.yml | Modified (add feature/** trigger) | 44a9343 |
| .github/workflows/build.yml | Modified (add feature/** trigger) | 44a9343 |

## Phase 5 — Polish and Release Candidate

### Scope
- Apply owner feedback from earlier artifacts
- Spacing, navigation, responsive improvements
- Accessibility: keyboard nav, focus states, labels, contrast
- Error recovery and unsaved-changes feedback
- Loading states refinement
- Final modularity review
- Dead code and placeholder removal
- Confirm empty first-run, no sample pages, no code escapes iframe
- Complete test/build/package/smoke pipeline
- Final artifact

### Acceptance Criteria
- [ ] Owner feedback incorporated
- [ ] Keyboard navigation works for all primary workflows
- [ ] Visible focus states on all interactive elements
- [ ] ARIA labels on icon-only buttons
- [ ] WCAG AA contrast
- [ ] Unsaved changes warning on page switch
- [ ] No dead code or placeholders remain
- [ ] Empty first-run confirmed
- [ ] No custom code escapes iframe
- [ ] Full CI pipeline green
- [ ] Final artifact produced

### Planned Files
( filled during implementation )

### Actual Files Changed

| File | Action | Commit |
|------|--------|--------|
| docs/VISUAL_MVP_TRACKER.md | Added | 4c80980 |
| README.md | Modified (+4 -0) | 4c80980 |
| .github/workflows/docs-quality.yml | Modified (add feature/** trigger) | 44a9343 |
| .github/workflows/build.yml | Modified (add feature/** trigger) | 44a9343 |

## Risks and Blockers

| Risk | Impact | Mitigation |
|------|--------|------------|
| BlockNote version incompatibility with Mantine 7.15 | High — editor may not render | Check peer deps before install; pin compatible version |
| DOMPurify browser-only (needs window) | Medium — cannot sanitize server-side | Sanitize on client before save; server trusts client input |
| Vite build output path mismatch | Medium — smoke test may fail | Align vite.config.ts outDir with CI packaging step |
| format-fix.yml still targets old branch | Low — cosmetic | Delete or update in Phase 1 |
| Local tree divergent (uncommitted changes) | Low — must use GitHub API exclusively | Enforced by protocol |

## Owner Feedback

( Record owner feedback after each artifact review )

## Decisions Changed During Testing

( Record any decisions that change based on testing results )

## Dependency Migration — Latest Stable Stack (One-Go)

**Branch:** `feature/dependency-compat`  
**Starting HEAD (branch tip before migration):** `3461baa` — regenerate bun.lock for BlockNote 0.54.0 + Mantine 8.3.18  
**Required ancestor:** `feature/visual-mvp` @ `85a036b` — verified via `git merge-base --is-ancestor 85a036b 8902da26` (true)  
**Final HEAD:** `8902da26` — chore: remove temporary format-fix workflow  
**Discrepancy note:** The reported starting point `85a036b` is the required base ancestor from `feature/visual-mvp`, not the branch tip. The tip at dispatch was `3461baa`. Both satisfy ancestry: `85a036b` is ancestor of both `3461baa` and `8902da26`. Full history: `85a036b` → `3461baa` → … → `8902da26`.

### Selected Exact Versions (npm `latest` verified via registry.npmjs.org)

All 16 direct dependencies pinned exact, no prerelease:

- `react` 19.2.8 / `react-dom` 19.2.8 / `@types/react` 19.2.18 / `@types/react-dom` 19.2.4
- `@mantine/core` 9.5.1 / `@mantine/hooks` 9.5.1 (requires React ^19.2.0 — satisfied)
- `@blocknote/core` 0.54.0 / `@blocknote/react` 0.54.0 / `@blocknote/mantine` 0.54.0 (peer: `@mantine/core ^8.3.11 || ^9.0.2` — satisfied)
- `vite` 8.2.2 + `@vitejs/plugin-react` 6.1.0 (peer `vite ^8.0.0` — satisfied)
- `typescript` 7.0.2, `@biomejs/biome` 2.5.9, `hono` 4.13.3, `zod` 4.4.3, `@tabler/icons-react` 3.46.0
- `@types/node` 26.2.0, `@types/bun` 1.3.14 — **pinned to Bun runtime 1.3.14** (see below)

### Bun Types Correction

Bun runtime in CI: `1.3.14` (`.github/workflows/build.yml:26` `bun-version: "1.3.14"`).  
Official `@types/bun@1.4.0` metadata: `dependencies: { "bun-types": "1.4.0" }` — strictly requires `bun-types` 1.4.0, no evidence of support for 1.3.14 runtime.  
**Action:** Pinned `@types/bun` to `1.3.14` (`dependencies: { "bun-types": "1.3.14" }`) to match runtime. Previous report incorrectly stated “match”.

### Test Count Correction

Previous reports listed inconsistent breakdowns (e.g., 27+22). Verified via source:

- `tests/foundation.test.ts` — **44 tests**
- `tests/pages.test.ts` — **24 tests** (16 CRUD + 2 rich JSON + 1 HTML + 5 validation)
- `tests/pages-controller.test.ts` — **20 tests** (14 utils + 6 API integration)
- `tests/shutdown.test.ts` — **6 tests**

**Total: 94 tests across 4 files, 201 expect() calls, 0 failures** (CI run 32426240531).

### CI Verification

- Build and Package: https://github.com/Rajendertyagi/RTWiki/actions/runs/32426240531 — **success** (Verify + Windows smoke test)
- Artifact: `RTWiki-0.1.0-windows-x64` 39805847 bytes
- Documentation Quality: triggered via `workflow_dispatch` — pending verification in finalization

## Next Phase

**Phase 3 — Rich Note Editor and Autosave — Ready to Start.** Dependency stack frozen at latest stable, all gates green. Awaiting owner approval to begin editor implementation.

## Final Verification Status

Phase 0: Owner approved (#71). Phase 1: Owner approved (#79). Phase 2: Correction 3 + Dependency Migration verified — format, lint, typecheck, test (94), web build, server build, Windows smoke test all pass on `8902da26`. Documentation Quality pending final run. Ready for Phase 3.

## CI Hardening and Simplification (Post-Baseline)

**Branch:** `feature/rich-note-editor`

### Packaged-Asset 404 — Root Cause and Fix

- **Root cause:** the smoke test's wildcard copy (`Copy-Item -Path "$src/*" -Destination <non-existent-dir> -Recurse`) flattened the staged package's top-level `web/` folder into the extraction root (`index.html` and `assets/` landed beside `RTWiki.exe`). The server resolved `frontendDistDir=<exe>/web` correctly, but `index.html` was not there, so `GET /` and every asset returned 404 while `/health` passed.
- **Fix:** copy the staged directory itself (no wildcard) so the proven layout — `RTWiki.exe` beside `web/` — is preserved exactly.
- **Fixed at:** `be5c85c5`, verified by CI run [32550718811](https://github.com/Rajendertyagi/RTWiki/actions/runs/32550718811) (Verify + Windows smoke both success).

### Workflow Simplification

- `.github/workflows/build.yml` reduced from 447 to 99 lines — orchestration only.
- Packaging moved to `scripts/ci/package-windows.ps1` (staging, validation, nesting rejection, no runtime dirs).
- Windows verification moved to `scripts/ci/windows-smoke.ps1` (identity hashes across build/staged/copied trees, port-free pre-check, captured-PID launch and port-ownership proof, runtime-directory assertion, full endpoint matrix with numeric status inspection, exact MIME and byte-size asset checks, missing-asset 404 and traversal rejection, second-instance behavior, shutdown security matrix, authorized shutdown, exact-PID-only cleanup with token redaction).
- `upload-artifact` pinned to officially released v7.0.1.
- Runtime-directory correction: the application now creates `data/`, `data/attachments/`, `data/backups/`, and `logs/` itself at startup (ADR-005 portable layout); CI asserts their existence after first launch instead of pre-creating them.

### Validation

- Refactor verified: run [32551658371](https://github.com/Rajendertyagi/RTWiki/actions/runs/32551658371) — all gates pass on `5d974b54`.
- Phase 4 has **not** started; design remains provisionally accepted only.

## Phase 3 Correction — Rich Note Blank Page

**Status:** Owner-discovered blocking defect after the green CI refactor at `4dc66dcd`. Phase 3 reopened.

### Defect

Clicking an existing Rich Note or creating a new one blanked the entire application.

### Root Cause

`FormattingToolbar` was rendered as a sibling of `BlockNoteView`. Per official BlockNote documentation, that component requires the editor React context provided inside `BlockNoteView` (custom toolbars go through `FormattingToolbarController` with `formattingToolbar={false}`). Standalone, its hooks throw during render; with no error boundary anywhere, React 19 unmounted the whole root. Unit tests and the Windows smoke test never exercise the React UI, so CI stayed green while the app was broken in a real browser.

### Correction (`95ce27a8`, lockfile sync `df2bc3aa`)

- Removed the standalone toolbar — `BlockNoteView` renders its default formatting toolbar automatically.
- Added `EditorErrorBoundary` around the editor: safe recovery panel (no error text, paths, tokens, or page content), reset-to-valid-empty-document flow, forced editor remount on recovery.
- Canonical empty document is a paragraph without a `content` key.
- New Playwright browser suite (`tests/browser/rich-note.spec.ts`, `@playwright/test` 1.62.1) runs against the real built application in CI: dashboard render, open/create paths, formatting toolbar, autosave Saved state, manual save, reload, home+reopen, pending-flush switch, dark-theme surface, HTML placeholder isolation (BlockNote never mounted), malformed-content recovery UI, plus uncaught-exception and blank-root guards.
- CI gained a `browser-tests` job (ubuntu, Chromium) between Verify and the Windows smoke; artifact uploads only after all three jobs pass.
- `lockfile-sync.yml` resolves `bun.lock` through GitHub-hosted automation whenever dependencies change.

### Validation

Pending: first full run over the corrected code (triggered by the tracker commit).
