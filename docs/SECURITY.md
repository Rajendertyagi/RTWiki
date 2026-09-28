# Security

This document defines the security requirements and threat model for RTWiki. Because the application runs entirely offline on a shared family PC, the threat model focuses on local data integrity, accidental corruption, and malicious input from pasted content or uploaded files.

## 1. Threat Model

RTWiki runs on a single Windows PC with no network-facing attack surface by default. The primary threats are:

This table states a mitigation per threat. **Where the mitigation is not implemented, that is stated.** See §2.1 and §2.3 for the sanitization scope, which is narrower than the first two rows imply.

| Threat | Source | Mitigation | Status |
|--------|--------|------------|--------|
| Malicious HTML in pasted content | User pastes from a compromised website or AI response | DOMPurify sanitization before conversion to blocks | **Partly — there is no paste handler.** 0 matches for `handlePaste` / `transformPasted` / `clipboard` in `src/`, and no import pipeline exists. Recorded as unbuilt work in §2.3 |
| Malicious JavaScript in Markdown | User renders a Markdown note containing `<script>` tags | The parser escapes raw HTML, then DOMPurify sanitizes; a parser bug is not the only barrier | **Built** — `src/web/features/markdown/markdown-render.ts:1,136` |
| Malicious script in the raw-HTML page | User authors a page with a `<script>` or an inline `on*` handler | Sandboxed `<iframe>` (`allow-scripts`, opaque origin) + its own CSP meta + HTML normalization that removes `script`, `iframe`, `object`, `embed`, `base`, external stylesheets, `meta[http-equiv]` and inline `on*` | **Built** — `src/web/features/html/preview-document.ts:236`, §2.4 and §5.2 |
| Malicious Mermaid / diagram SVG | Diagram text carries HTML tags, click callbacks or a `foreignObject` | `securityLevel: 'strict'`, `htmlLabels: false`, `svg-sanitize.ts`, CSP | **Built** — `src/web/features/rich-editor/blocks/mermaid-render.ts:80,90`, [ADR-012](adr/ADR-012-diagram-rendering-and-sanitisation.md) |
| Path traversal via attachment upload | User uploads a file with a crafted filename | Id-addressed serving: the request names an opaque `id`, the server serves the `stored_name` it generated | **Built** — `src/server/attachments/attachment-routes.ts`, §3 |
| Database corruption | Power loss, crash, concurrent writes | SQLite WAL + `foreign_keys = ON` + transactions + startup `integrity_check` | **Partly** — WAL, foreign keys and transactions are **Built** (`src/server/database/index.ts:97,98`); the startup check **throws instead of reporting failure on severe corruption** as of `476de71`, so its rejection path is unreachable for that class. §7 |
| Accidental data loss | User deletes a page | Soft delete + recycle bin | **Built** — `migrations.ts:24,64,70,74` |
| Accidental data loss | Restore from a corrupt or incompatible backup | Backup validation before restore | **Not implemented.** No backup or restore feature exists in `src/`; `data/backups/` is created at startup and stays empty. §8 is a requirement, not a description |
| Unauthorized LAN access (future) | Someone on the local network discovers the server | Localhost binding by default; LAN access requires explicit opt-in | **Built** — §4 |
| **A web page the user visits writes to their own server** | Any site the user browses while RTWiki runs issues a cross-origin `POST` to `127.0.0.1:8080` | **None.** No `Host` validation, no CORS middleware, and `isSameOrigin()` is not applied to the page, schedule or preset routes — 17 of 25 mutating routes perform no origin check, 5 of which are reachable with no prior identifier | **Not implemented.** Data-destroying: `POST /api/schedule/presets/apply` with `mode: "replace"` deletes every timetable entry and reminder. The loopback bind does not cover it — it stops remote hosts, not a page in the user's own browser. §4.1 and [KNOWN_BUGS.md](KNOWN_BUGS.md) |

## 2. Input Sanitization

### 2.1 HTML Sanitization (DOMPurify)

All HTML input must be sanitized before any part of it reaches the editor or the database. **Which sanitiser covers which path was measured, and the coverage is not uniform.**

| Path | Control | Enforced by |
|------|---------|-------------|
| **Markdown render** | micromark escapes raw HTML at the parser, then DOMPurify sanitizes the output string | `src/web/features/markdown/markdown-render.ts:1,136` |
| **Raw-HTML page** | Sandboxed `<iframe>` with an opaque origin, its own stricter CSP meta, and HTML normalization that strips `script`, `iframe`, `object`, `embed`, `base`, external stylesheets, `meta[http-equiv]` and inline `on*` attributes | `src/web/features/html/preview-document.ts:236`; §2.4, §5.2 |
| **Diagram output** | `securityLevel: 'strict'` + `htmlLabels: false`, then `svg-sanitize.ts` strips `foreignObject` and event attributes; Mermaid's internal sanitiser also runs | `src/web/features/rich-editor/blocks/mermaid-render.ts:80,90`; [ADR-012](adr/ADR-012-diagram-rendering-and-sanitisation.md) |
| **Pasted HTML** | *No control — the path does not exist* | §2.3 |
| **Imported HTML** | *No control — no import pipeline exists* | §2.3 |

**DOMPurify is imported in exactly one file in `src/`** — `markdown-render.ts:1` — and called once, at `:136`. Any statement elsewhere that DOMPurify covers pasted, imported or raw-HTML input is wrong. The raw-HTML and diagram paths have their own controls, listed above; they are independent of DOMPurify, and one must not be substituted for another.

**The Markdown sanitiser profile is `{ html: true }`.** Tags and attributes outside that profile are dropped. Script elements, event-handler attributes and `<style>` are refused, and the profile was deliberately widened to `{ html, mathMl, svg, svgFilters }` so that KaTeX's MathML and its SVG overlay survive — `MARKDOWN_SANITIZE_OPTIONS` in the same file, with a test asserting both that MathML/SVG are kept and that `script` and `on*` are still removed. **`SAFE_FOR_XML` is never disabled**: DOMPurify strips any attribute whose value contains `-->`, `]>`, or `</script`, so untrusted source text is carried as element text content, never in an attribute.

