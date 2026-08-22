# Security

This document defines the security requirements and threat model for RTWiki. Because the application runs entirely offline on a shared family PC, the threat model focuses on local data integrity, accidental corruption, and malicious input from pasted content or uploaded files.

## 1. Threat Model

RTWiki runs on a single Windows PC with no network-facing attack surface by default. The primary threats are:

| Threat | Source | Mitigation |
|--------|--------|------------|
| Malicious HTML in pasted content | User pastes from a compromised website or AI response | DOMPurify sanitization before conversion to blocks |
| Malicious JavaScript in imported Markdown | User imports a Markdown file containing `<script>` tags | Sanitization at import time; scripts stripped |
| Path traversal via attachment upload | User uploads a file with a crafted filename | Canonical path resolution + directory confinement |
| Database corruption | Power loss, crash, concurrent writes | SQLite journal mode + WAL + transactions |
| Accidental data loss | User deletes pages or restores wrong backup | Soft delete + recycle bin + backup validation |
| Unauthorized LAN access (future) | Someone on the local network discovers the server | Localhost binding by default; LAN access requires explicit opt-in |

## 2. Input Sanitization

### 2.1 HTML Sanitization (DOMPurify)

All HTML input — whether pasted from a browser, imported from a file, or entered in raw HTML mode — must pass through DOMPurify before any part of it reaches the editor or the database.

**Allowed tags (configurable whitelist):**
`p, br, strong, em, u, s, code, pre, h1, h2, h3, ul, ol, li, blockquote, table, thead, tbody, tr, th, td, img, a, span, div`

**Forbidden attributes:**
`onclick, onerror, onload, onmouseover, style` (style attributes are allowed only if they contain safe CSS properties — implemented via DOMPurify `ADD_ATTR` configuration).

**Script content is always stripped from pasted and imported HTML.** No `<script>`, `<object>`, or `<embed>` tags are permitted in pasted or imported content. Author-supplied custom HTML/CSS/JS from a note-package is permitted only inside the isolated sandbox described in §2.4, never in the main application document.

### 2.2 Mermaid Security Mode

Mermaid diagrams use the documented default `securityLevel: "strict"`, which encodes HTML tags in diagram text and disables click functionality. RTWiki separately blocks unauthorized external-resource loading through its CSP, sanitization, asset, and network policies. Only the subset of Mermaid syntax supported by `@blocknote/diagram-block` is allowed.

### 2.3 Paste Handler

The BlockNote paste handler converts incoming HTML/Markdown to BlockNote blocks using DOMPurify as an intermediate step. The conversion pipeline is:

```
Raw HTML → DOMPurify sanitize → HTML-to-BlockNote converter → BlockNote JSON
```

### 2.4 Custom Content Sandbox

When a page supplies optional custom HTML/CSS/JS (L3), it is rendered only inside an isolated sandbox:

- The sandbox is an `<iframe>` with `sandbox` attributes that **deny same-origin access** (`sandbox="allow-scripts"` without `allow-same-origin`), disable forms where unsafe, and block all network egress (`connect-src 'none'`, no `fetch`/XHR to external hosts).
- The sandboxed content has **no access** to the application's database, filesystem, cookies, `localStorage`, or the parent DOM. It cannot read or modify other pages.
- A strict **Content-Security-Policy** is applied to the sandbox: `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'none'`.
- **Active content (scripts) is off by default** and toggleable by a user setting. When disabled, only scoped CSS renders; JavaScript does not execute.
- Any page using custom content shows a clear visual indicator that active content is present.
- Trusted-global customization (site-wide custom CSS/JS) is a future, disabled-by-default capability and is not part of the MVP.

### 2.5 AI Import API

The localhost import API (`POST /api/v1/import/pages`) is bound to the loopback interface only:

- It accepts no cross-origin requests (CORS is disabled); only the local machine may call it.
- Request and package size limits are enforced before parsing (ZIP-bomb protection).
- Incoming packages are validated against the manifest schema; entry names are checked for path traversal.
- Import is idempotent per client-supplied request id; duplicate submissions do not create duplicate pages.
- Custom JavaScript inside an imported package is confined to the sandbox (§2.4) and has no database, filesystem, or network access.

## 3. Attachment Safety

| Check | Implementation |
|-------|---------------|
| **Extension allowlist** | Only extensions listed in `config.attachments.allowedExtensions` are accepted |
| **MIME type validation** | The detected MIME type must match the extension's expected type |
| **Size limit** | Enforced by `config.attachments.maxFileSizeBytes` (default: 50 MB) |
| **Safe filename generation** | Stored as `<UUID>_<originalFilename>` to prevent injection and collisions |
| **Path traversal prevention** | The resolved canonical path of every attachment is verified to be within the data directory before serving |
| **No execution** | Uploaded files are stored and served as static content only. No script interpretation occurs |

## 4. Server Binding

| Mode | Configuration |
|------|--------------|
| **Default (localhost only)** | `config.server.host = "127.0.0.1"` |
| **LAN access (future)** | Requires explicit set of `config.server.host` to `"0.0.0.0"` or a specific interface IP |

The server must **never** bind to `0.0.0.0` by default. Future LAN access must require a deliberate configuration change documented in [ADR-001](adr/ADR-001-browser-first-local-application.md).

## 5. HTTP Security Headers

The Hono backend must set the following headers on every response:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking (internal app, not framed) |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'` | Restrict resource loading to local assets |
| 
eferrer-Policy` | `no-referrer` | Prevent leaking internal paths |
| `Cache-Control` | `no-store` (for API responses) | Prevent caching of dynamic data |

## 6. Upload and Request Limits

| Limit | Default Value | Config Key |
|-------|--------------|------------|
| Maximum attachment size | 50 MB | `config.attachments.maxFileSizeBytes` |
| Maximum request body size | 100 MB | `config.server.maxRequestBodyBytes` |
| Maximum search query length | 500 characters | `config.search.maxQueryLength` |
| Maximum tags per page | 20 | `config.pages.maxTagsPerPage` |
| Maximum title length | 200 characters | `config.pages.maxTitleLength` |

## 7. SQLite Integrity

- **WAL mode** is enabled for the database file to prevent corruption during crashes.
- **Foreign keys are enforced** via `PRAGMA foreign_keys = ON` at every connection.
- **Transactions** wrap all multi-step operations (page save, attachment upload, backup creation).
- **Integrity check** runs on startup: `PRAGMA integrity_check`. If it returns anything other than `"ok"`, the application logs a warning and starts with a read-only mode, prompting the user to restore from backup.

## 8. Backup Validation

Before any restore operation begins, the backup service must validate:

1. The ZIP archive is readable and not corrupted (CRC check).
2. The archive contains a valid `manifest.json` with expected structure.
3. The 
twiki_version` in the manifest matches a compatible version range.
4. The SQLite database inside the archive passes `integrity_check`.
5. All attachment references in the manifest point to existing files in the archive.

If any validation step fails, the restore is aborted and the user is shown a clear error message.

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

## 11. Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — where sanitization and validation happen in each layer
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — coding standards that enforce these requirements
- [DATA_MODEL.md](DATA_MODEL.md) — soft-delete and attachment safety in the data layer
- [CI_CD.md](CI_CD.md) — security linting and static analysis in the build pipeline
- [AI_CONTENT_IMPORT.md](AI_CONTENT_IMPORT.md) — note-package contract and import pipeline
- [ADR-006](adr/ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [ADR-007](adr/ADR-007-sandboxed-custom-content.md) — sandboxed custom content
