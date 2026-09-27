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

**Superseded in part (2026-09-27).** Deciding "by the leading bytes" was implemented as a hand-written comparison against magic numbers, and that was not strong enough. A signature comparison accepts *any* file beginning with the eight PNG signature bytes, whatever follows them: a PNG header followed by attacker-chosen content was stored and served as `image/png`. Detection now reads the container structure with `file-type`, which for PNG walks the chunk sequence and requires a well-formed 13-byte `IHDR`, and which caps chunk count and scan budget so a crafted file cannot make the parser walk indefinitely. The principle is unchanged and the guarantee is strictly stronger: the type comes from the file's structure, and a file that only claims to be an image is refused.

The **allowlist remains ours**, separate from the parser. `src/shared/attachments/image-formats.ts` is dependency-free and browser-safe; the parser lives server-side in `src/server/attachments/image-detect.ts` and may report more types than we accept. A type that is detected but absent from the allowlist is refused, so widening what RTWiki accepts is always a deliberate edit to one list.

### 1a. AVIF is accepted; TIFF, HEIC and JPEG XL are not

Accepted formats: PNG, JPEG, GIF, WebP, AVIF, BMP.

AVIF decodes in every current browser and is markedly smaller than JPEG at the same quality. It is stored untouched — RTWiki accepts and serves images, it does not re-encode them — so no image decoder is required for it.

TIFF, HEIC and JPEG XL are deliberately absent even though they are detected reliably:

| Format | Why it is refused |
|---|---|
| TIFF | Renders in Safari only, so a note containing one shows a broken image in Chrome, Edge and Firefox. |
| HEIC | Unsupported by every current desktop browser. |
| JPEG XL | Unsupported by Chrome, Edge and Firefox. |

Accepting a format most readers cannot display would be worse than refusing it, because the failure looks like data loss to the user.

### 1b. An image's pixel count is capped

A file's dimensions are read from its header — never by decoding pixels — and an image above `PROVISIONAL_MAX_IMAGE_PIXELS` (50 MP, about 8000×6000) is refused with a message naming the limit.

This bounds what the browser must decode when a note is opened, which is what the deliberately-constructed images that exhaust a decoder are aimed at. It is a limit on rendering cost, not on bytes; the byte ceiling is the separate 50 MB attachment limit. An image whose header cannot be read is **not** refused on that basis: the format has already been established, and refusing it would make an accepted format depend on a second parser agreeing.

The limit is enforced in the route rather than inside the detector, so that "what is this" and "is this too big to open" stay separable questions.

### 1c. A refused SVG is named as an SVG

A user who pastes an SVG is told that SVG is the reason, rather than receiving a generic "unsupported type" they cannot act on. The server sends a reason code beside the human-readable message so the client can choose words without parsing English.

This cannot be done by detection alone. An SVG is XML text, and `file-type` reports it as `application/xml`, or as nothing at all when the file has no XML declaration — so the recogniser is a text sniff on the opening tag. Being wrong in that direction is harmless, because an SVG is refused either way; only the message changes.

### 2. SVG is not accepted

SVG is XML that can carry `<script>`, event handlers and external references. Served inline it is document execution, which the security model forbids for uploaded content ("no execution of uploaded documents; serve attachments as static content only").

Sanitising arbitrary SVG would mean maintaining a parser-level allowlist against a format designed to be extensible. Refusing the format is simpler and has a bounded failure mode. The cost is that a user cannot paste an SVG into a note; a note can still link to one hosted elsewhere. **This is a deliberate trade-off, not an oversight.**

If SVG support is ever wanted, the accepted route is ingest-sanitisation with DOMPurify's SVG profile **plus** a per-response `Content-Security-Policy: default-src 'none'` on the response that serves it. Both layers are required: a sanitiser is a parser keeping up with an extensible format, and a CSP is what actually prevents execution. Neither alone is the guard, and a regex-based sanitiser is not an acceptable substitute for either.

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

- No stored image can be a script, regardless of what the uploader claims. Enforced by test from the file's structure, not from metadata — and a file that merely *begins* with a valid signature is refused.
- A file whose header declares an absurd pixel count is refused before it reaches a browser decoder.
- No user-supplied string ever reaches the filesystem.
- One code path for picker, paste and drop, with one set of messages.
- Images work offline; the dictionary-style "no runtime CDN dependency" rule is preserved.
- AVIF is accepted, so a modern screenshot or photo uploads without conversion.
- Two new dependencies, both pure JavaScript with no native code, verified to work inside the compiled `RTWiki.exe` by `bun run test:compiled-images`.

**Negative / accepted costs**

- SVG is unsupported (see above). A refused SVG is named as an SVG, so the user is not left guessing.
- TIFF, HEIC and JPEG XL are unsupported, because a note containing one would show a broken image for most readers.
- Detection is no longer hand-rolled, so the accepted-format table no longer carries the format signatures. The trade is deliberate: a maintained parser is stronger than a signature list, and the allowlist that decides what is *accepted* is still ours alone.
- Deleting a page does not delete its images. The files become orphans, reclaimable from the `attachments` table but not yet reclaimed automatically — an open item in [KNOWN_BUGS.md](../KNOWN_BUGS.md). Wiring a page foreign key was rejected for now because an attachment may legitimately be uploaded before it is referenced, and a note may be deleted while its images are still wanted.
- The catalogue grows without bound until a retention pass exists. Same open item.
- The size limit is the provisional 50 MB default, and the pixel limit the provisional 50 MP default, both defined once in shared constants.
- The pixel limit is checked against a *declared* header. A file whose header understates its true size would pass. That is accepted: the header is what every decoder reads first, so a mismatch is a malformed-image problem rather than a way to reach a decoder.

**Neutral**

- `img-src 'self' data:` in the existing CSP already permits these URLs, so no CSP change was needed. This was verified, not assumed.

## Alternatives considered

**Trust the declared `Content-Type`, validate against the extension.** Rejected: both values come from the same untrusted request, so the check can be satisfied by making the lie consistent.

**Serve uploaded files from a separate origin.** Rejected: RTWiki is a single-origin local application, and adding a second origin buys isolation the id-addressing already provides without the deployment cost.

**Sanitise SVG and accept it.** Rejected: an unbounded parser-level allowlist for a format designed to be extended, in exchange for a format users rarely paste into a study note. Revisit only with sanitisation *and* a per-response CSP together, since neither alone is the guard.

**Keep hand-written signature detection, and just add AVIF to it.** Rejected after measurement. A signature comparison accepts any file beginning with the matching bytes regardless of what follows, so the accepted-type table was not enforcing what it claimed to enforce. The format signatures also become a permanent maintenance obligation: adding a format means writing and testing a parser rather than adding a line.

**Use `sharp` to decode, resize and compress.** Rejected: it is native code, and it compiles into a portable executable that then **fails at runtime** — verified, exit code 1. The user's machine must not need a toolchain, and must not get an app whose image features crash.

**Use `jimp` for resizing.** Not rejected on merit — it is pure JavaScript and does run inside the compiled executable. It is out of scope for this decision, and it decodes only five formats, so adopting it would permanently cap what RTWiki can process. Resizing is a separate decision with its own ADR.

**Store the original filename in the stored path** (`<UUID>_<original>`), as an earlier draft of the data model described. Rejected: it puts user-controlled text into a filesystem path for no benefit — the original name is kept in a column and used only for display.