**Script content is always stripped from imported and authored HTML.** No `<script>`, `<object>`, or `<embed>` tag is permitted in stored content. Author-supplied custom HTML/CSS/JS is permitted only inside the isolated sandbox described in §2.4, never in the main application document.

### 2.2 Mermaid Security Mode

Mermaid diagrams use the documented default `securityLevel: "strict"`, which encodes HTML tags in diagram text and disables click functionality. RTWiki separately blocks unauthorized external-resource loading through its CSP, sanitization, asset, and network policies.

**These are the controls, and they are verified in code:**

| Control | Setting | Where |
|---------|---------|-------|
| Mermaid security level | `securityLevel: 'strict'` | `src/web/features/rich-editor/blocks/mermaid-render.ts:81` |
| HTML labels | `htmlLabels: false` — mandatory, and RTWiki's rather than Mermaid 12's default | `src/web/features/rich-editor/blocks/mermaid-render.ts:90` |
| Autostart | `startOnLoad: false` | `src/web/features/rich-editor/blocks/mermaid-render.ts:80` |
| Structural SVG pass | Strips `foreignObject` and event attributes, guaranteeing removal without relying on DOMPurify's profile | `src/web/features/rich-editor/blocks/svg-sanitize.ts` |
| Resource restriction | `img-src 'self' data:`, `object-src 'none'`, `font-src 'self' data:` | `src/server/app.ts:53-64` |

**The diagram template list is not a security control, and an earlier version of this document was wrong to imply it was.** It previously read: *"Only the subset of Mermaid syntax supported by `@blocknote/diagram-block` is allowed."* Two things are wrong with that sentence:

1. **`@blocknote/diagram-block` is not a dependency.** It is absent from `package.json:27-76` and from `bun.lock`, and has 0 imports in `src/`. A copy sits in `node_modules/@blocknote/diagram-block/` as a stale install artefact. The diagram block is first-party: `src/web/features/rich-editor/blocks/diagram.tsx`.
2. **No syntax subset is enforced.** A user can type arbitrary Mermaid into a textarea and it is rendered. Measured: `src/web/features/rich-editor/blocks/mermaid-block-view.tsx:248-250` (the in-block editor) and `src/web/features/visual-pages/mermaid-workspace.tsx:520-523` (the Diagram page). The 21 `DIAGRAM_TEMPLATES` at `src/web/features/rich-editor/insert-blocks.ts:33-149` are **offered starting points** for the template bar, not a boundary. A template that offered nothing would still be safe, and a template offering everything would still be safe.

This matters because the sentence claimed a defence that does not exist. If someone later assumed arbitrary Mermaid was blocked by the template list, they would not add the controls that actually make it safe.

### 2.3 Import pipeline and paste handling — required, not implemented

**This section previously described a conversion pipeline that does not exist.** The requirement stands; the implementation does not.

Measured:

- **No paste handler.** 0 matches for `handlePaste`, `transformPasted`, `transformPastedHTML` or `clipboard` in `src/`. Pasting into the Rich Note is handled by BlockNote's own default behaviour, which RTWiki does not intercept.
- **No import pipeline.** No import, adapter or sanitise module exists. `src/shared/schemas/html-content.ts` and `markdown-content.ts` are page-content *schemas*, not import adapters.
- **No localhost import API.** 0 matches for `/api/v1/import` or `import/pages`; §2.5 describes an endpoint that is not mounted.

So the documented pipeline

```
Raw HTML → DOMPurify sanitize → HTML-to-BlockNote converter → BlockNote JSON
```

has no corresponding code. Unbuilt security work, to be built before any import or paste path is exposed:

1. One shared, centralized import pipeline for every entry point (paste, drop, file, localhost API) — never parallel paths.
2. DOMPurify as an intermediate step for any pasted or imported HTML, since no other control covers it (§2.1).
3. The loopback-only import API of §2.5, with CORS disabled, request and package size limits applied **before** parsing (ZIP-bomb protection), manifest validation, and entry-name path-traversal checks.
4. Warnings surfaced rather than silent content loss; unknown blocks preserved by `containUnknownBlocks()`, which rewrites each into a `codeBlock` holding its exact JSON behind `UNSUPPORTED_BLOCK_MARKER` (`src/web/features/rich-editor/document.ts:273`, `src/shared/constants/index.ts:76`).

**Interim risk, stated plainly:** until this exists, any HTML that enters the application by a path other than the Markdown renderer, the raw-HTML page sandbox or the diagram pipeline is unsanitized by RTWiki. Today no such path is exposed, so this is latent rather than live — but it is the reason the requirement must not be treated as satisfied.

### 2.4 Custom Content Sandbox

When a page supplies optional custom HTML/CSS/JS (L3), it is rendered only inside an isolated sandbox:

- The sandbox is an `<iframe>` with `sandbox` attributes that **deny same-origin access** (`sandbox="allow-scripts"` without `allow-same-origin`), disable forms where unsafe, and block all network egress (`connect-src 'none'`, no `fetch`/XHR to external hosts).
- The sandboxed content has **no access** to the application's database, filesystem, cookies, `localStorage`, or the parent DOM. It cannot read or modify other pages.
- A strict **Content-Security-Policy** is applied to the sandbox: `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'none'`.
- **Active content (scripts) is off by default** and toggleable by a user setting. When disabled, only scoped CSS renders; JavaScript does not execute.
- Any page using custom content shows a clear visual indicator that active content is present.
- Trusted-global customization (site-wide custom CSS/JS) is a future, disabled-by-default capability and is not part of the MVP.

### 2.5 AI Import API

**Not implemented.** 0 matches for `/api/v1/import` or `import/pages` in `src/`. The requirements below are the specification for unbuilt work, and every one of them is **unmet** today. They are recorded here so that building the endpoint cannot silently skip them.

The localhost import API (`POST /api/v1/import/pages`) must be bound to the loopback interface only:

