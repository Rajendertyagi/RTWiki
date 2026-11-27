# RTWiki — Import, Search, HTML, Code View and File Support Plan

Status: Proposed. One combined implementation, all parts in one go. Not authorized for coding yet.

## Goal

Make RTWiki's import and editing experience seamless, following what Trilium does well. Reuse what RTWiki already has; add exactly one new viewer package for file previews (decision below).

## Parts

### 1. Import
- Refactor the existing `createPage` flag into one intent: `convert` or `attach`.
- Extend the live `ImportFieldsSchema` (not the dead `ImportRequestSchema`).
- One routing table: format → target. Every accepted format has a route (test enforces this).
- `html` → native HTML page. `md`/`txt`/`csv` → note by default. Binary docs and images → attachment by default.
- `attach` creates no page and no provenance row (schema is page-scoped). Preview says this clearly.
- Old imports stay as they are. No migration, no data loss.
- After confirm: refresh sidebar, show all created pages, show warnings.
- Add optional rename field in preview.

### 2. Search
- Sidebar box filters only the tree, client-side, by title. No `q` request.
- Ctrl+K stays global (title/content/recent), server-backed.
- Extend existing `filterPagesByQuery` with a scope parameter. Keep an unfiltered `allPages` for Quick Finder.
- Update App.tsx, Dashboard, QuickFinder, and `refreshPages()` wiring.
- Keep `LIKE` search. FTS5 is a separate future ADR (current table is broken: TEXT page_id used as content_rowid, no triggers).

### 3. HTML editor
- One editor instead of three boxes. Inline `<style>` and `<script>` stay in place.
- Keep the data format `{version:2, html, css, javascript, jsEnabled}` so old pages still work.
- No virtual HTML/CSS/JS rows in the tree.
- JS off by default, one clear toggle.
- Sandbox and CSP unchanged.
- No new packages (CodeMirror, DOMPurify, Mantine already present).

### 4. Code view (new)
- Add a Code note type using the existing CodeMirror editor and existing Shiki highlighter.
- Language picker from a single-sourced language list.
- Basic features: word wrap, line numbers, indent settings, read-only preview.
- Short code stays in Markdown code blocks (Shiki).
- No new packages for the editor itself. Executable JS/JSX is a separate Render Note feature (part 6), not part of Code view.

### 5. File support (new) — preview engine: `omni-doc-viewer`
- Add a File note type for files that stay as files (PDF, DOCX, XLSX/XLS, PPTX, images, Markdown, CSV, text, code, JSON, HTML, video, audio).
- Cannot change type after creation; can convert to attachment.
- Preview with `omni-doc-viewer` as-is (study below). Feed attachment bytes directly as `Uint8Array` — no URL, no second pipeline.
- No custom renderer adapters. Imported `.html`/`.md` files become native notes, so omni-doc-viewer's HTML/Markdown renderers are only used for raw files attached as File notes — a rare edge case.
- RTWiki's HTML page (authoring, JS enabled) and omni-doc-viewer's HTML preview (read-only, no scripts) are different features with different requirements, not duplicates. Both stay unchanged.
- Buttons: download, open externally, upload new revision.
- Reuse existing attachment storage and ingest core.
- Legacy `.doc`/`.ppt` are unsupported by the engine: show a clear message + download, never a broken viewer.
- Defer large-file streaming and 374 MiB-style limits to a later decision.

### 6. Render Note — JSX/JS in notes (new, Trilium pattern)
- Add a **Render Note** type. It renders custom content inside a note.
- A linked **JSX code note** holds the component. A `~renderNote`-style relation points to it.
- JSX is compiled at runtime with **`oxbox`** (see study below) using React's automatic runtime.
- React 19 mounts the compiled component into the note area. No Preact — RTWiki already has React.
- The code note receives a small `api` object: read/create notes, show messages. No full app/database access.
- JS code notes (non-JSX) run the same way for imperative scripts.
- Markdown stays Markdown. JSX is **not** injected into micromark — no MDX, no pipeline change.
- This is a deliberate feature with its own ADR. It is not part of the import/search/HTML work.

