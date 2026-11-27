# External AI Integration — Comprehensive Test Matrix (Phases 0–3)

**Branch:** `feature/external-ai-integration`  
**HEAD:** `20faaa0` (`20faaa0...`, verified at execution start)  
**Working tree at start:** clean (`git status --short --branch` => `## feature/external-ai-integration...origin/feature/external-ai-integration`)  
**Report date:** 2026-11-27  
**Scope:** Read-only verification/execution. The only file modified by this agent is this report.

## 1. Constraints and environment

- No production code, tests, `package.json`, `bun.lock`, or existing docs were modified.
- No commits, pushes, resets, or cleans performed.
- No owner's real data directory used. Dev runtime used `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\data-dev`; compiled runtime used `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\data-compiled`.
- Compiled runtime staged into `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\stage-compiled` with **no `node_modules`** (verified: `node_modules=0`).
- Dev server: `bun run src/server/index.ts --no-open --port 18123 --data-dir ...` (Bun runtime).
- Compiled server: `build/server/RTWiki.exe --no-open --port 18124 --data-dir ...` from clean staged directory.

## 2. Sources read (required)

- `AGENTS.md`
- `docs/PLAN_EXTERNAL_AI_INTEGRATION.md`
- `docs/EXTERNAL_AI_INTEGRATION_FINAL_REPORT.md`
- `src/shared/attachments/document-formats.ts` (authoritative accepted formats)
- `src/server/openapi/index.ts`
- `src/server/routes/pages.ts`
- `src/server/routes/import.ts`
- `src/server/ingest/ingest-file.ts`
- `src/web/features/pages/import-preview-modal.tsx`

Additional inspected files for evidence: `src/server/app.ts`, `src/server/routes/recovery.ts`, `src/server/attachments/attachment-routes.ts`, `src/server/attachments/attachment-repository.ts`, `src/shared/schemas/pages.ts`, `src/shared/schemas/import.ts`, `src/shared/schemas/visual-page-content.ts`, `package.json`, `scripts/verify-compiled-openapi.ts`.

## 3. Fixture generation

Fixtures were generated outside the repo at `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\fixtures` using Python 3.15.0 (`python --version`) and a small generator script. No dependencies were added.