- It accepts no cross-origin requests (CORS is disabled); only the local machine may call it. The same-origin check that exists for attachment writes (`isSameOrigin`, `src/server/utils/request-origin.ts`) is the pattern to follow.
- Request and package size limits are enforced before parsing (ZIP-bomb protection). No import-package size cap is configured today, and **no global request ceiling exists** — the former `MAX_REQUEST_SIZE` was deleted in `138aa62` because no request path read it, and an uncapped route is a real gap that only a `bodyLimit` in `createApp()` can close. The per-route caps in §6 are not a substitute for a package cap.
- Incoming packages are validated against the manifest schema; entry names are checked for path traversal.
- Import is idempotent per client-supplied request id; duplicate submissions do not create duplicate pages.
- Custom JavaScript inside an imported package is confined to the sandbox (§2.4) and has no database, filesystem, or network access. The sandbox itself is built and enforced by the app-wide CSP, so this requirement is satisfiable — but the import route that would carry package JavaScript into it does not exist.

## 3. Attachment Safety

Implemented by `src/server/attachments/`, `src/shared/attachments/image-formats.ts` and `src/shared/attachments/document-formats.ts`; the contract is recorded in [ADR-013](adr/ADR-013-image-attachments.md) and inline viewing in [ADR-016](adr/ADR-016-inline-document-viewing.md).

| Check | Implementation |
|-------|---------------|
| **Content-based type detection** | The type is decided by the file's leading bytes. The declared `Content-Type` is never consulted — it is attacker-controlled, and trusting it is how an image endpoint becomes an XSS vector. A **text** document additionally goes through `officeparser`, because a `.txt` upload that is really a PDF is caught by parsing it and reading the extracted text (`src/server/attachments/document-detect.ts`) |
| **Image format allowlist** | PNG, JPEG, GIF, WebP, **AVIF**, BMP — `image-formats.ts:72-77`. Anything else is rejected, including a RIFF container that is not WEBP. AVIF is stored untouched; it decodes in every current browser and is markedly smaller than JPEG at equal quality. TIFF, HEIC and JPEG XL are **deliberately absent** even though `file-type` detects them: TIFF and HEIC have no dependable browser decode, and JPEG XL is unsupported by Chrome, Edge and Firefox |
| **Document format allowlist** | PDF, DOCX, PPTX, XLSX, and the OpenDocument equivalents — `document-formats.ts:70-91` |
| **SVG refused** | SVG is XML that can carry `<script>`, event handlers and external references. Serving one inline is document execution, which this model forbids for uploaded content. Refusing it is simpler and safer than sanitising arbitrary SVG |
| **Size limit** | `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES` (50 MB), enforced by Hono's `bodyLimit` middleware *before* the body is parsed, so an oversized upload is never buffered |
| **Id-addressed serving** | Requests name an opaque `id`. The server looks up the row and serves the `stored_name` it generated, so no user-supplied string reaches the filesystem. A traversal attempt has nothing to traverse — stronger than sanitising a filename and re-checking the resolved path |
| **Generated filenames** | `<UUID>.<ext>`, with the extension chosen from the detected type. The uploader's filename is recorded for display only, with separators and control characters removed |
| **Type pinning on serve** | The `Content-Type` sent is the recorded, detected type. `X-Content-Type-Options: nosniff` stops a browser second-guessing it and reinterpreting the bytes |
| **No execution** | Uploaded files are stored and served as static content only. No script interpretation occurs |
| **Cross-origin uploads** | `POST` and `DELETE` require a same-origin request (`isSameOrigin`, `src/server/utils/request-origin.ts`); `GET` does not, because an `<img>` tag sends no `Origin` header |
| **View is a separate route from download** | `GET /api/attachments/:id/view` serves inline; the download route is unchanged. They are two routes rather than one route with a parameter **so the default cannot become inline by accident** ([ADR-016](adr/ADR-016-inline-document-viewing.md)) |
| **View sends the stricter policy** | The view route sends `default-src 'none'; sandbox` on top of the app policy. `Content-Disposition` is the control; the CSP is defence in depth, in that order — see `src/server/attachments/content-disposition.ts`. Owner-authorised inline viewing, recorded 2026-09-27 |

The CSP already allows these images: `img-src 'self' data:` permits a same-origin `/api/attachments/...` URL.

## 4. Server Binding

The `config.server.host` paths named below **do not exist**. `AppConfig` (`src/server/config/index.ts:15-29`) exposes a flat `host`; the default is `DEFAULT_HOST` at `src/shared/constants/index.ts:10`, and the resolved paths come from `resolveRuntimePaths()` (`src/server/config/index.ts:76-98`).

| Mode | Configuration |
|------|--------------|
| **Default (localhost only)** | `DEFAULT_HOST` = `127.0.0.1` — `src/shared/constants/index.ts:10`, overridable by a flat `host` on `AppConfig` |
| **LAN access (future)** | Requires explicitly setting `host` to `0.0.0.0` or a specific interface IP |

The server must **never** bind to `0.0.0.0` by default. Future LAN access must require a deliberate configuration change documented in [ADR-001](adr/ADR-001-browser-first-local-application.md).

### 4.1 Cross-origin requests — required, not implemented

**Binding to loopback is not a cross-origin control, and treating it as one is the specific mistake
this subsection exists to prevent.** The bind stops a *remote host* from connecting. It does nothing
about a web page running in the user's own browser, which can reach `127.0.0.1:8080` just as
readily — and RTWiki opens a browser tab itself on every launch unless `--no-open` is passed.

**Measured at commit `476de71`, today:** there is **no** `Host` header validation (0 matches for
`allowedHosts`, `hostAllow`, or reading the `host` header in `src/`), **no** CORS middleware (0
matches for `hono/cors` or `Access-Control-Allow-Origin`), and **no** cookies anywhere, so
`SameSite` has no subject to protect. The existing `isSameOrigin()` helper
(`src/server/utils/request-origin.ts:16-44`) is correct and tested, but it is called on 5 route files
and **not** on `pages.ts`, `schedule.ts` or `schedule-presets.ts` — 17 of the 25 mutating routes in
`src/server/` perform no origin check. The JSON readers never inspect `Content-Type`
(`pages.ts:44-65`), so a request that declares a CORS-safelisted `text/plain` and carries a JSON body
is dispatched without a preflight.

