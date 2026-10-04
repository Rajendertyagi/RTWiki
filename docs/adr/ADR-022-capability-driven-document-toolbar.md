# ADR-022: One document toolbar, driven by editor capabilities

- **Status:** Accepted
- **Date:** 2026-10-02
- **Supersedes:** nothing. Refines [ADR-003](ADR-003-react-blocknote-mantine.md) only in that the
  formatting controls are now described as data rather than as a component per editor.

## Context

RTWiki had one toolbar *row* — `page-workspace.tsx`'s `toolbarRow` — and three toolbars
inside it. A Rich Note had `rich-toolbar.tsx`, roughly 900 lines calling BlockNote's command
API directly. An HTML page handed a rendered `ReactNode` up through `onToolbarReady`. A
Markdown page had no toolbar at all, so its page type was excluded from the row and a
Markdown formatting bar was built separately, in a row of its own below the header.

The visible result was two bars on a Markdown page and one on every other page type, and the
control set was whichever set the rendering component happened to contain.

The first attempt at fixing this made it worse in five specific ways, all of which are worth
recording because each is a way a shared toolbar can go wrong:

1. It decided what to render with `pageType === 'markdown'` conditionals inside the component.
   That cannot express *why* a control is unavailable, so a greyed button could not explain
   itself.
2. It used `Math.random()` in React keys, so the toolbar visibly re-laid-out on every render.
3. Three of its buttons returned their handler instead of calling it, so they were dead. The
   string transforms underneath were correct and were unit-tested; nothing tested the path
   from a rendered control to a transform to a dispatched transaction.
4. It set `role="toolbar"` and an ARIA label but no roving tabindex, so the bar had seventeen
   tab stops instead of one.
5. It imported `rich-toolbar.module.css` across feature boundaries, making one feature's
   stylesheet load-bearing for another.

## Decision

**The toolbar is one component, one control list, and one set of CSS. Editors contribute
capabilities, not markup.**

### The model

`src/web/features/workspace/toolbar-model.ts` declares the toolbar as data: 35 commands in 11
groups, plus the overflow control. Order and grouping are data because a group boundary is a
divider and where the boundaries fall is a design decision, not something a component should
re-derive from a list of strings.

Every control's key is its capability name. Never an array index and never its label: the key
is what React reconciles against, and a positional key tears a control down and rebuilds it
whenever anything above it changes.

### The contract

`src/web/features/workspace/capabilities.ts` defines what an editor surface reports, in two
parts:

- `commands` — the **static** answer: which capabilities this surface implements at all.
- `state()` — the **live** answer: which of them can act *right now*, and which are pressed.

Splitting them is what keeps a caret movement from re-creating the control set. The first
attempt collapsed them and re-rendered the bar on every keystroke.

`Availability` is a discriminated union, not two optional fields. With optional fields a caller
could write `{ reason: 'x' }`, forget `available`, and produce the one state the shell cannot
render: a control that is neither usable nor able to say why not.

**Every declared control is rendered, whether or not the editor has a command for it.** A
capability with no command is greyed with a reason, not dropped. Dropping it was tried first
and measured: on a Markdown page it produced a bar with *zero* disabled controls, because the
capabilities Markdown lacks are exactly the ones with no command. The bar was then silently
shorter on Markdown than on a Rich Note, and a reader could not distinguish "not applicable
here" from "not built yet".

### The unavailable control

A control that cannot act uses `data-disabled`, **not** the native `disabled` attribute,
because it must be able to explain itself. Both halves of this were measured rather than
assumed:

- A natively `disabled` button does not fire `mouseleave`, which is what kills a Mantine
  `Tooltip`. Verified: a `data-disabled` control keeps `pointer-events: auto` and its tooltip
  opens with the full reason; a natively disabled one does not.
- `data-disabled` is **not only a marker**. Mantine's own stylesheet matches it and paints a
  filled `--mantine-color-disabled` box. Left alone, an unavailable control was the only
  control on the bar with a background, so it read as selected rather than unavailable.
  Measured: `rgb(46, 46, 46)` against `rgb(201, 201, 201)` for every other control. The module
  resets it to transparent, leaving the 0.35 dim as the only signal.

The 0.35 dim is not new. It is the value the existing toolbar rule already applies to
`:disabled` and `[aria-disabled="true"]`, so an unavailable control looks the same in the
unified bar as it did in the Rich Note's.

### Roving focus

`use-roving-focus.ts` is a separate hook, and the tab strip's keyboard handler is deliberately
**not** reused despite its `tabIndex={active ? 0 : -1}` line looking like the same primitive.
The behaviours differ in ways that matter:

- The tab strip's arrows *change selection*. In a toolbar, arrows must move focus **without**
  running the command, or arrowing across the bar would bold and un-bold the document.
- Its `Ctrl+Arrow` reorders tabs, which has no toolbar analogue.
- It announces moves through a live region, because a reordered tab strip is not otherwise
  perceivable. A toolbar's pressed state already is.