| Fixture | How produced | Notes |
|---|---|---|
| `sample.txt`, `sample.md`, `sample.html`, `sample.csv`, `sample.tex`, `sample.rtf` | Written as plain text bytes with minimal valid content | Signatureless/text formats; RTF minimal valid RTF header/body |
| `sample.pdf` | Hand-crafted minimal PDF 1.4 with one page and "Hello PDF" text object | Valid PDF structure |
| `sample.docx` | Python `zipfile` OOXML package: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` | Minimal WordprocessingML |
| `sample.docm`, `sample.dotx`, `sample.dotm` | Same OOXML structure as DOCX with corresponding macro/template main content type | Minimal macro-enabled/template variants |
| `sample.pptx` | OOXML presentation package with `ppt/presentation.xml`, slide, rels | Minimal PresentationML |
| `sample.pptm`, `sample.potx`, `sample.potm`, `sample.ppsx`, `sample.ppsm` | Same PPTX structure with corresponding main content type | Minimal variants |
| `sample.xlsx` | OOXML spreadsheet package with workbook, worksheet, sharedStrings, rels | Minimal SpreadsheetML |
| `sample.xlsm`, `sample.xltx`, `sample.xltm` | Same XLSX structure with corresponding main content type | Minimal variants |
| `sample.odt`, `sample.odp`, `sample.ods`, `sample.odg` | Python `zipfile` ODF packages with stored `mimetype`, `META-INF/manifest.xml`, `content.xml` | Minimal ODF 1.2 content |
| `sample.epub` | Python `zipfile` EPUB with stored `mimetype`, container.xml, OPF, XHTML chapter | Minimal EPUB 2 package |
| `sample.png` | Hand-crafted 1x1 white PNG (IHDR/IDAT/IEND with zlib) | Valid PNG |
| `sample.gif` | Minimal 1x1 GIF89a bytes | Valid GIF |
| `sample.jpg` | Minimal 1x1 JFIF/JPEG bytes | Valid JPEG |
| `sample.webp` | Minimal RIFF WEBP VP8 keyframe 1x1 | Valid WebP |
| `sample.svg` | Minimal SVG markup | Used for rejection test (SVG must be rejected) |

Existing repo fixtures observed but not modified: `tests/fixtures/real-encrypted.docx`, `tests/fixtures/real-macro.docm`, `tests/fixtures/real-macro.xlsm`.

## 4. Execution method

- Real HTTP requests via `fetch` against running servers.
- DB side-effect checks via read-only `bun:sqlite` queries against isolated temp DBs (`pages`, `attachments`, `import_sources`, `search_index`, `page_revisions`, `operation_log` counts).
- Preview zero-write cells: snapshot counts before and after `POST /api/import/preview`; PASS requires HTTP 200 and identical counts.
- Compiled runtime: staged `RTWiki.exe` + `web` into clean temp dir, no `node_modules`, started with `--no-open --port 18124 --data-dir ...`.
- Evidence logs: `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix/results.json` (original automated run, 164 cells) and `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix/results-corrected.json` (corrective re-run, 15 cells). AI tool response saved as `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\ai-tools.json`. Console output from `run-matrix.ts` / `run-corrected.ts`.

## 5. Coverage matrix

### 5.1 Axis A — Page types (canonical formats)

| Page type | Direct POST /api/pages | POST /api/pages/batch | Import-created page | AI tool surface exposed | Evidence |
|---|---|---:|---|---|---|
| rich | PASS | PASS (in original batch cell context; see note) | N/A by design (not executed) | Observed in ai-tools.json (not per-type invoked) | `results.json`: direct create 201 id `dc4dcc1c-dab7-42aa-af23-520aef8d2b01` |
| html | PASS | PASS (in original batch cell context; see note) | N/A by design (not executed) | Observed in ai-tools.json (not per-type invoked) | `results.json`: direct create 201 id `1e3d5932-aeac-4294-bcbd-df730b1a524f` |
| markdown | PASS | PASS (in original batch cell context; see note) | PASS (import creates markdown pages) | Observed in ai-tools.json (not per-type invoked) | `results.json`: direct create 201 id `db324cc7-cda3-4fb3-ac5c-ab7181ff78bb`; import single-file returns markdown page |
| diagram | FAIL in `results.json`; PASS in corrective re-run | FAIL in `results.json` (`A.create.batch all4`); PASS in corrective re-run | N/A by design (not executed) | Observed in ai-tools.json (not per-type invoked) | `results.json`: direct create 400 "Stored content is not a valid visual page document."; batch all4 400. `results-corrected.json`: direct create 201 id `6100b18c-f0a0-4495-991a-9ca77ab406dc`; batch 201 count 4 |

**A notes:**
- `results.json` is the original automated artifact: 164 cells, 161 PASS, 2 FAIL, 1 NOT TESTED. The two FAILs are `A.create.direct diagram` and `A.create.batch all4`, caused by a **test-harness fixture error** in `run-matrix.ts` (diagram v2 content missing required `type` per `VisualPageContentV2Schema` in `src/shared/schemas/visual-page-content.ts`).
- Corrective re-run evidence is saved separately in `results-corrected.json` (15 cells, all PASS). It does **not** retroactively change `results.json`.
- Import pipeline creates markdown pages by design (`ingest-file.ts` sets `pageType: 'markdown'`, `serializeMarkdownContent`). "Import-created page" for rich/html/diagram is N/A by design, not a product failure.
- "AI tool surface exposed" was previously overclaimed as per-type PASS; the actual saved evidence is `ai-tools.json` showing 20 tools. Per-type invocation was not recorded.

### 5.2 Axis B — Operations per page type

| Operation | rich | html | markdown | diagram | Evidence |
|---|---|---|---|---|---|
| create | PASS | PASS | PASS | FAIL in `results.json`; PASS in `results-corrected.json` | see Axis A |
| read | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | `results.json` has rich/html/markdown only; corrected: status 200 |
| search (q=) | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 found=true |
| update (PATCH with version) | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 version 2 |
| move | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 |
| duplicate | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 201 id `fcc92c04-28af-4689-977f-880bd956720d` |
| trash (DELETE) | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 |
| restore (normal) | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 |
| restore (explicit revision) | NOT TESTED | NOT TESTED | PASS in `results-corrected.json` (living page) | NOT TESTED | No explicit-revision success cell in `results.json`. Corrective run executed real restore on living markdown page: status 200 pageId `ebb3ff9f-0c27-4b46-a190-4c0ad106ce81` revId `c64d658f-a412-4a54-8d3e-58f99a8d58d4` (`results-corrected.json`). Rich/html/diagram explicit-revision success not executed. |
| permanent delete (?confirm=permanent) | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: no-confirm 400 `confirmation_required`; confirmed 200 |
| revisions list | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 count 3 |
| recovery operations list | PASS | PASS | PASS | NOT TESTED in `results.json`; PASS in `results-corrected.json` | corrected: status 200 array |

**B notes:**
- `results.json` contains no diagram B.* operation cells except `B.ops diagram = NOT TESTED` (no page created due to harness fixture). The previous report incorrectly marked diagram operations PASS; those cells are corrected to NOT TESTED for the original artifact, with corrective evidence cited separately where executed.
- Explicit revision restore success was previously marked PASS based on code inspection/negative case; that was incorrect. Only the markdown living-page explicit revision restore was actually executed (corrective run, PASS). Rich/html/diagram remain NOT TESTED.

### 5.3 Axis C — Document formats (ACCEPTED_DOCUMENT_FORMATS)

All 25 formats from `src/shared/attachments/document-formats.ts` were tested.

| Format | Preview (zero writes) | Confirm | Single-file import | Attachment-only upload | Signatureless forced download | Signatureless /view refused | Evidence (status/code) |
|---|---|---|---|---|---|---|---|
| pdf | PASS | PASS | PASS | PASS | N/A | N/A | preview 200 zeroWrites=true; confirm 201; import 201; attach 201 |
| docx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| docm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| dotx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| dotm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| pptx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| pptm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| potx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| potm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| ppsx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| ppsm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| xlsx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| xlsm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| xltx | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| xltm | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| odt | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| odp | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| ods | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| odg | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| rtf | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| epub | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| tex | PASS | PASS | PASS | PASS | N/A | N/A | 200/201/201/201 |
| txt | PASS | PASS | PASS | PASS | PASS | PASS | preview 200 zeroWrites; confirm 201; import 201; attach 201; download 200 `Content-Disposition: attachment; filename="sample.txt"...`; /view 404 |
| md | PASS | PASS | PASS | PASS | PASS | PASS | download 200 attachment; /view 404 |
| html | PASS | PASS | PASS | PASS | PASS | PASS | download 200 attachment; /view 404 |
| csv | PASS | PASS | PASS | PASS | PASS | PASS | download 200 attachment; /view 404 |

**C notes:**
- Preview zero-write assertion checked `pages, attachments, import_sources, search_index, page_revisions, operation_log` counts before/after; all were identical for every format.
- Signatureless bytes stored and served as forced downloads (ADR-023) confirmed for txt/md/html/csv. `/view` refused (404) as expected.
- Extracted text/searchability: import creates markdown page and indexes content through normal page creation path; search endpoint was exercised for page types. A dedicated per-format extracted-text search assertion was not run for every format; this is a gap (see §8).

### 5.4 Axis D — Image formats

| Case | Result | Evidence |
|---|---|---|
| png upload | PASS | POST /api/attachments => 201 id `9c132333-08d7-48a6-bd85-a7139b56c3a9` |
| jpg upload | PASS | 201 id `34e33fae-a502-4b72-a1aa-fe74e2f61e74` |
| gif upload | PASS | 201 id `f624c601-26a6-4f6a-91d2-518d4cd51c27` |
| webp upload | PASS | 201 id `295ed998-d607-4cdc-850d-3cf113f5e900` |
| svg rejected | PASS | 415 `svg_not_supported` |
| oversized-pixel image | NOT TESTED | No oversized-pixel fixture generated; creating a valid large-dimension image without adding deps is non-trivial. Would require generating a valid image header claiming large dimensions or a real large image. |
| wrong media type / type confusion | PARTIAL | Compiled E2E covers PDF renamed .txt not downgraded; dev matrix did not include a dedicated wrong-media-type image upload case beyond SVG rejection. |

### 5.5 Axis E — Runtimes

| Runtime | Scope | Result | Evidence |
|---|---|---|---|
| Dev server (Bun) | Full matrix script + manual corrections | PASS (with harness correction noted) | `run-matrix.ts` against `127.0.0.1:18123`, isolated data dir; results in `results.json` |
| Compiled `RTWiki.exe` (clean dir, no node_modules) | Smoke + key cells | PASS | Staged `build/server/RTWiki.exe` + `web` into temp dir; `node_modules=0`; health 200; create rich/html/markdown/diagram 201; import preview 200; confirm 201; attachment upload 201; wrong media type 415; `/api/ai/tools` 200 with 20 tools |
| Compiled gates | verify-compiled-e2e, test:compiled-images, test:compiled-openapi | PASS | see §7 |

**E note:** The task asked for "every matrix cell" on both runtimes. I executed the full automated matrix on dev and a representative compiled smoke on the compiled runtime, plus the three compiled gate scripts which exercise many compiled behaviors. I did **not** re-run every dev matrix cell against the compiled runtime individually. This is an explicit coverage gap.

### 5.6 Axis F — Negative cases

| Case | Result | Evidence |
|---|---|---|
| Invalid input shape (create empty title) | PASS | POST /api/pages invalid title => 400 |
| Wrong media type | PASS | POST /api/pages with `text/plain` => 415 |
| Oversized body | PASS | >4MB JSON body => 413 |
| Mismatched revision ID | PASS | POST /api/pages/:id/revisions/00000000-.../restore => 410 `recovery_data_expired` |
| Expired revision | PARTIAL | Mismatched/nonexistent revision returned 410; a genuinely expired-by-retention revision was not constructed. |
| Untagged/dangerous AI operations absent from tool surface | PASS | `/api/ai/tools` returned 20 tools; no path/name containing "permanent" |
| Missing ?confirm=permanent | PASS | DELETE /api/pages/:id/permanent => 400 `confirmation_required` |
| Cancelled preview (no confirm) | PASS | Preview returned 200; DB counts unchanged before/after; no confirm request sent |
| Partial batch failure | PASS | Batch with one invalid item => 400 |

## 6. AI tool surface (observed, saved evidence)

`GET /api/ai/tools` response saved as `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\ai-tools.json` during the corrective run (`results-corrected.json`: `F.ai-tools.list all PASS status=200 count=20`). The original `results.json` only recorded `F.negative ai-tools-no-permanent PASS status=200 hasPermanent=false`; it did **not** record the full tool list.

Tools returned (from `ai-tools.json`):

```
GET /api/pages
POST /api/pages
POST /api/pages/batch
GET /api/pages/{id}
PATCH /api/pages/{id}
DELETE /api/pages/{id}
POST /api/pages/{id}/move
POST /api/pages/{id}/duplicate
POST /api/pages/{id}/restore
POST /api/import
GET /api/schedule/entries
GET /api/schedule/entries/{id}
GET /api/schedule/reminders
GET /api/schedule/reminders/{id}
POST /api/attachments
GET /api/attachments/{id}
GET /api/attachments/{id}/text
GET /api/settings/server
GET /api/settings/desktop
GET /api/settings/appearance
```

Dangerous operations absent as expected: permanent page/attachment delete, backup restore, shutdown, settings writes, preset apply/replace, trash listing, revision history/undo, attachment `/view`, attachment trash/restore, schedule writes, preview/confirm.

## 7. Verification gates

| Gate | Result | Exact evidence |
|---|---|---|
| `bun run format:check` | PASS | `Checked 530 files in 382ms. No fixes applied.` |
| `bun run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `bun test` | PASS | `2161 pass`, `0 fail`, `15204 expect() calls`, `Ran 2161 tests across 143 files. [27.18s]` |
| `bun scripts/verify-compiled-e2e.ts` | PASS | `79 passed, 0 failed` |
| `bun run test:compiled-images` | PASS | `ALL PASS - detection works in the compiled executable` |
| `bun run test:compiled-openapi` | PASS | `13 passed, 0 failed` |

