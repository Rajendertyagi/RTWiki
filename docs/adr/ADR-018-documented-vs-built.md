# ADR-018: Documented vs. Built — the Code Is the Authority

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-09-27 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | Partially — [ADR-002](ADR-002-bun-hono-sqlite.md), [ADR-003](ADR-003-react-blocknote-mantine.md), [ADR-008](ADR-008-page-hierarchy-and-workspace-tree.md) |

## Context

RTWiki's documentation set was written ahead of the implementation. It was written well — it
identifies real constraints, makes defensible choices, and in several places predicts problems the
implementation then had to solve for real. But it reads as a *description of a finished system*, and
it is not one.

That distinction is not academic in this repository. [`AGENTS.md`](../../AGENTS.md) is obeyed
literally by every automated agent that works here, and it inherits its claims from this
documentation set. An agent that reads "ORM: Drizzle ORM" and then greps for `drizzle-orm` finds
nothing, and has to choose between assuming the file is stale and assuming the code is. Every future
agent pays that cost. Worse, the failure is silent: nothing crashes when a documented module does
not exist, so the drift survives review indefinitely.

The drift is not a matter of a few stale version numbers. It is specific, structural, and was
verified line by line against the source at commit `6739ff6`. The table below is that evidence.
Every row was checked by searching `src/`, `tests/`, `scripts/`, `package.json`, `bun.lock` and
`node_modules`; `file:line` references point at what the code actually does.

**The `file:line` references were re-verified and corrected at `476de71`**, because commits
`138aa62` (which deleted `MAX_REQUEST_SIZE` and added `MAX_SCHEDULE_JSON_BODY_BYTES`) and `476de71`
shifted lines in `src/shared/constants/index.ts`, `src/server/config/index.ts` and
`src/server/bootstrap.ts`. The *findings* below are unchanged; where a row now says a constant was
**deleted**, that is a correction to the row, not a new finding.

