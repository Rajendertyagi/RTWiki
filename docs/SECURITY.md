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
| Database corruption | Power loss, crash, concurrent writes | SQLite WAL + `foreign_keys = ON` + transactions + startup `integrity_check` | **Built** — `src/server/database/index.ts:98,130`, §7 |
| Accidental data loss | User deletes a page | Soft delete + recycle bin | **Built** — `migrations.ts:24,64,70,74` |
| Accidental data loss | Restore from a corrupt or incompatible backup | Backup validation before restore | **Not implemented.** No backup or restore feature exists in `src/`; `data/backups/` is created at startup and stays empty. §8 is a requirement, not a description |
| Unauthorized LAN access (future) | Someone on the local network discovers the server | Localhost binding by default; LAN access requires explicit opt-in | **Built** — §4 |

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
4. Warnings surfaced rather than silent content loss; unknown blocks preserved by `containUnknownBlocks()`, which rewrites each into a `codeBlock` holding its exact JSON behind `UNSUPPORTED_BLOCK_MARKER` (`src/web/features/rich-editor/document.ts:110`, `src/shared/constants/index.ts:68`).

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
- Request and package size limits are enforced before parsing (ZIP-bomb protection). No import-package size cap is configured today; the general request ceiling is `MAX_REQUEST_SIZE` (100 MB), which is not a substitute — an agent must not treat it as one.
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

The `config.server.host` paths named below **do not exist**. `AppConfig` (`src/server/config/index.ts:16-31`) exposes a flat `host`; the default is `DEFAULT_HOST` at `src/shared/constants/index.ts:11`, and the resolved paths come from `resolveRuntimePaths()` (`src/server/config/index.ts:79-101`).

| Mode | Configuration |
|------|--------------|
| **Default (localhost only)** | `DEFAULT_HOST` = `127.0.0.1` — `src/shared/constants/index.ts:11`, overridable by a flat `host` on `AppConfig` |
| **LAN access (future)** | Requires explicitly setting `host` to `0.0.0.0` or a specific interface IP |

The server must **never** bind to `0.0.0.0` by default. Future LAN access must require a deliberate configuration change documented in [ADR-001](adr/ADR-001-browser-first-local-application.md).

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

The `Config Key` column names what the code actually reads. Several entries previously named `config.*` paths that **do not exist** — `AppConfig` (`src/server/config/index.ts:16-31`) exposes flat `host`, `port`, `dataDir`, `maxRequestSize`, and has no `attachments`, `search` or `pages` sub-objects.

| Limit | Default Value | Enforced by | Status |
|-------|--------------|-------------|--------|
| Maximum attachment size | 50 MB | `PROVISIONAL_MAX_ATTACHMENT_SIZE_BYTES`, `src/shared/constants/index.ts`; Hono `bodyLimit` at `src/server/attachments/attachment-routes.ts:6,144` — applied **before** the body is parsed, so an oversized upload is never buffered | Built |
| Maximum request body size | 100 MB | `MAX_REQUEST_SIZE`, `src/shared/constants/index.ts:16` | **Defined but NOT enforced.** Declared at `:16`, imported at `src/server/config/index.ts:13`, typed at `:30`, assigned at `:53` — and read by nothing. No request path consults it, so no request is actually bounded by it. Do not cite it as a limit |
| Maximum page JSON body (create/update) | 4 MB | `MAX_PAGE_JSON_BODY_BYTES`, `src/shared/constants/index.ts:20` | Built |
| Maximum HTML pane per page | 2 MiB UTF-8 | `MAX_HTML_BYTES`, `src/shared/schemas/html-content.ts:29,46` | Built |
| Maximum CSS pane per page | 512 KiB UTF-8 | `MAX_CSS_BYTES`, `src/shared/schemas/html-content.ts:30` | Built |
| Maximum JavaScript pane per page | 512 KiB UTF-8 | `MAX_JAVASCRIPT_BYTES`, `src/shared/schemas/html-content.ts:31` | Built |
| Client-error report size | 8 KB | `Content-Length` and raw byte length, before JSON parsing — §10 | Built |
| Client-error rate limit | 20 per minute → `429` | §10 | Built |
| Maximum search query length | 500 characters | *No limit found* — no `maxQueryLength` in `src/` | **Not implemented** |
| Maximum tags per page | 20 | *No limit found*, and **tags are not implemented as a feature**; the `page_tags` table does not exist in `migrations.ts` | **Not implemented** |
| Maximum title length | 200 characters | *No limit found* in a page schema | **Not implemented** |
| Import package size | — | *No import package cap is configured.* The general 100 MB request ceiling is **not** a substitute | **Not implemented** (§2.5) |

The three unbuilt rows are limits a user can reach today, so they are real gaps rather than aspirational entries. The search row is the most exposed: `GET /api/pages?q=` takes a query string with no length bound (`src/server/routes/pages.ts:57,60`).

## 7. SQLite Integrity

- **WAL mode** is enabled for the database file to prevent corruption during crashes.
- **WAL mode** is enabled for the database file to prevent corruption during crashes — `src/server/database/index.ts`.
- **Foreign keys are enforced** via `PRAGMA foreign_keys = ON` at every connection — `src/server/database/index.ts:98`.
- **Transactions** wrap all multi-step operations. *Partly verified:* parameterised SQL with explicit `transaction(...)` calls lives in `src/server/repositories/` and `src/server/services/`. The parenthetical "backup creation" above this list is **not implemented** — see §8.
- **Integrity check** runs on startup: `PRAGMA integrity_check` (`src/server/database/index.ts:130`). The helper returns true only when SQLite reports a single `"ok"` row (`:125-131`). *Note:* the earlier claim that a failed check starts the app in a **read-only mode** prompting a restore was not verifiable in `src/`; the read-only branch is not confirmed, and with no restore feature there would be nothing to restore from. Treat the read-only fallback as unverified until the backup work lands.

## 8. Backup Validation

**Not implemented.** Measured: 0 matches for a backup or restore feature in `src/`. The directory `data/backups/` is real and is created at startup (`src/server/bootstrap.ts:130,137`; `src/server/config/index.ts:96`), but nothing is ever written to it. `VACUUM` appears once, at `src/server/database/migrations.ts:405`, and only to re-apply `auto_vacuum`.

The requirements below are unbuilt security work. **They must be satisfied before a restore endpoint exists** — a restore that validates nothing is a data-corruption and code-execution vector, which is why this section is kept rather than removed.

Before any restore operation begins, the backup service must validate:

1. The ZIP archive is readable and not corrupted (CRC check).
2. The archive contains a valid `manifest.json` with expected structure.
3. The `rtwiki_version` in the manifest matches a compatible version range.
4. The SQLite database inside the archive passes `integrity_check`.
5. All attachment references in the manifest point to existing files in the archive.

If any validation step fails, the restore is aborted and the user is shown a clear error message.

The one pre-existing safeguard this depends on is already real: `PRAGMA integrity_check` runs on startup and the check helper requires a single `"ok"` row (`src/server/database/index.ts:125-131`).

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
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — coding standards that enforce these requirements
- [DATA_MODEL.md](DATA_MODEL.md) — soft-delete and attachment safety in the data layer
- [CI_CD.md](CI_CD.md) — security linting and static analysis in the build pipeline
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
- [ADR-011](adr/ADR-011-tauri-desktop-wrapper.md) — desktop shell trust boundary