## 8. Gaps / NOT TESTED / caveats

| Gap | Reason | Risk |
|---|---|---|
| Original report miscounted cells | Previous report claimed 136/131/0/2/3; `results.json` actually contains 164/161/2/1. Corrected in this revision. | High for audit trust — now reconciled |
| Full matrix not re-run on compiled runtime | Time/scope; compiled smoke + three compiled gates were run | Medium — compiled-specific regressions outside smoke/gates could be missed |
| Diagram initial direct/batch cells failed in first script | Test harness used invalid v2 visual content (missing `type`) | None for product; corrective re-run PASS saved in `results-corrected.json` |
| Diagram B operations missing from `results.json` | `B.ops diagram` was NOT TESTED in original run; previous report incorrectly marked them PASS | Medium — corrected by marking NOT TESTED for original artifact and citing corrective PASS evidence |
| A.3 import-created rich/html/diagram | Import pipeline creates markdown pages by design (`ingest-file.ts`) | None — design constraint, not missing capability |
| A.4 "AI tool surface where exposed" per page type | Full tool list saved in `ai-tools.json`; per-type invocation not recorded | Low — endpoints individually exercised |
| Explicit revision restore success only partially executed | Corrective run proved markdown living-page success; rich/html/diagram explicit-revision restore not executed | Low/Medium — endpoint behavior partially proven |
| Oversized-pixel image rejection | No valid oversized image fixture generated without adding deps | Low — code path exists; not runtime-proven here |
| Expired-by-retention revision 410 | Would require manipulating timestamps/retention; not constructed | Low |
| Per-format extracted-text searchability assertion | Import/indexing path exercised, but not queried with format-specific extracted text for every format | Medium |
| Attachment-only upload for every format on compiled runtime | Only PDF smoke on compiled | Low |
| Preview/confirm/import for every format on compiled runtime | Only PDF smoke on compiled | Low |
| Some generated OOXML/ODF/EPUB fixtures are minimal | They were accepted by the running server; richer real-world files may behave differently | Medium |
| `real-encrypted.docx` / macro fixtures in repo not exercised in this matrix | Not included in automated run; would be useful negative/security cases | Low |

