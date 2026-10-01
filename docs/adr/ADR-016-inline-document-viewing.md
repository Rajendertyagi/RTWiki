# ADR-016: Inline Document Viewing on a Separate Route

**Status:** Accepted. Supersedes [ADR-015](ADR-015-document-attachments.md) §3 only; ADR-015's storage, detection and text-extraction decisions stand.

**Date accepted:** 2026-09-27, by the project owner, explicitly and after the trade-off was put to them.

---

## Context

[ADR-015](ADR-015-document-attachments.md) decided that an attached document is **never** served
inline. Its reasoning was sound and is not disputed here: a document is a program, a PDF can carry
JavaScript, and serving one inline would execute it in RTWiki's own origin. Every document response
therefore carried `Content-Disposition: attachment` plus a per-response
`default-src 'none'; sandbox` policy — two independent layers, either of which alone would stop
execution.

That decision is now **reversed by owner decision**. The owner was shown the trade-off, including the
residual risk below, and authorised inline serving. The reason is a product one: attaching a document
without any way to read it in place is only half a feature, and a study note's attachments are
overwhelmingly lecture slides and readings that the user wants to look at immediately.

Two properties of the requester constrain the shape of the solution:

- The **browser** draws the PDF. There is no PDF.js, no renderer dependency, and none was added.
- The app-wide Content Security Policy is **not** widened. Whatever the view response needs is applied
  to that one response.

## Decision

### 1. Three ways to open a document, and only one of them is new

Every attached document offers three actions:

| Action | Route | What it does |
|---|---|---|
| **View text** | `GET /api/attachments/:id/text` | Renders the text RTWiki already extracted, inside the app. **Pre-existing — not built by this ADR.** |
| **View** | `GET /api/attachments/:id/view` | Opens in a new browser tab; the browser draws the document. **New.** |
| **Download** | `GET /api/attachments/:id` | Unchanged. `Content-Disposition: attachment`. |

**View text is the safest of the three and it is not new work.** `extracted_text` has been a column
since ADR-015 and `GET /api/attachments/:id/text` has existed since the same commit. It is surfaced
here because it was correct and unreachable, not because it was missing. No second text endpoint was
added and nothing is re-extracted.

That ordering is deliberate and should not be reordered later: View text opens no file at all, so it
has no attack surface of the kind described in the residual risk. If a user can be shown the content
of a document safely, that is the option to reach for first.

### 2. The view route is separate, and the download route is untouched

`GET /api/attachments/:id/view` serves the same bytes as `GET /api/attachments/:id` under different
headers. The two are deliberately **distinct routes**, not one route with a query parameter:

- The download route keeps `attachment`. Its headers, its behaviour and its tests are unchanged.
- Inline serving is therefore opt-in per request and never becomes the default by accident.

Both routes are **id-addressed only**, as everywhere else. No filename is ever used to address a
document, so there is no path to traverse.

### 3. The recorded, byte-detected type — never a client-supplied one

The view response's `Content-Type` is `record.mime_type`, which was determined from the file's own
bytes at upload time. It is not influenced by any request header or query parameter. This is the same
value the download route serves, and it is the reason a PDF renamed `.txt` is still served as a PDF.

### 4. Headers on the view response

- `Content-Type` — the recorded type.
- `Content-Disposition: inline; filename="…"; filename*=UTF-8''…` — built by the *existing*
  `contentDisposition()` helper, which was already written to accept `'inline'` and was used by nothing.
  The RFC 5987 encoding, and the reason it is an encoding rather than a sanitiser, are unchanged from
  ADR-015.
- `X-Content-Type-Options: nosniff`.
- `Content-Security-Policy: default-src 'none'; sandbox` — **identical to the download route's policy**,
  and narrower than the app-wide policy. §4 records the measurement behind that choice, including the
  expectation it contradicted.
- `Cache-Control: private, no-cache` and `Content-Length` — identical to the download route.

The app-wide policy in `src/server/app.ts` is **not modified**. It is not widened, narrowed, or
touched.

### 5. Content-Disposition is the control. The CSP is defence in depth.

**This is the sentence the next reader needs, and it is why the priority is recorded at all.**

ADR-015 protected documents with two layers and said the disposition was the one that works. That is
still true, and inlining makes it more true, not less:

- **Content-Disposition is the control.** `attachment` is what keeps a document from being rendered in
  RTWiki's origin. It is enforced by the browser before any content is parsed, and it holds regardless
  of what the bytes contain.
