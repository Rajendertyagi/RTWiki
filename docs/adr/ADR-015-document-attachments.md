# ADR-015: Document Attachments — Forced Download and Extracted Text

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:** Nothing
- **Related:** [ADR-013](ADR-013-image-attachments.md) (image validation and serving), [ADR-014](ADR-014-blob-stored-image-bytes.md) (bytes in the database), [SECURITY.md](../SECURITY.md)

## Context

R-024 and AC-030/AC-031 commit RTWiki to attaching "images, PDFs, and documents", and AC-031 names DOCX, ODT, TXT and MD. Until now only images existed.

A document is not an image. An image is bytes the browser draws; a document is a program. A PDF can carry JavaScript, an office file can carry macros, and served inline either executes in RTWiki's own origin. ADR-013 already reached this conclusion for SVG and refused it; a document is a strictly larger version of the same problem, and refusing it outright would defeat a committed requirement.

There is a second problem, which the reference implementation documents plainly. `.txt`, `.md`, `.html` and `.csv` have **no signature at all**. Verified here: `officeparser` refuses all four with *"Auto-detection of file type from buffer failed"*, and no library can do better, because there is nothing in the bytes that says "this is Markdown". Any design has to answer that, not route around it.

## Decision

### 1. Documents live in the same table as images

No new storage, no new endpoint, no new backup path. `attachments` gains two columns: `kind` (`image` or `document`) and `extracted_text`. Everything else — the blob, the streaming, the checksum, the atomic single-statement write — is shared with images and inherited from ADR-014.

This is the direct answer to where documents are kept: **in the database, beside the images, because the machinery that made images durable already exists.**

### 2. The type comes from the bytes, and the reported type is consulted last

The obvious implementation checks the reported type first, falls back to the parser, and treats a parse failure as "not a document". That ordering is a vulnerability, and a test in this repository caught it during development: a PDF renamed to `.txt` was accepted as text and had its contents read as the note's prose. A DOCX renamed `.html` would have had its OOXML markup read as HTML.

The order is therefore inverted:

1. The container is identified **from the bytes**, by `file-type`.
2. If it is a recognised document container, it is stored as that document.
3. Only if the bytes are **not** a recognisable container may the reported type be consulted — and then only for a type the allowlist itself marks `signatureless`.

The bytes always outrank the claim. That is the same rule ADR-013 established for images, applied to the case where following it naively would have been actively wrong.

### 3. A document is never served inline, and is protected twice

Every document response carries:

- `Content-Disposition: attachment` — the browser saves it rather than rendering it.
- `Content-Security-Policy: default-src 'none'; sandbox` — if a browser rendered it anyway, nothing in it could execute or load anything.
- `X-Content-Type-Options: nosniff` — the stored type cannot be second-guessed.

**Both layers are required.** The disposition is the one that works; the policy is the one that holds if the first is ever worked around. Serving only one of them would be a single point of failure.

The policy is deliberately stricter than the app-wide one, which permits `script-src 'self'` because the application itself is a scripted page. A document is not the application and must not inherit its permissions.

**Getting the per-response policy to actually reach the client took two attempts, and the failure was silent.** `secureHeaders` sets its headers *after* `await next()`, so it overwrites anything a handler writes. The first attempt put the override middleware in the wrong order and the document's `default-src 'none'` was replaced by the app-wide policy — with `script-src 'self'` — on every PDF and DOCX response, while every unit test passed. Only an end-to-end test against the shipped executable caught it, because in unit tests the route is mounted on its own Hono instance and the app-wide middleware does not exist. The ordering that works was established by measuring four arrangements rather than by reading middleware source, and is now asserted by a test that mounts both.

This is deliberately stricter than the reference implementation, which serves PDFs on its `/open` route with **no `Content-Disposition` and no CSP at all** — its own tests assert the header is absent. Its SVG path is hardened; its PDF path is not.

Images are unaffected and remain served inline, because an image is not a program.

