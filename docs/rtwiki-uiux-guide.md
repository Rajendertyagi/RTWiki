# RTWiki — UI/UX Guide for the Owner

This guide is written for the project owner — someone who decides what the app looks like and whether finished work matches their intent. It is also useful for engineers who need a plain-language summary of the design intent.

It covers layout, colour, type, behaviour, and known limitations. Every exact measurement, colour value, and source-file reference lives in the companion document **[rtwiki-uiux.md](rtwiki-uiux.md)**. This guide tells you the *reason*; that document gives you the *number*.

---

## 1. What we are going for

The reference point is **TriliumNext** — a dense, browser-like knowledge tool. "Dense" does not mean cluttered. It means:

- **Compact rows.** Chrome rows (tab strip, toolbar, title bar) are each about 40 pixels tall — one compact row. No wasted vertical space.
- **Browser-like layout.** A left rail for navigation, a page tree beside it, a content area in the middle, and an optional right sidebar. The document fills the content area, not a card inside it.
- **More content per screen.** The page tree uses 30-pixel rows so you can see many pages without scrolling. The document itself has no maximum line length so it acts as a canvas, not a narrow article column.

We chose this over something airier because the tool's job is to hold **a lot of notes** and let you move between them quickly. Whitespace is fine when there is nothing to see. When you are deep in a knowledge base, every unused pixel is a pixel you are not using to read or write.

---

## 2. Our rules

These are the principles that guide every decision. Each has a reason.

| Rule | Reason |
|---|---|
| One number per dimension. If the tab strip is 40px, every component that reads that height uses the same source. | Two sources for the same thing will drift apart. When they do, someone has to guess which is right. |
| Surfaces are named by their role — canvas, panel, rail, elevated — not by colour. | A surface name tells you what it does. A colour name tells you what it looks like today. Roles outlast palettes. |
| Borders mark focus, they are not decoration. | A border that is always there competes with content. A border that appears only when something needs attention guides the eye. |
| Corners are rounded only where a control needs to look pressable. | Sharp corners say "this is structural." Rounded corners say "this is interactive." Mixing them creates visual noise. |
| Rows are compact. | The goal is density with readability. 40px chrome rows and 30px tree rows fit more on screen without becoming hard to hit. |
| Motion only ever signals a state change. Never decoration. | Animation that exists only to please the eye adds latency between the user's action and the app's response. If it does not communicate change, it should not exist. |

---

## 3. The parts of the window

From top to bottom, left to right:

| Part | What it is for | Rough size | When it changes |
|---|---|---|---|
| **Chrome band / tab strip** | Window controls, tab row, drag surface | 40px tall | Only if a future change makes buttons taller than the band — currently they share one value. |
| **Tabs** | Switch between open pages | Same height as the band | Do not modify — this is a hard constraint for the current phase. |
| **Window buttons** | Close, minimise, maximise | 46px wide × 40px tall | Only in the Tauri desktop build; absent in browser mode. |
| **Utility rail** | Home, search, favourites, theme toggle | 40px wide | Width is fixed in config; a minor residual overflow of 2px is known but not visible. |
| **Page tree** | Navigate pages by folder structure | 336px default; resizable 220–520px | Collapses to a mobile drawer at narrow widths. |
| **Document area** | The active page's content | Fills remaining space | The rich note is the only element that scrolls vertically on its route. |
| **Right sidebar** | Page details, properties | 260px default; resizable 220–420px | **Not fixed at narrow widths.** It currently shrinks to a useless sliver with a toggle rather than hiding or becoming a drawer. See item 3 in the plan. |
| **Status bar** | Contextual information about the active page | 28px tall | Always present at the bottom of the content area. |

Exact measurements for every element are in the companion document.

---

## 4. Colours

Four surfaces, each with a role you can hold in your head:

| Surface | Role | Light feel | Dark feel |
|---|---|---|---|
| **Canvas** | The document you are reading or writing in. Brightest surface. | Clean white — the page itself. | Soft dark grey — the page continues uninterrupted. |
| **Panel** | The tree, the right sidebar, the settings view. Recessed behind the canvas. | Warm light grey — set back from the document. | Deep dark grey — clearly behind the canvas. |
| **Rail** | The narrow navigation strip on the far left. | Slightly deeper than the panel — a subtle anchor. | Slightly deeper than the panel — keeps the rail distinct. |
| **Elevated** | Hover fills, selected rows, raised elements. | White — lifts above the panel. | Slightly lighter than the canvas — a lift, not a recess. |

**The one rule that must always hold:** the document canvas is always the brightest surface, and the panel sits recessed behind it. Both in light mode and in dark mode.

Why this matters: the real defect was that the document had been given a border and rounded corners, so it read as a card floating inside a panel rather than as the page itself. The border and the corners were removed, and the two surfaces were then given separate names so they could never be confused again. There is now a test that checks the document and the panel are never the same tone. If that ever breaks, the document will start looking like a card again — and the fix is always to give the surfaces distinct values, never to hide the problem with padding.

---

## 5. Text

