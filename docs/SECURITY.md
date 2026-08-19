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

**Script content is always stripped.** No `<script>`, `<iframe>`, `<object>`, or `<embed>` tags are permitted.

### 2.2 Mermaid Security Mode

Mermaid diagrams are rendered in strict security mode:
- JavaScript execution inside diagram code is disabled.
- Only the subset of Mermaid syntax supported by `@blocknote/diagram-block` is allowed.
- External resource loading (`href`, `src`) is blocked.

### 2.3 Paste Handler

The BlockNote paste handler converts incoming HTML/Markdown to BlockNote blocks using DOMPurify as an intermediate step. The conversion pipeline is:

```
Raw HTML → DOMPurify sanitize → HTML-to-BlockNote converter → BlockNote JSON
```

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
| `Referrer-Policy` | `no-referrer` | Prevent leaking internal paths |
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
3. The `rtwiki_version` in the manifest matches a compatible version range.
4. The SQLite database inside the archive passes `integrity_check`.
5. All attachment references in the manifest point to existing files in the archive.

If any validation step fails, the restore is aborted and the user is shown a clear error message.

## 9. No Secrets in Git

- `.env` files, API keys, tokens, and passwords must never be committed.
- The `.gitignore` excludes `.env` and `.env.*` (while keeping `.env.example`).
- Configuration values that are secrets use environment variables at runtime only.

## 10. Cross-References

- [ARCHITECTURE.md](ARCHITECTURE.md) — where sanitization and validation happen in each layer
- [DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md) — coding standards that enforce these requirements
- [DATA_MODEL.md](DATA_MODEL.md) — soft-delete and attachment safety in the data layer
- [CI_CD.md](CI_CD.md) — security linting and static analysis in the build pipeline
