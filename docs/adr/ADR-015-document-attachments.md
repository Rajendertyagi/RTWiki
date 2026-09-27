# ADR-015: Document Attachments — Forced Download and Extracted Text

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:** Nothing
- **Related:** [ADR-013](ADR-013-image-attachments.md) (image validation and serving), [ADR-014](ADR-014-blob-stored-image-bytes.md) (bytes in the database), [SECURITY.md](../SECURITY.md)

## Context

R-024 and AC-030/AC-031 commit RTWiki to attaching "images, PDFs, and documents", and AC-031 names DOCX, ODT, TXT and MD. Until now only images existed, and [KNOWN_BUGS.md](../KNOWN_BUGS.md) §7 records that as a gap.

A document is not an image. An image is bytes the browser draws; a document is a program. A PDF can carry JavaScript, an office file can carry macros, and served inline either executes in RTWiki's own origin. ADR-013 already reached this conclusion for SVG and refused it; a document is a strictly larger version of the same problem, and refusing it outright would defeat a committed requirement.

There is a second problem, which the reference implementation documents plainly. `.txt`, `.md` and `.html` have **no signature at all**. Verified here: `officeparser` refuses all three with *"Auto-detection of file type from buffer failed"*, and no library can do better, because there is nothing in the bytes that says "this is Markdown". Any design has to answer that, not route around it.

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

This is deliberately stricter than the reference implementation, which serves PDFs on its `/open` route with **no `Content-Disposition` and no CSP at all** — its own tests assert the header is absent. Its SVG path is hardened; its PDF path is not.

Images are unaffected and remain served inline, because an image is not a program.

### 4. The parser is given the format as a hint, and this is not an optimisation

`officeparser` is asked to parse with an explicit `fileType` hint, taken from RTWiki's own `file-type` detection.

This is load-bearing. The parser's internal auto-detection **fails inside the compiled `RTWiki.exe`**: the copy of `file-type` inside it cannot run there, and the failure is reported as *"auto-detection of file type from buffer failed"* — indistinguishable from "not a document". Left alone, **every document would be silently refused in the shipped build while working perfectly in development.** The same class of problem ruled out `sharp` (ADR-014) and is why `bun run test:compiled-images` exists at all.

`file-type` is already a dependency, is already trusted for images, and is verified to work in the compiled build. The hint can only name a format the allowlist has already agreed to, so it cannot introduce anything new.

The parser emits two harmless warnings in the compiled build — it cannot load the optional native `@napi-rs/canvas`, and cannot polyfill `Path2D`. Both affect **rendering**, which RTWiki does not do. Text extraction is unaffected and is verified in the executable, three parses in a row.

### 5. One library, not two

`unpdf` was evaluated and **rejected on measurement**: it parsed a PDF exactly once per process, and every subsequent call failed with `DataCloneError` from a pdf.js worker's `postMessage`. A second PDF import would have failed in production while the first succeeded. `officeparser` parses PDFs reliably and repeatedly, which is why one library covers everything.

### 6. The download filename is encoded, not sanitised

`Content-Disposition` carries a user-supplied name, so the name reaches a response header. The value is emitted through RFC 5987 (`filename*=UTF-8''…`) with anything that could terminate a header percent-encoded, plus a conservative ASCII fallback.

A filename *sanitiser* is the wrong tool here, and was measured: `sanitize-filename` removes control characters but **leaves U+202E (RIGHT-TO-LEFT OVERRIDE) in place**, so a name can still be displayed reversed. Encoding sidesteps the class, because a percent-encoded string cannot contain a character that ends a header. Tests cover CRLF injection, quote-breaking, path traversal, an empty name, a name that is only dots, and a non-ASCII name.

### 7. A signature-less upload is stored as text, and is not served back

`.txt`, `.md` and `.html` are accepted: their text is extracted and stored in `extracted_text`, making them searchable. Their bytes are **not** offered for download, because a `GET` of such an attachment answers 404 — there is nothing meaningful to serve, and serving it would mean serving bytes whose type was never established.

This matches the reference implementation, which converts text to HTML on import and never stores it as a servable file. The `signatureless` flag in the allowlist makes the distinction explicit rather than implicit, and a test asserts no signature-less type is ever in the served set.

### 8. A document outlives the note that referenced it

Pages are soft-deleted and attachments have no page foreign key, so deleting a note does not delete its documents. This is a deliberate policy, matching the existing attachment behaviour and the reference implementation: an attachment may be uploaded before it is referenced, and a note may be deleted while its document is still wanted. A cascade would destroy documents still in use elsewhere.

The cost is the same one already recorded in KNOWN_BUGS §6: nothing reclaims an unreferenced document automatically. That remains a retention decision, not a defect.

## Consequences

**Positive**

- R-024 and AC-030/AC-031 are satisfied: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF, EPUB, TXT and MD.
- **A document's text is searchable.** For a study tool this is most of the value: a PDF you imported becomes findable by what is in it.
- No new storage, endpoint, or backup path. One table, one upload route, one streaming path.
- A renamed document cannot be downgraded to text, and a mislabelled upload is stored as what it actually is.
- The download name cannot terminate a response header, and cannot be used to reverse how it displays.
- One new dependency, pure JavaScript, verified to work in the shipped executable.

**Negative / accepted costs**

- **In-browser preview is not implemented.** A document downloads rather than opening in a tab. That is the safe default, and the same one the security model demands; an inline preview would need the sandboxed-iframe treatment ADR-007 gives custom content, which is a separate decision.
- **Scanned PDFs yield no text.** A PDF that is an image of a page has no text layer and no OCR, so it is stored and downloadable but not searchable. Reported as an empty extraction rather than a failure, because a structurally valid document with no text is a normal thing to upload.
- **Legacy binary formats are not supported.** `.doc` and `.xls` are OLE compound files that this parser does not handle; they are refused. AC-031 names DOCX and ODT, not DOC.
- **Extraction is synchronous with the upload.** A large PDF is parsed before the response is sent, so a 40 MB PDF takes measurably longer to upload than a 40 MB image. Accepted: the alternative is background work with a write ledger, which is a larger design than the requirement warrants.
- The `kind` column is stored *and* derivable from the MIME type. It is stored so a listing need not re-derive, and it is not the authority — ADR-013's rule still holds, that the recorded MIME comes from the bytes.

**Neutral**

- No native code is introduced. `officeparser` pulls `@napi-rs/canvas` as an *optional* dependency, unused for text extraction.
- The 50 MB attachment ceiling and the 50 MP image ceiling are unchanged and shared. A document is bounded by bytes only; it has no pixel dimension, so the pixel rule never applies to it.

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
| `officeparser` on a real DOCX (built as a genuine ZIP) | text, Markdown and HTML all correct |
| `officeparser` on a real PDF, repeated 4× | 4/4 correct |
| `unpdf` on a real PDF, repeated 6× | 1 correct, then `DataCloneError` on all others |
| `officeparser` on TXT / MD / HTML / CSV | all refused: no magic bytes |
| Parser auto-detection inside `RTWiki.exe` | **fails**; with an explicit `fileType` hint, succeeds 3/3 |
| `sanitize-filename` on `report.pdf\r\nX-Injected: pwned` | CRLF removed, but **U+202E preserved** |
| A `File` built from text | reports `text/plain;charset=utf-8`, which matches no exact allowlist entry |
| A PDF renamed `.txt`, through the endpoint | accepted as text — **the bug this ordering exists to prevent** |
