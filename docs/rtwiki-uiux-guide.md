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

## 2b. How depth and separation should work

This is a standing decision. It was reached by discussion, and it is recorded here so
it does not have to be explained again.

**The look we want:** hairline-thin lines, colour doing the work, shadows only where
something genuinely floats, and a light, modern, unheavy feel. Nothing should look
outlined, boxed or heavy.

**The order of importance — this is the rule to follow when unsure:**

1. **Colour does the structural work.** A panel is a different shade from the page it
   sits beside. This is the main way the eye knows where one thing ends and another
   begins, and it costs nothing visually.
2. **Shadow means "floating".** Only for things genuinely above the page: menus,
   pop-ups, dialogs, a sidebar that slides over content.
3. **A hairline is the exception, not the default.** A single very fine, very faint
   line, only where colour cannot do the job.

**Where a hairline is still right.** Two surfaces of the *same* shade sitting side by
side. For example the Markdown typing view and its preview. There is no colour
difference to detect, so one faint line is the honest solution.

**The one place a frame is always wrong: the document itself.** The page you are
reading or writing is never outlined, never rounded, never boxed. It is simply the
page.

**In dark mode, shadow is nearly invisible.** A shadow needs light to define it, and
there is very little light on a dark surface. So dark mode separates floating things
with a faint light edge instead of a shadow, and relies on colour even more than
light mode does. Where a dark surface steps away from another, it steps *lighter* —
that is what reads as "lifted".

**Hairlines should be barely there.** A visible grey line looks like a table. A faint
one looks like a seam. If you can clearly see the line, it is too strong.

### Why not borders everywhere

It is tempting to outline everything so the structure is obvious. It goes wrong in
three ways: the page stops reading as a page and starts reading as a widget; the
interface accumulates visual noise; and it dates quickly, because heavy outlining is
the opposite of the current look. Outlines are also the least flexible tool — they
cannot express depth, only separation, and they do not adapt to a dark theme.

### What this changed

- The document area lost its frame entirely, so it reads as the page.
- Colour separates the page from the panels around it, in both themes. The three
  structural surfaces are now a **measured** ladder: each one is a clear, even step
  away from the next, in both light and dark. A check measures the difference rather
  than trusting the eye, so a future colour change cannot quietly flatten the
  structure again.
- Where two same-shade surfaces meet, one faint line is used rather than a heavy
  border.
- The lines between the stacked rows at the top are now barely there, so the top of
  the window reads as one light block rather than a set of bands.
- The open tab now merges with the page below it, the way a browser tab does,
  instead of sitting on a shadow.
- The right-hand details panel is now a proper panel shade, rather than the same
  shade as the page with a hard line down its edge.
- The notification's blue bar is now a thin line along the bottom. It still shows
  how long you have before it closes, but it no longer shouts.
- Everything that genuinely floats - menus, pop-ups, dialogs, tooltips, and the
  notification toast — now shares one soft layered shadow with a faint light edge, so
  it visibly lifts off the page instead of sitting on it.

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

### The shades are chosen by eye-measurement, not by taste

Each surface is no longer picked by trying a grey until it looks right. It is picked
by a single number: **how light or dark it is, on a scale from 0 (black) to 1
(white), measured so that equal steps look like equal changes to the eye.**

The four shades are now spaced at exactly equal steps:

- **Dark mode** — rail 0.17, panel 0.22, document 0.27, raised 0.32. Each one is
  **0.05** further from black than the one before it. Four identical steps.
- **Light mode** — rail 0.91, panel 0.955, document 1.0. Each one is **0.045**
  closer to white.

Why this matters in plain terms: previously the steps were *nearly* equal, and
nearly is not good enough. Two of the dark shades were so close together that the
eye read them as the same colour, so the whole left side of the window looked like
one flat block. Now the gaps are mathematically identical, so every step is as
visible as every other one — and there is an automatic check that would catch it
if a future colour change broke the spacing.

The visible difference is a refinement, not a jump. The feel is the same; the
steps are just honest now.

### Sizing and shape live in the stylesheet, not in the code

Every visual dimension in the app — the rail's width, how wide a draggable divider
is, how deep a nested tree row is indented, how large a diagram is zoomed — used to
be written into the individual screens as one-off instructions. There are now
**no such one-off instructions left**. The stylesheet owns the shape and size; the
screens only hand it the actual number when that number is real data (a tree's
depth, a zoom level, a pane the user has dragged wider).

