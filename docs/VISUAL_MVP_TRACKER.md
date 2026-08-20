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
| 2 | Visual Workspace and Page Management | In progress | — | — | — |
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
- [ ] AppShell with sidebar and main content area
- [ ] Sidebar: logo, search, page list with type indicators, new-page button, theme toggle
- [ ] Dashboard: empty state with "Create Rich Note" and "Create HTML Page" buttons
- [ ] Page cards/list ordered by most recently updated
- [ ] Search filters pages by title
- [ ] New-page dialog with title input and type selection
- [ ] Editor header: editable title, type badge, save status (Saving…/Saved/Error)
- [ ] Rename, duplicate, delete actions in editor header
- [ ] Delete confirmation modal
- [ ] Loading and error states for all async operations
- [ ] All strings in centralized UI text dictionary
- [ ] All styles use Mantine theme tokens (no inline style)
- [ ] Portable Windows artifact produced

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
| docs/VISUAL_MVP_TRACKER.md | Added | 4c80980 |
| README.md | Modified (+4 -0) | 4c80980 |
| .github/workflows/docs-quality.yml | Modified (add feature/** trigger) | 44a9343 |
| .github/workflows/build.yml | Modified (add feature/** trigger) | 44a9343 |

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

## Next Phase

**Phase 1 — Owner approved.** Proceeding to Phase 2: Visual Workspace and Page Management.

## Final Verification Status

Phase 0: Owner approved (#71). Phase 1: Owner approved (#79 — [#32376828943](https://github.com/Rajendertyagi/RTWiki/actions/runs/32376828943)). All format, lint, typecheck, test, build, and Windows smoke test gates passed. 49 tests, 0 failures.