- **The CSP is defence in depth.** It limits what a document can do *if it is rendered anyway* — for
  instance if a user opens the view route directly, or a browser ignores the disposition. It reduces
  the blast radius. It is not what stops the rendering.

Reversing this priority would be the actual mistake. A future reader who concludes "the CSP is the
control, so it can be relaxed" would be wrong in the dangerous direction; a reader who concludes "the
CSP is the control, so the disposition can be dropped" would be wrong in the obviously-broken
direction. Both follow from keeping the disposition primary and the policy secondary.

## The residual risk, stated plainly

An inline PDF served from `127.0.0.1` is a **same-origin document**. The application's origin and the
document's origin are the same origin.

A restrictive CSP mitigates script execution. **It does not make a memory-safety bug in the browser's
PDF viewer impossible.** A maliciously crafted PDF that exploits a renderer vulnerability can execute
script alongside the user's notes, in the same origin as the notes themselves — the same origin that
holds every page, every attachment and every link. A CSP cannot prevent native code from being
compromised, and it cannot undo memory corruption.

What is accepted, by this decision:

- The user is exposed to the browser's PDF viewer on documents they chose to attach. In practice this
  is the same exposure as opening any PDF from any site, which is a risk most people accept daily.
- It is concentrated: RTWiki binds to `127.0.0.1` only, so the exposure requires a document the user
  chose, and the attacker must be able to place a crafted file in the user's own workspace.
- **The same-origin framing is the part that is genuinely new**, and it is why `default-src 'none'`
  stays on the response even though `sandbox` was dropped.

This is a real, deliberate reduction in safety bought for a real feature. It is recorded here in those
terms so that a future change to the viewer route — a new document type, a relaxed `default-src`, a
dropped `nosniff` — is recognisable as a continuation of this decision rather than an unrelated edit.

## Alternatives considered

**Keep ADR-015 as it is, and offer only View text and Download.** Rejected. It is the safest option
and it is genuinely worse to use: the user attaches a PDF and has to save it, then open it from the
downloads folder, to read a slide they wanted to see. The owner preferred the convenience and accepted
the risk knowingly.

**Widen the app-wide CSP to permit the viewer's needs.** Rejected, and specifically forbidden. It would
weaken every other response in the application to solve a problem on one route. The view response
carries its own policy instead.

**Serve the view from a separate origin or port.** Rejected. It would genuinely reduce the same-origin
exposure, and it is the shape a stricter design would take — but it means a second server, a second
port, and a cross-origin document, which is a large amount of machinery for a local single-user
application. Worth revisiting if RTWiki ever gains a LAN mode or multi-user access, which is exactly
when same-origin stops being a local-only concern.

**Render the PDF in an embedded viewer inside the app.** Rejected. It needs a rendering dependency,
and the requester was explicit that the browser does this work for free.

**A sandboxed iframe on a blob or data URL.** Rejected. It adds a rendering surface, a second copy of
the bytes in memory, and the sandbox restrictions that make the built-in viewer unusable — the finding
in §4 — without removing the underlying exposure.

## What was measured, and how

Measured in real Google Chrome, launched explicitly, driving a real server with a real PDF uploaded
through the real endpoint. **The measurement contradicted the expectation going in, and that is the
most useful thing in this ADR.**

### The expectation, and why it was wrong

The plan was to send `default-src 'none'` and drop `sandbox`, on the reasoning that Chrome's PDF
viewer is a plugin document and a sandboxed response refuses one. That is a reasonable-sounding
inference and it is **false**.

| Response | Result in Chrome |
|---|---|
| `inline` + `default-src 'none'` | **PDF rendered**, document text visible |
| `inline` + `default-src 'none'; sandbox` | **PDF rendered, identically** |
| `attachment` (control) | downloaded; no viewer, tab blank |
| `text/html` (control) | rendered as markup, not as a PDF |

Screenshots of the two `default-src` variants were byte-identical (11257 bytes) and both showed the
PDF's own text drawn on the page, with Chrome's viewer toolbar and thumbnail.

**The controls are what make this a result rather than an assumption.** Without them, "both rendered"
is equally consistent with "the harness cannot tell them apart". The `attachment` control proves
interception can change the outcome from rendering to not-rendering, and the `text/html` control
proves the bytes are what is being interpreted.

### So the stricter policy was free, and was taken

