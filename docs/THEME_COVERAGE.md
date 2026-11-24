# Theme coverage — definition of done

Status: **implementation complete** (Phases 1–4b). This document is the
authoritative definition of done for the RTWiki theme system. It records the
coverage matrix, the resolved owner decisions, the work stages and their gates,
and the enforcement that keeps future changes honest. It is the repo-appropriate
record of the coverage plan; the full gap-audit narrative is not duplicated here.

A theme change is done only when every matrix row below is green **or** has a
registered, owner-approved waiver in [theme-waivers.md](theme-waivers.md).

## Coverage matrix

Four dimensions. Every combination is covered by an automated check or a
registered waiver.

### Consumers (C1–C10) — what reads colour

| ID | Consumer | Required coverage |
|----|----------|-------------------|
| C1 | `var(--rtwiki-*)` in CSS | Resolved value equals the theme token, every theme/scheme |
| C2 | `var(--mantine-color-*)` surface roles in CSS | Override in resolver; resolved equals mapped theme token |
| C3 | `var(--mantine-color-*)` palette/accent roles | Unchanged across theme switch (stability gate) |
| C4 | Mantine component internals (Button/Input/Menu/Popover/Modal/Tooltip/disabled) | Computed-style probe on real components, every theme/scheme |
| C5 | TSX inline styles + style props | Theme var / `currentColor` or allowlist; no literal colour |
| C6 | JS-generated style objects (CodeMirror) | Theme var / `color-mix()`; scheme-aware; values asserted |
| C7 | SVG presentation attributes | `currentColor` or theme var; computed colour asserted |
| C8 | Third-party surfaces (BlockNote, Wunderbaum, CodeMirror, KaTeX, Mermaid, Mantine dates/notifications/schedule) | Each classified bridged-to-theme / scheme-aware / accepted-static / scheme-matched; Mermaid scheme-matched + transparent, theme-following deferred |
| C9 | Literal CSS colours & non-token `--rtwiki-*` colour definitions | Allowlist-or-tokenize gate; new literals fail; tracked-debt literals baselined |
| C10 | Pseudo/UA surfaces (`::selection`, focus rings, scrollbars, caret, overlay/backdrop) | Explicit rows; contrast at extremes; computed-style where possible |

### Delivery paths (D1–D5)

| ID | Path | Required coverage |
|----|------|-------------------|
| D1 | Pre-paint bootstrap (`server/theme/bootstrap.ts` → injected `<style>`) | Emitted CSS contains all overrides; canonical parity with D2 |
| D2 | Live resolver (`web/theme/css-variables.ts` → Mantine style tag) | Same canonical key/value map as D1 |
| D3 | Slider live update (`theme-provider.tsx`) | Computed style changes immediately; rapid-change last-write-wins |
| D4 | Sandboxed iframe `srcdoc` (`preview-frame.tsx` → `preview-document.ts`) | CSP/meta ordering, canvas/text colours, scrollbar/`currentColor`, rebuild on change, isolation from app vars |
| D5 | Bootstrap/Mantine attribute handoff & FOUC | Initial attributes correct; no flash before React; manager/bootstrap cannot disagree; scheme-choice sync |

D1 and D2 are compared as canonical normalized key/value maps, not raw bytes.

### Platforms / environments / schemes (P1b, P2, P3, P4)

| ID | Axis | Values | Coverage |
|----|------|--------|----------|
| P1b | Runtime targets | Vite dev, production Bun server, compiled portable desktop (WebView2) | D1/D2/D3 smoke parity on each |
| P2 | Scheme | light, dark, auto | All; auto initial + live OS flip + manual override persistence + reload |
| P3 | Theme | `default`, `pastel-dreams`, `catppuccin`, `vercel` | 4 × 2 schemes × 2 platforms = 16 screenshots |
| P4 | Environment | forced-colors (basic unreadability check), `prefers-contrast/more`, `prefers-reduced-motion`, live OS scheme flip | Accessibility pass. **Print is out of scope** (owner does not print notes) |

### Adjustment cases (A1–A7)

| ID | Case | Coverage |
|----|------|----------|
| A1 | Contrast 50 / 100 / 150 | WCAG gate at 50/150 for C1/C2/C4/C6/C10; 100 pixel-identical |
| A2 | Glass 30 / 100 | Computed alpha on every floating surface, light and dark |
| A3 | Reset → 100 | DB and CSS return to baseline |
| A4 | Invalid inputs (NaN, null, <min, >max, non-integer, corrupt DB) | Clamped safe; no CSS injection or broken style |
| A5 | Combinations | Full cross-product of theme × scheme × the six nominal adjustment states |
| A6 | Rapid slider changes / persistence races | Burst updates, last-write-wins, no stale reapply |
| A7 | Saturation policy at L clamp | Clamp + preserve token ordering/readability |

## Resolved owner decisions (2026-11-24)