**This is data-destroying, not merely a write.** Five routes are reachable with no prior
identifier, and one of them is destructive: `POST /api/schedule/presets/apply` with
`mode: "replace"` runs unqualified `DELETE FROM schedule_entries` and `DELETE FROM reminders`. Its
`source` accepts any of three literal, enumerable built-in keys, and `builtin:blank` is empty — so
one cross-origin request **permanently erases the user's entire timetable and every reminder**. It
requires no identifier, no reconnaissance, and no knowledge of the victim's data. The other four
create attacker-chosen pages, entries, reminders and presets. The full route table, the shortest
destructive request, and the impact bounds are in [KNOWN_BUGS.md](KNOWN_BUGS.md).

**The requirements, none of which is met today:**

1. **A `Host` allowlist on every request**, permitting only `127.0.0.1[:port]`,
   `localhost[:port]` and the configured `host`. This is the only control that stops **DNS
   rebinding**, where the browser believes the request is same-origin and therefore sends no
   `Origin` and no `Sec-Fetch-Site` — the branch `isSameOrigin` deliberately accepts at
   `request-origin.ts:43` for the CLI/automation path. A fix must not treat that branch as a
   security decision. It is also the only single control that covers all 17 unprotected routes.
2. **`isSameOrigin()` applied to every unsafe method**, either per route or hoisted to a single
   `app.use`. Correct for the ordinary cross-origin form `POST`; insufficient alone, per (1).
3. **`POST /api/schedule/presets/apply` must not accept an arbitrary built-in key as the source of a
   `replace`.** A destructive bulk delete is not an appropriate consequence of a request that names
   no existing record. This is a narrow fix to one route and is worth doing regardless of (1) and (2).
4. **`Content-Type: application/json` required by the JSON body readers.** Cheap and worth doing,
   but a second line rather than a fix: a `fetch` declaring it triggers a preflight that fails, so
   on its own it only refuses the `text/plain` variant.

A per-process token in a custom request header is the durable answer and the model every comparable
loopback product chose. It is a larger change — the frontend must attach it, it must not be kept in
`localStorage` where any XSS could read it, and it complicates the CLI path — so it does not replace
(1) or (2), and it is not listed as a requirement here because it has not been designed for this
codebase.

**This is a pre-existing gap, not a regression.** No documented claim asserted that it was covered;
it is recorded now so that a future agent does not read the localhost bind as the answer. Because a
reachable route can **destroy** data rather than only add it, LAN binding
([ADR-001](adr/ADR-001-browser-first-local-application.md)) must not be authorized before (1) and
(2) land.

**A fix for (1) was in the working tree when this section was written and is not counted as built
here** — it is uncommitted and this pass did not verify it. Two cautions for whoever lands it: a
`Host` allowlist stops **DNS rebinding** and does nothing about the ordinary cross-origin `POST` that
requires no rebinding, so the `POST /apply` wipe above stays reachable from a bare form submit until
(2) or (3) lands; and landing (1) is not evidence that (2) landed. Re-measure the route table.

## 5. HTTP Security Headers

The Hono backend sets the following headers on every response via the official
`secureHeaders` middleware (`hono/secure-headers`):

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (internal app, not framed) |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-<per-response>'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` | Restrict resource loading to local assets; allowlist nonce'd scripts |
| `Referrer-Policy` | `no-referrer` | Prevent leaking internal paths |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Deny powerful web platform features |

### 5.0 `Cache-Control` — partial coverage

The table above lists what `secureHeaders` sets. **`Cache-Control` is not among them**, and the middleware sets none of its own — verified in `node_modules/hono/dist/middleware/secure-headers/secure-headers.js`, where the string does not appear in `HEADERS_MAP` or `DEFAULT_OPTIONS`. Every header in the table is therefore covered; `Cache-Control` is covered only where it is set by hand, at **exactly four sites**:

| Site | Value | Why |
|------|-------|-----|
| `src/server/static.ts:113` | `no-store` | The SPA document. This is what stops a stored copy being paired with a later response's CSP nonce — see §5.1 |
| `src/server/static.ts:204` | `public, max-age=31536000, immutable` | Hashed asset filenames, so the bytes at a URL cannot change |
| `src/server/attachments/attachment-routes.ts:214` | `private, no-cache` | Attachments are addressed by id, so a shared cache must never hand one attachment's bytes to another URL |
| `src/server/attachments/attachment-routes.ts:282` | `private, no-cache` | As above, for the second serving route |

**Not covered: the entire JSON API.** `GET /api/pages` (titles), `GET /api/pages/:id` (full page JSON), `GET /api/pages?q=`, `GET /api/attachments/:id/text`, and the `onError` (`src/server/app.ts:213`) and `notFound` (`:218`) handlers all return page or error data with **no cache directives at all**. `src/server/routes/pages.ts` contains zero occurrences of the word `cache`.

The requirement stands; this is unbuilt work. The concrete risk is private page content sitting in a shared cache. It is **latent** in the default configuration, because the server binds loopback only (§4) and so has no shared cache to leak into — and it becomes live the moment LAN binding is authorized ([ADR-001](adr/ADR-001-browser-first-local-application.md)). **It must be closed before that phase, not during it.**

### 5.1 Per-Response CSP Nonce (Phase 4A)

