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
| 3 | Rich Note Editor and Autosave | CI verified | 405dc01b | [#32570059083](https://github.com/Rajendertyagi/RTWiki/actions/runs/32570059083) | RTWiki-0.1.0-windows-x64 |
| 4A | Secure HTML Page Foundation (preview, no editor UI) | CI verified | 3a1d4f3 | [#32584637817](https://github.com/Rajendertyagi/RTWiki/actions/runs/32584637817) | RTWiki-0.1.0-windows-x64 |
| 4B | HTML/CSS/JS Editor Tabs and Live Editing | CI verified | fb0bcb4 | [#32597212309](https://github.com/Rajendertyagi/RTWiki/actions/runs/32597212309) | RTWiki-0.1.0-windows-x64 |
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
- Sidebar uses Trilium-inspired persistent nav pattern with visible Stop RTWiki power icon in footer. (At Phase 2 there was no nested hierarchy or draggable tree; the page tree arrived later on `feature/workspace-hierarchy` — see ADR-008 and the Workspace Hierarchy section below. Tabs, backlinks, and cloning remain out of scope.)
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

## Phase 3 Correction - Persistent Diagnostic Logging (empty logs/)

**Status:** Owner-discovered blocking defect; resolved together with browser-proven editor defects below.

### Defect

The portable application created `logs/` but `logs/rtwiki.log` never appeared (or lost history).

### Root Cause (proven)

The logger buffered up to 100 lines in memory and flushed via `BunFile.write()`, which truncates the destination on every write. Short sessions never flushed at all; Windows console-close killed the process before close(); fatal-startup and smoke-failure paths buffered events that were never written; when a flush did run it overwrote all earlier records.

### Correction

- Logger rewritten: eager file creation at construction, synchronous append-only JSONL (nothing buffered, history preserved, survives hard kills), bounded rotation (1 MB threshold, `rtwiki.1.log`..`rtwiki.3.log`), fail-safe sink (one terminal warning, terminal logging continues, never throws).
- Full lifecycle persisted: startup (version + privacy-redacted dirs via `sanitizePathForLog()`), db open/migrations, listening, single-instance, shutdown requested/stages/complete, fatal startup.
- Dev runtime paths moved to `<repo>/data` and `<repo>/logs`; hidden import-time logger singleton removed (database module receives its logger explicitly); tests inject temporary paths only.
- Sanitized frontend-error endpoint `POST /api/client-errors` (shared Zod schema, same-origin, 8 KB pre-parse cap, 20/min rate limit, shutdown-token scrubbing) writing `client_error` events; no log-read endpoint exists.
- Global `AppErrorBoundary` plus extended `EditorErrorBoundary` recovery UI (Retry / Back to Pages / log location / diagnostic reference id); centralized frontend reporter with canned messages, reduced stack frames, bounded dedupe and WeakMap handled-error suppression.
- Unsafe self-pushing `lockfile-sync.yml` workflow removed.
- Windows smoke now asserts `logs/rtwiki.log` is app-created, non-empty valid JSONL with startup and shutdown-complete events and no token leakage.

### Additional defects proven by the new browser suite (all fixed)

- Autosave scheduler invoked detached `window.setTimeout/clearTimeout`, throwing `TypeError: Illegal invocation` on first edit in Chromium (Node timers are this-agnostic, so unit tests passed).
- The autosave controller was recreated on every render (inline `onSave` identity), disposing the pending debounce timer so saves never fired in the browser.
- Creating a note raced the page-list refresh: the selection-sync effect cleared the fresh selection; loads are now sequenced and created pages are inserted optimistically.
- Reopening after a save read a stale local list snapshot; saved pages now merge into state via `savePageContent()` (`updatePage` already returns the server page).

### Validation

- Unit/integration suites added for logger, path sanitization, lifecycle persistence, client-error endpoint and reporter semantics; Playwright suite extended to 11 scenarios including correlation-id-in-log assertions; `bun test` isolation from Playwright via `.pwspec.ts`.
- Green end to end: run [32569818202](https://github.com/Rajendertyagi/RTWiki/actions/runs/32569818202) (Verify + Browser tests + Windows smoke all success). Artifact `RTWiki-0.1.0-windows-x64`, SHA-256 `84D46EB75ABF3EC5C269F9FBC7CB0EC47EABD35CC88FCBE78ECFB2801A934B8E`. Smoke evidence: `LOG OK ... valid JSONL, startup event present`, `LOG FINAL OK: shutdown_complete persisted; shutdown token absent`.
- Phase 4 has not started.

## Phase 4A — Secure HTML Page Foundation

**Branch:** `feature/html-page-editor` (created from exactly `405dc01b`, the CI-verified Phase 3 base, run [32570059083](https://github.com/Rajendertyagi/RTWiki/actions/runs/32570059083)).
**Status:** CI verified — Verify (format, lint, typecheck, 290 tests, web+server build), Browser tests (Playwright, real Chromium) and Windows portable smoke all green on `3a1d4f3` ([run 32584637817](https://github.com/Rajendertyagi/RTWiki/actions/runs/32584637817)). Phase 4B (visible editor UI) has **not** been started.

### Scope

Canonical HTML-page content format, server-side persistence validation,
parse5-based search extraction, per-response CSP nonce infrastructure, and a
modular sandboxed preview builder with secure parent↔frame messaging. No
CodeMirror, no editor tabs, no split-pane UI — opening an HTML page shows the
secure read-only preview of stored content.

### Canonical Format (single source of truth)

`src/shared/schemas/html-content.ts` — imported by both frontend and server;
no duplicate schemas:

```json
{ "version": 1, "html": "", "css": "", "javascript": "" }
```

- Exact supported version: `z.literal(1)`. Strings only. Unknown keys
  **rejected** (`z.strictObject`) — silent key loss can never masquerade as a
  successful save. Empty HTML/CSS/JS is valid.
- UTF-8 **byte** limits via `TextEncoder` (not UTF-16 code units), owner-approved:
  HTML 2 MiB, CSS 512 KiB, JavaScript 512 KiB; page create/update JSON bodies
  capped at 4 MiB before parsing (`MAX_PAGE_JSON_BODY_BYTES`). Rich Note
  content paths are untouched.

### Persistence Validation

- Create: omitted or empty content for `pageType: "html"` becomes the
  canonical empty document (lenient, owner decision); any other value must be
  canonical JSON and is stored verbatim.
- Update: strict — canonical JSON required; stored verbatim on success.
- Page-type conversion is rejected explicitly (400) in Phase 4A; the update
  schema no longer carries `pageType`.
- Invalid content returns the existing structured `{ error }` format (400);
  oversized bodies return 413; malformed JSON returns 400.
- Legacy/malformed stored content: validate-on-write only. Reads return stored
  bytes verbatim, duplicates copy verbatim, title updates never rewrite
  content — nothing is silently overwritten or migrated.

### Search Behavior

`src/server/services/search-extraction.ts` parses authored HTML with
**parse5 8.0.1** (WHATWG-compliant tree walk — no regex parsing): readable
body text is indexed; `script`, `style`, `template` subtrees, comments, and
head metadata are excluded; entities arrive decoded from parse5; whitespace is
collapsed; output capped at 100k chars. Rich pages keep their exact previous
behavior (raw stored JSON indexed). The index refreshes on create/update/
duplicate and is removed on delete. Malformed legacy HTML content indexes as
empty rather than leaking JSON punctuation into results.

### Security Model — including a standards conflict and its authorized resolution

**Conflict discovered:** the mandated `<iframe sandbox="allow-scripts"
srcdoc="...">` design inherits the application's own CSP header
(`script-src 'self'`), because srcdoc frames clone the parent's policy
container ([HTML Standard](https://html.spec.whatwg.org/multipage/origin.html#policy-containers);
[webappsec-csp#700](https://github.com/w3c/webappsec-csp/issues/700) — closed
wontfix: a srcdoc child can never relax its parent's policy;
[CVE-2017-7788](https://nvd.nist.gov/vuln/detail/cve-2017-7788) proves modern
browsers enforce inheritance even when sandboxed). A client-generated nonce
inside the child cannot satisfy the inherited policy, so the JS pane could
never execute — the design contradicted itself.

**Authorized resolution (Option A, owner-approved):** Hono's official
`secureHeaders` + `NONCE` middleware generates a cryptographically random
per-response nonce (16 bytes, `crypto.getRandomValues()`, base64), places it
in the CSP header, and exposes it to handlers; both HTML-serving paths
(direct `/` and SPA fallback) inject it as non-executable
`<meta name="rtwiki-preview-nonce">`. Preview bootstrap and JavaScript-pane
scripts carry that exact nonce, satisfying inherited and child policies
simultaneously. Precedent: Cap.js resolved an identical failure this way
([cap#229](https://github.com/tiagozip/cap/issues/229)).

Additional guarantees:

- Child meta CSP (stricter, intersects with inherited policy):
  `default-src 'none'; script-src 'nonce-…'; script-src-attr 'none';
  style-src 'unsafe-inline'; img-src data:; connect-src/font-src/media-src/
  object-src/frame-src/worker-src/base-uri/form-action 'none'`.
  `img-src` stays `data:`-only; no `blob:` anywhere (owner decision).
- Sandbox attribute is exactly `allow-scripts`; never allow-same-origin,
  allow-top-navigation, allow-popups, or allow-forms.
- Closing `</script` / `</style` sequences escaped case-insensitively; no
  eval, no `new Function`, no unsafe-eval, no script unsafe-inline.
- Preview normalization uses browser `DOMParser` on a copy: removes `script`,
  `iframe`, `object`, `embed`, `base`, external stylesheets,
  `meta[http-equiv]`, and inline `on*` attributes; complete documents are
  extracted head/body-wise and never nest `<html>` inside `<html>`. Stored
  source is never modified.
- postMessage: opaque origin forces `targetOrigin="*"`; every message must
  pass three checks — `event.source === iframe.contentWindow`, strict Zod
  schema, exact per-preview channel ID (16 random bytes hex, regenerated per
  rebuild). Wrong source/schema/channel is silently ignored, never logged.
- Errors report only safe event type, operation, sanitized error name/message
  (canned), top-frame location, correlation/channel ID — never HTML/CSS/JS
  source or titles. Builder failure renders recoverable UI (Retry), never a
  blanked app; missing nonce fails closed.

### Tests and CI

- Unit/integration (`bun test`): schema validity/limits/strictness
  (`tests/html-content.test.ts`), persistence lifecycle incl. lenient create,
  strict update, legacy preservation, API 400/413 semantics
  (`tests/pages.test.ts`, `tests/pages-controller.test.ts`), parse5 extraction
  (`tests/search-extraction.test.ts`), preview-document construction and
  escaping (`tests/preview-document.test.ts`), message schema
  (`tests/preview-messages.test.ts`), nonce pairing against the real app
  (`tests/nonce.test.ts`).
- Real-Chromium security suite (`tests/browser/html-preview.pwspec.ts`,
  Playwright): nonce pairing/uniqueness across responses; JS-pane execution;
  HTML-pane scripts stripped; inline handlers dead; eval blocked; unnonced
  injected scripts blocked; external scripts, fetch, WebSocket, nested frames
  blocked (proven via `securitypolicyviolation` events recorded inside the
  frame); form submission and anchor/top navigation blocked; sandbox attribute
  exactly `allow-scripts`; valid current-channel message accepted while wrong-
  channel, stale-channel, and spoofed-source messages are rejected; sanitized
  runtime-error surfacing; stripped-nonce fail-closed recovery UI with
  sanitized `client_error` log entry.
- CI jobs unchanged (Verify → Browser tests → Windows smoke → artifact);
  frozen-lockfile install throughout.

### Dependency Evidence

- `parse5@8.0.1` pinned exact, direct production dependency. npm registry:
  v8.0.1 published 2026-04-19, MIT, maintained by the Cheerio/rehype/Lit team
  (inikulin/parse5), relied on by jsdom, Angular, Lit, Cheerio; 0 known
  vulnerabilities (Snyk).
- Single declared runtime dependency: `entities@^8.0.0` (entity decoding),
  visible in `bun.lock`; never imported directly by RTWiki code.
- Lockfile updated without local tooling: temporary push-triggered workflow
  (branch-scoped, `contents: read`, `bun install --lockfile-only`, artifact
  upload only) produced `bun.lock`; the artifact was verified to contain only
  the expected additions and committed normally; the temporary workflow was
  deleted in the same corrective push (`5b0fa16`). No self-pushing workflow
  existed at any point; no GitHub token was used or stored.

### Commits

| SHA | Message |
|-----|---------|
| 06185a2 | chore(deps): declare parse5 8.0.1 and temporary lockfile-artifact workflow |
| 5b0fa16 | chore(deps): sync bun.lock for parse5 8.0.1 and remove temporary lockfile workflow |
| 548112d | feat: canonical HTML-page content schema with UTF-8 byte limits |
| 25e35bf | feat: validate HTML-page content in persistence flow with lenient create and strict updates |
| c71841b | feat: extract searchable text from HTML pages via parse5 |
| 6e2ae53 | feat: per-response CSP nonce via Hono secureHeaders injected into SPA HTML |
| b3dc2af | feat: sandboxed HTML preview builder with nonce'd scripts and channel messaging |
| f46300f | chore: expose preview status attribute for browser-test observability |
| 228daa1 | test: real-Chromium security suite for sandboxed HTML previews |
| 8c0f58f | docs: record Phase 4A canonical format, security model, and search behavior |
| 3d32a1c / 33601ac | chore: temporary format-diagnostics workflow (read-only artifact; deleted in 63ed42a) |
| 63ed42a | fix: apply canonical formatting and resolve lint/typecheck findings; remove diagnostics workflow |
| d930c75 | fix: move channel-id generator into pure module; correct empty-block assertion |
| cdf5431 | fix: escape-test slicing logic; legacy html CRUD test to canonical content |
| 2bbbaa8 | fix: preserve authored casing when escaping closing script/style sequences |
| 6597be7 | fix: style-escape test asserts the actual raw-text contract |
| 1ed5147 | test: correct channel-rejection probes and nonceless-script assertion |
| 32960df | test: html pages render sandboxed preview instead of placeholder |
| 3a1d4f3 | fix: report missing-nonce preview failures; assert sandbox form blocking directly |

Intermediate note: run #244 on `06185a2` failed at frozen-lockfile install —
expected and documented before the lockfile landed.

### Validation

- **Green end to end:** run [32584637817](https://github.com/Rajendertyagi/RTWiki/actions/runs/32584637817)
  on `3a1d4f3` — Verify (format, lint, typecheck, 290 tests across 19 files,
  web build, server build), Browser tests (Playwright/Chromium, 30 scenarios:
  28 preview-security + rich-note suite incl. updated html-page scenario),
  Windows portable smoke — all success.
- Artifact `RTWiki-0.1.0-windows-x64`, 41,827,103 bytes
  ([download](https://github.com/Rajendertyagi/RTWiki/actions/runs/32584637817/artifacts/9478742210)).
- Documentation Quality workflow passed on `8c0f58f`
  ([run 32578294107](https://github.com/Rajendertyagi/RTWiki/actions/runs/32578294107)).
- Convergence honesty: reaching green took several correction rounds after the
  initial implementation — Biome canonical formatting applied via a temporary
  read-only CI artifact workflow (owner-approved; deleted in `63ed42a`), plus
  test-only fixes (escape-test slicing/case expectations, legacy CRUD test to
  canonical content, channel-probe correctness, nonceless-script assertion,
  html-placeholder scenario superseded by the preview) and one product fix
  (missing-nonce failures now report through the sanitized client-error
  reporter). No logic, dependency, lockfile or workflow changes rode along
  with formatting; every intermediate failure was diagnosed from owner-provided
  logs because job logs require authentication this environment lacks.

### Remaining Phase 4B Work (not started)

Visible editing surface only: CodeMirror-based HTML/CSS/JavaScript tabs,
split-pane live editing, per-page JavaScript enable/disable toggle, paste and
.html import through the shared pipeline, full-page preview mode, revisit of
the page-type-conversion restriction. All Phase 4A foundations above are
built to be consumed unchanged by 4B.

## Phase 4B — Editable HTML-Page Workspace

**Branch:** `feature/html-page-editor` (continues on the Phase 4A branch from `b700919`).
**Status:** CI verified — Verify (format, lint, typecheck, tests, web+server build), Browser tests (Playwright/Chromium: 13 editor scenarios + 19 preview-security + rich-note suite) and Windows portable smoke all green on `fb0bcb4` ([run 32597212309](https://github.com/Rajendertyagi/RTWiki/actions/runs/32597212309)). No hierarchy, drag/drop, sidebar or Rich Note work included.

### Scope delivered

- CodeMirror 6 editors for HTML, CSS and JavaScript (official `codemirror@6.0.2`
  meta-package `basicSetup` + `lang-html`/`lang-css`/`lang-javascript`), wrapped
  by a thin in-repo hook — no third-party React binding.
- Tabs and a responsive editor/preview split view (stacks below 48em).
- Live preview through the unchanged Phase 4A secure sandbox; rebuilds are
  debounced by the centralized `PREVIEW_REBUILD_DEBOUNCE_MS = 800` constant and
  regenerate the channel ID per rebuild.
- Autosave via the shared controller plus manual Save (`Mod-S` and header
  button); Saving/Saved/Failed/Retry states reuse the existing status surface.
- Reload and page-switch persistence ride the existing server-merge and
  flush-ref patterns.

### Canonical schema v2 — per-page JavaScript toggle

- v2 adds `jsEnabled`; new pages default to **false**; legacy v1 documents
  load safely and normalize to disabled in memory (stored bytes stay v1 until
  an actual edit re-serializes as v2 — no database migration, content is
  opaque TEXT validated at the application boundary).
- The preview includes the user JavaScript pane only when enabled; the
  bootstrap always runs. Toggle is visible, labelled, and persisted through
  autosave/manual Save.

### Dependencies (verified against npm registry metadata at planning time)

Direct: `codemirror@6.0.2`, `@codemirror/state@6.7.1`, `@codemirror/view@6.43.9`,
`@codemirror/language@6.12.4`, `@codemirror/lang-html@6.4.12`,
`@codemirror/lang-css@6.3.1`, `@codemirror/lang-javascript@6.2.5`,
`@lezer/highlight@1.2.3`. Transitive leaves: `style-mod`, `w3c-keyname`
(pre-existing via ProseMirror), `crelt`, `@marijn/find-cluster-break`,
`@lezer/{common,lr,html,css,javascript}`, `@codemirror/{autocomplete,search,
commands,lint}` (via basicSetup). Lockfile updated through the approved
temporary read-only artifact workflow; deleted in the same corrective push.

### Lazy loading

The editor loads as its own chunk via `React.lazy` under a Suspense skeleton
(aria-busy) and an `HtmlEditorErrorBoundary` (Retry / Back to pages / sanitized
report). Chunk sizes are measured in CI before any decision on replacing
basicSetup with manual composition.

### Tests

Unit: schema-v1/v2 validation matrix, normalization, empty-doc defaults,
toggle serialization preserving siblings, byte limits in both shapes; preview
gating (JS pane omitted when disabled, bootstrap always present).
Browser (`html-editor.pwspec.ts`): editor opens with tabs + JS off default;
typing updates live preview after debounce; autosave Saved + reload
persistence; Mod-S manual save; failed-save Retry recovery; page-switch flush;
JS-off does not execute seeded code; enabling executes after rebuild; toggle
persists across reload and page switching; v1 compatibility with normalize-on-
save; editing never weakens normalization (typed scripts stay inert); mobile
split stacking. The full Phase 4A security suite runs unchanged (seeds now
explicitly enable JS where probes require execution).


### Validation

- **Green end to end:** run [32597212309](https://github.com/Rajendertyagi/RTWiki/actions/runs/32597212309)
  on `fb0bcb4` — Verify, Browser tests (42 scenarios), Windows portable smoke
  all success. Artifact `RTWiki-0.1.0-windows-x64`, 41,993,184 bytes.
- Save persistence is asserted at the network layer: tests capture the actual
  `PATCH /api/pages/:id` request and unwrap the `{content}` envelope before
  asserting, so a stale status label can never masquerade as a save.
- Content-save Retry lives in the editor surface (parity with the Rich
  editor); the header's Retry action remains scoped to page-list mutations.

### Commits

| SHA | Message |
|-----|---------|
| 5cb6dcc | chore(deps): declare CodeMirror 6 packages + temporary lockfile-artifact workflow |
| a614415 | chore(deps): sync bun.lock for CodeMirror 6 packages; remove temporary workflow |
| 4b74f09 | feat: editable HTML workspace with CodeMirror tabs, JS toggle and live preview |
| d00de74 | test: schema v2 jsEnabled coverage and preview gating assertions |
| e732531 | test: browser suite for editable HTML workspace and JS toggle |
| aa7e5fe | docs: record Phase 4B scope, schema v2 and dependency evidence |
| c17b4aa | chore: temporary format-diagnostics workflow (read-only artifact; deleted in e530d80) |
| e530d80 | fix: canonical formatting + lint/typecheck findings; remove diagnostics workflow |
| 147e5d7 / 78f27fd | fix: canonical JSX form; header save-state mapping without unsafe cast |
| 08f68e7 | fix: expect().toContainText assertion form in editor suite |
| 421d83c / 688aead | test: Saved assertion scoped to aria-live status paragraph (canonical form) |
| 2c96a91 | fix: handle null response in save watcher |
| 9c6ff2c | test: assert save persistence via PATCH request truth; header owns list-Retry |
| fb0bcb4 | fix: restore editor-owned content-save retry control |

## Workspace Hierarchy — Page Tree, Reordering, and Drag-and-Drop

**Branch:** `feature/workspace-hierarchy`
**Status:** CI verified — Build and Package fully green (Verify, Browser tests, Windows portable smoke) on `52fb0a0` ([run 32659192827](https://github.com/Rajendertyagi/RTWiki/actions/runs/32659192827)). Owner manual testing has **not** been performed yet.

### Scope delivered

- Page hierarchy: adjacency-list `parent_id` + sibling `position` (migration
  `003_page_hierarchy` with deterministic legacy backfill and partial index);
  transactional move endpoint with cycle/descendant rejection and an
  authoritative reconciliation payload. See [ADR-008](adr/ADR-008-page-hierarchy-and-workspace-tree.md).
- Accessible sidebar tree: WAI-ARIA tree/treeitem roles, roving-tabindex
  keyboard focus independent of active-page selection, Enter-to-open,
  expand/collapse, drop-hint indicators.
- Drag-and-drop reorder/reparent via core-only
  `@atlaskit/pragmatic-drag-and-drop@3.0.0` with honey-pot-aware pointer
  lookup, cached rendered hint committed at drop, and a drop-time fallback for
  sparse drag event streams. No hitbox or auto-scroll layer.
- Keyboard/context-menu move alternative ("Move to…", Move up/Move down)
  sharing the same validated endpoint as DnD.
- Complete-page pagination in the controller: the full living-page collection
  is retrieved through bounded windows of the existing list API before the
  hierarchy is built or moves commit — absolute sibling indexes require it;
  windowed loads placed rows incorrectly beyond 50 siblings (fixed and
  regression-tested).
- Shared contract fix: `MoveReconciliationResponse` now declares the moved-page
  snapshot under the authoritative `page` key (was stale `movedPage`).

### Validation

- Unit/integration: **317 tests passing** (`bun test`, 0 failures).
- Browser (Playwright, real Chromium): **56 scenarios passing**, including all
  13 original tree-DnD scenarios unchanged plus a deterministic >50-page
  regression performing `[a,b,c] → [a,c,b]` with active-page and zero-PATCH
  assertions.
- Bundle measurement: raw `2,307,568` / gzip `670,647` bytes (+357/+164 over
  the pre-hierarchy run; no dependency changes).
- Artifact `RTWiki-0.1.0-windows-x64` (artifact ID `9498309204`,
  42,005,562 bytes) from green run 32659192827.
- `main` untouched throughout; no pull request opened; work remains on
  `feature/workspace-hierarchy`.