- Its focus is driven by selection; a toolbar has none, so its roving index must stand alone.

The shared idea is one line of tab-index arithmetic, which is not worth a cross-feature import.

Disabled controls are skipped when arrowing, per the APG: landing on a control that cannot act
wastes the keypress and hides the fact that it is unavailable.

### Overflow

The existing `useToolbarOverflow` hook is reused unchanged. It measures rather than
breakpointing, so the split happens at the width the controls actually need, and the
overflowed controls are *moved* rather than reimplemented — which is what keeps a popover-backed
control working from inside the panel.

## Consequences

### The Markdown adapter

`codemirror-capabilities.ts` maps capabilities to CodeMirror. Undo and redo are CodeMirror's
own `undo`/`redo` from `@codemirror/commands`, and availability is read from `undoDepth`/
`redoDepth` — the same numbers the commands consult, not a second history tracked here. A
greyed undo that reads "nothing to undo" is the difference between an unavailable command and a
broken button.

`codemirror-markdown-actions.ts` holds the pure string transforms. They are editor-agnostic and
were the one genuinely reusable part of the deleted first attempt.

### The seam differs from the HTML page, deliberately

`html-editor.tsx`'s `onToolbarReady` hands up a `ReactNode`, because the HTML toolbar is
popover-heavy and predates this model. The Markdown page publishes capabilities instead. This
is an inconsistency, recorded here rather than hidden: the HTML toolbar has not been converted,
and doing so is follow-up work rather than something this change pretended to do.

### Lazy loading is preserved

`DocumentToolbar` is `lazy()` in `page-workspace.tsx`, matching the existing `RichToolbar`. A
static import was tried first and was a measurable regression: the model names 36 Tabler
icons, so a static import pulled the whole icon set plus `ActionIcon`, `Tooltip` and `Popover`
into the **eager** entry chunk. Verified in the built output — the entry went from 1876 KB to
1858 KB once the shell moved into its own 6 KB chunk.

The Markdown adapter stays in the lazily-loaded `markdown-workspace` chunk, so CodeMirror and
the toolbar's Markdown half are not pulled in by a page that never opens one.

### Overflowing is measured, not asserted

One property is worth stating because the naive test for it is wrong. Whether the bar overflows
cannot be checked with `scrollWidth <= clientWidth`: the overflow panel is portalled into the
body, and its children still count toward the bar's scrollable overflow in Chromium. A correct
split measured `scrollWidth` 702 against a `clientWidth` of 540 while its visible slots summed
to exactly 540. The assertion is on the last visible slot's right edge against the bar's, and
the layout test asserts the *row* rather than the inner `role="toolbar"` element, because that
element is vertically centred within the row and comparing its top edge to the tab strip's
bottom reads a 6px difference that is the centring, not a gap.

## Alternatives rejected

**Extend `rich-toolbar.tsx` to cover Markdown.** Rejected: it is bound to BlockNote's API
(`editor.toggleStyles()`, `useEditorState()`), none of which exists for CodeMirror. The two
editors share no commands, only a shape.

**One `ReactNode` per editor, as the HTML seam already does.** Rejected as the model for a
*new* surface, because it makes the control set a property of whichever component is rendered,
which is the defect being fixed. It is why the Markdown seam is capabilities.

**Drop controls an editor cannot do.** Rejected: it reflows the row on every tab switch, and
"not applicable here" becomes indistinguishable from "not built yet".

**A roving-focus dependency (Radix, React Aria).** Rejected: Mantine has no such primitive and
`ActionIcon.Group` is unusable here because its own documentation forbids wrapping children in
extra elements, which the measured-slot design requires. The behaviour is ~40 lines and is
testable without a DOM.

**Convert Markdown to BlockNote.** Rejected by the owner. CodeMirror stays.

## Verification

- `tests/toolbar-model.test.ts` — 15 tests. Model invariants: unique keys, one group per
  control, non-positional group keys, a label from the dictionary, the overflow control not
  also being a bar control.
- `tests/codemirror-markdown-actions.test.ts` — 31 tests. The transforms, including the
  select-all case described below.
- `tests/browser/unified-toolbar.pwspec.ts` — 19 tests, in a browser because a CodeMirror
  `EditorView` constructs DOM in its constructor and cannot exist headless.

The interaction tests exist because of defect 3 above. Each presses a real control and reads
the document back, so a control wired to nothing fails. A single test asserts that *every*
declared capability changes the document when run, which is the general form of the bug that
shipped before.

One bug was found by writing them. `isWholeLineSelection` compared the selection's end column
against `0`, so a select-all — which puts the caret at the last character — was rejected, and
every block control (heading, list, quote, table) was disabled while the inline marks worked.
The hand-written unit tests all selected to column 0 and so passed. The fix compares against
the end of the line's text, and the tests now assert the select-all case explicitly.