Sandboxed HTML previews are delivered as `srcdoc` documents, and **srcdoc
frames inherit the parent document's CSP** (HTML Standard policy-container
model; see [webappsec-csp#700](https://github.com/w3c/webappsec-csp/issues/700)
— a child policy can never relax the parent's). Preview bootstrap and
user-JavaScript scripts must therefore carry exactly the nonce that appears in
the serving response's CSP header:

- The nonce is generated by Hono's official `NONCE` handler: 16 random bytes
  from `crypto.getRandomValues()`, base64-encoded, fresh per request.
- The same nonce is injected into the served SPA document as a
  non-executable `<meta name="rtwiki-preview-nonce">` tag; the preview builder
  reads it and stamps it on every script inside the sandbox.
- Header and body always originate from the same request context.
- HTML responses use `Cache-Control: no-store`, so a stored copy of the page
  can never be paired with a later response's nonce-bearing header.
- If an HTML response ever lacks a nonce, it is served without the meta tag
  and previews fail closed with a recoverable UI; basic serving is unaffected.

### 5.2 Sandboxed Preview Policy

The preview iframe uses `sandbox="allow-scripts"` — never `allow-same-origin`,
`allow-top-navigation`, `allow-popups`, or `allow-forms — giving it an opaque
origin. Its own stricter meta CSP is applied *in addition to* the inherited
parent policy (policies intersect):

```text
default-src 'none'; script-src 'nonce-<parent>'; script-src-attr 'none';
style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none';
media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none';
base-uri 'none'; form-action 'none'
```

The JavaScript pane is the only executable user-script source and runs **only
when the page's `jsEnabled` flag is on** (canonical content v2; legacy v1
documents normalize to disabled). When enabled it is emitted as a nonce'd
script element; when disabled the element is omitted entirely — the bootstrap
(our own code, required for navigation defense and status reporting) always
runs. Authored HTML is normalized in a browser-parsed copy (`script`,
`iframe`, `object`, `embed`, `base`, external stylesheets, `meta[http-equiv]`,
and inline `on*` attributes removed) before it enters the preview document,
while the stored source remains untouched. Because the iframe's origin is
opaque, `postMessage` uses `targetOrigin="*"`, so the parent validates every
message against three independent checks — `event.source ===
iframe.contentWindow`, a strict message schema, and an exact per-preview
channel ID generated with `crypto.getRandomValues()` — and silently ignores
anything else.

## 6. Upload and Request Limits

The `Config Key` column names what the code actually reads. Several entries previously named `config.*` paths that **do not exist** — `AppConfig` (`src/server/config/index.ts:15-29`) exposes flat `host`, `port`, `dataDir`, and has no `attachments`, `search` or `pages` sub-objects.

**There is no global request ceiling, and this table must not be read as implying one.** Every row
below is a *per-route* or *per-field* cap. Nothing bounds a request to a route that has no row.

| Limit | Default Value | Enforced by | Status |
|-------|--------------|-------------|--------|
| Maximum attachment size | 50 MB | `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES`, `src/shared/constants/index.ts:33`; Hono `bodyLimit` at `src/server/attachments/attachment-routes.ts:6,144` — applied **before** the body is parsed, so an oversized upload is never buffered | Built |
| Maximum page JSON body (create/update) | 4 MB | `MAX_PAGE_JSON_BODY_BYTES`, `src/shared/constants/index.ts:19`; enforced at `src/server/routes/pages.ts:46,55` | Built |
| Maximum schedule JSON body (entries, reminders, timetable presets) | 1 MiB | `MAX_SCHEDULE_JSON_BODY_BYTES`, `src/shared/constants/index.ts:28`; one shared reader at `src/server/routes/schedule.ts:30,35`, imported by `schedule-presets.ts` | Built — added in `138aa62` |
| Maximum settings JSON body | 4 KiB | A private `MAX_SETTINGS_BODY_BYTES` at `src/server/routes/settings.ts:17,45` — a module-local constant, deliberately not promoted to shared config | Built |
| Maximum HTML pane per page | 2 MiB UTF-8 | `MAX_HTML_BYTES`, `src/shared/schemas/html-content.ts:29,46` | Built |
| Maximum CSS pane per page | 512 KiB UTF-8 | `MAX_CSS_BYTES`, `src/shared/schemas/html-content.ts:30,47` | Built |
| Maximum JavaScript pane per page | 512 KiB UTF-8 | `MAX_JAVASCRIPT_BYTES`, `src/shared/schemas/html-content.ts:31,48` | Built |
| Client-error report size | 8 KB | `Content-Length` and raw byte length, before JSON parsing — `src/server/routes/client-errors.ts:90,95`, §10 | Built |
| Client-error rate limit | 20 per minute → `429` | §10 | Built |
| Client debug-event batch size | 32 KiB | `Content-Length` and raw byte length, before JSON parsing — `src/server/routes/client-debug-events.ts:89,94` | Built |
| **Global request body ceiling** | — | *No such control exists.* `MAX_REQUEST_SIZE` (100 MB) was **deleted** in `138aa62` | **Not implemented** — see below |
| Maximum search query length | 200 characters | `MAX_SEARCH_QUERY_LENGTH`, a module-local constant at `src/server/routes/pages.ts:24`, checked at `:81-88` before `listPages`; an over-long `q` is a `400` with an actionable message, never a silent clamp | Built — added in `476de71` |
| Maximum tags per page | 20 | *No limit found*, and **tags are not implemented as a feature**; there is no `page_tags` table in `migrations.ts` and no `tags` field on either page schema | **Not implemented** |
| Maximum title length | 200 characters | `z.string().min(1).max(200)` in both page schemas (`src/shared/schemas/pages.ts:4,29`), enforced at the route by `CreatePageSchema.safeParse` (`src/server/routes/pages.ts:108`) and `UpdatePageSchema.safeParse` (`:212`) — an over-long title is a `400` | Built |
| Import package size | — | *No import package cap is configured, and there is no global request ceiling to fall back on* | **Not implemented** (§2.5) |

**The only unbuilt row above is tags, and tags are not a reachable limit because the feature does not
exist.** The rows that remain genuinely unbuilt are the global request ceiling and the import-package
cap, both recorded above. This table previously listed the search term as unbounded at 500
characters and the title as unbounded; both were wrong — the search ceiling was added in `476de71`
and the title ceiling has always been in the schema. A row that reports a control as missing is as
misleading as one that reports a dead constant as enforced, and both were corrected here.

**On the deleted global ceiling — recorded so it is not reintroduced as a claim.** `MAX_REQUEST_SIZE`
(100 MB) existed until `138aa62`. It was not merely unenforced: it was **unreachable**, because
`createConfig()` is called only from tests — the runtime composition root uses
`resolveRuntimePaths()` and never constructs an `AppConfig`. It was also a poor number: below Bun's
own default transport ceiling of 128 MB and above every application-level cap in the table, so it
could not have changed any reachable outcome. A 100 MB limit that reads like protection while
governing nothing is worse than its absence, because every document naming it misleads the next
reader. The correct place for a real backstop is a `bodyLimit` registered in `createApp()` — the
composition root every security test exercises through `app.fetch`. **That backstop is still
unbuilt**, and the deletion is not a fix. Per §13 of [`AGENTS.md`](../AGENTS.md): a constant that is
declared, exported, typed and assigned but read by nothing is dead configuration, and a deleted
constant is not evidence that the limit it named now exists.

## 7. SQLite Integrity

- **WAL mode** is enabled for the database file to prevent corruption during crashes.
- **WAL mode** is enabled for the database file to prevent corruption during crashes — `src/server/database/index.ts`.
- **Foreign keys are enforced** via `PRAGMA foreign_keys = ON` at every connection — `src/server/database/index.ts:98`.
- **Transactions** wrap all multi-step operations. *Partly verified:* parameterised SQL with explicit `transaction(...)` calls lives in `src/server/repositories/` and `src/server/services/`. The parenthetical "backup creation" above this list is **not implemented** — see §8.
- **Integrity check** runs on startup: `PRAGMA integrity_check` (`src/server/database/index.ts:130`). The helper returns true only when SQLite reports a single `"ok"` row (`:125-131`). *Note:* the earlier claim that a failed check starts the app in a **read-only mode** prompting a restore was not verifiable in `src/`; the read-only branch is not confirmed, and with no restore feature there would be nothing to restore from. Treat the read-only fallback as unverified until the backup work lands.
- **The check throws rather than returning false on the worst corruption.** *Measured at `476de71`,
  and it inverts what the bullet above implies:* `checkIntegrity()` has no `try`/`catch`, and
  `PRAGMA integrity_check` does not always return rows to be judged. On a 60% truncation and on a
  file that is not a database at all it **throws**; on a 300-byte truncation it returns five error
  rows. So "returns true only for a single `ok` row" is correct but incomplete, and the intended
  failure path is not reached for the corruption classes that matter most. At the call in
  `src/server/bootstrap.ts` the exception propagates as a raw `SQLiteError` and the
  `'Database failed integrity check'` log line never fires. Any validator built by reusing this
  helper would crash instead of reject. See [KNOWN_BUGS.md](KNOWN_BUGS.md). *A fix adding the
  `try`/`catch` was present in the working tree but uncommitted and unverified when this was
  written, so it is not counted as built.*

## 8. Backup Validation

**Built.** The backup service is `src/server/backup/` and the restore endpoint is
`src/server/routes/backup.ts`. Before any restore moves a file, the candidate is validated by
`src/server/backup/validation.ts`, which runs the steps below in order and stops at the first
failure, returning a classified reason from `BACKUP_VALIDATION_REASONS` rather than a free-text
message.

A restore is the one operation in RTWiki that can destroy a working wiki, so the shape of this
feature is deliberately conservative: the current database is **moved aside, never deleted**, and —
because nothing in this codebase respawns the server — the user is told plainly to close and reopen
RTWiki. There is no relaunch, so no restart handshake is assumed.

The container is a **bare SQLite file**: no archive, no zip, no `manifest.json`.
[AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) §3 describes a `.rtwiki.zip` note-package, but that is
the content-import feature and a different one; a restore here reads a plain database, which is why
the steps below are file checks rather than archive checks.

Before any restore operation begins, the backup service validates:

1. **The 16-byte SQLite header.** Checked before opening, so a user who picks a photograph is told
   "this is not a database" instead of being handed SQLite's own wording for the same fact.
2. **The file opens as a database, through its own read-only connection** — never the live one, so
   validating a candidate can never corrupt the database a restore would replace.
3. **`PRAGMA integrity_check` returns a single `ok`.** **A throw counts as failure**, per §7.
   `integrity_check` alone is not sufficient even when it passes cleanly.
4. **`PRAGMA foreign_key_check` returns zero rows.** **Not covered by step 3** — SQLite documents
   that `integrity_check` "does not find FOREIGN KEY errors", and `foreign_keys = ON`
   (`src/server/database/index.ts:98`) means a restore leaving orphaned rows would otherwise pass.
   This is a separate, required step.
5. **Schema compatibility is checked against the `_migrations` table, not `user_version`.**
   `user_version` is never used anywhere in `src/`, so `_migrations` is the only authority that
   reflects what this build actually did. The required set is derived from the migration calls
   themselves (`appliedMigrationNames()`), not from a hand-maintained list that would drift without
   failing anything. Rejected in **both** directions: a backup carrying an unknown migration was
   written by a newer RTWiki, and one missing an expected migration would restore a half-migrated
   schema. The two report distinct reasons (`schema-too-new`, `schema-missing-migration`).
6. **User confirmation**, naming the file, its date and its size, and stating that the current data
   is moved aside rather than deleted. This is a decision, not a check, and lives in the UI — the
   route does not act on a passing validation without it having happened.
7. **Path containment.** A path from a client is a request to *name* a file, not permission to reach
   one. The name is taken as a basename before any path is built, and the result is re-checked with
   `path.relative` rather than a prefix comparison, because a prefix test does not hold at a drive
   root. The candidate is therefore always inside `data/backups/`, which is also why it can never be
   the live database.

If any validation step fails, the restore is aborted, **nothing has been moved**, and the user is
shown which check failed.

**A backup contains no deleted page content.** This is documented SQLite behaviour, not merely a
local observation: `VACUUM INTO` leaves *"all deleted content purged from the backup, leaving behind
no forensic traces"* — see [lang_vacuum.html](https://www.sqlite.org/lang_vacuum.html). Measured on
two functionally identical databases after deleting a row, a plain file copy still held the deleted
text in dead pages (40,960 bytes) while the `VACUUM INTO` output did not (8,192 bytes); both opened
cleanly with `integrity_check = ok`. For a private-notes wiki that is a deliberate property, recorded
here so it is not later mistaken for an accident. There is nothing to scrub.

**Backups carry no attachment bytes held outside the database.** A fully migrated database needs
exactly one file. The exception is a database caught mid-migration by `dropStoredName()`, where some
rows still have `data IS NULL` and their bytes remain in `data/attachments/`. The backup service
**refuses** in that state rather than producing a file that looks complete and is not — see §8.1.

### 8.1 How a backup is taken — measured constraints, now enforced

The list above says what to validate. These are the measured facts that constrain *how to produce*
the thing being validated, and each one closes off an approach that looks reasonable.

**A plain file copy of `rtwiki.sqlite` is not a backup, and the failure is silent.** The database
runs in WAL mode (`src/server/database/index.ts:97`), so the `-wal` file is part of its persistent
state. SQLite's WAL documentation is explicit that separating a database from its WAL "might lose
transactions that were previously committed". Measured against a live WAL database holding an
uncheckpointed committed table in its `-wal`:

```
source -wal exists     true
copy integrity_check   ["ok"]        <-- PASSES
copy sees late table   0             <-- and the committed table is GONE
```

**A copy that passes `integrity_check` while having lost committed data would be accepted as good
by every step in the list above.** That single measurement is the strongest argument for the
mechanism below, and it is why step 4 cannot be the only check.

**`VACUUM INTO` is the supported mechanism, and it is safe on a live database.** SQLite documents it
as "an alternative to the backup API for generating backup copies of a live database", and states
that while `VACUUM` is a write operation requiring the lock, **`VACUUM INTO` is not** — so it needs
no exclusive lock and does not block writers. Measured on a live, actively-written WAL database:
the command succeeded, the connection stayed open and writable, and the output returned
`integrity_check = ok`. It has no `-wal` of its own, which removes a whole class of restore mistake.
Three operational constraints come with it, all now enforced in `src/server/backup/backup-service.ts`:

- The target "must not previously exist, or else it must be an empty file". Measured on this
  machine: a second `VACUUM INTO` over an existing target fails with
  `SQLiteError: output file already exists`. So a backup is written to `rtwiki-backup-<period>.partial`
  and **moved onto its slot only on success** — forced by the API, not merely the safer style. A
  backup that failed halfway through while overwriting a slot would destroy the previous good copy,
  which is the one needed precisely when backups are failing.
- An interrupted run "might be incomplete and corrupt", so a leftover `.partial` is a corrupt file
  sitting where a backup belongs. They are swept at startup, because "delete on failure" does not run
  when the process is killed. Measured on this machine: `fs.rename` over an existing *file* succeeds
  on Windows, so no delete-then-rename fallback is written; renaming onto a *directory* fails
  `EPERM`, which is unreachable here because the slot name comes from a fixed list.
- It is not incremental, and it is not synchronised unless `PRAGMA synchronous` is `NORMAL` or
  `FULL` — see below.

**The open-transaction question is not settled by the documentation, and was measured instead.**
SQLite documents that *"a VACUUM will fail if there is an open transaction on the database connection
that is attempting to run the VACUUM"*, and that unfinalized statements typically hold a read
transaction open. Whether that applies to `VACUUM INTO` is **not stated**: the same page says it
"works the same way except that it uses the file named on the INTO clause", which is an inference,
and the very next sentence says `VACUUM` (but not `VACUUM INTO`) is a write operation — which is
precisely what that rule protects. The backup is therefore never invoked from inside a transaction,
and a `VACUUM INTO` that fails transiently is reported rather than retried into silence.

**`PRAGMA synchronous` is now set explicitly to `FULL`** (`src/server/database/index.ts`, in
`initDatabase`). It was previously never set anywhere in `src/` or `scripts/`, so SQLite's
compiled default applied — `FULL` in practice, which happened to satisfy the guarantee above, but
only by resting on a build flag in a dependency RTWiki does not control. On `VACUUM INTO` the
setting is load-bearing rather than cosmetic: SQLite's documented guarantee that the output is
fsync'd is conditional on it, so leaving it unset would have made every backup's durability a
property of the Bun build. `FULL` rather than `NORMAL` deliberately: autosave commits every
`PROVISIONAL_AUTOSAVE_DEBOUNCE_MS`, so the fsync cost is a handful per second and negligible,
whereas `NORMAL` in WAL mode trades power-loss durability for throughput. The wrong trade for
someone's notes.

**Attachments are BLOBs, so a fully migrated database needs exactly one file — with one measured
exception.** Bytes live in `attachments.data` (`src/server/database/migrations.ts:245`) and no route
reads them from disk, so there is nothing else to copy. The exception:
`dropStoredName()` (`:323-336`) deliberately **retains** the `stored_name` column when any row still
has `data IS NULL`, and logs `attachment_backfill_incomplete`. A database in that state still has
bytes in `data/attachments/`, so **that** database needs the directory too. A backup routine must
detect it with `SELECT count(*) FROM attachments WHERE data IS NULL` and either back up the directory
or refuse — silently omitting it is exactly the content loss `AGENTS.md` §4 forbids.
**It refuses**, and says so: `countAttachmentsAwaitingBytes()` in
`src/server/backup/validation.ts` makes a one-file backup a two-part backup and double the restore
path, which is the worse trade for a state that resolves on the next boot. Note the window is narrow
and easy to misjudge — migration `008_drop_stored_name` rebuilds the table with `data BLOB NOT NULL`,
so on a fully-migrated database the `data IS NULL` check cannot match at all. It is reachable only
between `007_attachment_blobs` (which adds a *nullable* column) and `008` (which is deliberately
skipped while any row still has bytes on disk). A guard that refused unconditionally would therefore
stop every backup forever.

**A standing check, not a one-off:** the bundled SQLite version is a property of the **Bun**
version, not of anything `package.json` pins, so no dependency bump would ever flag it. Measured
here: Bun 1.4.2 ships SQLite **3.53.2**. SQLite documents a WAL-reset bug that "is likely present in
all versions of SQLite from 3.7.0 through 3.51.2" and is "fixed in version 3.51.3 and later", so the
current build is above it — but a Bun downgrade below 3.51.3 would silently introduce a corruption
bug. Re-check this whenever the Bun version changes.

## 9. No Secrets in Git

- `.env` files, API keys, tokens, and passwords must never be committed.
- The `.gitignore` excludes `.env` and `.env.*` (while keeping `.env.example`).
- Configuration values that are secrets use environment variables at runtime only.

## 10. Local Diagnostics Endpoint and Log Privacy

### Client-Error Reporting (`POST /api/client-errors`)

The frontend reports sanitized failure diagnostics (React error-boundary catches,
`window.error`, unhandled promise rejections, Rich Note parse/save/init
failures) to this local-only endpoint.

Protections, in evaluation order:

1. **Same-origin** enforcement via fetch metadata (`Sec-Fetch-Site`, `Origin`,
   
eferer`) compared against the *actual* request URL origin — no hardcoded
   host, so the check keeps working if RTWiki is ever served from another
   loopback or LAN address in an authorized future phase.
