# Theme waiver registry

No silent exceptions. Every deviation from the coverage matrix in
[THEME_COVERAGE.md](THEME_COVERAGE.md) must appear here with all seven required
fields: ID, matrix row, rationale, owner, date, revisit/expiry condition, and
compensating control. A row without a compensating control is not a waiver.

Status colours fixed (Decision 1) is a **decision**, not a waiver; it is recorded
in [THEME_COVERAGE.md](THEME_COVERAGE.md).

| ID | Matrix row | Rationale | Owner | Date | Revisit / expiry condition | Compensating control |
|----|------------|-----------|-------|------|----------------------------|----------------------|
| W-001 | C2 / A1 | Border token is a subtle divider by design; interactive controls are distinguished by background fill and focus rings, so WCAG 1.4.11 does not apply to purely decorative separation. Measured 1.00–2.33:1 at contrast 150 (src/web/theme/contrast-rules.ts). | Owner decision via centralized rule book (contrast-rules.ts) | 2026-11-24 | If the border token becomes a UI-component boundary rather than a decorative divider | Text meets 4.5:1; focus rings and background fill distinguish controls |
| W-002 | D5 | With JavaScript disabled the inline bootstrap script cannot set data-* attributes for scheme selection; RTWiki requires JS to run. | Phase 4a implementation, owner-accepted limitation | 2026-11-24 | If JS-free rendering becomes a product requirement | Server-injected pre-paint style plus a JS-enabled/bundles-blocked test |
| W-003 | C9 | Pre-existing tracked-debt literals in customization.css (spellcheck underline + 6 diagram template colours) and source-find-dialog.module.css (dialog shadow) are baselined with dispositions in tests/theme-consumers.test.ts; the gate blocks NEW literals only. | Phase 2 C9 gate, owner-accepted tracked debt | 2026-11-24 | When tokenization of the tracked-debt literals is scheduled | Explicit baseline with per-entry dispositions in tests/theme-consumers.test.ts |
| W-004 | C8 | Mermaid diagrams use many colours; following every RTWiki theme risks unreadable combinations, so theme-following is deferred (Decision 2). | Owner decision (Decision 2) | 2026-11-24 | If the owner wants Mermaid to follow RTWiki themes | Scheme-matched transparent rendering verified in Phase 4a |
| W-005 | P1b | The desktop sidecar RTWikiServer.exe is absent from this checkout; the borrowed production Bun server was used instead, so the sidecar-spawn path itself was not exercised. | Phase 4b implementation, owner-accepted limitation | 2026-11-24 | When the sidecar executable is available in the checkout | Desktop shell rendering and theme switching verified via the borrowed server, with 8 desktop screenshots |
| W-006 | C2 | The risky Mantine surface keys --mantine-color-default, --mantine-color-disabled and --mantine-color-disabled-border are kept at Mantine defaults to avoid flattening default buttons and disabled controls (Decision 3); every fallback emits a structured log entry. | Owner decision (Decision 3) | 2026-11-24 | After visual validation of the risky surface mappings | Structured fallback-log assertion plus a default/disabled distinctness test |
| W-007 | D5 | Mantine style-tag CSP nonce gate dropped — `styleSrc` already includes `'unsafe-inline'` (required by Mermaid at src/server/app.ts:68), so no nonce is needed; no getStyleNonce wiring exists in theme-provider.tsx or main.tsx. | Owner decision — gate dropped as unnecessary | 2026-11-24 | If CSP `styleSrc` no longer includes `'unsafe-inline'` (e.g. Mermaid removed or CSP tightened), requiring a nonce for Mantine's generated style tag | CSP `styleSrc` includes `'unsafe-inline'` at src/server/app.ts:68; nonce wiring deliberately absent and asserted by its absence in the theme provider and entry point |
