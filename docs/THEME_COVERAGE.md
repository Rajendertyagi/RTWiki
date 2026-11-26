# Theme coverage — definition of done

Status: **implementation complete** (Phases 1–4b). This document is the
authoritative definition of done for the RTWiki theme system. It records the
coverage matrix, the resolved owner decisions, the work stages and their gates,
and the enforcement that keeps future changes honest. It is the repo-appropriate
record of the coverage plan; the full gap-audit narrative is not duplicated here.

A theme change is done only when every matrix row below is green **or** has a
registered, owner-approved waiver in [theme-waivers.md](theme-waivers.md).
"Complete" below means the named gate exists and runs in CI — not that a plan
sentence merely describes an intention. Every claim carries a file reference.

## Implementation evidence (Phase 4b reconciliation)

| Claim | Evidence |
|-------|----------|
| S1 literal-value gate covers **all five** promised classes — sizes, spacing, radius, motion durations, z-index — in `src/web/**/*.css` **and** TSX `style={{…}}` objects, class-aware, with per-class baselines/dispositions and fail-on-new-literal | `tests/theme-spacing-gate.test.ts` (`CLASS_RULES`, `CLASS_BASELINE`, `findClassLiterals`); synthetic tests prove each class is scanned and a new literal in each class fails |
| S2 computed-style conformance across 4 themes × light/dark | `tests/browser/theme-s2-conformance.pwspec.ts` |
| C4 Mantine component internals on real components | `tests/browser/theme-c4-components.pwspec.ts`; internal reference path rendered by `src/web/features/theme-showcase/theme-showcase.tsx` |
| C9 literal-colour gate (15-entry baseline) unchanged | `tests/theme-consumers.test.ts` |
| Reduced motion disables **RTWiki-owned** CSS transitions, not just Mantine's | `src/web/theme/customization.css` `@media (prefers-reduced-motion: reduce)`; real computed-style check in `tests/browser/theme-universal.pwspec.ts` (P4) |
| A6 real interaction → API → SQLite → reload persistence and last-write-wins | `tests/browser/theme-universal.pwspec.ts` (A6 "real slider changes persist…") drives the actual Mantine sliders; the older synthetic-event test remains as a race check |
| Document typography stays relative (32 `intentional-relative` em entries) | `tests/theme-spacing-gate.test.ts` (`TYPOGRAPHY_RATIONALE`, drift guard) |
| Document heading ratio scale is present and unchanged (h1 1.85em, h2 1.45em, h3 1.2em, h4 1.05em, h5/h6 0.95em) | `tests/theme-spacing-gate.test.ts` ("document heading ratio scale is present and unchanged"), reading `src/web/features/markdown/markdown-content.css:122-155` |
| Third-party computed-style conformance (CodeMirror, KaTeX, Mermaid) | `tests/browser/theme-third-party.pwspec.ts`; probes rendered by `src/web/features/theme-showcase/theme-showcase.tsx` using the production modules `editor-theme.ts`, `markdown-render.ts` and `mermaid-render.ts` |
| Forced-colors / print evidence | `tests/browser/theme-universal.pwspec.ts` (P4 emulates `forcedColors: 'active'` and asserts text stays distinct from background); no `@media print` rule exists anywhere in `src/web` (source scan), so print is out of scope per owner decision 4 |
| Motion ownership (`MOTION` + documented single-use exemptions) | `tests/theme-motion-gate.test.ts` |

## Coverage matrix

Four dimensions. Every combination is covered by an automated check or a
registered waiver.

### Consumers (C1–C10) — what reads colour

| ID | Consumer | Required coverage |
|----|----------|-------------------|
| C1 | `var(--rtwiki-*)` in CSS | Resolved value equals the theme token, every theme/scheme |
| C2 | `var(--mantine-color-*)` surface roles in CSS | Override in resolver; resolved equals mapped theme token |
| C3 | `var(--mantine-color-*)` palette/accent roles | Unchanged across theme switch (stability gate) |
| C4 | Mantine component internals (Button/Input/Menu/Popover/Modal/Tooltip/disabled) | Computed-style probe on real components, every theme/scheme — `tests/browser/theme-c4-components.pwspec.ts`, rendered through the internal showcase at `src/web/features/theme-showcase/theme-showcase.tsx` |
| C5 | TSX inline styles + style props | Theme var / `currentColor` or allowlist; no literal colour |
| C6 | JS-generated style objects (CodeMirror) | Theme var / `color-mix()`; scheme-aware; values asserted |
| C7 | SVG presentation attributes | `currentColor` or theme var; computed colour asserted |
| C8 | Third-party surfaces (BlockNote, Wunderbaum, CodeMirror, KaTeX, Mermaid, Mantine dates/notifications/schedule) | Each classified bridged-to-theme / scheme-aware / accepted-static / scheme-matched; Mermaid scheme-matched + transparent, theme-following deferred. Computed-style checks for CodeMirror (`editor-theme.ts` chrome tokens), KaTeX (`markdown-content.css` `.katex` colour and 1.04em ratio) and Mermaid (transparent SVG background + scheme-matched theme) run in `tests/browser/theme-third-party.pwspec.ts` across all 8 theme × scheme combinations |
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
| P4 | Environment | forced-colors (basic unreadability check), `prefers-contrast/more`, `prefers-reduced-motion`, live OS scheme flip | Accessibility pass. Reduced motion is a **real computed-style check**: RTWiki-owned transition durations go from non-zero to `0s` on tab, page-card, tree row and nav link in default light/dark (`tests/browser/theme-universal.pwspec.ts`). Forced colors is exercised by the same spec's `forced colours: the app renders and text stays readable` case (`page.emulateMedia({ forcedColors: 'active' })`, then asserts body text stays distinct from its background). **Print is out of scope** (owner does not print notes): confirmed by source scan — no `@media print` rule exists in `src/web` |

