# RTWiki Visual UI Audit Report

**Date:** 2026-09-08
**Branch:** develop (3cbfdd3)
**Working Directory:** D:\Temp\RTWiki
**Audit Scope:** Read-only visual inspection of running local instance at http://127.0.0.1:8080/
**Screenshots:** D:\Temp\RTWiki-ui-audit\2026-09-08\

---

## Screenshot Inventory

| File | Viewport | State |
|------|----------|-------|
| `01-full-desktop.png` | 1280×800 | Full app shell, light theme |
| `02-sidebar-normal.png` | 360×650 (clipped) | Sidebar, no selection |
| `03-dashboard-cards.png` | 880×500 (clipped) | Dashboard cards |
| `04-sidebar-selected.png` | 360×650 (clipped) | Sidebar with Diagram selected |
| `05-sidebar-hover.png` | 360×650 (clipped) | Sidebar hover state |
| `06-app-selected.png` | 1280×800 | Full app with Diagram active |
| `07-sidebar-expanded.png` | 360×650 (clipped) | Sidebar with HTML Page expanded (subfiles) |
| `10-narrow-full.png` | 390×844 | Narrow viewport (mobile-like) |

---

## Findings

### UI-001: Root Header Visually Identical to Selectable Tree Items — Selection State Ambiguity
| Field | Content |
|-------|---------|
| **Severity** | High |
| **Screen/state** | All sidebar states (`02`, `04`, `07`) |
| **Evidence** | `02-sidebar-normal.png`, `04-sidebar-selected.png` |
| **What is wrong** | The "Root" header row uses the same blue background fill as a selected tree item. When a page is clicked and becomes selected, the Root header *also* remains highlighted, creating two competing "selected" indicators. There is no visual distinction between a section label and an active selection. |
| **Why it matters** | Users cannot instantly tell which item is actually selected. The selection affordance is diluted by the persistent Root highlight. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — Root element styling; `page-tree.tsx` — Root render logic |
| **Recommended correction** | Root header should use a distinct, non-selectable style: lighter/faded background or no background at all. It should not share the selected color. |
| **Acceptance check** | When any single tree row is selected, only that row shows the blue selection fill. The Root label shows a neutral/secondary style. |
| **Scope** | Visual-only |

---

### UI-002: Focus Ring Missing in Light Theme on Selected Rows
| Field | Content |
|-------|---------|
| **Severity** | High |
| **Screen/state** | Desktop light theme, after click selection (`04-sidebar-selected.png`) |
| **Evidence** | `04-sidebar-selected.png` — selected row shows blue background but no visible focus border |
| **What is wrong** | In light theme, when a row is selected (clicked), there is no visible focus ring. The `.wb-row.wb-focus` style applies a blue inset border, but this ring is either invisible or not applied because keyboard focus goes to the container rather than the row itself. |
| **Why it matters** | Keyboard users and accessibility scanners rely on focus rings to identify the current element. Without a visible focus indicator, the tree is unusable for keyboard navigation. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — `.wb-row.wb-focus` rule; `wb-tree-host.ts` — focus management |
| **Recommended correction** | Ensure keyboard focus is programmatically set to the focused row element. Make the focus ring more prominent in light theme. |
| **Acceptance check** | Tabbing through the tree shows a clear blue outline ring on the focused row in both light and dark themes. |
| **Scope** | behaviour affected |

---

### UI-003: Row Title Vertically Misaligned (~5px Off-Center)
| Field | Content |
|-------|---------|
| **Severity** | Medium |
| **Screen/state** | All sidebar states (`02`, `04`, `07`) |
| **Evidence** | `02-sidebar-normal.png` — titles sit higher within their 30px row height |
| **What is wrong** | Row titles have a top offset of ~1px within a 30px row, making them visually appear near the top edge rather than vertically centered. This is consistent across all page types. |
| **Why it matters** | Creates a subtle but noticeable visual inconsistency — every text label appears slightly top-heavy. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — `.wb-title` line-height vs row height mismatch |
| **Recommended correction** | Adjust title line-height or flex alignment to properly center text within the 30px row. |
| **Acceptance check** | Text baseline of each title sits visually at the vertical midpoint of its row. |
| **Scope** | Visual-only |

---