### 7. Markdown visual polish (better-looking pages)
- No new package. The parser is already correct — micromark + GFM + maths + callouts + columns + Mermaid + Shiki.
- Work is in `src/web/features/markdown/markdown-content.css` (and the two sibling CSS files).
- Fix the heading anchor rule: the comment at line 157 promises anchors hidden until hover, but **no rule exists**. Add it.
- Add KaTeX refinements used by better themes: `font-family` fallback, `line-height`, `text-indent: 0`, and the 1px top-padding workaround on `.katex-display`.
- Improve typography scale, table framing, code-block framing, callout colours, and formula spacing — all with existing Mantine tokens, both colour schemes.
- Optional, separate: code-block language label + copy button, and Mermaid zoom/fit/fullscreen. These need JS plus CSS, not CSS alone.
- Rejected: `github-markdown-css` (hardcoded light colours, wrong root class, no highlight rules) — already audited in the CSS file itself.

### 8. Trilium learnings — adopted with RTWiki's stack only
Studied Trilium's active content, Web View, Render Note, and Include Note. Adopt these, using only what RTWiki already has:

- **Include Note** — solves the "same content, different look" problem. One note embedded in another renders through one editor, one look. Extend the existing `linkedPage` BlockNote block (`src/web/features/rich-editor/blocks/linked-page-block.tsx`) into an inline include. No new package. This is the answer to HTML inconsistency — one renderer, not two.
- **Active content badge** — generalize the existing `jsEnabled` toggle into a visible Mantine `Badge` + `Menu` on notes with active content (HTML with JS, Render Notes). Click reveals enable/disable. On import, active content is **off by default**; the user turns it on explicitly. Mantine only, no new package.
- **Content-width consistency** — RTWiki already shares `--rtwiki-document-inset` between BlockNote and Markdown. Extend the same token to HTML pages and file previews. CSS-only.
- **Note type conversion** — Trilium converts between types explicitly. RTWiki's import `convert` intent already exists; add "Convert to HTML page" for a file note by reusing it. Note: `UpdatePageRequest` deliberately omits `pageType` (`pages.ts:46`), so conversion needs its own endpoint/service — one place, not scattered writes.
- **Render Note refresh + print** — reuse the HTML editor's existing manual Refresh preview pattern for Render Notes. Print support is a later, separate item.

**Not copied:** Preact (RTWiki has React), Web View (needs Electron `webview`; RTWiki is browser-based), backend scripts with full DB access (out of scope).

## JSX compiler study — `oxbox` (standalone tested 2026-11-28)

