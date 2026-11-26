# Pending — actionable items

**Snapshot date:** 2026-11-26 · **Branch:** `develop` · **HEAD:** `7e8580f` (in sync with `origin/develop`)

This file records the remaining **actionable** work. Accepted exceptions that need no action are deliberately excluded; see [theme-waivers.md](theme-waivers.md) for those.

## 1. Commit and push the W-005 changes

The desktop sidecar smoke test passed and W-005 was removed, but the resulting edits are **uncommitted**. `origin/develop` is at `7e8580f` with no unpushed commits; only these local edits remain:

- `docs/THEME_COVERAGE.md` — desktop sidecar spawn recorded as verified
- `docs/VISUAL_AUDIT_FINAL_REPORT.md` — finding F7, W-005 disposition, limitations
- `docs/theme-waivers.md` — W-005 row removed (waivers 12 → 11)
- `tests/theme-docs-sync.test.ts` — 11 expected IDs, non-vacuous W-005 removal assertion

**Action:** commit these four files and push to `origin/develop`. Awaiting owner authorization.

**Verification already run on this tree:** `bunx tsc --noEmit` clean; `bun run format:check` clean (511 files); `bunx biome lint` clean; `bun test` 2096 pass / 0 fail; `bun scripts/verify-docs.ts` PASS (0 failures/warnings).

## 2. W-004 — Mermaid theme-following

**Status:** deferred by owner Decision 2; left untouched at the owner's instruction.

**Blocker:** an owner go/no-go decision. If the answer is no, the waiver stays as a valid documented decision and no work is pending.

**If yes:**

1. Switch from scheme-only `theme: 'default' | 'dark'` (`src/web/features/rich-editor/blocks/mermaid-render.ts:117,175`) to Mermaid `theme: 'base'` with `themeVariables` derived from RTWiki semantic tokens.
2. Thread the active theme into `renderMermaidSvg` (it currently receives only `'default' | 'dark'`).
3. Keep `securityLevel: 'strict'`, `htmlLabels: false`, `look: 'classic'`, `layout: 'dagre'` intact — these are load-bearing and asserted by tests.
4. Verify contrast/readability across all 4 themes × 2 schemes; update `tests/mermaid-security.test.ts`, `tests/mermaid-cross-surface.test.ts`, `tests/browser/diagram-labels.pwspec.ts` and the docs; then remove W-004.

**Risk:** arbitrary theme colors can produce unreadable diagrams — this is why it was deferred. A contrast-validated mapping is required, not a blind palette injection.

## 3. W-006 — risky Mantine surface keys

**Status:** pending focused visual validation.

The three keys `--mantine-color-default`, `--mantine-color-disabled` and `--mantine-color-disabled-border` are kept at Mantine defaults to avoid flattening default/disabled controls (`src/web/theme/css-variables.ts:59-71`); every fallback emits a structured log. The 260-screenshot visual audit covered the app broadly but did **not** specifically target disabled/default control states, so it does not satisfy the waiver's revisit condition.

**Action:** capture and visually inspect default and disabled controls (buttons, inputs, menu items) across all 4 themes × 2 schemes. If the mappings are safe, apply them and remove W-006; if not, record the visual evidence and keep the waiver with that evidence.

## Related proposed work (not part of this task)

[PLAN_EXTERNAL_AI_INTEGRATION.md](PLAN_EXTERNAL_AI_INTEGRATION.md) is a plan for external AI integration and recovery, approved by the owner with three targeted refinements on 2026-11-26. Its audit is in [PLAN_EXTERNAL_AI_INTEGRATION_AUDIT.md](PLAN_EXTERNAL_AI_INTEGRATION_AUDIT.md). Phase 0 of that plan is a hard gate; execute one phase at a time with review between phases.
