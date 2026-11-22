# ADR-024: One Ingest Pipeline and Structured Import

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-11-22 |
| **Supersedes** | The "DOCX editable conversion is not implemented and is not implied" finding of [ADR-020](ADR-020-search-and-conversion-boundary.md) §5 item 6 (`:104-106`), and the "Why only Markdown exists" claim in the now-deleted `src/shared/import/conversion.ts`. Both are superseded **only** for the ingest path described here; ADR-020 is otherwise unchanged |
| **Related** | [ADR-006](ADR-006-rich-content-and-import-contract.md), [ADR-015](ADR-015-document-attachments.md), [ADR-023](ADR-023-signatureless-bytes-and-forced-download.md), [AGENTS.md](../../AGENTS.md) §4 |

## Context

AGENTS.md §4 requires that every content import — paste, drop, file, or localhost API — go
through **one shared, centralized import pipeline**, with no parallel implementations. It also
requires that unknown content never be silently lost.

At the time this ADR was written there was no such pipeline. Attachments were uploaded only
through `POST /api/attachments` (`src/server/attachments/attachment-routes.ts:206-264`), there
was no `POST /api/import` route, and the conversion boundary had exactly one adapter — the
Markdown adapter in the now-deleted `src/shared/import/conversion.ts`. ADR-020 §5 item 6
(`:104-106`) recorded that DOCX editable conversion was not implemented, and `conversion.ts`
explained why only Markdown existed. Both statements were accurate when written. This ADR
supersedes those two findings for the new ingest path and records the design that implements it.

This is a **foundation**, not the full import contract. The distinction is made explicit below.

## Decision

### 1. One server-side ingest module, two thin HTTP consumers

There is one module, `src/server/ingest/ingest-file.ts`, exposing:

```text
ingestFile(db, input, deps)
```

It owns detection, byte storage, conversion, and provenance. Two HTTP consumers call it and do
nothing else:

- `POST /api/attachments` — attachment-only ingest. The existing document-block UX is
  unchanged: a document inserted as BlockNote's `file` block remains an attachment
  (ADR-015 §3, `:54-59`).
- `POST /api/import` — full ingest: page + attachment + provenance in one operation.

Neither consumer reimplements detection, storage, or conversion. This is how AGENTS.md §4's
"no parallel import paths" is satisfied without changing what a document card looks like or
does.

**Built.** `src/server/ingest/ingest-file.ts` implements this; the two consumers are
`src/server/routes/import.ts` and `src/server/attachments/attachment-routes.ts`.

### 2. Structured conversion through the library, not a handwritten walker

For formats with a real container, conversion uses officeparser's AST through the library's own
`ast.to('md')` call. RTWiki does **not** write its own AST walker: a handwritten walker would be
a second parser to keep in step with the dependency, and would drift silently on a version
bump. The Markdown that comes back is fed into RTWiki's existing micromark-based Markdown
rendering path (`src/web/features/markdown/markdown-render.ts`), so structured documents land in
the same pipeline as text the product already handles.

Signature-less formats (TXT, MD, HTML, CSV) have no AST at all — that is the property that made
them signature-less in the first place (ADR-015:14). They use their raw, unflattened text
directly. There is no structure to preserve and no walker to run.

**Built.** `src/server/ingest/document-to-markdown.ts` calls `ast.to('md', ...)` with
`generateIds: false`. When the ingest core supplies an image URL resolver it also sets
`includeImages: 'image-only'` and an `onNode` callback that renders each image node as a link to
its stored attachment; without a resolver (a direct conversion unit test) images are omitted.

### 3. Embedded images are localized and stored

officeparser parses with `extractAttachments: true`, so `ast.attachments` carries the embedded
images as base64. `extractImages()` in `document-to-markdown.ts` reads that library-owned array —
no handwritten AST walk — validates each image against RTWiki's existing image allowlist, and
returns the bytes. The ingest core stores each image as an ordinary image attachment **inside the
same transaction** as the page, under an id generated before conversion, and the Markdown
generator's `onNode` callback renders `![alt](/api/attachments/:id)`. A failed image write rolls
back the page, so a note can never link to a missing attachment.

Images that cannot be brought across — an unsupported type such as SVG, undecodable data, or a
library-reported extraction failure — are counted and surfaced as an `images_not_imported`
warning. The warning is load-bearing: AGENTS.md §4 forbids silently losing content, so a skipped
image is always reported rather than quietly dropped. The client shows every import warning as a
Mantine notification (`App.tsx`), so the warning reaches the user rather than stopping at the API.

**Built.** `extractImages`, the `onNode` URL rewrite, transactional image storage, and UI warning
surfacing are all implemented and covered by unit and compiled-E2E tests.

### 4. Provenance lives in its own table

Import provenance is stored in a separate `import_sources` table, with **no foreign key** to
`pages`. The snapshot survives deletion of the page it describes. It is deliberately not a set
of columns on `pages`: a page can be re-imported, duplicated, or deleted, and provenance
describes the import event rather than the page. Attaching it to the page would either lose it
on delete or force it to be copied on duplicate, both of which are wrong.

**Built.** Migration `013_create_import_sources` creates the table;
`src/server/ingest/provenance-repository.ts` writes and reads it.

### 5. One transaction for page + attachment + provenance

`createPage` (`src/server/services/page-service.ts:195-205`) owns its own
`BEGIN IMMEDIATE` / `COMMIT` (`:197-200`). It is split into a transaction-less `createPageCore`
(`:171`) plus a wrapper: the wrapper preserves today's behaviour for existing callers, while the
ingest path opens a single transaction that covers the page write, the attachment write, and the
provenance row together. A partial import — a page with no attachment, or an attachment with no
provenance — must not be observable after a crash.