Chosen over Sucrase (Trilium's choice), `oxc-transform`, `@swc/wasm-web`, `esbuild-wasm`, and `@babel/standalone`.

**Standalone test result — PASS.** Installed with `bun add oxbox` (no Node needed). Transformed a JSX component with `jsx: { runtime: 'automatic', importSource: 'react' }`. Output was correct React 19 code importing `jsx`/`jsxs` from `react/jsx-runtime`, with `errors: []`.

**Verified facts:**
- Version 0.1.0, MIT, **zero dependencies**, single ESM chunk with WASM embedded.
- Works in browsers and Node/Bun. `bun add oxbox` works; the transform runs in the browser, not in Bun.
- Same API as `oxc-transform` / `oxc-parser`. Built from Oxc (Rust) — 3–5× faster than SWC, 20–50× faster than Babel.
- `init(): Promise<void>` — eagerly decodes/instantiates WASM. **Required before sync APIs in browsers.**
- `transformSync(filename, source, options)` → `{ code, errors, map?, helpersUsed }`.
- `JsxOptions`: `runtime: 'classic' | 'automatic'` (default automatic), `importSource` (default `'react'`), `development`, `pure`, `throwIfNamespace`, `pragma`, `pragmaFrag`.
- Also exports `transform`, `parse`, `parseSync`, `isolatedDeclaration*`, `moduleRunnerTransform*`.
- `errors` is an array even when code is produced — parser recovers from common syntax errors. Check it, do not assume empty.

**Obligations:**
- **CSP change required:** add `'wasm-unsafe-eval'` to `scriptSrc` in `APP_CONTENT_SECURITY_POLICY` (`src/server/app.ts:68-79`). Without it, WASM instantiation is blocked.
- Worker pool needs cross-origin isolation (COOP/COEP), which RTWiki does not set. Falls back to single-threaded — fine for note-sized JSX.
- Version 0.1.0 is brand new and single-maintainer. Sucrase is the documented fallback if oxbox proves unstable.

## File viewer study — `omni-doc-viewer` (verified from source, v0.2.0)

Chosen over anyview, `@lamberl-lee/file-preview`, `@iamjariwala/react-doc-viewer`, `react-doc-viewer`, and `@docmentis/udoc-viewer`.

Why it wins: MIT licence, fully offline, one install, no Microsoft/Google iframe, no API key, no online authorisation.

### Verified facts
- **Licence:** MIT wrapper. `NOTICE` lists every engine and its licence. All permissive (Apache-2.0 / MIT / ISC). `pptx-preview` is ISC in package.json; its author's README restricts redistribution of *source*, but the package consumes only the published npm build unmodified.
- **Dependencies (8, one install):** `jszip`, `marked`, `dompurify`, `@e965/xlsx` (Apache-2.0 republish of SheetJS CE 0.20.3), `pdfjs-dist`, `docx-preview`, `pptx-preview`, `emf-converter`. React is an optional peer.
- **No third-party calls:** `normalizeSource()` only fetches the URL the app passes. `data:` URLs and base64 decode locally. CDN is opt-in (`pdf.workerFallbackCdn`, default `false`).
- **HTML safety:** DOMPurify plus iframe `sandbox=""`, `referrerpolicy="no-referrer"`, `srcdoc`. No scripts — correct for a read-only preview of an untrusted file. RTWiki's HTML page keeps its own authoring sandbox separately.
- **Markdown safety:** `marked` + DOMPurify; falls back to plain text if sanitizer unavailable. Used only for raw `.md` files attached as File notes; imported `.md` files become native Markdown notes rendered by RTWiki's micromark.
- **PPTX repair:** `sanitizePptx()` fixes broken `[Content_Types].xml`, injects slide size, reports every change as a warning.
- **Lazy loading:** `BUILTIN_LOADERS` dynamic-imports each engine only when that format is opened.
- **React lifecycle:** `useViewer` destroys the controller on unmount and aborts in-flight renders when the source changes.
- **CSP:** styles via constructable stylesheets (`adoptedStyleSheets`), fallback `<style>` with `styleNonce`; inline styles via CSSOM. PDF worker needs `worker-src` in RTWiki's CSP.
- **PDF worker chain:** explicit → bundler-resolved (probed) → CDN (opt-in) → main-thread fallback with warning. Bundled worker uses `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` — Vite emits it. For CJK/JPX, self-host `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` and set `pdf.assetsUrl`.
- **API (core):** `renderDocument(options)`, `createViewer(options)`, `detect`, `detectFromBytes`, `normalizeSource`, `registerRenderer`, `setPdfWorkerSrc`, `inspectPptx`.
- **API (React):** `import { DocViewer } from 'omni-doc-viewer/react'`. Props include `source`, `type`, `pagination`, `theme`, `pdf`/`docx`/`pptx`/`csv`/`xlsx`/`html` tuning, `onLoad`/`onError`/`onWarning`, `styleNonce`.
- **Sources accepted:** URL, `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, `Response`, `{ base64 }`. RTWiki attachment bytes fit directly.
- **Limits:** legacy `.doc`/`.ppt` throw `UnsupportedFormatError`; `.xls` works via SheetJS. PPTX is a readable preview — no animations, transitions, charts, SmartArt, or speaker notes.
- **Maturity:** v0.2.0, single maintainer, but SLSA provenance on npm and a real browser test suite.

### Why no custom renderer adapters

Imported `.html` and `.md` files become native notes under the import plan. omni-doc-viewer's HTML/Markdown renderers therefore only run for raw files attached as File notes — a rare edge case. Overriding them with RTWiki's implementations would add code and maintenance for no user benefit.

RTWiki's HTML page and omni-doc-viewer's HTML preview are different features, not duplicates: one is an authoring workspace where JS runs (`jsEnabled`), the other is a read-only preview of an untrusted file with scripts disabled. Forcing one implementation would break one of them. Both stay as they are.

### Rejected alternatives
- `@docmentis/udoc-viewer` — WASM engine needs online authorisation; offline use needs a paid licence.
- `@lamberl-lee/file-preview` — LGPL-3.0, six optional peers, v0.8.0.
- `anyview` — pre-1.0, six parser peers.
- `@iamjariwala/react-doc-viewer` / `react-doc-viewer` — Office files go to Microsoft Office Online; local files do not preview.

## Lean architecture — single source of truth (verified against the code)

Studied `DEVELOPMENT_STANDARDS.md`, `ARCHITECTURE.md`, `src/shared/constants/index.ts`, `src/shared/contracts/pages.ts`, `src/web/config/index.ts`, `capabilities.ts`, `schema.ts`, `page-workspace.tsx`, and `page-preview-text.ts`.

**The problem:** knowledge of each page type is scattered across at least seven `pageType ===` switches — `page-workspace.tsx` (toolbar row AND editor switch, two separate chains), `page-preview-text.ts`, `status-bar.tsx`, `wb-adapter.ts`, `page-tree.tsx`, `new-page-dialog.tsx`, `tree-context-menu.tsx`. Adding a note type means editing all of them. This violates "define once, reuse everywhere."

**The fix — one page-type registry.** A single module owns, per `PageType`:
- id, label (from `UI_TEXT`), icon
- lazy editor component
- capability provider (the existing `capabilities.ts` model — editors declare what they can do; the toolbar renders what it is given)
- plain-text extractor (moves the logic out of `page-preview-text.ts`)
- flags: supports word count, has subfiles, supports create-child, supports conversion

Every scattered switch consumes this registry. Adding a note type becomes one registry entry.

**Anchors that already exist and must be reused, not duplicated:**
- `PageType` union — `src/shared/contracts/pages.ts:11` (single source for the type list)
- `UI_TEXT` — `src/web/config/index.ts:247` (all user-facing strings)
- `src/shared/constants/index.ts` (all limits, paths, TTLs — never repeat a number)
- `capabilities.ts` (toolbar behaviour — no `pageType` conditionals in the view layer)
- `rtwikiBlockSchema` — `schema.ts:30` (block registry; hand-maintained, known debt — new blocks go in their own module, registry refactor is owed, not silently replaced)

**Rules for this implementation:**
- Strict TypeScript, no unjustified `any`, explicit return types (DEVELOPMENT_STANDARDS §2).
- Mantine tokens for all visual values; `UI_TEXT` for all strings (§5).
- Shared schemas/types between frontend and backend in `src/shared/` (§1.1).
- Explicit dependencies, no global services or editor instances (§1.2).
- Parameterized SQL, versioned migrations, transactions for multi-step writes.
- No new packages beyond `omni-doc-viewer` and `oxbox`.

## ADRs

One ADR covering all eight parts, including:
- ADR-004 clarification for imported HTML and the HTML page exception.
- Intent refactor and routing table.
- Search scope model and why FTS5 is deferred.
- Code note and File note types, and why Shiki/CodeMirror are reused.
- **New dependency decision:** why `omni-doc-viewer` is added, why the other viewers were rejected, and the CSP/worker obligations it creates.
- **Render Note decision:** Trilium pattern, React over Preact, `oxbox` over Sucrase, the `wasm-unsafe-eval` CSP change, and why JSX is not added to Markdown.
- **Markdown styling decision:** CSS-only polish, no new package, why `github-markdown-css` is rejected.
- **Page-type registry decision:** one registry replaces the scattered `pageType ===` switches; capability model reused; `UpdatePageRequest` conversion needs its own endpoint.
- **Trilium learnings decision:** Include Note over duplicate renderers, active content badge, shared content-width token, convert-to-HTML.

## Files (expected)

- Import: `src/shared/schemas/import.ts`, `src/server/routes/import.ts`, `src/server/ingest/ingest-file.ts`, `src/web/App.tsx`
- Search: `use-pages-controller.ts`, `pages-controller-utils.ts`, `sidebar.tsx`, `App.tsx`, `dashboard.tsx`, `quick-finder.tsx`
- HTML: `html-editor.tsx`, `wb-adapter.ts`, `wb-tree-host.ts`, `App.tsx`
- Code/File: new note type schema, editor, routes, repository/service changes, UI
- **Viewer:** `package.json`, lockfile, new `file-preview` component wrapping `DocViewer`, CSP/worker asset wiring, `NOTICE`/licence attribution
- **Render Note:** new note type schema, JSX code note relation, `oxbox` runtime compiler, React mount component, small `api` object, `wasm-unsafe-eval` CSP change in `src/server/app.ts`
- **Markdown CSS:** `markdown-content.css` (anchor rule, KaTeX refinements, typography/table/code/callout polish), sibling CSS files if needed
- **Trilium learnings:** extend `linked-page-block.tsx` into Include Note; active content badge (Mantine); shared `--rtwiki-document-inset`; conversion endpoint
- **Page-type registry:** new registry module; refactor the seven `pageType ===` switches to consume it
- Tests: new files under `tests/`
- ADR: one new file in `docs/adr/`

## Order (one go)

1. Shared schemas, page-type registry, and ADR first.
2. Install `omni-doc-viewer` and `oxbox` with pinned versions and a frozen lockfile; wire worker assets and both CSP changes (`worker-src`, `wasm-unsafe-eval`).
3. Import.
4. Search.
5. HTML editor.
6. Code note.
7. File note + viewer.
8. Render Note + JSX compiler + React mount + `api` object.
9. Markdown CSS polish (anchor rule, KaTeX refinements, typography/table/code/callout).
10. Trilium learnings: Include Note, active content badge, content-width token, conversion endpoint.
11. Dead-code removal (see Dead code section — verified findings only).
12. One full test run (including compiled-exe smoke test for offline worker/CSP and a JSX render test).
13. One independent read-only verifier.
14. Commit locally. No push or merge.

## Dead code — verified audit (2026-11-28, read-only)

Thorough audit completed. Every finding below was confirmed by targeted grep/glob/read against `src/`, `tests/`, `scripts/`, `package.json`, `bun.lock`, and `src-tauri/`. The scan was conservative — a full O(n²) pass was too slow, so this is a verified minimum, not an exhaustive list.

### Confirmed dead exports (zero `src/` importers)
- `src/shared/schemas/import.ts:80,88` — `ImportRequestSchema`, `ImportRequest` (test-only; `ImportFieldsSchema` is live)
- `src/web/features/rich-editor/document.ts:6` — `AUTOSAVE_DEBOUNCE_MS` (dead re-export of `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS`)
- `src/shared/import/policy.ts:156` — `MARKDOWN_IMPORT_MAX_CHARS` (dead alias of `MAX_MARKDOWN_SOURCE_CHARS`)
- `src/shared/schemas/import.ts:97,106,109,114,128` — `ImportPreviewPageSchema`, `ImportPreviewPage`, `ImportPreviewSchema`, `ImportPreview`, `ConfirmImport` (`ConfirmImportSchema` at `:123` **is** live)
- `src/shared/schemas/health.ts:3,13` — `HealthResponseSchema`, `HealthResponseInput`
- `src/shared/contracts/health.ts:1,3` — `HealthStatus`, `HealthResponse`
- `src/shared/contracts/pages.ts:49` — `PageListResponse`
- `src/shared/schemas/rich-content.ts:42` — `isPreservedUnknownBlockContent` (only a comment mention at `:214`)
- `src/web/util/recent-pages.ts:54` — `clearRecentPages`
- `src/web/config/index.ts:203` — `OVERLAY_OWNER_ATTR`
- `src/web/config/index.ts:999` — `STATUS_TEXT` (dead duplicate of `UI_TEXT` subset at `:1000-1004`)
- `src/server/attachments/attachment-routes.ts:47` — `DOCUMENT_SIZE_WARNING_MESSAGE`
- `src/server/bootstrap.ts:75` — `ExistingInstanceResult`
- `src/server/repositories/page-repository.ts:1232,1258,1270` — `PageLinkRef`, `replaceOutgoingLinks`, `deleteOutgoingLinks` (only `replaceOutgoingLinksCore` at `:1243` is used)
- `src/shared/schemas/page-move.ts:17,19` — `PageMoveInput`, `MoveReconciliationResponse`
- `src/shared/schemas/pages.ts:60` — `BatchCreatePagesInput`
- `src/shared/schemas/visual-page-content.ts:100,103,113` — `VisualPageContentSchema`, `VisualPageContent`, `serializeVisualPageContent` (both types `@deprecated` at `:99,102`)
- `src/web/features/workspace/editor-preferences.ts:108,122,136` — `setSpellCheck`, `addPersonalWord`, `removePersonalWord`
- `src/web/features/tabs/tabs-model.ts:42,78` — `activationIsAlreadyOpen`, `removeFromTabs`
- `src/shared/constants/index.ts:261,309,310,311,329` — `ScheduleColor`, `SHELL_LOG_FILENAME`, `SHELL_LOG_MAX_BYTES`, `SHELL_LOG_MAX_ROTATED_FILES`, `SETTINGS_KEY_WINDOW_GEOMETRY` (shell log values mirrored in Rust `src-tauri/src/main.rs:79-81`; TS copies unused)

### Test-only exports (keep the test or the function becomes live — see conflicts)
- `src/web/features/rich-editor/document.ts:283` — `isUnknownBlockPreserved` (only `tests/rich-blocks-compat.test.ts`; documents the unbuilt "surface a warning" half)
- `src/shared/import/policy.ts:76,119` — `UNSUPPORTED_IMPORT_FORMATS`, `MARKDOWN_IMPORT_ACCEPT_ATTRIBUTE`
- `src/web/hooks/pages-controller-utils.ts:9,23,32,39` — all four helpers, including `filterPagesByQuery` (only tests today)

### Orphaned files (zero incoming imports)
- `src/shared/contracts/errors.ts` — all four classes dead (`AppError`, `NotFoundError`, `ValidationError`, `ConflictError`)
- `src/shared/contracts/health.ts`, `src/shared/schemas/health.ts`
- `src/web/hooks/pages-controller-utils.ts` — test-only

### Duplicate definitions to single-source
1. Autosave debounce — authoritative `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` (`constants/index.ts:116`); hardcoded `2000` at `autosave-controller.ts:60`; dead re-export above.
2. Loopback host — `DEFAULT_HOST` (`constants/index.ts:9`) vs literals at `bootstrap.ts:150,160,597`, `server/index.ts:70,80`, `launcher.ts:13`, `server-settings-api.ts:119,162`.
3. Default port — `DEFAULT_PORT` (`constants/index.ts:10`) vs `8080` at `server/index.ts:70,80`.
4. `mid-migration-attachments` — `constants/index.ts:426` vs retyped at `backup-api.ts:11`, `backup-service.ts:53,225,227`, `backup-panel.tsx:44`.
5. Shell log settings — TS `constants/index.ts:309-311` vs Rust `main.rs:79-81` (TS copies unused).
6. `STATUS_TEXT` (`config/index.ts:999`) duplicates `UI_TEXT` fields.
7. `100_000` in four files: `constants/index.ts:59`, `visual-page-content.ts:59`, `search-extraction.ts:25`, `document-detect.ts:88` (arguably distinct concerns — review, do not blindly merge).
8. `'Untitled'` at `wiki-link.tsx:43` vs `DEFAULT_IMPORTED_PAGE_TITLE` (`constants/index.ts:69`).
9. `'rtwiki.log'` at `fatal.ts:65`, `config/index.ts:395`, `logging/index.ts:34` vs `LOG_FILENAME` (`constants/index.ts:8`).
10. Redundant aliases at `policy.ts:156,159` re-exporting `constants/index.ts:59,112`.

### Unused dependencies
- `react-icons` (`package.json:83`) — zero imports; also noted in `docs/HANDOVER.md:138`. Remove.
- `latest` (`package.json:64`) — zero imports; a CLI package, no script invokes it. Remove.
- `codemirror` (`package.json:57`) — **DO NOT REMOVE.** No direct import, but load-bearing as transitive provider of `@codemirror/autocomplete`, `@codemirror/commands`, `@codemirror/search`, which ARE imported (`use-codemirror.ts:1,2,14`, `source-capabilities.ts:9`, `source-find-dialog.tsx:9`) and are not declared directly.

### Known debt verified
- `@blocknote/diagram-block` never adopted — absent from `package.json`/`bun.lock`; docs-only mentions. Diagram block is first-party (`blocks/diagram.tsx`).
- Drizzle never adopted — no package/code reference; docs-only.
- Block registry debt — `schema.ts:30-43` is a hand-maintained six-spec list; no registry module.
- `richHtml` never implemented — zero matches in `src/`.
- DOMPurify scope — only real import at `markdown-render.ts:1`, `sanitize()` at `:266` (AGENTS.md cites `:136`, stale).
- Mermaid strict mode — `mermaid-render.ts:95,113` (AGENTS.md cites `:80,90`, stale).
- Recursive unknown-block containment — `document.ts:115-117,134,231-232,257` verified.
- No `TODO`/`FIXME`/`HACK`/`XXX` in `src/`; only two `@deprecated` tags.

### Conflicts with this plan — resolve before deleting
- `filterPagesByQuery` (`pages-controller-utils.ts:32`) is test-only today, but **part 2 (Search) plans to use it**. Do not delete — it becomes live.
- `isUnknownBlockPreserved` (`document.ts:283`) is test-only, but its test documents an unbuilt requirement. Keep the test; decide separately whether to keep the function.
- `ImportRequestSchema` deletion is consistent with part 1 (which uses `ImportFieldsSchema`). Safe to remove with its test.

### Removal rules
- Only delete what the audit proves has zero importers/callers in `src/` **and** whose tests are either removed or updated.
- Resolve the three conflicts above first.
- Do not remove `codemirror`.
- Do not change an accepted ADR silently — stale line numbers in AGENTS.md are reported, not edited here.
- No speculative deletion of private/internal helpers (the O(n²) scan did not finish).

## Scope limits

No auth, cloud sync, LAN, AI chat, `.rtwiki.zip`, second database, second ingest pipeline, or unrelated cleanup.
Only two new packages are allowed: `omni-doc-viewer` and `oxbox`. No other new packages.
No CDN fallback enabled — the app must work offline.
No MDX in Markdown — JSX lives only in Render Notes.