| Documented claim | Where documented | Verified reality |
|---|---|---|
| **Drizzle ORM** is the ORM | [ADR-002](ADR-002-bun-hono-sqlite.md), `AGENTS.md` §6, [README](../../README.md), [ARCHITECTURE](../ARCHITECTURE.md), [DEVELOPMENT_STANDARDS](../DEVELOPMENT_STANDARDS.md) | **Absent.** Not in `package.json:27-76`, not in `bun.lock`, not in `node_modules`, 0 imports in `src/`. The code uses `bun:sqlite` with hand-written parameterised SQL: `src/server/repositories/page-repository.ts:1`, `src/server/repositories/schedule-repository.ts:1`, `src/server/services/page-service.ts:1`, `src/server/services/schedule-service.ts:1` |
| **`@blocknote/diagram-block`** provides diagram blocks | [ADR-003](ADR-003-react-blocknote-mantine.md), `AGENTS.md` §6, [SECURITY](../SECURITY.md), [MVP_SCOPE](../MVP_SCOPE.md), [PRODUCT_REQUIREMENTS](../PRODUCT_REQUIREMENTS.md), [ROADMAP](../ROADMAP.md) | **Absent** from `package.json:27-76` and `bun.lock`; 0 imports anywhere. The diagram block is hand-rolled: `src/web/features/rich-editor/schema.ts:4,32` calls `createReactDiagramSpec()` from `src/web/features/rich-editor/blocks/diagram.tsx:11`. A copy of the package sits in `node_modules/@blocknote/diagram-block/` as a stale install artefact — it is not a declared dependency and nothing imports it |
| **`@atlaskit/pragmatic-drag-and-drop`** is the sole DnD layer | [ADR-008](ADR-008-page-hierarchy-and-workspace-tree.md), [ARCHITECTURE](../ARCHITECTURE.md) | **Absent.** Not in `package.json` or `bun.lock`, 0 imports. Real tree DnD is Wunderbaum's own `dnd` config: `src/web/features/sidebar/wb-tree-host.ts:463-496` |
| **Backup / restore** — `POST /api/backup/create`, `POST /api/backup/restore`, `BackupService`, `VACUUM INTO` | [ARCHITECTURE](../ARCHITECTURE.md) §3.8, [DATA_MODEL](../DATA_MODEL.md) | **0 matches** in `src/`. `src/server/app.ts:168-209` mounts only pages, schedule, schedule/presets, attachments, shutdown, settings, client-errors and client-debug-events. `VACUUM` alone appears at `src/server/database/migrations.ts:405`, to re-apply `auto_vacuum`. The `data/backups/` **directory** is real and is created at startup (`src/server/bootstrap.ts:181,188`, `src/server/config/index.ts:93`) — the directory exists, the feature does not |
| **`GET /api/search`** and **`SearchService`** | [ARCHITECTURE](../ARCHITECTURE.md) | **0 matches.** Search exists but by a different route and a different mechanism: `GET /api/pages?q=` (`src/server/routes/pages.ts:57,60`) → `listPages` (`src/server/services/page-service.ts:235,239`) → `src/server/repositories/page-repository.ts:310-330`, which matches with `LIKE`, not FTS5. The FTS5 virtual table `search_index_fts` is created at `src/server/database/migrations.ts:37` and **never queried**; every write goes to the base table `search_index` (`page-repository.ts:46,120,156,195,267,294`) |
| **One shared import pipeline**, 8 named stages | [ARCHITECTURE](../ARCHITECTURE.md) §3.11, [ROADMAP](../ROADMAP.md) ("already exists") | **0 matches.** No import, adapter or sanitise module exists. `src/shared/schemas/html-content.ts` and `src/shared/schemas/markdown-content.ts` are page-content *schemas*, not import adapters |
| **A block registry**; no central switch over block types | `AGENTS.md` §6, [ADR-003](ADR-003-react-blocknote-mantine.md):60, [ADR-006](ADR-006-rich-content-and-import-contract.md) | **0 matches** for `blockRegistry` / `BLOCK_REGISTRY`. `src/web/features/rich-editor/schema.ts:28-37` is a hand-maintained `BlockNoteSchema.create().extend({ blockSpecs: { mathBlock, callout, diagram, mindMap, linkedPage, documentBlock } })` — six named specs, which is the anti-pattern the rule forbids. The only `registry` in `src/` is `src/web/theme/registry.ts`, a Mantine theme map |
| **A `richHtml` block** preserves the original source | `AGENTS.md` §4, [ARCHITECTURE](../ARCHITECTURE.md) | **0 matches** for `richHtml` in `src/`. The *rule* is implemented by a different mechanism: `containUnknownBlocks()` at `src/web/features/rich-editor/document.ts:273` converts each unknown block into a `codeBlock` holding its exact JSON, prefixed with `UNSUPPORTED_BLOCK_MARKER` (`src/shared/constants/index.ts:76`) |
| **A 50 MB import-package cap**, `config.import.maxPackageBytes` | `AGENTS.md` §8 | **0 matches.** `src/server/config/index.ts:15-29` (`AppConfig`) has no `import` key. There is no import-package cap, and **no global request ceiling to fall back on** — `MAX_REQUEST_SIZE` was deleted in `138aa62` |
| **A 100 MB global request ceiling** | [SECURITY](../SECURITY.md) §6 (until `138aa62`) | **Deleted, not enforced.** `MAX_REQUEST_SIZE` was declared, imported, typed, assigned and read by nothing, and `createConfig()` is called only from tests — the running server never held the value. `138aa62` removed it. **The gap is real and still open:** the correct control is a `bodyLimit` registered in `createApp()`, and that has not been built. Per-route caps exist and are listed in [SECURITY](../SECURITY.md) §6; they are not a global ceiling |
| **Config accessors** `config.server.port`, `config.data.directory`, `config.attachments.maxFileSize`, `config.customContent.enabled`, `getRuntimePaths()` | `AGENTS.md` §§6-8, [DEVELOPMENT_STANDARDS](../DEVELOPMENT_STANDARDS.md) | **0 matches** for all five. Real: `DEFAULT_PORT` / `DEFAULT_HOST` at `src/shared/constants/index.ts:10-11`; `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` at `:33`; `resolveRuntimePaths()` at `src/server/config/index.ts:76-98`; `AppConfig` at `:15-29` exposes flat `host`, `port`, `dataDir` and no request-size field |
| **Service classes** `PageService`, `SearchService`, `AttachmentService`, `ImportService`, `BackupService` | [ARCHITECTURE](../ARCHITECTURE.md) | **0 matches** in `src/`, `tests/` and `scripts/`. `src/server/services/page-service.ts` exports free functions — `createPage:87`, `movePage:124`, `getPage:133`, `updatePage:150`, `listPages:235`; the only class in the file is `PageValidationError:29` |