This is invisible to a user, and that is the point. It means a width can only be
changed in one place, so two parts of the app can never quietly disagree about
how wide something is — and the app gets faster and lighter as a result, because
the browser stops recalculating style rules that were buried in the code.

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
| **Window becomes narrow** | The left tree collapses into a drawer. The toolbar and tab bar now give way instead of being cut off: buttons that do not fit move into a single **more** button, and tabs that do not fit get small **left/right arrows** to scroll them. **The right sidebar does not yet collapse properly — it shrinks to a sliver, which is a known defect.** | When the window is wider than the workspace minimum (480px) — the layout should not collapse. |
| **Dragging a divider** | Pane dividers are 6px wide (1px visible, 5px invisible pointer tolerance). Keyboard step is 20px. Bounds: tree 220–520px, right sidebar 220–420px. | When the divider is already at its minimum — dragging further should do nothing, not snap back. |
| **Save indicator** | The bar along the bottom always tells you the truth about saving: **Unsaved changes** while an edit is waiting, **Saving...** while it writes, **Saved** once it is on disk, **Save failed** with a Retry button if it did not work. | Let it say "Saved" while the edit is still only in memory. That is the one thing a save indicator must never do — it is what makes an autosave trustworthy. |
| **Theme toggle** | The rail button flips between light and dark. It does **not** follow the OS preference (a known gap, F7). | When the user expects the app to respect `prefers-color-scheme` on first load — it does not yet. |
| **Scrolling** | The rich note is the **only** element that scrolls vertically on its route. The pane dividers, tabs, and chrome rows are fixed. | In the tree or sidebar — those scroll horizontally (overflow) or not at all; they do not participate in the vertical scroll of the document. |

---

## 7. Each kind of page

| Page type | What the surface should look like |
|---|---|
| **Rich Note** | One continuous canvas. No border, no rounded corners, no card frame. The document fills the content area from edge to edge. |
| **HTML page** | One continuous canvas now, as above. The content is shown inside a locked-down sandbox so its own scripts cannot reach the app. A page that brings no styling of its own still gets readable text in both themes; a page that brings its own styling keeps it. |
| **Code page** | Editor surface bound to the document canvas. No separate card framing. |
| **Markdown page** | The rendered view is one continuous canvas, as above. The typing view deliberately keeps its frame — see the note below. |
| **Dashboard** | Uses separate cards with gently rounded corners. Cards are appropriate here because the dashboard is a collection of items, not a single document. |
| **Settings** | A panel with small rounded rows. Matches the right sidebar, because settings is a panel-type view rather than a document. |

**Why the Markdown typing view keeps its frame.** The rendered view and the typing
view are not the same thing. One is your document; the other is a box you type into.
Keeping the typing view visually distinct is a deliberate choice, so you can tell at a
glance which one your cursor is in. It is a decision rather than an unfinished job, so
it should not be "cleaned up" by someone assuming consistency. If you decide you would
rather it match the document exactly, that is a small change — but it is your call, not
an oversight to correct.

---

## 8. Do's and don'ts