**The editor card carries no link, and that is part of this decision.** A document is inserted as
BlockNote's built-in `file` block, which renders the file's name inside a `div` — not an anchor. So
there is no route from a note to an inline render, and the forced download is not merely the default
that a future change could quietly reverse. A browser test asserts the card contains no `a`, `iframe`,
`embed` or `object`, because BlockNote owns the card's internals and an upgrade could turn it into a
link without anything in this repository changing.

**Viewing was requested and is now built**, on a separate route, by owner decision on 2026-09-27.
See [ADR-016](ADR-016-inline-document-viewing.md), which supersedes this section. In short: this rule
still governs `GET /api/attachments/:id`, which remains a forced download; `GET
/api/attachments/:id/view` serves the same bytes inline behind its own policy, and the default was
never relaxed.

The reasoning below is not withdrawn. It is why the two routes are separate, why the download route
keeps `sandbox`, and why the card is not a link that renders anything on its own.

### 4. The parser is given the format as a hint, and this is not an optimisation

`officeparser` is pinned at **8.9.0** (the latest release at the time of writing) and is asked to parse with an explicit `fileType` hint, taken from RTWiki's own `file-type` detection.

This is load-bearing. The parser's internal auto-detection **fails inside the compiled `RTWiki.exe`**: the copy of `file-type` inside it cannot run there, and the failure is reported as *"auto-detection of file type from buffer failed"* — indistinguishable from "not a document". Left alone, **every document would be silently refused in the shipped build while working perfectly in development.** The same class of problem ruled out `sharp` (ADR-014) and is why `bun run test:compiled-images` exists at all.

`file-type` is already a dependency, is already trusted for images, and is verified to work in the compiled build. The hint can only name a format the allowlist has already agreed to, so it cannot introduce anything new. For formats with no magic number of their own (LaTeX) or whose container `file-type` reports only as a bare `zip` (the macro-enabled and template OOXML variants), the hint comes from the reported media type instead — gated so a binary renamed to `.tex` is not decoded as LaTeX.

The parser emits two harmless warnings in the compiled build — it cannot load the optional native `@napi-rs/canvas`, and cannot polyfill `Path2D`. Both affect **rendering**, which RTWiki does not do. Text extraction is unaffected and was re-verified in the executable with 8.9.0 across the full format set (see "Verifying the shipped build" below).

### 5. One library, not two

`unpdf` was evaluated and **rejected on measurement**: it parsed a PDF exactly once per process, and every subsequent call failed with `DataCloneError` from a pdf.js worker's `postMessage`. A second PDF import would have failed in production while the first succeeded. `officeparser` 8.9.0 parses PDFs reliably and repeatedly, which is why one library covers everything.

### 6. The download filename is encoded, not sanitised

`Content-Disposition` carries a user-supplied name, so the name reaches a response header. The value is emitted through RFC 5987 (`filename*=UTF-8''…`) with anything that could terminate a header percent-encoded, plus a conservative ASCII fallback.

A filename *sanitiser* is the wrong tool here, and was measured: `sanitize-filename` removes control characters but **leaves U+202E (RIGHT-TO-LEFT OVERRIDE) in place**, so a name can still be displayed reversed. Encoding sidesteps the class, because a percent-encoded string cannot contain a character that ends a header. Tests cover CRLF injection, quote-breaking, path traversal, an empty name, a name that is only dots, and a non-ASCII name.

### 7. A signature-less upload is stored as text, and is not served back

`.txt`, `.md`, `.html` and `.csv` are accepted: their text is extracted and stored in `extracted_text`, and appended to the owning page's `search_index` row so the file is findable by what is inside it. CSV takes this path through RTWiki's own text reader, not through `officeparser` — it is a text file with no magic bytes, and the parser cannot establish a type for it. Their bytes are neither offered for download nor kept: a `GET` of such an attachment answers 404, because there is nothing meaningful to serve and serving it would mean serving bytes whose type was never established. Storing bytes nothing can retrieve only duplicated unreachable content into every backup, so the row records their absence explicitly (`bytes_stored = 0`).

This matches the reference implementation, which converts text to HTML on import and never stores it as a servable file. The `signatureless` flag in the allowlist makes the distinction explicit rather than implicit, and a test asserts no signature-less type is ever in the served set.