### Three things that are *not* drift, checked because they sit next to the drift

Recording these matters as much as recording the failures: a correction pass that quietly "fixed"
accurate claims would be as damaging as one that left the wrong ones in place.

| Claim | Status |
|---|---|
| `2000 ms` autosave debounce | **Accurate.** `PROVISIONAL_AUTOSAVE_DEBOUNCE_MS` at `src/shared/constants/index.ts:32` |
| `50 MB` **attachment** limit | **Accurate.** `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` at `:33`, enforced at `src/server/attachments/attachment-routes.ts:145`, `src/web/features/rich-editor/blocks/document-upload.ts:36`, `image-upload.ts:47`. Only the *import-package* cap is fictional |
| Mermaid `securityLevel: "strict"`; security headers | **Accurate.** `src/web/features/rich-editor/blocks/mermaid-render.ts:81`; headers via `hono/secure-headers` at `src/server/app.ts:3,67,128` |

## Decision

**The built code is the authority.** Documentation describes what exists. Architectural *intent* is
preserved, but it is explicitly labelled as intent rather than presented as fact.

Where a document and the code disagree about what was built, the code is right and the document was
wrong. An agent holding this ADR may correct the document without asking, and does not need to
guess which source to believe.

### The labelling convention

Every unbuilt item is marked with exactly this form, wherever it appears:

> **Planned — not implemented.** <what it is and why it is still wanted>. Tracked in [ADR-018](ADR-018-documented-vs-built.md).

The convention is stated once here and applied consistently. A reader who sees that sentence knows
three things without investigating: the feature is absent, the intent is deliberate, and there is a
record to consult. The three parts are load-bearing — dropping "why it is still wanted" converts a
labelled requirement into a bare omission, which is indistinguishable from something abandoned.

## Two lists, deliberately kept apart

Deleting architectural intent is a loss. Stating it as fact is a defect. Only the second is fixed
here.

### Wrong — never implemented, and must be corrected or labelled

These are claims about the past that are simply untrue. They get corrected to the truth, or labelled
as planned work. No effort is implied either way.

1. **Drizzle ORM.** Never adopted. The stack runs on hand-written parameterised SQL over
   `bun:sqlite`, which satisfies the same requirement — type-safe, parameterised, versioned
   migrations — without the dependency. ADR-002's `ORM` row is the only place that names it.
2. **`@blocknote/diagram-block`.** Never adopted. The diagram and mind-map blocks are first-party
   code in `src/web/features/rich-editor/blocks/`, which gave RTWiki control over Mermaid
   sanitisation that an off-the-shelf block would not have allowed.
3. **`@atlaskit/pragmatic-drag-and-drop`.** Never adopted. ADR-008's stated goal — an accessible
   tree with drag-and-drop at keyboard parity — *is* built, on Wunderbaum's own DnD. Only the named
   library is wrong.
4. **Backup and restore.** No endpoint, no service, no `VACUUM INTO`. The `data/backups/` directory
   is created at startup and stays empty.
5. **`GET /api/search` and `SearchService`.** Search is real, at `GET /api/pages?q=`, and it uses
   `LIKE` — not FTS5. Both the endpoint name and the `Search: SQLite FTS5` claim are wrong.
6. **The shared import pipeline.** Described as existing in two documents; no such module exists.
7. **The `richHtml` preservation block.** The named mechanism does not exist.
8. **The 50 MB import-package cap** and every `config.*` accessor listed above.
9. **`*Service` class names.** The services are free functions over an explicit `Database`
   argument, which is what [DEVELOPMENT_STANDARDS](../DEVELOPMENT_STANDARDS.md) already requires.
   The names were never the substance.

### Intent worth keeping — label, do not delete

These are real requirements, correctly reasoned, awaiting implementation. The gap is recorded; the
requirement stands. Whether to build it is a product decision, and it is not made here.