`DOCUMENT_VIEW_CONTENT_SECURITY_POLICY` is the **same value** as the download route's:
`default-src 'none'; sandbox`. The two are separate exported names for one value, so a future
measurement showing they must diverge can change one without silently changing the other.

This is the outcome the task was most likely to get wrong in the unsafe direction — dropping
`sandbox` on the strength of a plausible story. It is recorded at length because the reasoning, not
the code, is what would have been repeated.

### The rest of the observation

- The tab's origin stays `127.0.0.1` — same-origin, which is the accepted exposure.
- The console is clean. The one 404 seen was Chrome asking for `/favicon.ico`, which RTWiki does not
  serve; it is the browser's housekeeping, not the document's doing, and the test filters on the
  resource URL rather than the message text.
- No script from the document executes. A PDF's own JavaScript is denied by `default-src 'none'`.
- The response headers are, verbatim: `content-type: application/pdf`,
  `content-disposition: inline; filename="…"; filename*=UTF-8''…`,
  `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox`.

### A harness fact worth recording separately

**Playwright's bundled Chromium cannot render PDFs at all.** It has no PDF viewer, so it *downloads*
the response and `page.goto()` fails with `Error: goto: Download is starting`. A test written against
it would have reported that inline viewing does not work — a completely false conclusion about the
product, produced entirely by the test environment.

The view test therefore launches the system Chrome via `chromium.launch({ channel: 'chrome' })`. This
is not a workaround for flakiness; it is the only way to observe the behaviour at all. On a machine
without Chrome the test cannot run, and that is recorded as a skip-with-reason rather than papered over.

A second harness fact: **when Chrome navigates to a PDF, the navigation response reports no
`content-security-policy` header to the client**, because the document is handed to the viewer as a
plugin. The header is on the wire, but it is not observable from the navigation object. Header
assertions are therefore made over the API, and the browser test asserts what the browser *did*.

## Consequences

**Easier:** a document is finally usable in place. The `inline` branch of `contentDisposition()` —
written in ADR-015 and used by nothing until now — has a caller.

**Harder:** the same-origin exposure described above is real, and the route's headers are now
load-bearing in a way the download route's never were. Two tests assert the view route's disposition
and policy, because a regression here would be silent.

**Unchanged:** images are still served inline and still carry no disposition — an image is not a
program, and this decision does not touch [ADR-013](ADR-013-image-attachments.md). SVG remains refused
for images. A signature-less document (`.txt`, `.md`, `.html`) still has no servable bytes and still
returns 404 on both routes; its text is reachable through View text.

## Risks

- **A crafted PDF exploiting a viewer bug runs script in the notes' origin.** Accepted, mitigated by
  `default-src 'none'`, not eliminated. See the residual risk section.
- **A browser that ignores `Content-Disposition: inline` and downloads instead.** A usability
  surprise, not a safety one. The download path still exists. Firefox was not measured; only Chrome
  was, and its behaviour is the one this ADR relies on.
- **A viewer memory-safety bug.** See the residual-risk section. This is the one that is genuinely
  new and it is not mitigated away.
- **Office formats will not render in most browsers.** `DOCX`, `XLSX`, `PPTX` and `ODT` have no
  mainstream browser renderer; View on one of those will download it or show source. This is the
  browser's behaviour, not a policy RTWiki imposes, and it is why Download and View text are on the
  card. This is the browser's behaviour rather than a defect of ours, and is recorded here so it is not mistaken for one.

## Revisit conditions

- RTWiki gains LAN binding or multi-user access. Same-origin stops being a local-only concern and the
  separate-origin alternative above becomes the right answer.
- A rendering dependency is ever added, which would make View-in-browser unnecessary.
- The owner decides the convenience is not worth the same-origin exposure. Reverting is a small
  change: remove the route and its three controls.

## Cross-references

- [ADR-013](ADR-013-image-attachments.md) — id-addressed, byte-verified attachment serving. The
  addressing rule both routes follow.
- [ADR-014](ADR-014-blob-stored-image-bytes.md) — the bytes are in the database, so one file backs both
  routes.
- [ADR-015](ADR-015-document-attachments.md) — **superseded in §3 only.** Its storage, byte-first
  detection, parser hint, RFC 5987 filename encoding, signature-less handling and
  outlives-the-note policy all stand. Its "never inline" rule is what this ADR reverses.
- [ADR-005](ADR-005-portable-data-layout.md) — where the bytes live on disk.
- [SECURITY.md](../SECURITY.md) — the application-wide security contract.
