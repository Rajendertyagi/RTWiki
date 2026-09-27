# ADR-013: Image Attachments — Content-Based Validation and Id-Addressed Serving

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:** Nothing
- **Related:** [ADR-004](ADR-004-canonical-block-json-format.md) (canonical BlockNote JSON), [ADR-005](ADR-005-portable-data-layout.md) (portable data layout), [ADR-003](ADR-003-react-blocknote-mantine.md) (BlockNote)

## Context

Rich Notes accept images. BlockNote's default schema already contains an `image` block, and BlockNote already routes every way a user can supply a file — the file picker, paste and drop — through a single `uploadFile` hook. What was missing was the server side: an endpoint, storage, validation, and a way to serve the file back.

The design question is not how to upload an image. It is what RTWiki is willing to *accept and serve*, given that a stored file is served back from the same origin as the application.

## Decision

### 1. The type comes from the file's bytes, never from the request

A multipart part's `Content-Type` is a string supplied by the client. A request can claim `image/png` while carrying arbitrary content. If the server records the claim and later serves it back, the image endpoint becomes a stored-XSS vector: the browser renders the response with the type the server repeats.

So the accepted format is decided by the file's leading bytes and that decision is the *only* type recorded and served. The declared type is not read. The stored extension comes from the same decision, so the two can never disagree.

### 2. SVG is not accepted

SVG is XML that can carry `<script>`, event handlers and external references. Served inline it is document execution, which the security model forbids for uploaded content ("no execution of uploaded documents; serve attachments as static content only").

Sanitising arbitrary SVG would mean maintaining a parser-level allowlist against a format designed to be extensible. Refusing the format is simpler and has a bounded failure mode. The cost is that a user cannot paste an SVG into a note; a note can still link to one hosted elsewhere. **This is a deliberate trade-off, not an oversight.**

Accepted formats: PNG, JPEG, GIF, GIF87a/GIF89a, WebP (verified via the `WEBP` form type at offset 8, so a WAV or AVI `RIFF` container is not mistaken for one), BMP.

### 3. Uploads are addressed by catalogue id, not by filename

Requests name an opaque `id`. The server looks up the row and serves the `stored_name` **it** generated.

This is stronger than sanitising a filename and then verifying the resolved path is inside the directory. There, correctness depends on the sanitiser and the check both being right. Here, no part of the request ever becomes a path, so a traversal attempt has nothing to traverse — the failure mode is the failure mode of an ordinary lookup miss.

The stored name is `<UUID>.<ext>`. The uploader's filename is kept in `original_name` for display, with path separators and control characters removed, and is never used to build a path.

### 4. The document stores a URL, not file content

An `image` block stores the URL returned by the upload. The document stays canonical BlockNote JSON ([ADR-004](ADR-004-canonical-block-json-format.md)) with a URL in a `url` prop; no bytes are inlined, and no `data:` URI is used as a fallback. Inlining would put megabytes of base64 into the page row and into every autosave, and would bypass the size limit and the type check entirely.

The file itself lives under `data/attachments/` per [ADR-005](ADR-005-portable-data-layout.md), and the catalogue row is the source of truth about it.

### 5. One client entry point, with the message owned centrally

BlockNote calls `uploadFile` for the picker, for paste and for drop. RTWiki therefore supplies exactly one function for all three — there is no second upload path to keep in step.

That function also owns the failure *message*. Paste and drop are handled inside BlockNote, not by RTWiki, so a caller-owned error message would only ever surface for the Insert-menu route; reporting centrally means a rejected image is explained no matter which route produced it. The error is still rethrown so the caller can restore its own state.

The client does not duplicate the server's type rules. It checks only the size limit, to spare the user a pointless wait.

### 6. The toolbar reads the entry list

An insertion entry declares which toolbar run it belongs to. The toolbar groups by that declaration rather than naming entry keys itself, because a hand-maintained key list fails silently: an entry added to the shared list but not to the toolbar simply never appears. The Insert-menu entry for images was, in practice, invisible for exactly this reason.

## Consequences

**Positive**

- No stored image can be a script, regardless of what the uploader claims. Enforced by test from the bytes, not from metadata.
- No user-supplied string ever reaches the filesystem.
- One code path for picker, paste and drop, with one set of messages.
- Images work offline; the dictionary-style "no runtime CDN dependency" rule is preserved.

**Negative / accepted costs**

- SVG is unsupported (see above).
- Deleting a page does not delete its images. The files become orphans, reclaimable from the `attachments` table but not yet reclaimed automatically — an open item in [KNOWN_BUGS.md](../KNOWN_BUGS.md). Wiring a page foreign key was rejected for now because an attachment may legitimately be uploaded before it is referenced, and a note may be deleted while its images are still wanted.
- The catalogue grows without bound until a retention pass exists. Same open item.
- The size limit is the provisional 50 MB default, defined once in shared constants.

**Neutral**

- `img-src 'self' data:` in the existing CSP already permits these URLs, so no CSP change was needed. This was verified, not assumed.

## Alternatives considered

**Trust the declared `Content-Type`, validate against the extension.** Rejected: both values come from the same untrusted request, so the check can be satisfied by making the lie consistent.

**Serve uploaded files from a separate origin.** Rejected: RTWiki is a single-origin local application, and adding a second origin buys isolation the id-addressing already provides without the deployment cost.

**Sanitise SVG and accept it.** Rejected: an unbounded parser-level allowlist for a format designed to be extended, in exchange for a format users rarely paste into a study note.

**Store the original filename in the stored path** (`<UUID>_<original>`), as an earlier draft of the data model described. Rejected: it puts user-controlled text into a filesystem path for no benefit — the original name is kept in a column and used only for display.