1. **Status colours fixed (C3/C8).** Red = error, green = success, amber =
   warning mean the same thing in every theme. Each status colour passes a
   contrast check on every theme surface (canvas/pane/rail/elevated) in light
   and dark; the C3 stability test asserts they do not change on theme switch.
   This is a decision, not a waiver.
2. **Mermaid scheme-matched, transparent, theme-following deferred (C8).**
   Mermaid keeps its own `default`/`dark` theme selected by the app scheme and
   renders on a transparent background. Diagrams use many colours; following
   every theme risks unreadable ones. See waiver W-004.
3. **Fallback approved with structured logging (C2).** The three risky Mantine
   surface keys — `--mantine-color-default`, `--mantine-color-disabled`,
   `--mantine-color-disabled-border` — are not overridden, so default and
   disabled controls stay visually distinct. Every fallback emits a structured
   log entry (theme id, scheme, variable, mapped value, reason). See W-006.
4. **Accessibility scope (P4).** `prefers-reduced-motion` in; forced-colors
   basic one-time unreadability check in; `prefers-contrast/more` in; live OS
   scheme flip in; **print out** (deferred — the owner does not print notes).
5. **Motion ownership.** `MOTION` in `src/web/config/index.ts` is the sole
   authoritative home for shared application motion, emitted as
   `--rtwiki-motion-*` by `css-variables.ts`. Tab (`ease`), tree hover
   (`ease-out`) and card hover (`ease`) are separate values despite sharing
   150ms — different easing means a different interaction decision, so they are
   never consolidated by matching numbers. Tree-quick (80ms) stays single-use
   in `customization.css`; window-chrome (75ms) and Markdown (120ms) are
   documented exemptions. `tests/theme-motion-gate.test.ts` guards the baseline.

**Mantine-owned fixed base (Stage 1).** `FIXED_MANTINE_BASE`
(`src/web/theme/mantine-base.ts`) pins `fontFamilyMonospace` to Mantine's exact
default — consumed as `--mantine-font-family-monospace` by `editor-theme.ts` and
`markdown-columns.css` — and sets `respectReducedMotion: true` for decision 4.
Mantine's `Collapse`, `Transition` and `FloatingIndicator` zero their transition
durations under that setting; none of those three components are in use today,
so enabling it has no rendered effect yet. All other absent Mantine fields stay
deferred; `tests/theme-mantine-base.test.ts` guards both additions and the
deferred set.

## Work stages and gates

| # | Stage | Gate | Status |
|---|-------|------|--------|
| 1 | Emission unification | D1/D2/D3 parity, C1/C2/C3, scheme-correct floating bg, Decision 3 fallback distinctness + structured log assertion, Decision 1 status-colour readability | Complete |
| 2 | Rendered consumers | C4/C5/C6/C7/C8/C9/C10: browser computed-style spec on real components (C4/C8/C10) + desktop screenshot smoke; desktop computed-style spec not performed (see W-005). Mermaid scheme-matched transparent rendering. Mantine style-tag CSP nonce gate dropped (see W-007). | Complete |
| 3 | Adjustments | A1–A7: WCAG + alpha + parity tests, clamping, combinations, races, saturation | Complete |
| 4 | Delivery & environments | D4/D5, P1b/P2/P3/P4: iframe probe, no-flash probe, 16 screenshots, accessibility pass | Complete |
| 5 | Docs | This matrix as definition of done; token/consumer inventory; waiver registry | Complete |
| 6 | Enforcement | CI gates + PR rule + docs-sync guard (below) | Complete |

## Enforcement

- `.github/workflows/build.yml` already runs `bun test` (discovers every
  `*.test.ts`, including the theme coverage/consumer/contrast/adjustment and
  docs-sync suites) and `bunx playwright test` (discovers
  `tests/browser/theme-universal.pwspec.ts`). All theme tests are therefore
  CI-gated on push and pull request; no redundant theme-specific CI job is added.
- `.github/workflows/docs-quality.yml` runs `bun scripts/verify-docs.ts` on
  Markdown changes, checking relative links, heading anchors and document
  structure. [AGENTS.md](../AGENTS.md) §13 requires the same command locally
  whenever docs or links change.
- `tests/theme-docs-sync.test.ts` is the docs-sync guard: it fails if a theme
  JSON id, waiver ID, or the C9 baseline drifts out of these docs.

## PR rule

Any change to theme files, CSS colour variables, iframe `srcdoc`, Mermaid
config, or third-party theme integration **must** update this matrix or add a
waiver to [theme-waivers.md](theme-waivers.md). The checkbox in
`.github/pull_request_template.md` makes this explicit at review time.

## Related documents

- [AGENTS.md](../AGENTS.md) — repository protocol (§6 architecture, §8 coding
  standards, §9 security, §13 documentation)
- [SECURITY.md](SECURITY.md) — sanitization and sandbox requirements for the
  iframe and diagram surfaces
- [CI/CD](CI_CD.md) — pipeline stages and quality gates
- [theme-waivers.md](theme-waivers.md) — registered exceptions to this matrix