**Built.** `ingestFile` opens one `BEGIN IMMEDIATE` covering all three writes
(`src/server/ingest/ingest-file.ts:154-194`).

## What this supersedes, precisely

| Earlier claim | Status now |
|---------------|-----------|
| ADR-020 §5 item 6, "DOCX editable conversion is not implemented and is not implied" (`:104-106`) | **Superseded for the ingest path.** A DOCX imported through `POST /api/import` is converted into editable Markdown content. ADR-020 is unchanged everywhere else |
| `src/shared/import/conversion.ts:49-56`, "Why only Markdown exists" | **Superseded.** The conversion boundary gains a structured officeparser path alongside Markdown. The module itself is not rewritten by this ADR; Stage 1 authorizes that change |

## What this is NOT — the full ADR-006 pipeline is still unbuilt

[ADR-006](ADR-006-rich-content-and-import-contract.md) defines an eight-stage pipeline
(ADR-006:48):

```text
adapter → validation → sanitize → asset localization → convert → preview → canonical JSON → transactional save
```

**That pipeline is still NOT built, and this ADR does not build it.** It is a foundation: one
ingest module, one structured converter, one provenance table, and one transaction. In
particular:

- **Asset localization is explicitly out of scope** (§3 above), so stage 4 of the eight is
  deliberately skipped for now, with a warning instead of silent loss.
- **Preview and canonical-JSON stages are not added here.** The output of the structured
  converter goes into the existing Markdown rendering path; it does not become a new
  canonical-JSON stage.
- ADR-006 is **not superseded** by this ADR. It remains the authoritative record for the full
  pipeline, and a future ADR must change it before the pipeline can be claimed as built.

Also unchanged by this ADR: the document-block UX, the attachment serving model
([ADR-015](ADR-015-document-attachments.md), [ADR-023](ADR-023-signatureless-bytes-and-forced-download.md)),
the localhost-only binding, and the absence of a native wrapper, LAN mode, or AI dependency. No
new global request ceiling is introduced (AGENTS.md §9); existing per-route caps remain as they
are.

## Consequences

**Positive**

- One ingest function is the single place where detection, storage, conversion, and provenance
  happen, so the two HTTP consumers cannot drift apart.
- Structured documents become editable content rather than download-only attachments, without
  changing how an attached document card behaves.
- Provenance survives page deletion, and a failed import rolls back as a unit.
- Skipped images are reported, satisfying "never silently lose content".

**Negative / accepted costs**

- officeparser's AST API is a dependency surface. Using `ast.to('md')` rather than a handwritten
  walker keeps the surface small but does not remove it; a breaking library change still needs
  attention.
- Signature-less formats get no structural conversion at all — raw text is the honest ceiling
  for bytes with no self-describing format.
- The `import_sources` table grows without a foreign key and is never pruned by a page delete.
  That is the intended snapshot behaviour, not a leak to be "fixed" with a cascade.
- The foundation is shipped, but it is not the full ADR-006 pipeline: paste/API sources, the
  `.rtwiki.zip` note-package path, and preview remain unbuilt. Asset localization is built for
  embedded images (§3), but not for external image URLs referenced by a document.

## Alternatives considered

**A handwritten AST walker over officeparser's output.** Rejected: it becomes a second parser
that must track the library's node shapes, and a version bump would break it silently. The
library's own `ast.to('md')` is the single source of truth.

**Add provenance columns to `pages`.** Rejected: provenance describes an import event, not a
page. Columns would be lost on delete or duplicated on duplicate, and would couple the page
schema to import history.

**Let `createPage` keep its transaction and call it from ingest.** Rejected: nested transactions
would either fail or silently flatten, and the page could commit while the attachment or
provenance write failed. One transaction at the ingest boundary is the only shape that makes a
partial import unobservable.

**Silently skip images.** Rejected: AGENTS.md §4 requires surfacing warnings rather than
dropping content. Images that cannot be localized are now reported through `images_not_imported`
and shown in the UI; successfully extracted images are stored and linked rather than skipped.

## Owner decision: the full ADR-006 pipeline is deferred (2026-11-22)

The owner has decided **not** to build the full eight-stage ADR-006 pipeline now. Today's file
import already covers the formats in scope; the pipeline is only worth building when a genuinely
new content-entry type appears (paste, web pages, or AI output). The decisions, recorded here so a
future agent does not stop on the old "one pipeline" rule again:

- **Sanitize at display time.** Render-time DOMPurify remains the enforcement point; no new
  server-side sanitization stage or DOM-shim dependency is authorized.
- **Save in the editor's own format.** Canonical storage stays whatever the target editor uses —
  BlockNote JSON for rich pages, the Markdown envelope for Markdown pages. No new unified
  canonical-JSON stage is authorized.
- **No preview step.** Import stays one-shot; no upload → preview → confirm flow is authorized.
- **Deferred until a new import type is needed.** When that day comes, a new ADR must change
  ADR-006 first. Until then this ingest foundation is the accepted scope, and the eight-stage
  pipeline remains `Planned — not implemented` in the docs.

## Revisit conditions

- officeparser changes or removes `ast.to('md')`, or its AST becomes unstable across a pinned
  version bump.
- External image URLs (images a document references but does not embed) are not localized; if
  that becomes required, the `onNode` resolver must be extended to fetch and store them under
  RTWiki's network policy, with a security review.
- A third HTTP consumer needs ingest. It must call `ingestFile` rather than grow its own path;
  if it cannot, the "one pipeline" claim in this ADR is broken and must be re-examined.
- The full ADR-006 eight-stage pipeline is authorized. That requires a new ADR changing ADR-006
  first, as recorded above.