### Adjustment cases (A1–A7)

| ID | Case | Coverage |
|----|------|----------|
| A1 | Contrast 50 / 100 / 150 | WCAG gate at 50/150 for C1/C2/C4/C6/C10; 100 pixel-identical |
| A2 | Glass 30 / 100 | Computed alpha on every floating surface, light and dark |
| A3 | Reset → 100 | DB and CSS return to baseline |
| A4 | Invalid inputs (NaN, null, <min, >max, non-integer, corrupt DB) | Clamped safe; no CSS injection or broken style |
| A5 | Combinations | Full cross-product of theme × scheme × the six nominal adjustment states |
| A6 | Rapid slider changes / persistence races | Burst updates, last-write-wins, no stale reapply. **Real path verified**: keyboard-driven Mantine sliders → `PUT /api/settings/appearance` → SQLite → reload; API responses and computed styles agree before and after reload, and a rapid burst settles on the last value (`tests/browser/theme-universal.pwspec.ts`). The synthetic-event test remains as a race check |
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

## Document typography — ownership split (owner-approved)

Mantine owns the document preview's **base** font size
(`--mantine-font-size-sm` on `.previewPane`). RTWiki owns the document-specific
**ratio scale** and proportional spacing. The ratios are intentionally relative
to the parent font size; converting them to fixed pixels would break heading
proportions, nested content and responsive typography. They are recorded in the
S1 baseline as `intentional-relative` (not `tracked-debt`) and guarded against
drift by `tests/theme-spacing-gate.test.ts`. See W-008.

Documented heading ratio scale (`markdown-content.css:123-150,635-639`):

| Heading | Ratio | Narrow-layout override |
|---------|-------|------------------------|
| h1 | 1.85 | 1.55 |
| h2 | 1.45 | 1.3 |
| h3 | 1.2 | — |
| h4 | 1.05 | — |
| h5 / h6 | 0.95 | — |

Unitless line-heights and proportional `em` spacing are preserved as authored;
no separate typography-token system was introduced. The exact heading ratios
above are asserted by the "document heading ratio scale is present and
unchanged" case in `tests/theme-spacing-gate.test.ts`, which reads
`src/web/features/markdown/markdown-content.css:122-155` directly.

## Motion ownership and exemptions

`MOTION` in `src/web/config/index.ts` is the sole home for shared application
motion, emitted as `--rtwiki-motion-*` by `css-variables.ts`. Tab (`ease`), tree
hover (`ease-out`) and card hover (`ease`) are separate decisions despite sharing
150ms. Three single-use durations are documented exemptions, not debt:
window-chrome caption feedback `75ms` (W-009), Markdown link underline `120ms`
(W-010), tree expander quick feedback `80ms` (W-011). All are baselined in
`tests/theme-motion-gate.test.ts`. Under `prefers-reduced-motion: reduce`,
`customization.css` overrides the five `--rtwiki-motion-*` tokens to zero at
render time without changing the `MOTION` config values.

## Literal-value gates S1 / S2

Gate S1 (`tests/theme-spacing-gate.test.ts`) is class-aware across five value
classes — sizes, spacing, radius, motion durations and z-index — in CSS and TSX
style objects. Each class has its own property matcher, literal grammar,
intrinsic exemptions and reviewed baseline with dispositions; a new literal in
any class fails. Gate S2 (`tests/browser/theme-s2-conformance.pwspec.ts`) checks
computed values against the resolved SSoT variables across the theme × scheme
matrix. Both are additive: removing a literal is always fine.

## Work stages and gates

| # | Stage | Gate | Status |
|---|-------|------|--------|
| 1 | Emission unification | D1/D2/D3 parity, C1/C2/C3, scheme-correct floating bg, Decision 3 fallback distinctness + structured log assertion, Decision 1 status-colour readability | Complete |
| 2 | Rendered consumers | C4/C5/C6/C7/C8/C9/C10: browser computed-style spec on real components (C4/C8/C10) + desktop screenshot smoke and sidecar-spawn smoke (shell spawns sidecar, process tree, shutdown, no orphan). Mermaid scheme-matched transparent rendering. Mantine style-tag CSP nonce gate dropped (see W-007). | Complete |
| 3 | Adjustments | A1–A7: WCAG + alpha + parity tests, clamping, combinations, races, saturation. A6 now includes the real slider → API → SQLite → reload path with last-write-wins (`theme-universal.pwspec.ts`) | Complete |
| 4 | Delivery & environments | D4/D5, P1b/P2/P3/P4: iframe probe, no-flash probe, 16 screenshots, accessibility pass. Reduced motion is a real computed-style check, not a source scan | Complete (desktop sidecar spawn verified by smoke test; JS-disabled paint — W-002) |
| 5 | Docs | This matrix as definition of done; token/consumer inventory; waiver registry; typography ownership split and heading scale; motion exemptions | Complete |
| 6 | Enforcement | CI gates + PR rule + docs-sync guard (below). S1 now covers all five promised value classes in CSS and TSX | Complete |

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
  JSON id, waiver ID, the C9 baseline, the documented heading ratio scale, the
  five S1 value classes, the real A6 persistence claim, or the reduced-motion
  computed-style claim drifts out of these docs. It asserts all twelve waiver
  rows (W-001…W-012) carry the seven required fields.

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