| Choice | Do | Don't | Why |
|---|---|---|---|
| **Surface tones** | Give the document and the panel their own named colours, and keep the document brighter. | Let the document and the panel end up the same tone. | The document must never blend into its surroundings. A test now checks they are never equal, so this cannot regress silently. |
| **Colour contrast** | Make each surface a clear, even step from the one beside it, in both themes. | Two surfaces that are a hair apart. They look identical, so the structure has to come from a border — which defeats the point. | The document is the brightest surface, the panels sit behind it, and the rail sits behind them. It is checked by measurement, not by eye. |
| **Separators** | Use one very faint line, and only where colour cannot do the job. | Heavy or doubled lines. A line you can clearly see is too strong. | The top of the window stacks several rows; strong lines turn it into bands. |
| **Floating things** | Give menus, pop-ups, dialogs, tooltips and notifications one shared soft shadow with a faint light edge. | Giving each one its own, or leaving them flat. | A thing that floats should look lifted. The light edge matters most in dark mode, where a shadow alone is nearly invisible. |
| **Radii** | Round corners on controls and cards. Leave the canvas square. | Apply radius to the document surface. | The canvas is structural; radius implies a widget. |
| **Row height** | Keep chrome rows at 40px and tree rows at 30px. | Add dead space inside a row (e.g. a 50px band with a 40px tab row). | Dead space wastes screen real estate and signals unfinished geometry. |
| **Motion** | Use transitions only for state changes (hover, selection, divider hover). | Add entrance animations, slide transitions, or decorative motion. | Motion should communicate, not decorate. Every animation adds perceived latency. |
| **Scrollbar** | Let the document scroll vertically as the only scrolling element on its route. | Make the pane or the chrome row scrollable. | Scroll ownership must be unambiguous; multiple scroll owners confuse the user. |
| **Theme switching** | Verify every change in both light and dark modes. | Check only one scheme and declare the palette correct. | The dark-mode inversion was hidden by a light-only check. Always toggle both. |
| **Measurements** | Keep every size in one central place that the whole app reads from. | Write the same number in two different files. | Two copies drift apart, and then someone has to guess which is right. |
| **Test assertions** | Assert on elements that actually exist in the current app. | Write tests that wait for a title input when the title is a contenteditable H1. | F4 is a shipped test that can never pass because it asserts a non-existent element. |
| **New themes** | Add theme data to the registry; do not invent colours. | Guess palette values for Catppuccin or Nord. | These themes must come from their official palettes, not from memory or approximation. |
| **Choosing a shade** | Change the single lightness number, and keep the steps equal. | Pick a grey by trying it and seeing whether it looks right. | An equal step is provably visible; a picked step is not. The check can verify one and not the other. |
| **Sizing anything** | Put the size in the stylesheet or a shared setting. | Write the size into an individual screen. | A size written twice drifts, and the app slowly becomes heavier as styling accumulates in the code. |
| **Fitting things in a fixed strip** | Leave visible breathing room on both sides. | Make the container exactly as wide as its contents. | An exact fit passes a "does it fit" check while looking cramped, and leaves no room for anything larger later. |
| **Showing the same thing twice** | Show it once. | Print the page type as words when there is already a type icon. | It cost 60 pixels of title on every row, so long names were cut off. |
| **Making a list line up** | Measure the real positions and check them. | Trust that the numbers in the settings look right. | The indent was calculated at 20px but drawn at 16px, so every level drifted 4px and the cutoff point for long names was worked out from the wrong number. |
| **Running out of room in a bar** | Move what does not fit into a single **more** button, and say so. | Let the row scroll sideways, or slice the last control. | A row that scrolls with no visible scrollbar looks broken, not scrollable. A sliced button looks like a rendering fault. |

---

## 9. What still needs doing, in order

