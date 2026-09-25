# RTWiki — UI/UX Audit Findings (verified against the running app)

- **Date:** 2026-09-25
- **Baseline:** Mantine **9.6.2**, chrome band **40px**
- **Method:** real app driven with Playwright/Chromium against a live server. Every
  number is measured from the rendered DOM, not read from documentation.
- **Evidence:** `.superpowers/sdd/desktop-chrome-fix/audit/` — `re-audit-desktop.png`,
  `re-audit-mobile.png`, plus the original `desktop-light.png`, `editor-dark.png`,
  `mobile-light.png`, `tree-collapsed.png`.
- **Related:** `docs/ui-ux-audit-report.md` (earlier audit), `docs/UI_UX_PLAN.md`
  (proposed redesign — see §6), `docs/trilium-uiux-spec.md`.

> **Revision note.** This document was first written against a stale install
> (Mantine 9.5.1) and compared rendered values against the *committed* config
> while the working tree already contained a redesign in progress. Both were
> corrected; see §0 and F3/F5. Every figure below was re-measured on 9.6.2 with
> the 40px band.

---

## 0. Baseline now verified

| Source | Version |
|---|---|
| `package.json` / `bun.lock` | 9.6.2 |
| `node_modules/@mantine/core` | **9.6.2** (synced) |

The local install had been 9.5.1 while the manifest pinned 9.6.2, so the first
pass measured a version CI never runs. After `bun install --frozen-lockfile`:

- `bun run typecheck` → 0 · `bun test` → **460 pass / 0 fail**
- `tests/browser/window-chrome.pwspec.ts` → **8/8** (the AppShell geometry the
  chrome depends on is unaffected by the 9.5.1 → 9.6.2 bump)
- Document overflow remains **0** at 1440×900, 1280×720, 900×700 and 390×844

### Band height decision: 40, not 50

An in-progress change had set `TAB_STRIP_HEIGHT = 50` while leaving
`--rtwiki-tab-height` at 40. Measured consequence:

```
band 50 · tabSlot 49 · tab row 40  →  9–10px of dead space
```

The tab row sits top-aligned in a 49px slot while the 46×49 caption buttons fill
the full band, so the tabs and the window controls stop lining up. **The band and
the tab row are the same row**, so they now share one value (`40`), which also
matches `--rtwiki-row-height`, the toolbar row, the page header row, and the
now-40px rail column — one consistent density across the shell.

---

## 1. Verdict

The chrome rows and the new window band are sound: no overflow at any viewport,
dark mode is accessible, and the rail/tree/band layout is exactly as designed.

Two defects remain, both in the highest-traffic surface, and both survive the
version bump and the band change:

1. **The document canvas occupies 15% of the space given to it** and renders as a
   bordered card floating in an empty field.
2. **At 390px, 24 of the 35 formatting controls are unreachable** — clipped with
   no scroll, menu, or affordance.

A third item is documentation debt: a shipped test asserts a title input that
does not exist, so it can never pass.

---

## 2. Findings

**High** = functionally broken · **Medium** = visible defect or latent breakage ·
**Low** = polish.

### F1 — High — Editor canvas fills only 15% of its region *(re-confirmed)*

| Measurement | Value |
|---|---|
| Region available (`mainContent`) | 1104 × 832 |
| Editor rendered | 788 × 123 |
| **Fill ratio (height)** | **0.15** |
| Fill ratio (width) | 0.71 |

Identical on 9.6.2 with the 40px band, so this is not a version or band artefact.
The document is a white rounded card with a visible border and grey gutters on all
sides — it reads as *a widget inside a page* rather than *the page*, and the dead
space below it is the largest visual flaw in the app.

Evidence: `re-audit-desktop.png`, `desktop-light.png`.

---

### F2 — High — Mobile loses 24 of 35 toolbar controls *(re-confirmed)*

| Measurement | 390px |
|---|---|
| Total toolbar controls | **35** |
| Reachable (fully inside the toolbar box) | **11** |
| **Unreachable** | **24** |
| `overflow-x` | `visible` |
| `scrollWidth` vs `clientWidth` | 390 vs 390 — **cannot scroll** |

The toolbar does not scroll and offers no overflow menu, so the clipped controls
cannot be reached at all. The right "Page details" sidebar is also still rendered
as a ~50px sliver with a toggle, rather than being hidden or becoming a drawer
below the `sm` breakpoint.

Evidence: `re-audit-mobile.png`, `mobile-light.png`.

---

