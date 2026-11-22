# ADR-023: Signatureless Bytes Are Stored and Served as Forced Downloads

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-11-22 |
| **Supersedes** | [ADR-015](ADR-015-document-attachments.md) **§7 only**. No other section of ADR-015 is changed; §3 still governs the download route and [ADR-016](ADR-016-inline-document-viewing.md) still governs the view route |
| **Related** | [ADR-015](ADR-015-document-attachments.md), [ADR-016](ADR-016-inline-document-viewing.md), [ADR-024](ADR-024-one-ingest-pipeline-and-structured-import.md), [SECURITY.md](../SECURITY.md) |

## Context

ADR-015 §7 made a decision that was reasonable for the system as it then stood and is now
being reversed for a narrower case than it was written for. The section decided that
signature-less uploads (`.txt`, `.md`, `.html`, `.csv`) keep their extracted text but not
their bytes, because "serving it would mean serving bytes whose type was never established"
(ADR-015:92). Stated as the rule it enforced: **bytes whose type was never established must
not be served.**

That rule existed for two concrete reasons, both still visible in the code:

- Migration `011_signatureless_attachment_bytes` (`src/server/database/migrations.ts:278-364`)
  made `data` nullable and added `bytes_stored` so a row with no bytes could say so itself
  rather than looking like a half-finished ADR-014 migration (`:299-308`). The copy uses
  `CASE WHEN data IS NULL THEN 0 ELSE 1 END` (`:346-351`).
- `insertAttachment` derives `bytesStored` from `data === null`
  (`src/server/attachments/attachment-repository.ts:88-103`), and the `/view` route still refuses
  a signature-less document with 404 (`src/server/attachments/attachment-routes.ts:340`) via
  `isServableDocument` (`:443-446`). The download route once did too; it no longer does.

The premise has changed. The import foundation in [ADR-024](ADR-024-one-ingest-pipeline-and-structured-import.md)
needs the original bytes of a signature-less file to be present so they can be stored as an
attachment alongside the converted page. The question is therefore no longer "may bytes with
no established type be kept at all", but "does serving such bytes as a forced download carry
a risk different from serving every other document". It does not.

## Decision

Signature-less files imported through the new ingest path keep their bytes, and those bytes
are served from `GET /api/attachments/:id` under exactly the same controls as every other
document. ADR-015 §7 is superseded **to that extent and no further**.

### The accepted counter-argument

ADR-015 §3 already decided that *every* served document is a program and is protected twice:
`Content-Disposition: attachment` plus a per-response `default-src 'none'; sandbox` policy
(ADR-015:36-52). ADR-016 §5 reaffirmed the priority — the disposition is the control, the CSP
is defence in depth (ADR-016:83-100). A signature-less file served this way is in the identical
risk profile to a PDF or DOCX served the same way.

The decisive observation is what the type is used for. It is used **only to name the download**,
never to decide whether to render:

- `contentDisposition('attachment', record.originalName, acceptedDocumentFormatFor(record.mimeType)?.ext ?? 'bin')`
  at `src/server/attachments/attachment-routes.ts:295-299`; the function itself is at
  `src/server/attachments/content-disposition.ts:102-110`. The recorded MIME contributes one
  thing — a filename extension.
- Nothing in the download handler branches on the type to choose a rendering path. The bytes
  go into a `ReadableStream` and a `Response` (`:306`).

So the original security reason is already satisfied by controls that predate this decision.
What remains of ADR-015 §7 is a statement about usefulness — "there is nothing meaningful to
serve" — and that is no longer true once the bytes are retained. The rule is reversed for
newly imported files only; see *The asymmetry* below.

### The controls that remain, verified in code

Each of these was checked against the source, not assumed from the prose of ADR-015:

1. **`Content-Disposition: attachment`.** Built at
   `src/server/attachments/content-disposition.ts:102-110` and set on the download response at
   `src/server/attachments/attachment-routes.ts:295-299`. The browser saves rather than renders.
2. **CSP `default-src 'none'; sandbox`.** The constant is
   `src/server/attachments/content-disposition.ts:13`. The route requests it through
   `DOCUMENT_CSP_KEY` (`attachment-routes.ts:303`), and the middleware at `src/server/app.ts:137-141`
   applies it. That middleware is registered **before** the app-wide `securityHeaders` at
   `app.ts:145`, which is the ordering that lets the stricter policy survive `secureHeaders`
   overwriting headers after `await next()`. The failure mode this ordering prevents was silent
   in unit tests and is recorded at ADR-015:48.
3. **`X-Content-Type-Options: nosniff`.** `src/server/attachments/attachment-routes.ts:281`.
4. **`Cache-Control: private, no-cache`.** `src/server/attachments/attachment-routes.ts:284`.
5. **Recorded MIME from the allowlist, not the request header.** The only type written to a
   response is the stored `record.mimeType` (`attachment-routes.ts:279`, `:352`); the comment
   at `:347-350` states explicitly that nothing in the handler reads a client-supplied type.
   That stored type was established from the bytes at upload by the one ingest pipeline
   (`src/server/ingest/detect-upload.ts`), with the reported type consulted only where the bytes
   cannot speak for themselves.
6. **RFC 5987 filename encoding.** `src/server/attachments/content-disposition.ts:140-153`,
   with the conservative ASCII fallback at `:119-132` and the directory-stripping base name at
   `:162-171`. A name cannot terminate the header.
7. **Id-addressed only.** `src/server/attachments/attachment-routes.ts:143-147` documents why;
   `:268-271` looks the attachment up by opaque id. There is no path and therefore no traversal
   surface.
8. **Streamed bytes.** `src/server/attachments/attachment-repository.ts:164-186`, in 512 KB
   chunks (`:150`), so an in-flight response holds one chunk rather than the whole file.