1. **The block registry** ([ADR-006](ADR-006-rich-content-and-import-contract.md)). The rule — one
   module per block type, no central switch — is sound and is the reason the editor is extensible at
   all. `schema.ts:28-37` is a hand-maintained six-spec list that a seventh block will have to
   remember to update. **This is unpaid debt against a standard the project set itself, and it is
   the most expensive item in this table.**
2. **"Never silently lose content."** Implemented, and implemented well — `containUnknownBlocks()`
   preserves each unknown block's exact JSON through every autosave round-trip, which is the
   guarantee the `richHtml` proposal was reaching for by a different route. The rule is honoured
   today; only the documented mechanism is fictional.
3. **One shared import path.** Whatever form it takes, "no parallel import paths" remains the right
   rule, because a second path is a second sanitiser.
4. **Backup and restore.** A genuine product requirement, correctly identified as needing validation
   before restore. Unbuilt, not unwanted.
5. **FTS5.** The table exists and is unused. The requirement behind it is real; the current `LIKE`
   scan is an acceptable MVP substitute, not the finished design.

## What this ADR does not do

**It does not descope anything.** Removing a requirement is a product decision and belongs to the
owner, not to a documentation pass. Nothing in the "intent worth keeping" list is withdrawn, and
nothing in [PRODUCT_REQUIREMENTS](../PRODUCT_REQUIREMENTS.md), [MVP_SCOPE](../MVP_SCOPE.md) or
[ACCEPTANCE_CRITERIA](../ACCEPTANCE_CRITERIA.md) is changed by this record.

It also does not claim the code is *good*. Several of these gaps are debt with a real cost — the
block registry most of all. The decision here is only about which source is authoritative when a
document and the code disagree, not about closing the gap.

An agent who finds a discrepancy not listed in this ADR is expected to **report it, not silently
reconcile it** — consistent with the pre-work protocol in [`AGENTS.md`](../../AGENTS.md) §2.

## Follow-up

A second pass covers [ARCHITECTURE.md](../ARCHITECTURE.md),
[DEVELOPMENT_STANDARDS.md](../DEVELOPMENT_STANDARDS.md).
Those three were excluded from this pass because they were being edited concurrently; changing them
here would have destroyed work in progress. [README.md](../../README.md), [SECURITY.md](../SECURITY.md),
[MVP_SCOPE](../MVP_SCOPE.md), [PRODUCT_REQUIREMENTS](../PRODUCT_REQUIREMENTS.md) and
[ROADMAP](../ROADMAP.md) carry claims from the table above and are also outstanding.

The index row for this ADR is added to [the ADR index](README.md) with that pass.

## Consequences

**Easier:** an agent can trust a documented component exists, or can tell in one sentence that it
does not. New work starts from a known baseline instead of a designed one.

**Harder:** every document that repeats these claims needs the same correction, and until each is
done, a reader who lands on a not-yet-corrected file still meets the old text. That is why the
outstanding files are named above rather than left implicit.

## Risks

- **The label becomes wallpaper.** A `Planned — not implemented` marker on a long enough list stops
  being read. Mitigated by keeping the marker short and putting the reason in it, but the mitigation
  is procedural, and nothing enforces it.
- **This ADR itself goes stale.** Its table was first verified at commit `6739ff6` and re-verified at
  `476de71` after `138aa62` shifted line numbers in three source files. It must be amended, not
  appended to, as items are built — the same failure mode it documents would otherwise recur here.
- **Corrections land unevenly.** Partial passes leave the document set describing two different
  systems at once. This is the worst intermediate state, and it is the reason the outstanding files
  are listed explicitly.

## Cross-references

- [ADR-002](ADR-002-bun-hono-sqlite.md) — Drizzle ORM claim, partially superseded.
- [ADR-003](ADR-003-react-blocknote-mantine.md) — diagram-block and block-registry claims, partially superseded.
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — the block-registry and import-pipeline contracts that remain owed.
- [ADR-007](ADR-007-sandboxed-custom-content.md) — the sandboxed custom-content contract; the note-package format is unbuilt.
- [ADR-017](ADR-017-markdown-engine-micromark.md) — the most recent ADR, and the one written after this correction pass began; cited here as the reference for what an ADR that matches the code looks like.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — the document with the largest concentration of unbuilt claims.