The type scale is small and deliberate:

| Size | Use |
|---|---|
| 12px | Status bar values, window hints, small badges |
| 13px | Tab labels, sidebar headings, the quick finder, page card body text |
| 14px | **The normal reading size.** Almost all body text. |
| 16px | Page card titles |
| 18px | Large headings |

**Deliberate choice:** the document text has **no maximum line length**. This is not an oversight. RTWiki is a canvas-style tool — notes can be as wide as the pane lets them be, and the document stretches to fill the content area. This matches the upstream Trilium reference, which also does not constrain line length.

---

## 6. How things behave

| Behaviour | What happens | When **not** to |
|---|---|---|
| **Hover** | Subtle background-fill transition (150ms). Tabs, tree rows, page cards all use it. | On the document canvas itself — the canvas has no hover fill; it is not a button. |
| **Selecting a tree row** | A shared highlight colour marks the row, and the Home entry uses the same one. | In the document area — selection there is handled by the editor, not by the tree. |
| **Window becomes narrow** | The left tree collapses into a drawer. The toolbar scrolls sideways rather than wrapping. **The right sidebar does not yet collapse properly — it shrinks to a sliver, which is a known defect.** | When the window is wider than the workspace minimum (480px) — the layout should not collapse. |
| **Dragging a divider** | Pane dividers are 6px wide (1px visible, 5px invisible pointer tolerance). Keyboard step is 20px. Bounds: tree 220–520px, right sidebar 220–420px. | When the divider is already at its minimum — dragging further should do nothing, not snap back. |
| **Save indicator** | Autosave is debounced at 2000ms. A visible indicator shows save status. | When the user has not made any changes — no indicator should appear. |
| **Theme toggle** | The rail button flips between light and dark. It does **not** follow the OS preference (a known gap, F7). | When the user expects the app to respect `prefers-color-scheme` on first load — it does not yet. |
| **Scrolling** | The rich note is the **only** element that scrolls vertically on its route. The pane dividers, tabs, and chrome rows are fixed. | In the tree or sidebar — those scroll horizontally (overflow) or not at all; they do not participate in the vertical scroll of the document. |

---

## 7. Each kind of page

| Page type | What the surface should look like |
|---|---|
| **Rich Note** | One continuous canvas. No border, no radius, no card frame. The document fills the content area from edge to edge. |
| **HTML page** | Currently frames its content as a card (8px radius). This is a known gap — the card frame should be removed once the theme foundation is stable. |
| **Code page** | Editor surface bound to the canvas token. No separate card framing. |
| **Markdown page** | Currently frames its content as a card (8px radius). Same gap as HTML — will be fixed in the next work item. |
| **Dashboard** | Uses separate cards with gently rounded corners. Cards are appropriate here because the dashboard is a collection of items, not a single document. |
| **Settings** | A panel with small rounded rows. Matches the right sidebar, because settings is a panel-type view rather than a document. |

**Honest note:** the HTML and markdown editors still frame their content as a card. This is visible and known. It is not fixed yet.

---

## 8. Do's and don'ts

| Choice | Do | Don't | Why |
|---|---|---|---|
| **Surface tones** | Give the document and the panel their own named colours, and keep the document brighter. | Let the document and the panel end up the same tone. | The document must never blend into its surroundings. A test now checks they are never equal, so this cannot regress silently. |
| **Borders** | Use borders only as focus indicators (active split, selected row). | Add borders to the document canvas for decoration. | A permanent border competes with content and breaks the canvas feel. |
| **Radii** | Round corners on controls and cards. Leave the canvas square. | Apply radius to the document surface. | The canvas is structural; radius implies a widget. |
| **Row height** | Keep chrome rows at 40px and tree rows at 30px. | Add dead space inside a row (e.g. a 50px band with a 40px tab row). | Dead space wastes screen real estate and signals unfinished geometry. |
| **Motion** | Use transitions only for state changes (hover, selection, divider hover). | Add entrance animations, slide transitions, or decorative motion. | Motion should communicate, not decorate. Every animation adds perceived latency. |
| **Scrollbar** | Let the document scroll vertically as the only scrolling element on its route. | Make the pane or the chrome row scrollable. | Scroll ownership must be unambiguous; multiple scroll owners confuse the user. |
| **Theme switching** | Verify every change in both light and dark modes. | Check only one scheme and declare the palette correct. | The dark-mode inversion was hidden by a light-only check. Always toggle both. |
| **Measurements** | Keep every size in one central place that the whole app reads from. | Write the same number in two different files. | Two copies drift apart, and then someone has to guess which is right. |
| **Test assertions** | Assert on elements that actually exist in the current app. | Write tests that wait for a title input when the title is a contenteditable H1. | F4 is a shipped test that can never pass because it asserts a non-existent element. |
| **New themes** | Add theme data to the registry; do not invent colours. | Guess palette values for Catppuccin or Nord. | These themes must come from their official palettes, not from memory or approximation. |

---

## 9. What still needs doing, in order

