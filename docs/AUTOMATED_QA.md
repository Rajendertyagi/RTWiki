# Automated Owner QA

The browser suite proves expected code paths; this system adds a layer that
behaves more like the owner manually using RTWiki. It is testing
infrastructure only — no product behaviour lives here.

## Layers

| Suite | What it does |
| --- | --- |
| `owner-journeys.pwspec.ts` | Five end-to-end owner journeys (rich lifecycle, dashboard/tree, HTML workspace, visual pages, connect & find) using roles/visible labels and real mouse coordinates. Includes genuine application restarts via the app's shutdown endpoint — the Playwright webServer runs `scripts/dev-supervisor.ts`, which respawns the server when it exits. |
| `qa-geometry.pwspec.ts` | Geometry contracts (numeric pane relationships at 390×844 / 1280×800 / 1920×1080 in both themes: rail height, tree/workspace separation, tabs→toolbar→title→document order, no horizontal overflow, full-screen coverage) plus region screenshots (`toHaveScreenshot`) with animations/caret disabled. |
| `exploratory-owner.pwspec.ts` | Deterministic exploratory simulation: three fixed seeds × 75 bounded actions from a realistic action model (create/open/type/format/insert/navigate/theme/reload…). After every action a battery of invariants runs (no page/console errors, no failed API calls, 0–1 selected rows, tab↔page agreement, no lingering overlays, positive workspace dimensions, no duplicate tabs, parseable saved content). Failures print the seed and full action history. |
| `a11y.pwspec.ts` | axe-core WCAG A/AA scans on dashboard, rich editor, HTML IDE, Diagram/Mind Map workspaces, context menu, Ctrl+K palette and wiki-link picker in both themes. Full violation lists attach to the report; impact=critical findings fail the run. Dev-only dependency (`@axe-core/playwright`, MPL-2.0) — runtime bundles are unchanged. |
| `long-session.pwspec.ts` | Accumulated session: 60+ pages across hierarchy levels, mixed types, backlinks, rename/duplicate/delete churn, ≥5 accumulated tabs, browser reload and a real server restart with final persistence verification. |

## Physical hit targets

`tests/browser/helpers/hit-target.ts` verifies interactive regions the way a
person experiences them: practical bounding-box size, `elementFromPoint()`
ownership at the centre (and corners for cards), and real
`page.mouse.click()` at verified coordinates. It also exposes
`resetDatabase()` for deterministic setup via the API only.

## Failure evidence

Playwright retains traces/screenshots/videos on failure (`playwright.config.ts`)
plus an HTML report. The permanent browser workflow uploads
`playwright-report/`, `test-results/` and the sanitized Debug Mode log
(`logs/rtwiki-debug.jsonl` — never note content) as a 7-day artifact when the
job fails. The database is never uploaded.

## Screenshots

Baselines live in `tests/browser/__screenshots__/` per platform. The first
Linux CI cycle generates `-actual` images inside the failure artifact; they
are reviewed and committed as baselines, then the suite reruns. Any future
snapshot change must be explicitly reviewed — tolerances stay small so real
clipping or overlay defects cannot hide.