2. **JSON only**: `application/json` content type required.
3. **8 KB payload cap** enforced through `Content-Length` and the raw byte
   length of the body **before** any JSON parsing.
4. **Rate limit**: rolling window of 20 reports per minute → `429`.
5. **Shared schema** (`src/shared/schemas/client-error.ts`): closed event-name
   enum, page-type enum, strict field caps (component ≤100, error name ≤120,
   message ≤300, stack location ≤200, correlation ID ≤64), unknown fields
   stripped. No arbitrary context objects are accepted.
6. **Secret scrubbing**: the per-process shutdown token is removed from every
   accepted field before the report reaches the log file.

Accepted reports are written only to `logs/rtwiki.log` through the structured
logger as `client_error` events. There is deliberately **no HTTP endpoint that
can read log files**.

The frontend reporter never transmits page titles, page content, BlockNote
document JSON, cookies, or authorization headers. Known failure classes use
canned messages; stacks are reduced to a single top-frame basename with
line/column; correlation IDs are generated with `crypto.getRandomValues()`.

### Log File Privacy

- Location: `<RTWiki.exe directory>/logs/rtwiki.log` with bounded rotation
  (
twiki.1.log` … 
twiki.3.log`, 1 MB threshold, oldest deleted first).
- Directory paths are redacted before logging (`%USERPROFILE%`, `%TEMP%`,
  `<repo>`, `<exe-dir>`); the Windows username must never appear.