### F3 — *Corrected* — Rail width is now consistent

An earlier version of this report listed three conflicting rail values
(60 / 40 / 42) and blamed the config. That was wrong: it compared rendered values
against the **committed** config while the working tree already set
`railWidth: 40`. With that in place the navbar and the config agree.

**Residual, minor:** the rail element still measures 42px inside a 40px navbar
(padding `var(--mantine-spacing-xs) 4px` plus content), so it overflows by 2px.
Worth tightening; not a visible defect.

---

### F4 — Medium — A shipped test asserts an element that does not exist

`tests/browser/shell-layout.pwspec.ts:132` waits for
`input[aria-label="Title"]`. With a rich page open that element count is **0** —
the page title is edited as the document's own H1 (the single
`[contenteditable="true"]` is the BlockNote editor). There is no separate title
input, so **this test cannot pass on any machine**. It is a stale assertion, not
an environment flake.

---

### F5 — *Corrected* — Status bar height is consistent

Previously reported as 26-vs-28 drift. That was the same committed-vs-working-tree
error as F3: the working tree sets `statusBarHeight: 28`, which matches the
rendered footer host (28px). **No defect.** Withdrawn.

---

### F6 — Medium — Toolbar density and grouping

35 icon-only controls in one 40px row across the full content width, with no
labels and no clear grouping. Scanning cost is high; the active control is
distinguished only by a filled background. Compounds F2 at narrow widths.

---

### F7 — Low — Dark mode ignores the OS preference

With `prefers-color-scheme: dark` the app still rendered
`data-mantine-color-scheme="light"`; the theme only changed via the rail's Theme
control. Once dark, contrast is healthy (tree rows and title text both
**10.26:1**), so this is an expectation gap, not a legibility defect.

---

### F8 — Low / hygiene — Development database polluted with test pages

The sidebar lists `ShellA…ShellE`, `Runtime Error …`, `Broken note`,
`Flush/Save/Reload probe`, `Overnight …`, `ZZProbeCanary`, `Audit Rich Sample`.
The majority were created by automated test runs writing into the developer
database. Approved for cleanup.

---

## 3. Working well (measured)

- **No document overflow** at any of the four tested viewports.
- **Dark theme** coherent and accessible (10.26:1 on tree rows and title text).
- **Chrome band** exactly as specified: rail `y=0` full height, tree column `y=0`
  full height, band beside the tree at 40px, one 1px separator, no control nested
  inside a drag region, caption buttons 46×40.
- Tab strip, toolbar and title rows are a consistent 40px each.

---

## 4. Not verified

- Native Tauri shell (no Rust toolchain here; this is browser-mode geometry
  against the same bundle).
- HTML pages, code pages, Calendar/Study, Settings, Trash, Favorites.
- Empty, loading and error states; keyboard navigation and focus order.
- Contrast for every element (tab, tree row, title row, toolbar sampled only).
- The Windows `decorations(false)` build.

---

## 5. Work order

| # | Item | Findings | Note |
|---|---|---|---|
| 1 | Editor canvas fills its region; drop the card frame | F1 | Biggest visual gain |
| 2 | Mobile: toolbar overflow menu; hide right sidebar below `sm` | F2, F6 | 24 controls currently unreachable |
| 3 | Repair the stale `Title` assertion | F4 | Unblocks a permanently red test |
| 4 | Rail element 42px → 40px | F3 residual | Minor |
| 5 | Toolbar grouping / labels | F6 | Do with #2 |
| 6 | Honour `prefers-color-scheme` on first load | F7 | Small |
| 7 | Clean test pages from the dev database | F8 | Approved |
| 8 | Reconcile UI/UX docs with measured geometry | §6 | — |

---

## 6. Why `docs/UI_UX_PLAN.md` should not be implemented as written

1. **Wrong framework version** — it specifies "Mantine v7"; the project is on
   **9.6.2**. The 7→9 AppShell and token changes are what this plan then
   redefines.
2. **Hardcoded dark hex surfaces** (`#101113`, `#141517`) — breaks light mode and
   contradicts the project's Mantine-token rule.
3. **A third geometry set** (rail 50, tree 250, tab 38, toolbar 36) — the rail is
   now 40 and the band 40; adopting this would re-introduce drift.
4. **It inventories a different app** — its rail contents ("Brand logo `R`, Pages,
   Search, Trash…") are Notion's, not RTWiki's.

Salvage the intent (compact rows, strict toolbar vs page-action separation, one
spacing/radius system). Discard the numbers and the version.