**Plain `.zip` archives and Overleaf projects are not supported.** A ZIP that is not one of the recognised document containers is refused as `extract_failed` ("could not be opened"), not silently unpacked. There is no archive-import path and no Overleaf integration; tabular data should arrive as `.ods` or `.xlsx`, and `.tsv` remains deliberately unsupported.

### 8. Every parse carries RTWiki's own resource ceilings

`officeparser` ships default decompression ceilings, and RTWiki now passes its own rather than inheriting them: `DOCUMENT_MAX_UNCOMPRESSED_BYTES` (512 MB uncompressed), `DOCUMENT_MAX_ZIP_ENTRIES` (10 000) and `DOCUMENT_MAX_TABLE_CELLS` (1 000 000). The values match the library defaults deliberately — what changes is that they are RTWiki's, recorded in configuration and in SECURITY.md §3, so the guard cannot move silently when the dependency's does.

This is a real control rather than a restatement of the upload size limit. `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` bounds what arrives; it does not bound what a compressed archive asks the parser to expand it into, and the classic crossing of that gap — a repeated byte run — costs almost nothing to store. The table-cell ceiling is a genuinely separate guard, because ODF encodes cell repeats in the XML and expands them while building the AST, after both the byte and entry ceilings have already been satisfied.

A container recognised and then refused is reported as `extract_failed`, not `unsupported_type`. The distinction matters to a user in the only way that matters: telling someone their valid DOCX is a file type this application does not accept is a claim they can do nothing about. Whether the refusal was a tripped ceiling or a damaged archive is retained on the rejection as a diagnostic and logged, never shown — both are fixed by opening the file and saving a fresh copy.

Separate from these decompression ceilings is a wall-clock backstop, `DOCUMENT_PARSE_TIMEOUT_MS` (30 s), described in §10. It is not a decompression ceiling and, importantly, **not a hard execution-time limit**.

### 9. A document outlives the note that referenced it

Pages are soft-deleted and attachments have no page foreign key, so deleting a note does not delete its documents. This is a deliberate policy, matching the existing attachment behaviour and the reference implementation: an attachment may be uploaded before it is referenced, and a note may be deleted while its document is still wanted. A cascade would destroy documents still in use elsewhere.

The cost is the same one already recorded for images: nothing reclaims an unreferenced document automatically. That remains a retention decision, not a defect.

### 10. PDF parsing runs in-process, behind a wall-clock backstop that is not a hard limit

`officeparser`'s default `pdfParserConfig.separateProcess: true` never completes its child-process handshake under Bun, so a PDF parse hangs forever. Every parse therefore pins `pdfParserConfig: { separateProcess: false }`, running pdf.js in the host process. A source-level test asserts the literal `separateProcess: false` so a dependency upgrade cannot silently restore the default and reintroduce the hang.

Because pdf.js now runs in-process, the library's own PDF time limit — which applies only in separate-process mode — is unavailable. `DOCUMENT_PARSE_TIMEOUT_MS` (30 s) is an `AbortController` timer passed to every `parseOffice` call as a backstop. It ends work that yields to the event loop (worker startup, OCR, an already-expired deadline), and an `AbortError` is mapped to a `timeout` refusal detail rather than being reported as a malformed file.

**This is deliberately not described as a hard limit.** A CPU-bound synchronous parse blocks the event loop, so the timer cannot fire until the work ends. A characterization test proves this honestly: a PDF with 100 000 text-show operators parses to completion even with a 50 ms deadline. Cutting such a parse short would require a worker or child process — exactly what Bun cannot do here. The guard is a backstop for cooperative work, not an execution-time ceiling.

### 11. Password-protected and legacy Office files get their own messages

An OLE/CFB container is ambiguous: it is either an old binary Office file (`.doc`, `.xls`, `.ppt`) or a *modern* Office file (`.docx`, `.xlsx`, `.pptx`) locked with a password. `file-type` reports `cfb` for both, so the bytes alone cannot tell them apart. `officeparser` can: it recognises the encryption streams and refuses with `PASSWORD_REQUIRED` / `PASSWORD_INCORRECT` before doing any decryption work, while a legacy binary is refused as an unsupported `cfb` type. RTWiki asks it before choosing the user-facing message:

- **Password-protected** → *"This file is password-protected. Remove the password and try again."*
- **Legacy binary** → *"Save as .docx, .xlsx or .pptx and try again."*

Both are 415 refusals. Telling an encrypted `.docx` user to "save as .docx" would be wrong — the file already is one — which is why the two cases are separated rather than collapsed into a generic "unsupported type".

### 12. A large document is warned about, not refused

`PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` is the hard upload ceiling, enforced by Hono's `bodyLimit` before the body is buffered. It was raised from 50 MB to **100 MB**. A separate, advisory threshold `DOCUMENT_SIZE_WARNING_BYTES` (**50 MB**) flags a document that is accepted but may be slow to open and search. Because the warning sits below the ceiling, it is observable for documents between 50 MB and 100 MB: they pass the body limit, are stored and indexed, and carry a non-blocking `document_size_warning` in the response that the client shows as a notification. The warning never rejects an upload.

## Consequences

**Positive**

- R-024 and AC-030/AC-031 are satisfied, and the accepted set is now wider: **PDF**; **DOCX, DOCM, DOTX, DOTM**; **PPTX, PPTM, POTX, POTM, PPSX, PPSM**; **XLSX, XLSM, XLTX, XLTM**; **ODT, ODP, ODS, ODG**; **RTF, EPUB**; **TeX**; and the signature-less text formats **TXT, MD, HTML, CSV**. The 11 macro/template variants are packaged like their base documents and are read through the base parser (their macros are not executed). Plain ZIP archives and Overleaf projects are not supported.
- **A document's text is searchable.** For a study tool this is most of the value: a PDF you imported becomes findable by what is in it. The text is appended to the **owning page's** `search_index` row, not given an index of its own, so a note with both prose and an attached PDF appears once in results and is found by words from either.
- No new storage, endpoint, or backup path. One table, one upload route, one streaming path.
- A renamed document cannot be downgraded to text, and a mislabelled upload is stored as what it actually is.
- The download name cannot terminate a response header, and cannot be used to reverse how it displays.
- One new dependency, `officeparser` pinned at 8.9.0, verified to work in the shipped executable across the full format set. Its optional native `@napi-rs/canvas` dependency is not used for text extraction.

**Negative / accepted costs**

- **There is no in-app renderer.** A document downloads by default; [ADR-016](ADR-016-inline-document-viewing.md) later added a separate View route that lets the browser draw the document in a new tab. That is browser rendering, not an embedded preview, and it did not relax the download route.
- **Scanned PDFs yield no text.** A PDF that is an image of a page has no text layer and no OCR, so it is stored and downloadable but not searchable. Reported as an empty extraction rather than a failure, because a structurally valid document with no text is a normal thing to upload.
- **Legacy binary formats are not supported.** `.doc`, `.xls` and `.ppt` are OLE compound files that this parser does not handle; they are refused with an actionable "Save as .docx, .xlsx or .pptx and try again." message (§11). AC-031 names DOCX and ODT, not DOC.
- **Extraction is synchronous with the upload.** A document is parsed before the response is sent, so a large PDF takes measurably longer to upload than an image of the same size. The 30 s guard (§10) is a backstop for cooperative work, not a hard limit on a CPU-bound parse. Accepted: the alternative is background work with a write ledger, which is a larger design than the requirement warrants.
- The `kind` column is stored *and* derivable from the MIME type. It is stored so a listing need not re-derive, and it is not the authority — ADR-013's rule still holds, that the recorded MIME comes from the bytes.

**Neutral**

- No native code is required for text extraction. `officeparser` pulls `@napi-rs/canvas` as an *optional* dependency, unused here.
- The hard attachment ceiling is now **100 MB** (raised from 50 MB), with a separate **50 MB** advisory document warning (§12). The 50 MP image ceiling is unchanged. A document is bounded by bytes only; it has no pixel dimension, so the pixel rule never applies to it.

## Alternatives considered