| # | Item | Reason for position |
|---|---|---|
| ~~Tabs~~ | ~~**Reorderable tabs**~~ **DONE.** Drag a tab sideways to move it, or hold Ctrl and press the arrow keys. See section 7a of the engineering reference for how and why. |
| ~~The filler region~~ | **Struck, not implemented.** Our notes carried a "filler-based drag region" item from an early reading of Trilium. Read against the source, that filler drags the *application window*, not a tab. It means nothing in a browser-first app, so the item is removed rather than built. |
| ~~Dark mode ignores the computer's setting~~ | **DONE.** The app now follows the operating system, with a **System** choice added so you can hand control back after picking Light or Dark. |
| ~~The formatting bar has no grouping~~ | **DONE — and the finding was stale.** Measured, the bar is already in seven labelled groups with all 28 buttons named. The one real problem it did have, that unavailable buttons looked available, is fixed. |
| ~~1~~ | ~~**Theme token foundation** — registry engine, per-region tokens, editor bound to canvas~~ | **DONE.** Registry, Default theme, and editor binding are live. Guarded by tests. |
| ~~2~~ | ~~**Remove card frames from HTML and markdown editors**~~ | **DONE.** Both rendered views are now one continuous canvas. The Markdown typing view keeps its frame on purpose — see section 7. |
| 3 | **Re-measure and fix the mobile toolbar** | The recorded numbers (F2) predate the current stylesheet and must not drive a fix. Re-measure first, then decide between scroll and an overflow menu. |
| 4 | **Application shell polish** - honour `prefers-color-scheme` (F7), and decide whether the left rail should run the full height or stop at the status bar | The rail is now exactly the right width and no longer casts a shadow. The open question is height, not width |
| 5 | **Tabs** — tab seam into the active tab, filler-based drag region | Shell geometry must settle first (item 4) so tab work is not re-verified. |
| 6 | **Toolbars for Markdown and Diagram pages** | Rich Note and HTML Page have a toolbar; these two have none at all. This is a missing feature, not a styling fault, so it needs your decision on what the buttons should be before any code is written. |
| 7 | **Settings, Calendar, Trash and Favorites as tabs** | They open as a panel that covers the pages underneath. Making them ordinary tabs is a bigger change than it looks, and it shares a starting question with item 6: how should a view that is not a note take part in the tab strip? |
| 8 | **Cosmetic polish** - toolbar grouping and labels (F6), fix the stale test (F4) | The database is clean: 360 test pages removed, 4 pages left alone because they could not be identified as test rubbish. The rest is independent or low-risk. |
| 9 | **Theme picker UI** — plus Catppuccin and Nord from their official palettes | A one-option picker is noise. Held until a second theme exists. |

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
| HTML child files "do not save" | Typing into a CSS child file looked lost. | It was not. Reading the stored page directly showed the CSS was saved, and the rule applied inside the preview. Two separate things had been mistaken for one: a new page starts with empty CSS, and the status bar reported "Saved" for work that had not been written yet. |
| The preview background was going to break | Switching the palette to a perceptual colour format would leave HTML previews with no background, because the safety check only understood three older colour formats. | Caught before it shipped by reading the check while changing the palette. The check now understands the new format and has its own test. The lesson: a value that passes through a validator must be read when the value changes shape. |
| Ten failing tests were "flaky" | Ten tests failing in the rich-note area were treated as an unstable test environment and put aside. | They all shared one cause: creating a page was silently doing nothing. The test suite had been reporting a real, total failure in the most-used action in the app, and it was read as noise. **When every test in a group fails the same way, that is one fault, not many.** |
| The rebuilt tree was reported working | A row was changed so it became a flex container, and the automated checks all passed. | The change removed the row's only child from the page layout, leaving the row with **no clickable area at all**. It still drew correctly and still passed every colour and spacing check, so only using it revealed that dragging had stopped working. **A check that can pass while the thing is unusable is not a check.** Five problems were reported in one go; all are now covered by tests. |
| Two failing tests were blamed on this change | Two tests in the stability group started failing after the sidebar work, and looked like damage from it. | The work was put aside and the tests were run again **against the previous commit**. They failed there too. Nothing had been broken. What had actually happened is that the recorded "4 failures" baseline was incomplete — it is 6. **A remembered failure count is not a baseline; re-run the code you are about to change.** |
| "The 72px name floor is not being applied" | A measurement read 14px while the stylesheet plainly said 72px, which looked like the rule was being ignored. | It was being **outranked**. The tree library sets a minimum width of one character on the same element, and one character at that font size is exactly 14px. The library's stylesheet is loaded after ours, so our rule lost. **A number that looks like a default is often simply another rule's value.** |
| "The selected row turns white on hover" | The report was that hovering the item you had chosen showed a white colour. | The row's hover colour was measured and was correct. The white was the little action button on the row, which carried an opaque pale background so its icon would stay readable over the blue selection — and in a light theme that background is nearly white. **Right colour, still broken.** The same trap as the row that had no clickable area. |
| "Mantine has a package for drag-and-drop lists" | Offered to you by name as an option for the reordering work. | It does not exist — it returns "not found" on npm and does not appear in a search. I stated it as fact without ever having read it. The deeper error was the assumption behind it: Mantine has no drag-and-drop code of any kind, so there was nothing to find. Three claims in this session came from memory rather than from reading, and all three were wrong. |
| "Those failing tests are just out-of-date tests" | Twenty-four failing checks across five files were treated as housekeeping to tidy up. | Four were real faults in the app, and two of those were losing your work: the bottom bar saying unsaved work was saved, and reloading closing your tabs. Calling a failure "pre-existing" describes *when* it appeared, never *what it is*. That phrase had been used to excuse them across several sessions, and it is what kept them alive. |
| "The other checks all passed" | A long background run of the remaining checks was read as confirmation while other work carried on. | The run is void. The app was rebuilt several times while it was still going, so what it was testing changed underneath it. A check that is interrupted or rebuilt mid-flight is not a measurement — I have thrown the result away and am running it again against one fixed build. |
| "The formatting bar is one undifferentiated row" | Carried over from the original review and never looked at again. | It is not any more: it is split into seven labelled groups, and every one of its 28 buttons is named for a screen reader. The finding simply went stale. This is the second time a recorded problem turned out to describe code that had already moved on, which is why the note now says to re-measure before acting. |
| "Draggabilly is the right library" | Recommended, and the whole reordering plan was built around it, partly because it is small. | Its last release was in **December 2021** and it has not been touched since. It is abandoned. The replacement chosen instead was updated the previous day, and works in a way that fits how this app is written. **"Small" was the right instinct and the wrong fact.** |
| "The reordering library could not reorder" | A test built to try the library out showed the tabs refusing to move, which looked like a clear verdict against it. | The test's own drag handle was an empty box with no height, so the mouse never touched it. The library worked perfectly once the test was fixed. **A red result from a test you wrote yourself is a fact about the test.** |
| "The editor grabbing the cursor was nothing to do with tabs" | Written off as a neighbouring problem while the reordering was being chased. | It was the actual cause. For just over a second after you open a page, the editor takes the cursor back if it is not already in a box you would type into — and tabs were not on that list. So every time you moved a tab with the keyboard, the cursor jumped into the document a moment later. It had been there all along; nothing had ever put the cursor on a tab to expose it. **When a symptom shows up in a neighbouring part of the app, that part is telling you something about itself.** |