### UI-004: Expander Chevron Hard to See / Poor Contrast in Light Theme
| Field | Content |
|-------|---------|
| **Severity** | Medium |
| **Screen/state** | All sidebar states (`02`, `07`) |
| **Evidence** | `02-sidebar-normal.png`, `07-sidebar-expanded.png` — chevrons barely visible next to icons |
| **What is wrong** | The expander chevron uses a muted grey color that blends into the light background. The chevron is small (14×14px) with thin stroke. |
| **Why it matters** | Users may not notice the expander is clickable, reducing discoverability of nested content. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — `i.wb-expander` color rule |
| **Recommended correction** | Increase expander color contrast or add a subtle background fill behind the chevron on hover. |
| **Acceptance check** | Chevron is clearly visible as a clickable disclosure control in both themes. |
| **Scope** | Visual-only |

---

### UI-005: Action Button Position Shifts on Focus vs Hover
| Field | Content |
|-------|---------|
| **Severity** | Low |
| **Screen/state** | `05-sidebar-hover.png` |
| **Evidence** | Hover screenshot shows action button appearing |
| **What is wrong** | The three-dot menu button is absolutely positioned and hidden until hover/focus. On hover it appears, but the reveal may look different depending on whether the row is already selected vs just hovered. |
| **Why it matters** | Inconsistent visual treatment may confuse users about which state is active. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — `button.rtw-row-action` rules |
| **Recommended correction** | Ensure the action button background is readable on both neutral hover and blue selected fills. |
| **Acceptance check** | Three-dot menu button is readable in all row states. |
| **Scope** | Visual-only |

---

### UI-006: Subfile Rows Have Different Height but No Clear Visual Separation
| Field | Content |
|-------|---------|
| **Severity** | Low |
| **Screen/state** | `07-sidebar-expanded.png` |
| **Evidence** | Subfile rows "HTML", "CSS", "JavaScript" appear indented under parent |
| **What is wrong** | Subfile rows use shorter height and faded text color, but the visual separation from parent is subtle — they look more like disabled items than a meaningful grouping. |
| **Why it matters** | Users may not understand these are editor tabs associated with the parent page. |
| **Likely code area** | `src/web/features/sidebar/page-tree.module.css` — `.rtw-type-subfile` rules |
| **Recommended correction** | Add a subtle left border or indent guide connecting subfile rows to their parent. |
| **Acceptance check** | Subfile rows are clearly grouped under their parent page. |
| **Scope** | Visual-only |

---

### UI-007: Narrow Viewport Dashboard Header-to-Card Transition Tight
| Field | Content |
|-------|---------|
| **Severity** | Medium |
| **Screen/state** | `10-narrow-full.png` (390×844) |
| **Evidence** | Dashboard cards at narrow width |
| **What is wrong** | At 390px width, the "Pages" header sits close to the first card with minimal margin. Search input is replaced by rail icons, making search less accessible. |
| **Why it matters** | Users on tablet/narrow screens may find the layout cramped and search harder to access. |
| **Likely code area** | `src/web/features/dashboard/page-card.tsx`, responsive breakpoints in `App.tsx` |
| **Recommended correction** | Add bottom margin to header; consider showing a search icon in the rail. |
| **Acceptance check** | At narrow width, no content overlaps; search remains accessible. |
| **Scope** | Visual-only |

---

## Top 5 Fixes First

| Rank | ID | Issue | Severity |
|------|-----|-------|----------|
| 1 | UI-001 | Root header shares selection highlight — selection ambiguity | High |
| 2 | UI-002 | Focus ring missing on selected rows — keyboard accessibility | High |
| 3 | UI-003 | Row titles vertically misaligned — consistency | Medium |
| 4 | UI-004 | Expander chevron low contrast — discoverability | Medium |
| 5 | UI-007 | Narrow viewport header spacing — responsive quality | Medium |

---

## Visually Verified as Acceptable (No Changes Needed)

- **Dashboard card layout** at desktop: clean grid, consistent spacing, proper badge colors per page type
- **Icon alignment**: Page-type SVG icons well-aligned within slots
- **Status bar**: Compact, readable, appropriate z-index
- **Tab strip**: Clean separation between tabs, close buttons functional
- **Date formatting** on cards: consistent and readable

---

## Known Limits of This Audit

1. No deep dark theme testing — could miss contrast issues specific to dark mode
2. No interactive state testing beyond click/hover — double-click rename, context menu, drag-and-drop not tested
3. No cross-browser verification — inspected only in Chromium
4. No performance assessment — visual inspection does not cover render performance
5. Tree expansion limited to one level — deeper nesting not tested

---

## Confirmation

- No source files were edited during this audit.
- No git operations performed.
- No pages, notes, or data were created or modified.
- Screenshots saved to: `D:\Temp\RTWiki-ui-audit\2026-09-08\` (external to repository).
