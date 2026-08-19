# ADR-007: Sandboxed Custom HTML/CSS/JS

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-19 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

Some AI-generated pages and advanced users want custom HTML, CSS, or JavaScript for layouts, interactions, or visual flourishes that the native block set (L1) and the `rt-*` vocabulary (L2) do not cover. RTWiki must permit this without breaking its hard guarantees: offline-only operation, localhost-only binding, no cloud dependency, and no compromise of the user's data or the rest of the application.

The question: how can custom HTML/CSS/JS be allowed at all, given that pasted/imported HTML is sanitized and scripts are stripped ([SECURITY.md](../SECURITY.md))?

## Decision

Custom HTML/CSS/JS (L3) is permitted **only inside an isolated sandbox**, with three trust levels:

1. **Bundled design system (trusted, always on).** The application's own Mantine theme tokens and component styles. No user-authored code.
2. **Per-page scoped CSS (user-authored, optional).** CSS that is encapsulated to the page that defines it and cannot affect the rest of the application. On by default within a page's own scope; toggleable.
3. **Per-page sandboxed JavaScript (user-authored, optional, off by default).** JS that runs only inside an `<iframe>` sandbox with no same-origin access, no database/filesystem access, and no network egress. Disabled by default and toggleable by a user setting.

**Trusted-global customization** (site-wide custom CSS/JS applied across all pages) is a **future, disabled-by-default** capability and is explicitly **not** part of the MVP.

### Sandbox Requirements

- The sandbox iframe uses `sandbox="allow-scripts"` **without** `allow-same-origin`, so it cannot reach the application's origin.
- A strict Content-Security-Policy is applied to the sandbox: `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'none'`.
- No network egress: `connect-src 'none'` blocks `fetch`/XHR/WebSocket to any host.
- No access to the parent DOM, `localStorage`, cookies, the database, or the filesystem.
- A clear visual indicator shows when a page contains active content.
- Active content (scripts) is **off by default**; the user must explicitly enable it.

### Authoring Surface

Custom content arrives via the note-package ([ADR-006](ADR-006-rich-content-and-import-contract.md)) as `style.css` and `script.js`, or via the localhost import API. It is never injected into the main application document.

## Alternatives Considered

| Alternative | Reason for Rejection |
|------------|---------------------|
| Allow custom JS in the main application context | Defeats offline/localhost-only security; could read the database or other pages. |
| Disallow custom content entirely | Too restrictive for advanced AI-generated pages; loses a key differentiator. |
| Use a separate sandboxed renderer process | Over-engineering for a portable Windows MVP; iframe sandbox meets the isolation requirement. |
| Enable global custom JS by default | Unacceptable risk; must remain opt-in and disabled by default. |

## Consequences

**Positive:**
- Advanced users and AI tools can extend pages beyond the native block set.
- Isolation preserves the offline, localhost-only security guarantees.
- Disabled-by-default active content keeps the default posture safe.

**Negative:**
- Sandboxed JS cannot integrate tightly with the app (by design).
- CSP tuning may restrict some legitimate custom scripts; documented as a limitation.

**Neutral:**
- Trusted-global customization is deferred; per-page scope is the MVP boundary.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Sandbox misconfiguration exposes same-origin | Low | Never set `allow-same-origin` with `allow-scripts`; CI checks the sandbox attributes. |
| User enables malicious script | Medium | Off by default; clear indicator; no DB/FS/network access even when enabled. |
| CSP blocks legitimate custom code | Medium | Document supported CSP; provide fallback to scoped CSS only. |

## Revisit Conditions

This decision should be revisited if:
- A trusted-global customization feature is approved by the owner (would become a new, opt-in capability).
- The Windows portable target cannot enforce iframe sandboxing reliably (unlikely).
- A requirement for custom content to access local data emerges (would require a new ADR and security review).

## Cross-References

- [ARCHITECTURE.md](../ARCHITECTURE.md) — custom content sandbox layer
- [SECURITY.md](../SECURITY.md) — sanitization and sandbox security requirements
- [ADR-006](ADR-006-rich-content-and-import-contract.md) — rich-content model and import contract
- [AI_CONTENT_IMPORT.md](../AI_CONTENT_IMPORT.md) — note-package custom content fields