| # | Item | Reason for position |
|---|---|---|
| ~~1~~ | ~~**Theme token foundation** — registry engine, per-region tokens, editor bound to canvas~~ | **DONE.** Registry, Default theme, and editor binding are live. Guarded by tests. |
| 2 | **Remove card frames from HTML and markdown editors** | F1 is resolved for rich notes; the remaining two editors still frame their content as cards. Now unblocked: each theme declares its own canvas tone, so the frame can be removed safely. |
| 3 | **Re-measure and fix the mobile toolbar** | The recorded numbers (F2) predate the current stylesheet and must not drive a fix. Re-measure first, then decide between scroll and an overflow menu. |
| 4 | **Application shell polish** — tighten rail overflow (F3 residual), honour `prefers-color-scheme` (F7) | Small items that use the declared tokens rather than hardcoded values. |
| 5 | **Tabs** — tab seam into the active tab, filler-based drag region | Shell geometry must settle first (item 4) so tab work is not re-verified. |
| 6 | **Cosmetic polish** — toolbar grouping and labels (F6), fix the stale test (F4), clean the dev database (F8) | Everything else is independent or low-risk. |
| 7 | **Theme picker UI** — plus Catppuccin and Nord from their official palettes | A one-option picker is noise. Held until a second theme exists. |

**Out of scope for this cycle:** building the two extra colour themes, giving the
diagram renderer or the text editor their own per-theme work, any change to the tab
strip, and verifying the native desktop build.

---

## 10. What we got wrong before

These findings were recorded as fact and later proved wrong. The reason is noted so the same mistake is not repeated.

| Finding | What was claimed | Why it was wrong |
|---|---|---|
| F1 (fill ratio) | The document filled only 15% of its region. | The measurement compared content height (123px, a short note) against container height (832px). The editor wrapper already filled its region at 752px. The real defect was the framed-card treatment, not the fill ratio. |
| F2 (toolbar scroll) | The toolbar could not scroll; its overflow was set to be visible. | The measurement predated the code it described. The toolbar has allowed sideways scrolling and has refused to wrap for some time, so those readings cannot be right. The real behaviour has not been re-measured yet. |
| F3 (rail width) | Three conflicting rail values (60 / 40 / 42). | The comparison used the committed config while the working tree already had `railWidth: 40`. The config and render agreed once the correct baseline was used. |
| F5 (status bar) | A 2-pixel disagreement about the status bar height between two places that define it. | The same mistake as F3: the comparison was made against the committed version of the settings rather than the current one. Once compared correctly, the two agreed. No defect. |

---

## 11. Known gaps

These items have never been checked or verified in this environment:

| Item | Reason |
|---|---|
| **Native Tauri desktop window** | No Rust toolchain is available here. All verification has been done in browser mode against the same bundle. |
| **Windows `decorations(false)` build** | Requires a Tauri build, which is not available in this environment. |
| **HTML pages, code pages, Calendar/Study, Settings, Trash, Favorites views** | Only Rich Note and dashboard were driven during verification. |
| **Empty, loading, and error states** | Not driven during the audit. |
| **Keyboard navigation and focus order** | Not tested. |
| **Contrast for every element** | Only the toolbar and the page tree rows were checked. Both were comfortable at about 10:1. Tabs, the title row, and the rest of the interface have not been measured. |
| **Pane drag-resize, collapse persistence, keyboard shortcuts** | Runtime behaviours not studied. |
| **Tab overflow scrolling, command palette, contextual toolbar conditional groups** | Not driven during the audit. |

The authoritative reference document for all measurements and source locations is **[rtwiki-uiux.md](rtwiki-uiux.md)**.

---

## 12. Keeping this guide honest

A design document that has drifted is worse than no document, because it will be
trusted and it will be wrong. These are the rules that keep it trustworthy.

**Update the guide in the same piece of work as the change it describes.** Not as a
follow-up task, not at the end of a phase. If a change alters how something looks or
behaves, the guide changes with it. This is the single rule that matters most — every
other rule here follows from it.

**When something turns out to be wrong, correct it in place and say so.** Do not
quietly delete it. Section 10 exists because four findings were recorded as fact and
later proved wrong. That list is the most valuable part of this document, because it
is what stops the same conclusions being reached again.

**Say whether a claim was measured or merely read from the code.** A number copied
out of a stylesheet records what was intended. A number measured in the running app
records what actually happens. Those are different confidence levels and should never
be blurred together. The companion document keeps the two separate.

**Do not write down what ought to happen as though it does.** Three of the four
corrections above were the same mistake: an aspiration recorded as an observation.

**When you do not know, write that you do not know.** Section 11 is a real list of
gaps, not a formality.

### Change log

Newest first.

| When | What changed | Why |
|---|---|---|
| 2026-09-25 | This guide was written, alongside a companion reference document | The existing reference was written for engineers and was not usable for making design decisions |
| 2026-09-25 | The theme foundation was completed | Colour rules now have one source and a test that protects them |
| 2026-09-25 | Two earlier findings were withdrawn | Their measurements could not have been true of the code they described |