**Serve documents inline, as the reference implementation does.** Rejected: a PDF with embedded JavaScript, opened in the application's origin, executes there. Its `/open` route carries no `Content-Disposition` and no CSP.

**Use `unpdf` for PDFs and `officeparser` for the rest.** Rejected on measurement: `unpdf` parses one PDF per process and then fails on every later call with `DataCloneError`. Two libraries would also mean two format tables to keep in step.

**Detect documents by the reported type, falling back to the parser.** Rejected: a test demonstrated it accepts a PDF renamed `.txt` and reads its contents as note text. Type confusion is not a theoretical concern here; it was reproduced.

**Use a filename sanitiser for `Content-Disposition`.** Rejected: measured to leave U+202E in place, and it is the wrong shape of tool for a header. Encoding is correct by construction.

**Refuse TXT and MD as undetectable.** Rejected: AC-031 requires them, and the requirement is satisfiable — convert the text on import and never serve the file. Refusing would satisfy the letter of "detect the type" by refusing the format.

**Inline preview in a sandboxed iframe.** Not rejected — deferred. It is the natural next step and would reuse ADR-007's sandbox, but it is a distinct decision with its own threat model, and building it now would mean shipping a preview that has never been reviewed as one.

## What was measured, and how

Every claim here was produced on the development machine against this schema, Bun 1.4.2, SQLite 3.53.2. The figures that shaped the decision:

| Measurement | Result |
|---|---|
| `officeparser` 8.9.0 on a real DOCX (built as a genuine ZIP) | text, Markdown and HTML all correct |
| `officeparser` 8.9.0 on a real PDF, repeated 4× | 4/4 correct |
| `unpdf` on a real PDF, repeated 6× | 1 correct, then `DataCloneError` on all others |
| `officeparser` on TXT / MD / HTML / CSV | all refused: no magic bytes. CSV is accepted through RTWiki's own text reader instead |
| Parser auto-detection inside `RTWiki.exe` | **fails**; with an explicit `fileType` hint, succeeds 3/3 |
| Default `pdfParserConfig.separateProcess: true` under Bun | child-process handshake never completes; `separateProcess: false` parses in well under 2 s |
| A 100 000-operator PDF with a 50 ms deadline | parses to completion — the 30 s guard is **not** a hard execution-time limit |
| `sanitize-filename` on `report.pdf\r\nX-Injected: pwned` | CRLF removed, but **U+202E preserved** |
| A `File` built from text | reports `text/plain;charset=utf-8`, which matches no exact allowlist entry |
| A PDF renamed `.txt`, through the endpoint | accepted as text — **the bug this ordering exists to prevent** |
| A PDF's `Content-Security-Policy` with the app-wide middleware mounted | app-wide policy won, `script-src 'self'` included — **unit tests could not see this** |
| Document policy under the correct middleware order | `default-src 'none'; sandbox` reaches the client |

## Verifying the shipped build

Two checks exist because two defects were invisible to the unit suite:

- `bun run test:compiled-images` — compiles a probe to a standalone executable and runs it. Document parsing fails *only* inside the compiled binary, so this is the check that catches it.
- `bun run scripts/verify-compiled-e2e.ts` — starts the built `RTWiki.exe` and drives it over HTTP as a browser would: uploads a real PDF, DOCX and PNG, then asserts the disposition, the policy, byte integrity, the type-confusion case and the extracted text. This is what found the policy being overwritten.

The end-to-end script passes `--no-open`, because the application otherwise opens a browser tab on the user's screen on every run, and it stops the server on every exit path including a thrown assertion.

**Re-verified against the built executable with `officeparser` 8.9.0 (2026-11-21).** Beyond the scripted checks above, real files were uploaded through the compiled `RTWiki.exe` and produced the expected results: PDF, ODG, CSV, TeX, DOCM, XLSM, a legacy `.doc` (save-as message), a password-protected `.docx` (password message), and a 60 MB document (accepted with the advisory size warning). This confirms the in-process PDF mode, the expanded format list, the two distinct refusal messages and the warning behaviour in the shipped build, not just in development.