- Never logged: shutdown tokens, page content, BlockNote JSON, request bodies,
  cookies, authorization headers.
- Normal successful HTTP and static-asset requests are not logged.

## 10A. Desktop Shell Trust Boundary (ADR-011)

**Built but never executed here.** The Rust sources are real and tracked — `src-tauri/src/main.rs`, `sidecar.rs`, `Cargo.toml` — and the capability manifest is real. But `bun run build:desktop` requires a Rust toolchain that is not installed in this environment, and the compiled shell has never been built or run on this machine. Treat every control below as **verified by source reading only**, not by execution. The web application does not depend on any of it.

The Tauri shell extends the trust boundary with native OS capabilities. These
rules keep the web content untrusted even inside the native window:

- The webview loads **only** the loopback origin (`http://127.0.0.1:<port>/`).
  A Rust-side navigation handler refuses navigation to any other URL, so web
  content can never steer the window to an attacker-controlled origin.
  **Verified** — `on_navigation` at `src-tauri/src/main.rs:429-431` checks
  `url.host_str()` against `127.0.0.1` and the Tauri scheme; the sidecar binds
  `http://127.0.0.1:{port}` (`sidecar.rs:62`).
- Tauri capabilities granted to the frontend are least-privilege: `core:default`
  plus autostart query/enable/disable and notification permission/send only. No
  filesystem, shell-execute, dialog, or arbitrary window-management permissions
  are exposed to web content. **Verified** in `src-tauri/capabilities/default.json`
  — the permission list is exactly the 16 entries above and contains no fs, shell
  or dialog permission. The prose above previously said "autostart query/enable/disable
  and notification"; the file also grants eight `core:window:*` calls (drag, minimize,
  maximize, unmaximize, toggle-maximize, is-maximized, hide, close), which are
  window management of the app's own window and are within the same least-privilege
  intent. `src-tauri/capabilities/remote-loopback.json` also exists; **not audited
  in this pass** — reported, not cleared.