---

## 11. Known gaps

These items have never been checked or verified in this environment:

| Item | Reason |
|---|---|
| **Native desktop window** | The app has never been checked as a real desktop window — the toolchain to build it is not available here. Everything so far was checked in a browser. The underlying program itself does start and serve the app correctly. |
| **Windows `decorations(false)` build** | Requires building the desktop shell, which is not available in this environment. |
| **HTML pages, code pages, Calendar/Study, Settings, Trash, Favorites views** | Only Rich Note and dashboard were driven during verification. |
| **Empty, loading, and error states** | Not driven during the audit. |
| **Keyboard navigation and focus order** | Not tested. |
| **Contrast for every element** | Only the toolbar and the page tree rows were checked. Both were comfortable at about 10:1. Tabs, the title row, and the rest of the interface have not been measured. |
| **"Saved" confirmation in the HTML source view** | **FIXED.** The bar said "Saved" for the whole two-second window before an autosave even ran, because a pending edit was reported as "clean". There is now a distinct **Unsaved changes** state. |
| **Retry after a failed save** | **Works.** A failed save shows **Save failed** with a Retry button in the bottom bar; pressing it sends the pending content. A check that had been failing was clicking a button that does not exist, so the feature looked broken when it was not. |
| **Pane drag-resize, collapse persistence, keyboard shortcuts** | Runtime behaviours not studied. |
| **Tab overflow scrolling, command palette, contextual toolbar conditional groups** | Not driven during the audit. |
| **Markdown and Diagram workspaces** | Only the *absence* of a toolbar was measured. The editors themselves were not driven. |
| **Settings, Calendar, Trash, Favorites** | Only that they open as a panel covering the pages underneath. The views themselves were not driven. |
| **The full set of browser checks** | Never run start to finish. They are run in groups, and each group's failures are compared against a freshly measured baseline rather than a remembered one. |

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
| 2026-09-26 | The app now follows your computer's light/dark setting | It always looked light, even on a machine set to dark, until you found the setting by hand. There is now also a **System** choice, so you can hand control back to the computer after picking one |
| 2026-09-26 | Reloading no longer throws away your open tabs | This is the serious one. Open two pages, reload, and one disappeared — and then stayed gone. The app was writing a web address into its own location bar and, on reload, reading that back as "open only this one page" |
| 2026-09-26 | The bottom bar no longer claims unsaved work is saved | On a Rich Note or a Markdown page it said "Saved" continuously, including while your edit was still only in memory. The same mistake had been copied into three places, and the one that was right was the only one being tested |
| 2026-09-26 | The right-click menu on a page can now be opened from the keyboard | The ContextMenu key and Shift+F10 did nothing at all. The menu opened and closed again within a few milliseconds, which is why it looked like it never opened |
| 2026-09-26 | Buttons that cannot be used right now now look like it | On the formatting bar, unavailable buttons looked exactly the same as available ones — 28 identical icons in a row, with no way to tell that clicking one would do nothing |
| 2026-09-26 | The settings list looks like the rest of the app's lists | It was a separate visual style for the same idea. Each section now has an icon and is sized from the same values as the page tree, the pane no longer prints "Settings" above content that the list beside it already names, and you can filter the sections by typing |
| 2026-09-26 | Tabs can be reordered, by dragging or with Ctrl and the arrow keys | They looked like tabs but could not be moved, so they were a picture of tabs rather than tabs. Both routes go through the same rule, so the mouse and the keyboard can never disagree |
| 2026-09-26 | Moving a tab with the keyboard no longer throws the cursor into the document | The editor reclaims the cursor for a moment after a page opens, and tabs were not on its list of places you might deliberately be typing. It had always been true; nothing had ever put the cursor on a tab to show it |
| 2026-09-26 | The plan to add a "filler region" to the tab bar was removed | Read against Trilium's actual code, that region drags the *application window*, not a tab. It has no purpose in a browser-first app, so it is struck rather than built |
| 2026-09-26 | The side panel now lines up on one edge | The search box, the "Root" row and the page rows were three different widths with three different left edges, so the highlight changed width depending on what you clicked. There is now one measurement that all three use |
| 2026-09-26 | "Root" sits flush with the first page, and the home page's tab no longer looks flat | There was a 10-pixel gap under "Root" and none at all between the pages below it, so the spacing changed for no visible reason. On the home page the open tab met a hard line instead of joining the row beneath it, because the home page's heading was the wrong shade |
| 2026-09-26 | Only one thing says "you are here" on the home page | The left strip and the page tree were both marking the home page as current, in two different colours |
| 2026-09-26 | Hovering the page you have selected no longer shows a white patch | The little action button on the row had a pale background so its icon would stay readable over the blue highlight — which meant hovering the row you had chosen painted a near-white square on it |
| 2026-09-25 | The empty bar above the dashboard is gone, and the information bar now shows where you are | On the home page there were no tabs, so a 40-pixel empty strip sat above your content for no reason, and the bar along the bottom lost its "you are here" information |
| 2026-09-25 | The open tab now joins up with the row below it | The active tab was floating above the toolbar as a rounded shape rather than connecting to the page beneath it, which read as an outline rather than a tab |
| 2026-09-25 | The search box in the side panel is wide again, with a proper outline | A previous attempt made it run edge to edge with no corners, and its border turned out to be so faint the box was nearly invisible |
| 2026-09-25 | The page tree is easier to use with a keyboard or a screen reader | The arrow keys moved correctly but nothing announced which page you were on, so a screen reader read nothing when you pressed Down |
| 2026-09-25 | The page tree was rebuilt so the rows line up properly | Nested pages were drifting sideways by a few pixels per level, and long titles were being cut off using the wrong measurement. The rows now sit on an exact grid |
| 2026-09-25 | The tree is easier to read: bigger icons, larger text, visible arrows, and each page's name is no longer repeated after its type | Every line was showing its type twice — once as an icon, once as words. Removing the words gave each title about 60 pixels back |
| 2026-09-25 | The "Root" row now matches the other rows, and the search box spans the full width of the pane | Both were slightly different sizes from the rows below them, which is what made the spacing look uneven |
| 2026-09-25 | The top bars now shrink gracefully when the window is narrow | When the window was narrow, the formatting toolbar was sliced through the middle of a button with nothing to say there was more. Now the buttons that do not fit move into one "more" button, and tabs that no longer fit get small left and right arrows |
| 2026-09-25 | The line between the tab bar and the toolbar was removed | The two rows are now told apart by their shade rather than by a rule, so the top of the window no longer reads as a stack of bands |
| 2026-09-25 | Creating a new page now actually opens it | It had been silently doing nothing: the page was saved, but no tab opened, nothing appeared in the tree, and the editor never loaded. You were told it worked while the screen said "Saved" |
| 2026-09-25 | The left navigation strip was widened from 40 to 48 pixels | At 40 the icons exactly filled it with no breathing room, so they touched both edges. It now looks centred and has room to grow |
| 2026-09-25 | The four surface shades are now spaced by an exact, measured amount | They had been picked by eye and were nearly equal, so two of them read as the same colour. A refinement, not a visible jump |
| 2026-09-25 | All sizing and shape moved out of the individual screens into the stylesheet | Fifteen one-off size instructions were scattered across the app. Now there is one place for each, and nothing hardcodes a size inline |
| 2026-09-25 | This guide was written, alongside a companion reference document | The existing reference was written for engineers and was not usable for making design decisions |
| 2026-09-25 | The packaged app now includes the screen it shows | The built program shipped with no interface at all and showed a "not found" page. The build now places the screen beside the program, where it looks for it. |
| 2026-09-25 | The save indicator was made truthful | It reported "Saved" for work that had not been written yet, so a pending edit looked saved |
| 2026-09-25 | The HTML and Markdown rendered views stopped being cards | They were framed and painted a different shade from the page, so in dark mode the content looked like a hole. Only the typing view keeps a frame, on purpose |
| 2026-09-25 | The theme foundation was completed | Colour rules now have one source and a test that protects them |
| 2026-09-25 | Two earlier findings were withdrawn | Their measurements could not have been true of the code they described |