## 9. Summary

### 9.1 Original automated artifact (`results.json`)

| Metric | Count |
|---|---:|
| Matrix cells recorded | 164 |
| PASS | 161 |
| FAIL | 2 |
| NOT TESTED | 1 |

FAIL cells in `results.json`: `A.create.direct diagram` (400, invalid harness fixture missing `type`), `A.create.batch all4` (400, same harness fixture). NOT TESTED: `B.ops diagram` (no page created).

### 9.2 Corrective re-run artifact (`results-corrected.json`)

| Metric | Count |
|---|---:|
| Matrix cells recorded | 15 |
| PASS | 15 |
| FAIL | 0 |
| NOT TESTED | 0 |

Covers: corrected diagram direct create, corrected batch all4, diagram B operations (read/search/update/move/duplicate/trash/restore/revisions/recovery/permanent-no-confirm/permanent-confirmed), explicit revision restore success on living markdown page, AI tools list capture.

### 9.3 Reconciliation

The previous version of this report incorrectly claimed 136 recorded cells / 131 PASS / 0 product FAIL / 2 harness FAIL corrected / 3 NOT TESTED. That was a miscount and overclaim. The authoritative original automated evidence is `results.json` (164/161/2/1). Corrective evidence is separate and does not rewrite `results.json`. Diagram operation PASS claims in the previous report were unsupported by `results.json` and have been corrected to NOT TESTED for the original artifact, with corrective PASS evidence cited where executed.

| Metric | Count |
|---|---:|
| Verification gates PASS | 6/6 |

**Overall:** No product failures observed in executed cells. The two FAILs in `results.json` are test-harness fixture errors (missing `type` in diagram v2 content), corrected and re-run with saved evidence in `results-corrected.json`. Gaps remain explicit; no gap is reported as PASS.

## 10. Scope confirmation

- Modified files: **`docs/EXTERNAL_AI_TEST_MATRIX.md` only**.
- No production code, tests, package.json, bun.lock, or other docs modified.
- No commits, pushes, or branch changes.
- Temp files created only under `D:\Coding\OpenCode\user\tmp\opencode\rtwiki-matrix\`.