- The sidecar is spawned from Rust with an explicit executable path and an
  argument array (`RTWikiServer.exe --no-open --port <port>`) — never through a
  shell string — so no injection is possible through the launch path.
- The graceful-shutdown token is generated per launch, passed to the sidecar
  over a local channel (environment), and never logged (see §10).
- `data/window-state.json` contains only window geometry (integers and a
  boolean) and is excluded from backups. **Verified** for the content claim
  (`src-tauri/src/geom.rs:4,13`); the backup-exclusion half is **untestable
  today** because no backup feature exists (§8).
- Autostart registers the current executable path. Moving the application
  folder after enabling autostart leaves a stale entry until the toggle is
  reset; the Settings/tray toggle rewrites the entry on change.
- The strict Content-Security-Policy (§5) applies unchanged in the desktop
  window. If the Tauri IPC bootstrap ever proves incompatible with it, a
  desktop-scoped CSP accommodation requires a dedicated security review
  (ADR-011 revisit condition) — it must never be weakened silently. The
  frontend bridge degrades to browser APIs in the meantime.

## 11. Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — where sanitization and validation happen in each layer
- [KNOWN_BUGS.md](KNOWN_BUGS.md) — the measured defects behind §4.1, §6 and §7, with their evidence
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — coding standards that enforce these requirements
- [DATA_MODEL.md](DATA_MODEL.md) — soft-delete and attachment safety in the data layer
- [CI_CD.md](CI_CD.md) — security linting and static analysis in the build pipeline
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
- [ADR-011](adr/ADR-011-tauri-desktop-wrapper.md) — desktop shell trust boundary