### Residual risks, stated plainly

Mirroring the honesty of ADR-016:102-124:

- **A browser that ignores `Content-Disposition` still cannot execute script.** `sandbox` and
   `default-src 'none'` deny script and every fetch directive
   (`content-disposition.ts:4-7,13`). This is defence in depth, not the primary control — the
   disposition is (ADR-016:83-100).
- **A native renderer memory-safety bug remains possible.** A CSP cannot undo native memory
   corruption (ADR-016:107-111). For a forced download this additionally requires the user to
   open the saved file, which is the same exposure as opening any file from disk.
- **The recorded MIME is still a claim about bytes with no self-describing signature.** What
   changed is not that the claim became more trustworthy, but that the claim is now used only
   to name a download. A mislabelled signature-less file is saved under the name the allowlist
   gave it; RTWiki never renders it.

### The `/view` route deliberately continues to 404

`GET /api/attachments/:id/view` still refuses signature-less bytes
(`src/server/attachments/attachment-routes.ts:340`, via `isServableDocument` at `:443-446`).
This is defence in depth: even if a future change weakened the download disposition, there is
no inline path for these bytes. ADR-016 is not superseded by this decision.

### The asymmetry: this is not retroactive

Rows already written as signature-less under the old code have `data = NULL` and
`bytes_stored = 0` (`attachment-repository.ts:88-103`; migration 011's
`CASE WHEN data IS NULL THEN 0 ELSE 1` at `migrations.ts:346-351`). Their bytes were
discarded at upload time and **cannot be reconstructed**. Those rows keep 404ing on both
routes. No backfill is attempted, because none is possible.

Only signature-less files imported **after** the ingest pipeline lands get stored bytes. The
honest consequence is that two attachments with the same MIME can behave differently depending
on when they were created: an old one 404s, a new one downloads. That is accepted rather than
papered over with a migration that would have nothing to copy from.

### Backup implications

`countAttachmentsAwaitingBytes` (`src/server/backup/validation.ts:245-262`) flags
`data IS NULL AND bytes_stored = 1` on post-011 schemas (`:246-247`), falling back to the broader
`data IS NULL` on pre-011 schemas where the column does not exist (`:248-250`).

- New signature-less rows carry bytes and `bytes_stored = 1` → **not flagged**.
- Legacy signature-less rows have `data = NULL` and `bytes_stored = 0` → **not flagged**.
- The mid-migration guard is **not weakened**. A row with `data IS NULL AND bytes_stored = 1`
  still means "bytes were never migrated" and still refuses backup. The new rows are
  distinguishable precisely because they carry bytes, which is the distinction `bytes_stored`
  was introduced to preserve (`migrations.ts:295-304`).

## Security review gate (blocking)

This checklist was **prepared evidence for the owner/reviewer**, not a sign-off. The
compiled-executable checks below are now implemented in `scripts/verify-compiled-e2e.ts`
(73 checks pass); the browser-execution item remains a manual observation and is not claimed
as verified.

- [x] A `.html` file containing `<script>` uploaded via `POST /api/attachments` and fetched
      from `GET /api/attachments/:id` returns attachment disposition + CSP + `nosniff`.
      Covered end-to-end by `scripts/verify-compiled-e2e.ts`.
- [x] The per-response CSP reaches the client with the app-wide middleware mounted. The
      failure mode at ADR-015:48 was invisible to unit tests, so this is checked against the
      shipped executable, not a route-level unit test.
- [x] `GET /:id/view` still returns 404 for the same `.html` attachment.
- [x] A PDF renamed `.txt` is still stored and served as PDF (type comes from the bytes).
- [x] `source.kind: 'paste'` and `source.kind: 'api'` are rejected **before bytes are read**
      (`tests/import-api.test.ts`).
- [x] No new global request ceiling is invented (AGENTS.md §9). Existing per-route caps stay
      as they are; a deleted or per-route limit is not a global backstop.
- [ ] The `.html` download does **not** execute the script in a real browser. Header checks
      cannot establish this; it remains a manual observation.
- [ ] No private content is logged.

## Consequences

**Positive**

- The import foundation can retain the original bytes of a signature-less file, so an imported
  document is downloadable as well as searchable.
- The security posture of the download route is unchanged: same disposition, same CSP, same
  `nosniff`, same id addressing, same streaming.
- The backup mid-migration guard keeps working without modification.

**Negative / accepted costs**

- Two attachments with the same signature-less MIME can behave differently by creation date
  (see *The asymmetry*). This is visible to users and is not hidden.
- Storing bytes that were previously discarded increases row and backup size for newly
  imported signature-less files. This is the cost of making them downloadable.
- The recorded MIME remains an unproven claim; the decision relies on the disposition, not on
  the claim, to keep it harmless.

## Alternatives considered

**Keep ADR-015 §7 and convert signature-less text without storing bytes.** Rejected: it would
leave imported text files undownloadable and would force the ingest path to have a second,
parallel storage rule — exactly the kind of divergence AGENTS.md §4 forbids.

**Serve signature-less bytes inline under a narrower CSP.** Rejected: it would create a second
serving policy for one class of document and make the type — the very thing that was never
established — load-bearing for a rendering decision.

**Backfill legacy rows.** Rejected as impossible. Their bytes were never stored; there is
nothing to copy from. A migration would fabricate data or leave the rows in a worse state.

## Revisit conditions

- A browser ships that renders `Content-Disposition: attachment` responses inline in a way the
  sandbox and `default-src 'none'` do not contain.
- The download route gains a rendering branch keyed on MIME type. That would make the
  unestablished type load-bearing and would invalidate the central argument of this ADR.
- A real backfill source for legacy signature-less bytes is discovered.
