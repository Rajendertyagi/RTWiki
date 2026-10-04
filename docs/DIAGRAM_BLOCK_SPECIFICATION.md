# Diagram blocks: how sizing and viewing should work

This document describes, in plain language, every control that affects how big a diagram is
drawn and how it is viewed, and what each one should do. It is the reference used to check the
application and to decide what to fix.

It is written for readers who do not read code. Where a measurement appears, it was measured in
the running application, and the number is the one that was actually observed.

---

## 1. The two things that are easy to confuse

There are two independent controls, and they are not the same thing.

| | **The box** | **The view** |
|---|---|---|
| What it changes | The frame drawn around the diagram | The diagram's position and magnification inside that frame |
| Changed by | The corner grip, the size buttons | The eight buttons in the diagram's own corner |
| Saved with the note? | **Yes** | **No** |
| Seen by someone else opening the note? | Yes | No |

**Why the view is not saved.** If you zoom in to read a wide diagram, then close the note and come
back, the diagram is drawn at its normal size again. This is deliberate. Somebody else opening
your note should see the diagram as you wrote it, not as you happened to be squinting at it.

**Consequence to be careful about:** the view controls must never change what is stored in the
note. If zooming a diagram can alter the saved note, that is a defect.

---

## 2. The box: the controls

### 2.1 The corner grip

A small diagonal-lines handle in the bottom-right corner of the box.

- It appears when the pointer is over the block, and stays dim otherwise so it does not compete
  with the diagram.
- Dragging it changes the box.
- Releasing it saves the new size into the note.
- Releasing without having moved anything must **not** save anything. Clicking the grip out of
  curiosity should not turn an unsized block into a sized one that the user then has to undo by
  resizing it again.

**Limits.** The box cannot become smaller than 240 x 120 pixels, or larger than 1600 x 2000
pixels. These are the outermost limits for the whole application and are deliberately generous;
the column of text is a narrower and more relevant limit, covered in 2.3.

**Keyboard.** The grip can be focused, and the arrow keys then resize the box in steps of 40
pixels. Arrow Right and Arrow Up make it bigger; Arrow Left and Arrow Down make it smaller. A
keyboard user must be able to do everything a pointer user can do here.

### 2.2 The five size buttons

A row of five buttons shown on hover, showing the block's width as a set of bars: narrower bars
mean a narrower block. Hovering a button names it.

| Button | What it means | What it sets |
|---|---|---|
| Small | Short bars | 360 wide, 240 tall |
| Medium | Medium bars | 640 wide, 400 tall |
| Large | Tall bars | 960 wide, 560 tall |
| Full width | Widest bars, no fixed width | As wide as the column allows, 400 tall |
| Auto height | No bars — a diagram outline | As wide as the column allows, height decided by the diagram |

Bars rather than letters: the earlier version showed the bare letters `S M L F A`, and two of
those letters stand for a *behaviour* rather than a size, which a first-time reader cannot guess.
Bars say the same thing without words and work in any language.

**Requirement for all five:** pressing a size button must visibly change the **diagram**, not
only the border. A border that changes while the picture inside it ignores you is the single most
confusing failure this feature can have, and it is the defect recorded in section 5.1.

### 2.3 How wide the box may become

**Required behaviour:** a diagram must be able to be resized horizontally in a way that feels
useful. Concretely: **a block narrower than its column can be widened again by dragging the same
grip outward**, without reaching for a size preset.

**Nothing extends past the text column.** A block is capped at the column's own width, so a note
containing a resized diagram looks exactly like a note of plain text. The Diagram page is the one
deliberate exception: its blocks sit in a wrapping grid, so a wider block reflows into a second
column and the wider ceiling is correct there. See 6.1 for how that decision was made.

**One authority, and it is the one CSS enforces.** A block's width is bounded by exactly one thing:
`max-width: 100%` on `.sizeContainer`, which resolves against **its containing block's content box**.
**The boundary is a surface contract, declared with `data-block-width-boundary`.** A block's width is
bounded by exactly one thing: `max-width: 100%` on `.sizeContainer`, which resolves against its
containing block's content box. Rather than infer which element that is, **each surface declares it**:

```
surface owns the boundary
        —  data-block-width-boundary
shared resize component (blockWidthBoundary)
        —
one authoritative number
```

| surface | marks | element | measured at 1600x950 / 1440x900 / 700x800 |
|---|---|---|---|
| Rich Note | `.previewPane` (`mermaid-block-view.tsx`) | the note's text column | **822 / 662 / 506** |
| Diagram page | `.blockList` (`mermaid-workspace.tsx`) | the wrapping flex row | **974 / 814 / 646** |

`blockWidthBoundary` walks up from the container to the **nearest** marked ancestor and reads that
element's content box. Read-only: `closest()` inspects the tree and writes nothing. The pointer drag,
the keyboard and the size presets all call it, so there is one authority and nothing to keep in step.

Why these two, in each case:

- **Rich Note.** The container's parent is already `.previewPane`, which is `width: 100%` and
  `flex: 0 1 auto`. Its content box comes from the text column and does not depend on the block, so it
  is the containing block in CSS's own terms. One level up — and the marker says so.
- **Diagram page.** The container's parent is Motion's `Reorder.Item`, whose width is
  `var(--block-width-live, var(--block-width, auto))` — the block's own size, written back onto it — and
  which then takes a *share* of the wrapping row: measured `flex-basis: 352px, flex-grow: 1`, holding
  **401px of an 814px row** when a second block sat beside it. Clamping to it forbids all growth, which
  is the trap. The row, one level higher, is the boundary — and the marker says so rather than leaving
  the shared component to work out which box it is looking at.

**Boundary discovery is read-only, and that is enforced rather than asserted.** The alternative — offer
the block maximum through the width custom properties, read what was drawn, put everything back — is
exact, and was measured and abandoned. Writing to the tree trips the block's own `ResizeObserver`,
whose state update **replaces the resize grip**, so the pointer capture `onPointerDown` takes is
destroyed and every following `pointermove` goes to whatever is under the cursor. Measured: with the
probe, the grip node after `pointerdown` was a *different element* and a Rich Note drag moved nothing on
either axis; without it, the same node and a working drag. Two tests hold the line: the grip node must
be the same node for the whole gesture, and a `MutationObserver` over the boundary and every ancestor
above it must record **no** attribute write during a drag, which is exactly what the probe did.

**A missing marker is reported, not guessed around.** No declared boundary falls back to
`LAYOUT.blockMaxWidth` — the only other constraint in the product — and logs a `console.warn` once per
container. It deliberately does **not** fall back to some other ancestor: quietly picking an unmarked
neighbour is how the earlier version produced a boundary 126px wider than the space a block could ever
occupy, and it did so silently.

**The declaration is the clamp's ceiling, not a promise CSS will honour.** Both are limits and they are
not the same limit. Measured: moving the Diagram page's marker up to `.contentRow` (1104px) left the
block stopping at **814px**, because the `Reorder.Item`'s own `max-width: 100%` still resolves against
`.blockList`. A block may never draw wider than the declared boundary; it may draw less.

**Correction, measured.** This section previously described **two grips, one on each side edge**,
and 5.5 claimed the single corner grip left a block unable to grow again. Both claims were checked
against the running application and are wrong:

- There is **one** grip, in the bottom-right corner (`block-resize.tsx`), and the earlier
  description of two was never true of the code.
- A narrowed block **can** be widened with that same grip. Measured in Chromium at a 1440x900
  window on a note whose column is 662px: dragging left took the block **662 → 402**, and
  dragging right from there took it **402 → 662** again. No preset was used at any point.

**Why dragging a maximal block sideways still does nothing, and why that is correct.** An earlier
version of this section required that "from a box that is already as wide as the text, dragging
sideways should visibly do something". That requirement is not satisfiable together with 6.1: a
block already at the column width has nowhere to grow *within the column*, and growing past it is
the thing 6.1 forbids. Neither one grip nor two can satisfy it. The requirement has been restated
above to the part that is both achievable and useful — widening a block that has room to grow —
and the maximal-block case is left as the correct no-op that it is.

**Measured:** note column 662px, single corner grip, drag left 662 → 402, drag right 402 → 662.
Dragged 900px past the edge from a full-width block, it stays at the column width.

### 2.4 How the diagram responds to the box

**Required behaviour — this is the behaviour the application should have:**

- **Unsized block.** The diagram is drawn at its natural size. Nothing is stretched.
- **Box made wider or shorter.** The diagram scales up or down to fit the box, keeping its shape.
  A diagram is never distorted: if the box is a different shape from the diagram, the diagram is
  fitted to the box and the leftover space is left as margin, rather than the diagram being
  stretched to fill it. The diagram stays centred.
- **Auto height.** The box's height is decided by the diagram, so there is never empty space
  inside the box and the bottom of the diagram is never cut off.
- **Diagram larger than the box.** The whole diagram is always reachable. It is never cropped
  with no way to see the missing part.

**Status: both surfaces now behave this way.** This paragraph previously said the Rich Note did
not, and that "resizing should autofit the diagram" and "the diagram goes to the edges and is not
fully visible" were the same complaint. That was true when written and was fixed by 5.4; the note
now carries the same rule as the Diagram page, `.sizeContainerSized`, which gives the stored height
a definite box and lets the diagram shrink into it rather than being clipped by it.

Measured after the fix: a note block with a stored height scales its diagram to fit, and the whole
diagram stays reachable.

**One thing this does NOT do, deliberately.** A block may be made taller than the window. That is
allowed — a reader who wants a tall diagram should be able to have one, and the stored size is the
reader's choice, not a function of the window. Such a block is not "autofitted" back down: it
simply extends its page, and the note's scroll container reaches the rest of it. Measured: a block
of 1330px inside a 752px scroll pane, with the diagram's bottom fully visible once the pane is
scrolled to the end.

### 2.5 Where the size is saved

A block's width and height are part of the note's content, alongside the diagram's text. They are
saved when the drag or the size button is released, and are visible to anyone who opens the note.

**Requirements:**

- The size that is saved must be **the size the box actually reached**, not the size that was
  asked for. If the box cannot grow as far as the pointer asks, the smaller real size is what must
  be saved. Saving the larger requested size would leave the note holding a size the page can never
  draw, and a reload would quietly disagree with the picture forever.
- A saved size must never exceed what the column can display.
- **Saving must be reliable.** If a resize is sometimes not saved, that is the most serious defect
  in this feature: the user believes a change is stored and it is not. See section 5.2.

---

## 3. The view: the eight buttons

Eight buttons sit in the bottom-right corner of a diagram, arranged as a pad: the four arrows
around a reset button in the centre, zoom in above the right arrow, zoom out below it, and full
screen under the reset.

- They are **invisible until the pointer is over the diagram**, so they never sit on a diagram
  that is being read. They must also be reachable by keyboard.
- They are the same eight buttons, doing the same thing, on a Diagram page and inside a note.
  These were two separate sets of code that drifted apart until the same diagram looked like two
  different things. They are now one shared component, and that is deliberate: two copies of the
  same feature will drift apart again.

| Button | What it does |
|---|---|
| Four arrows | Moves the diagram one step in that direction |
| Zoom in / Zoom out | Enlarges or shrinks the diagram inside the box |
| Reset view | Returns the position and magnification to normal |
| Full screen | Shows the diagram on its own, filling the screen |

**Limits.** Zoom is bounded so a diagram cannot be shrunk into nothing or magnified past the point
of usefulness. The bounds are 20% and 600% of natural size.

**There is exactly one zoom, and it is `--view-scale`.** A diagram's magnification is
`DiagramView`'s `--view-scale`, in a range of 20%–600%, applied to `.layer` and nothing else. It is
the only zoom that has a pan, a full screen, a reset, and a reachability proof. Both surfaces use
the same one, and **there is no page-level or block-level multiplier anywhere**:

- The Diagram page used to carry a second, width-based zoom — a workspace `zoom` control writing
  `--zoom-level` onto a `.zoomHost` wrapper, 50%–200%. It multiplied with `--view-scale`, with no way
  to see the product, and the **lower half of its range did nothing at all**, because `.zoomHost`
  carried `min-width: 100%`: measured, at `--zoom-level: 50%` the host's `offsetWidth` was unchanged.
  It is removed. 5.15 records it.
- The Rich Note's equivalent legacy zoom had already been removed for exactly this reason, which is
  what left the Diagram page inconsistent with it.
- **The rule to keep:** nothing between the picture and its `.layer` may change its own size or carry
  a transform. That is a statement about geometry, not about class names, and it catches a second
  zoom layer whatever it happens to be called. `diagram-zoom-fit-authority.pwspec.ts` asserts it.

The effective magnification a reader sees is **painted width ÷ layout width**, and that must equal the
one declared value at every level. It is a measurement, not a label: a second multiplier shows up as
the difference between the two.

**Full screen's fit.** Full screen adds one more term, `--view-fit`, and the contract is:

> **Fit is the scale at which the drawing fills the viewport on its limiting axis** —
> `max(1, min(viewportWidth / layoutWidth, viewportHeight / layoutHeight, 4))`.

- It is measured from the picture's **layout** box (`clientWidth`, which is transform-independent) and
  the **overlay's** box. Not from the painted rect: that box contains the reader's own zoom, so a
  1.25 zoom drove the ratio to 0.80, it was clamped to 1, and fit silently stopped working. Fit is a
  property of the drawing and the screen, and must not contain the reader's magnification.
- `1` is an answer, not a fallback. A diagram the layout has already fitted to the overlay's width has
  nothing to gain, and `1` is the correct value for it.
- `4` is the existing product decision that a 200px two-node flowchart scaled to a 4K screen turns its
  labels into furniture.
- It is **multiplied into** `--view-scale`, never substituted for it, so the effective magnification
  is exactly one product of two known terms: `viewScale × fit`.
- The picture is centred, at `max(0, (viewport − painted) / 2)` per axis. That `max` is what keeps
  reachability true: it clamps the picture's **start** coordinate to 0, so when the drawing is too
  big to centre every pixel of overflow stays end-side and scrollable.
- It is written only while full screen is open and **removed explicitly** on close. React owns the
  three properties in the element's `style` prop and rewrites those, but it does not know these exist
  and will never clear them; left behind they multiply into the box view too, and the diagram comes
  back from full screen enormously magnified and cropped — the very symptom, reintroduced by the fix.

**Zoomed and panned content must stay reachable.** This is the one requirement of the view that
needs stating on its own, because the obvious implementation gets it wrong in a way that is easy to
mistake for a fix. Zoom and pan are CSS `transform`s on the layer. **A transform changes what is
painted but not what is laid out**, so on its own it produces no scrollbars: the diagram grows past
the box, the box clips it, and the part that hangs outside cannot be reached.

A transformed element *does* contribute to an ancestor's scrollable overflow area, so `overflow:
auto` on that ancestor is necessary — and on its own it is **not sufficient**. An LTR scroll
container can only travel towards its **end**. A `transform-origin` at the centre grows the box in
*both* directions and only the end-side growth becomes scrollable, so half the overflow is produced
and then discarded:

| `.layer` `transform-origin` | stage `scrollWidth` (port 640) | painted content, local x | left | right | top | bottom |
| --- | --- | --- | --- | --- | --- | --- |
| `center center` | 720 | −80 … 720 | **no** | yes | **no** | yes |
| `0 0` | 800 | 0 … 800 | yes | yes | yes | yes |

Measured on this exact DOM and CSS in Chromium at `scale(1.25)`, with the origin as the only
variable. With the centre origin the stage reports extent for exactly half the overflow it needed,
and the missing half grows with the scale: **80px unreachable at 1.25×, 461px of a 1562px drawing
at 2.44×**, and 9–10% of the drawing's width in full screen at every viewport measured. Panning
does not rescue it — panning far enough to show the start edge pushes the end edge out of reach,
because the scrollable travel is smaller than the travel needed to see the whole drawing at once.

So the rule is not "add `overflow: auto`". It is:

- **One scroll owner per diagram: `.stage`** (`diagram-view.module.css`), because it holds the layer.
- **`.layer` must use `transform-origin: 0 0`.** That is what puts the whole of the zoom's overflow
  on the scrollable side. Every other rule below is downstream of it.
- **`.host` must not scroll.** The eight buttons are absolutely positioned against it, and an
  absolutely positioned box scrolls with its containing block — a scrolling `.host` would carry the
  controls away exactly when a zoomed diagram needs them.
- **Full screen owns its own overflow**, for the same reason: its scale is `--view-fit` composed
  with the reader's zoom, and it is a different box.
- **Pan is not implemented by scrolling.** Panning has to work at any magnification, including a
  diagram that fits entirely and has nothing to scroll. It stays a transform, and the controls —
  anchored to the non-scrolling `.host` — are what make an over-panned picture recoverable.

**The trade this forces, stated rather than hidden.** The anchor is the box's top-left rather than its
centre, which is what every scroll-reachable zoom canvas does and the only anchor that can satisfy
both edges at once. Measured consequence: zoom below 100% shrinks the drawing towards the top-left of
its box rather than towards the middle. At the default 100% nothing changes. Having both is not
possible — centring a box larger than its port is *defined* as overflowing the start side — so
reachability, a correctness property, wins over centring, which is cosmetic.

`align-items: safe center` on the full-screen overlay was tried for this and **removed**: it cannot
act here. `.fullscreen .layer` is `width: 100%; height: 100%`, so the flex item is exactly the size of
its container and never overflows it by layout, and `safe` substitutes `start` for *layout* overflow
only. Measured at three viewports, `layer.offsetWidth × offsetHeight` equalled the overlay's client
box every time. Reachability comes from the transform origin and the overlay's `overflow`.

Measured after the fix, at 1.0× / 1.25× / 1.5625× / 1.953× / 2.4414× on **both** surfaces at
1600×950, 1440×900 and 700×800: all four edges reachable by scrolling alone at every level, in the
box and in full screen, with no document-level horizontal overflow, and pan still moving the drawing a
fixed number of screen pixels at every zoom. `diagram-zoom-reachability.pwspec.ts` proves each edge
by scrolling to it and re-reading `getBoundingClientRect()`, and it fails against the old centre
origin — 6 of its 6 combinations, reported as `content l=-80… LXX`.

**Full screen, specifically required:**

- Opening full screen must not disturb the diagram in the box.
- Closing it — with the close button or the Escape key — must bring the diagram back **exactly as
  it was**, at the same zoom and the same position.
- **The diagram must not vanish from its box after returning from full screen.** This is currently
  broken; see section 5.3.
- The full-screen overlay must be able to reach everything it shows. It centres its content, and a
  centred item larger than its container overflows in **both** directions with the start-side part
  unreachable — so the overlay centres with `safe center`, which falls back to `start` on an
  overflowing axis.

---

## 4. Every use case, and what must happen

Each row is something a person can do, and what they must see. "Currently" is what the
application does today.

| # | What the user does | What must happen | Currently |
|---|---|---|---|
| 1 | Opens a note with a diagram, no size set | Diagram drawn at its natural size, box snug around it | Correct |
| 2 | Hovers a block | Grip and size buttons appear | Correct |
| 3 | Clicks the grip, releases without moving | **Nothing is saved** | Correct |
| 4 | Drags the grip down to make the box shorter | Box shrinks, **diagram scales down to fit** | Correct — fixed, see 5.4 |
| 5 | Drags the grip right to make the box wider | Box widens, diagram scales up to fit | In a note: nothing happens (5.5) |
| 6 | Drags the grip up-left to make the box smaller and shorter | Both shrink, diagram stays whole and centred | Correct — fixed, see 5.4 |
| 7 | Releases the grip | The size reached is saved to the note | Correct, after the debounce window |
| 8 | Presses Small / Medium / Large | The **diagram** visibly changes size, not just the border | Correct on both — 360 / 640 / 820 |
| 9 | Presses Full width | Box fills the column, height 400 | Correct |
| 10 | Presses Auto height | Box hugs the diagram, no empty space, nothing cut off | Correct, and never so short it loses its own controls — see 5.10 |
| 11 | Focuses the grip, presses arrow keys | Box resizes in 40px steps | Correct — fixed, see 5.6 |
| 12 | Hovers a diagram | The eight view buttons fade in | Correct, and always present — see 5.10 |
| 13 | Presses zoom in three times | Diagram grows, box unchanged, nothing saved | Correct |
| 14 | Presses a pan arrow | Diagram shifts one step **in the direction the arrow names** | Correct — fixed, see 5.11 |
| 15 | Presses reset | Position and magnification back to normal | Correct |
| 16 | Presses full screen | Diagram **grows to fill the screen**, carries the same eight controls, and the box behind is unchanged | Correct — fixed, see 5.12 |
| 17 | Presses Escape in full screen | Returns to the box, same zoom, same position, diagram still there | Correct — fixed, see 5.12 |
| 18 | Zooms, then reloads the page | Diagram is back at its normal size; the note is unchanged | Correct, and required |
| 19 | Resizes a block, then opens that note in a second window | Same size, same scaled diagram | Not checked (5.8) |
| 20 | Resizes the box so the diagram is much taller than the box | Whole diagram reachable, never cropped with no recourse | Correct — fixed, see 5.4 |
| 21 | Makes a diagram small, then presses zoom in repeatedly | Cannot zoom into invisibility | Correct |
| 22 | Narrows the window after sizing a block | Box shrinks to fit the window; the **stored** size is not overwritten by the narrow rendering | Correct — drawn 504px at a 700px window, stored still 640 |
| 23 | Sizes a block, then closes the note within two seconds | The change is still saved | Correct, but nothing on screen says "not yet" |
| 24 | Reads any of the thirty templates on either surface | Whole, labelled, fitted, and drawn the same size on both surfaces | Correct — see the [diagram tracker](DIAGRAM_TEMPLATE_TRACKER.md) |
| 25 | Widens the window after the toolbar has split | The controls that moved into the dropdown come back out | Correct — fixed, see 5.13 |
| 26 | Finds a template in the bar, in its dropdown, or in a note's Insert menu | The same icon, the same colour, wherever it is | Correct — fixed, see 5.14 |

---

## 5. Defects found

Each is stated with what was observed, so it can be checked again after a fix.

### 5.1 "Fit width" did nothing

Mermaid writes a maximum size directly onto every diagram it draws, at the diagram's natural size.
That limit is written in a way that overrides the application's own styling, so the rule intended
to scale the diagram to its box never applied.

Observed: the size buttons resized the box correctly — measured 820, then 640, then 820 pixels
across Small, Medium and Large — while the diagram stayed frozen at 196 pixels throughout. The
user pressed a button, saw the border change, and saw the picture ignore them.

Fixed. The limit is now removed where diagrams are processed, so both surfaces scale properly.
The check that it stays fixed asserts the drawn width of the diagram changes, and was confirmed
to fail before the fix was kept.

### 5.2 Saving a resized block — the report did not reproduce

This was reported as "sometimes autosave works, sometimes not", and it is the most serious-sounding
item in the document, so it was tested directly.

**Measured, all correct:**

- Choosing **Medium** stores `width 640, height 400` on the note, and the server holds it.
- Two size changes inside one debounce window store the **second** value, not the first and not a
  blend: `width 820, height 560`.
- A size change followed immediately by typing in the note stores both the size and the typed
  text. Nothing is lost.
- The save is not instant, and this is the most likely origin of the report. The note waits out a
  short pause before writing, so for roughly two seconds after pressing a size button the note on
  screen is ahead of what is stored. The indicator in the status bar is the authority on whether
  a change has been written. A size that looks unsaved during that window is unsaved *yet*, not
  unsaved.

**Conclusion:** the suspected cause recorded here earlier — a stale copy of the block's settings
being written back — **is not the cause, and was a reading of the code rather than a measurement.**
It has been disproved. The report should be treated as the debounce window above, or as a separate
issue that still needs reproducing; the honest position is that it is now unexplained, and that
saying so is more useful than attaching a theory to it.

**Still worth doing:** the delay itself. Two seconds is a long time to look at a note and not know
whether the change is stored. Making the pending state obvious is cheap and removes the reason for
the report.

### 5.3 Returning from full screen — not reproduced

**Measured, correct:** the diagram is 640x549 before full screen, 640x549 during it, and
**640x549 after Escape**, with exactly one diagram present in the box. The picture is not lost.

The earlier note in this document claimed this was caused by one piece of markup being used in two
places at once. That explanation was **wrong** — it was proposed without measuring, and the
measurement contradicts it. The concern is not recorded here as a cause. If the report is still
seen by hand, it needs the steps written down before it can be worked on; it is not reproducible
from the application as it stands.

### 5.4 A note's diagram does not scale to its box

The Diagram page has rules that scale the diagram into the box. The note has no equivalent.

**Measured.** Choosing **Medium** on a note gives a box of **400px** tall holding a diagram
**549px** tall — the diagram overhangs the bottom of the box by **82px**. Choosing **Auto height**
gives a box of 719px holding a 703px diagram, correct. Choosing nothing gives 719 and 703,
correct. So the failure is specific: **a stored height on a note clips the diagram rather than
scaling it**, and the top of the diagram is what survives.

This is the single cause of use cases 4, 6 and 20, and of the report that a resized diagram goes to
the edges and is not fully visible.

**Fixed** by giving a note the same scale-to-fit rules the Diagram page already had, applied only
when a height is actually in play. The container gains a `sizeContainerSized` class whenever a
height is stored or being dragged, mirroring the Diagram page's `blockCanvasSized`.

**Measured, after the fix.** Medium: box **400**, diagram **384**, overhang **0** — was 549 in a
400px box with 82px overhanging. Auto height: box **719**, diagram **703**, overhang **0**, so
picking Auto height still works and is not overridden by the new rule.

### 5.5 A note's diagram could not be widened sideways — reported, re-measured, not a defect

**As reported.** The note's text column is 820px and a block already fills it. The single corner grip
had nowhere to grow into, so a sideways drag did nothing: 820px stayed 820px. From that it was
concluded that "a block made smaller could never be made bigger again without a preset", and a
**two-grip** fix was written into 2.3 and here.

**Re-measured, and the conclusion does not hold.** The claim was tested directly in Chromium at a
1440x900 window, on a note whose column is 662px, with one corner grip and no preset:

| step | drag | before | after |
| --- | --- | --- | --- |
| 1 | left 260px | 662 | **402** |
| 2 | right 260px | 402 | **662** |

A block narrowed with the corner grip **is** widened again by the same grip. The step-1 behaviour
that the report saw is correct: dragging a block that already fills the column has nowhere to go,
because 6.1 forbids growing past it, and no arrangement of grips can change that.

**Correction.** The two-grip model described in 2.3 and here was never built and is not wanted: it
would add a second pointer target and an inverted delta for a capability the corner grip already
provides. 2.3 now describes the single-grip model and states the achievable requirement.

What remains genuinely worth knowing from this item: **the drag reports a width it does not apply.**
While dragging outward on a full-width block, the handle tracks the pointer and the block does not
move, because the ceiling is reached. That reads as an unresponsive control. It is not a sizing
defect, and the fix is to the *feedback*, not the clamp — see 6.3.

### 5.6 The corner grip resized the wrong way under the keyboard

**Measured, before the fix.** The starting box is 820px. One press of Arrow Right — the key
that makes a box **bigger** — left it at **280px**. One press of Arrow Down took the height to
120px, the minimum.

**Cause.** The key handler worked from the block's **stored** size. An unsized block stores
nothing, so the handler began from the smallest permitted size (240px) and then added 40 to it.
Every keyboard resize of an unsized block therefore started from the wrong number and moved the
wrong way. The pointer drag did not share this fault, because it measures the real box on press,
and the keyboard path was simply missing that measurement.

**Fixed** by starting from the box actually on screen, falling back to the stored value and only
then to the limits. `dragSize` still wins where it exists, so a keypress during a drag steps from
the in-flight size rather than snapping back to the committed one.

**Measured, after the fix.** 820x719 → Arrow Left **780x678** (smaller, correct) → Arrow Right
**820x718** (larger, correct) → Arrow Down **780x678** (shorter, correct). Every key now moves in
the direction its name promises.

**Correction to an earlier claim in this document.** It previously said the grip could not be
reached by keyboard at all. That was wrong: it was diagnosed by calling `focus()` on the element
and finding focus had not moved, which does not test tab order. Tabbing through the note reaches
the grip after **16 presses**, with `tabIndex=0` and nothing disabled. The grip was always
reachable; only its key handling was wrong. The companion claim that the five size buttons were
unreachable is withdrawn on the same basis — it was inferred from the false one rather than
measured.

### 5.8 Not yet checked

Use case 19 in the table above — opening a resized block in a second window — has not been tested.

### 5.9 One unreproduced test failure

During the work on 5.5, a single `bun run test` run reported 3 failures. No run since has
reproduced them: five consecutive runs after it reported **1283 pass, 0 fail**. The failing test
names were not captured before the output scrolled past, and no test file was edited between that
run and the clean ones.

Recorded here rather than dismissed, because "it did not reproduce" is not "it is fixed". Either it
is a flake or it depends on run order, and this document should not claim a suite is green on the
strength of five runs when a sixth once disagreed. Anyone picking this up should run the suite
rather than trust the count.

### 5.10 A short block lost its own controls

**Measured.** Auto height on a short diagram gave a note block a box of **78px**. The eight view
buttons are a 90x90 pad anchored to the bottom of that box, and the block clips anything past its
edge — so the pad fell **entirely outside**. The block had no pan, no zoom, no full screen, and no
way to undo a zoom. On the Diagram page the same block lost its size-preset row to the card's own
action bar.

**Why it is worse than it looks.** This is the reported "full screen then back and the diagram is
gone", reached by a route other than full screen. With no controls inside the overlay (5.12) the
only way to make a diagram bigger there was the zoom, which is shared with the box; and with the
pad clipped away in the box there was then no way back from it. Neither fault reproduces on its
own — opening and closing full screen on a normally-sized block leaves the diagram untouched, which
is what 5.3 records — but the two together produce the report exactly.

**Fixed, but the first fix under-floored one of the two surfaces.** The floor has to sit on two
things, and putting it on one was not enough: on the commit path, which clamps a dragged, keyed or
preset height, and on the view host, which is the box the pad is positioned against. A block with
**no stored height** never passes through the first — Auto height stores `''` and the box is sized by
its contents — which is why the host needed it as well.

What that left wrong: `LAYOUT.blockControlsMinHeight` (140) is the height of the **control pad**, and
it was being used as the floor for **both** surfaces. The Diagram page's card stacks an action row
*above* the canvas inside the same box, and `.host` is that card's *second* row, so 140px of host
needs 140 + 27 + 2 = 169px of card. At a stored height of 140 the host needed more room than the card
had, the host overflowed, and the card's `overflow: hidden` clipped it. Measured at that height: the
card's bottom edge at y=298 with the pad's bottom at y=304, so the pan-down and full-screen buttons
were 6px outside the card, and the stage ran to y=326, clipping 28px of canvas as well. A Rich Note
block at 140 is fine, because its padding gives the pad room — which is exactly why one number for
both surfaces was wrong.

**Now two floors, one number each, from one place.** `LAYOUT.blockControlsMinHeight` is the note's,
published as `--rtwiki-block-controls-min-height`. `LAYOUT.visualPageBlockMinHeight` is the Diagram
page's — that floor plus `VISUAL_PAGE_BLOCK_CHROME_HEIGHT`, the card's action row and its own
border — published as `--rtwiki-visual-page-block-min-height` and applied to `.blockCard`'s
`min-height`. `ResizableBlockContainer` takes the floor as a prop, so the drag, the keyboard and the
size presets all clamp to the surface's own figure rather than a hardcoded one.

The card's `min-height` also does the work for **documents already stored below the floor**: stored
sizes are never rewritten on load, so a document carrying 140 renders with the card at 169 and every
control visible rather than clipped. Measured at stored heights of 140 and 150: pad inside the card,
all eight controls inside and hit-testable, and the next edit stores 169.

`diagram-block-resize-geometry.pwspec.ts` asserts all eight controls are inside the card at the
floor, on both surfaces, and fails against the old shared floor — reported as `outside: pan-down,
zoom-out, full-screen`, which is the original fault by name.

### 5.11 Pan up moved the picture down

**Measured.** One press of pan-up set the vertical offset to `+40px`, which moves the picture down;
pan-down set `-40px`. Left and right were correct, so the pair read as a rendering fault rather than
as two swapped signs, and it was wrong on both surfaces at once because they share one component.

**Fixed.** The vertical offsets are now named constants with their direction in the name
(`PAN_UP_Y` is negative, because the Y axis points down).
`tests/browser/diagram-view-controls.pwspec.ts` asserts the **painted** position rather than the
custom property, so a sign error in the transform itself cannot satisfy it.

### 5.12 Full screen was a dead end, and duplicated the diagram

**Three faults, one chain, all measured.**

- The overlay carried **no** controls: zero zoom buttons inside it. The only way out was the X.
- The picture did not grow. At a 1600x950 window the overlay covered the viewport and the diagram sat
  in the middle of it at **426x414** — exactly its size in the box.
- The same element was rendered into both places, so the document held **two copies** of the diagram
  while the overlay was open: **24 element ids present twice**, and Mermaid addresses its markers and
  clip paths by id, so the two renderings were not independent of each other.

**Fixed.** There is now **one** layer node, re-parented into the overlay and back, so "come back to it
exactly as it was" is true by construction rather than by keeping two copies in step. The overlay
carries the same eight controls. The picture is scaled to the overlay by a measured `--view-fit` that
multiplies into the same transform as the reader's own zoom.

**The trap in the fix, recorded because it is the reported symptom.** The screen-fit scale is written
straight to the element's style, and React does not manage a property it did not render — so the
first version never removed it, and the diagram came back from full screen magnified and cropped.
That is "full screen then back and the diagram is not visible", introduced by the fix for it. The
close path now removes it explicitly, and the test asserts the drawn size is byte-for-byte the size
it had before full screen opened.

### 5.13 The template bar never grew again

**Measured.** The bar reported `clientWidth` 504px at a 1000px window. Widening to 1800px left it at
504px with the "more" dropdown still open; widening again after narrowing left it at 319px.

**Cause.** `useToolbarOverflow` decides how many controls fit by reading the bar's `clientWidth` and
nothing else, so that number has to mean "the room there is". The bar was shrink-to-fit inside a
shrink-to-fit group, which made it mean "the width of whatever is still in it" — and once a split was
applied the tail had left, so the measurement collapsed and stopped tracking the window.

**Fixed** by letting the group and the bar fill the row (`flex: 1 1 auto`), which is what the Rich
Note's toolbar already did and which is why it never had the fault.
`tests/browser/diagram-template-bar-layout.pwspec.ts`.

### 5.14 A template looked different depending on where it was shown

**Measured.** The bar drew a 24px icon coloured by family. Its own overflow dropdown and the Rich
Note's Insert menu drew an 18px icon in the default text colour: `rgb(76, 141, 255)` on the bar,
`rgb(0, 0, 0)` in the dropdown. Three renderings of one list, and a control changed its appearance
the moment the window narrowed and pushed it into the dropdown beside it.

**Fixed** with one `TemplateFamilyIcon` used by all three surfaces, carrying the family colour. Icon
*size* still differs between a text row and a 40px toolbar row, because those genuinely want
different sizes; colour and shape do not.

### 5.15 The Diagram page carried a second, independent zoom

**Measured, and it was a multiplier rather than a duplicate.** Two zooms were live at once:

| path | mechanism | range |
|---|---|---|
| page | `diagram-zoom-in` / `-out` / `diagram-zoom-label` → `--zoom-level` → `.zoomHost { width }` | 50%–200% |
| block | `DiagramView` zoom → `--view-scale` → `.layer { transform }` | 20%–600% |

Measured at 1440x900 with a 1806px-wide diagram: at page zoom 100% the `.zoomHost` laid out at 375px
and the drawing painted 375px. One page zoom step gave `--zoom-level: 125%`, the host 469px, the
drawing 469px. Adding a block zoom on top gave `matrix(1.25, …)` and a painted **586px** — 469 × 1.25,
the product of two controls whose individual values were both on screen and whose product was not.

Three further faults in the same mechanism:

- **Half its range did nothing.** `.zoomHost` carried `min-width: 100%`, so at `--zoom-level: 50%` its
  `offsetWidth` was **unchanged**. Zoom-out was a control that reported a number and moved nothing.
- It had no pan, no full screen and no reset, so a reader who used it could not undo it.
- Its range was the **opposite** shape to the block zoom's: it could not magnify a small diagram
  past 200%, and could shrink one to 50% that the block zoom would hold at 20%.

**Fixed by removal**, not by consolidation into it. `DiagramView`'s `--view-scale` is the authority:
it is the only zoom with a pan, a full screen, a reset, a documented 20%–600% range and a reachability
proof, and the only one both surfaces share. The Rich Note's equivalent legacy zoom had already been
removed as a duplicate, which is precisely what left the Diagram page inconsistent with it. The `zoom`
state, the three controls, `--zoom-level` and `.zoomHost` are gone.

Guarded by `diagram-zoom-fit-authority.pwspec.ts`. Restoring the page zoom fails the structural check
on the Diagram page at all three viewports (*"the page-level zoom host, `.zoomHost` — expected 0,
received 1"*) and still passes on the Rich Note, which never had it. See 5.16 for why the geometric
check alone does not catch it at neutral.

### 5.16 Full screen's fit measured the wrong box, and put the drawing off-screen

**Measured, and it was worse than "a near no-op".** A previous study characterised `--view-fit` as
1.015 unzoomed and exactly 1 zoomed. That was measured on a *wide* diagram only, and the picture is
much worse than neutral on a small one:

| diagram | fit as it was | what it drew | where it drew it |
|---|---|---|---|
| 1806px wide (already fitted to the overlay's width) | 1.0 | 1440x53 | centred, correct |
| 196x168 two-node flowchart | **4** — the cap | 784x672 | **2816px from the left edge of a 1440px overlay** |

So "near no-op" was true for a wide drawing and wrong for a small one, where fit applied the maximum
it was allowed and threw four fifths of the result off the screen.

**Cause, two faults.**

1. **It measured the painted box.** `getBoundingClientRect()` returns the *transformed* rect, so the
   reader's own zoom was inside the measurement. At 1.25x on a wide diagram the ratio fell to 0.80,
   was clamped to 1, and fit silently did nothing at every zoom. Fit is a property of the drawing and
   the screen and cannot contain the reader's magnification.
2. **A scale about the layer's top-left scales the picture's *layout position* too.** The picture is
   not at the layer's origin: `.layer` centres its child, and the surface wrappers centre again —
   measured 622px from the layer's left edge and 12px from its top on the Diagram page. Scaling from
   `0 0`, which 3. requires for reachability, therefore throws a fitted picture towards the end by
   `(scale − 1) × position`. 2816 = 4 × 622 + 328.

**Fixed.** The scale is now derived from the **layout** box (`clientWidth`, transform-independent) and
the **overlay's** box, so fit no longer contains the reader's zoom: measured, the same drawing gets
`--view-fit: 4` whether the reader is at 1.0 or 1.25, where before it got 4 and then 1. The centring
is a second term, `--view-fit-offset`, set to `max(0, (viewport − painted) / 2)` per axis — which
converts a *painted* position back into a transform offset using the picture's measured origin inside
the layer, and whose `max` is what keeps the start edge on screen when the drawing overflows. The
same 196x168 drawing now paints at 784x672 starting at **(328, 114)** in a 1440x900 overlay, which is
exactly `((1440 − 784)/2, (900 − 672)/2)`.

**A trap worth recording, because it is invisible and total.** `translate()` takes its two values
**comma**-separated; the space-separated two-value form belongs to the `translate` *property*, not to
the `translate()` *function*. Written the other way round, the declaration is invalid at computed-value
time and the browser drops the **entire** `transform` value — the zoom and the pan as well, not just
the offending function. Measured on this Chromium (153): `CSS.supports('transform',
'translate(10px 20px) scale(2)')` is **false**. The symptom is a layer that computes to
`transform: none` at every zoom, which looks exactly like a zoom control that does nothing, and which
no assertion on a custom property can see. Only reading the painted geometry found it — and the full
F1–F4 reachability suite passed while zoom was dead, because a diagram that is not zoomed is
trivially reachable.

**What the checks can and cannot see, recorded because it changed the tests.** The page-level zoom of
5.15 multiplied by **width**, and a width multiplier widens the layout as well, so while it sat at
100% it left the effective scale — painted ÷ layout — exactly right. No ratio detects a second zoom
layer that happens to be at neutral; only its existence does. So there are two checks, not one: the
geometric one, which catches any layer the moment it is off neutral or scales by transform, and a
structural one that asserts there is no second control, no second wrapper and no second custom
property at all. The structural check is the one that catches this defect; the geometric one alone
passes with it restored at neutral. That was measured, not assumed.

Guarded by `diagram-zoom-fit-authority.pwspec.ts`, on both surfaces at all three viewports. Restoring
the old measurement fails the centring assertion on all six (*"centred horizontally: painted starts at
2488, expected 328"*) and the zoom-independence assertion (*"fit must not depend on the reader zoom:
3.571 unzoomed, 2.857 at 1.25"*).

---

## 6. Decisions needed before fixing

### 6.1 May a note diagram grow wider than the text column? — answered: no

**The question.** A block in a note already fills the width of the text. To make sideways dragging
useful, the block must be allowed to grow beyond the text column. Three ways to do that, and what
each one actually does to the reader's experience.

**How other apps solve it.** Notion, Obsidian and Google Docs all keep a note's text in a fixed
narrow column and let a wide element sit outside it, centred on the text. It is the accepted
convention: a note containing a wide diagram looks different from a note of pure text, and that is
expected rather than surprising.

**What BlockNote — the editor RTWiki already uses — does.** Its own image block solves exactly this
problem, and the answer is worth reading before choosing. From the published API and from the
bundled source (`@blocknote/react`):

- The image block has a `previewWidth` prop, in pixels, that stores the chosen size **in the
  document** — the same as RTWiki's `width`.
- It ships **two** resize grips, one on the left edge and one on the right, not one in the corner.
- The grips appear on hover **or while the pointer is already down**, and disappear on leave.
- While dragging, an invisible shield covers the image, so the drag cannot be mistaken for a text
  selection.
- **It does not let an image grow wider than the editor.** The stored width is clamped to the
  editor's own width. So BlockNote's answer is not "allow overflow into the margin" — it is
  "make the grips good, and never let the block exceed the column."
- When the image is centred, dragging the *left* grip moves the right edge the same distance, so
  the image grows symmetrically from the middle rather than sliding.

**The finding that matters most.** RTWiki and BlockNote disagree, and BlockNote is the more mature
answer. RTWiki permits a block to grow past the column (its ceiling is the full width of the row or
column); BlockNote does not, and clamps to the editor. RTWiki's Diagram page depends on the wider
rule because its blocks sit in a **wrapping** grid, where a wider block reflows into a second
column — a layout that does not exist in a note.

**Options as they would appear to a user:**

- **A. Two grips, clamped to the column, the way BlockNote's images behave.** Dragging either edge
  always does something, because the block is no longer pinned at exactly the column width; a block
  starts at the column width, and either grip moves it in or out. Nothing ever extends past the
  text, so every note looks uniform. This is the most conventional option and the least surprising.
  **This is the recommendation.** It also makes the resize grip match the rest of the editor rather
  than being a corner-only control unique to diagrams.
- **B. Two grips, allowed to extend into the margin, the way Notion does.** Both edges always do
  something *and* a diagram can be wider than the text. The cost is that a note with a wide diagram
  looks different from a note of pure text.
- **C. Keep one corner grip, confined to the column.** This is today's behaviour. Sideways dragging
  does nothing, because a block is always exactly the column width. Not recommended: it is the
  behaviour that prompted this decision.

**Decision: A**, on the grounds that it is what the editor underneath already does for every other
kind of content, so a diagram stops behaving like an exception. B was not chosen: a note containing
a wide diagram would then look different from a note of plain text, and nothing in the evidence
asked for that.

**Note.** Section 5.6 fixed a *related* fault in the same area: the keyboard was resizing from the
wrong number. That fix made the keys behave correctly, and it is worth knowing that the sideways
drag in a note now behaves the same as before and still cannot widen. This decision is untouched by
it.

### 6.2 When the box is smaller than the diagram, shrink or scroll? — answered, scale to fit

The Diagram page scaled to fit. A note kept the diagram at its size and clipped it. The two
surfaces did the opposite things, which is the drift this document exists to end. An earlier
preference in this work favoured keeping the inner scroll; that is now **overruled**, because it
produced the one failure with no workaround — content that could not be seen at all.

**Decision: scale to fit the box, on both surfaces.** Implemented and measured in 5.4. The whole
diagram is always visible, never cropped, with blank margin where the box and the diagram have
different shapes. A user who wants the diagram larger has zoom, and zoom now stays inside the box
rather than pushing content out of sight.

Unsized blocks are unchanged on both surfaces: drawn at natural size, scrolling if the block is
narrower than the diagram. That is a deliberate difference from the Diagram page and is recorded
in 2.4.

### 6.3 The drag reports a width the block does not draw — answered, and fixed

From 5.5: while dragging outward on a block that already fills its column, the handle tracks the
pointer, the block does not move, and the clamp is reached. The *sizing* was correct. The fault was
the **feedback**: a block's maximum width was computed twice, by two functions, and they disagreed.

**Measured, and it was a real divergence between two code paths, not one.**

| surface | pointer (`widthCeiling`, drag) | keyboard and presets (`contentBoxWidth`) | agree? |
|---|---|---|---|
| Rich Note | **788** — walks to the nearest `overflow-y: auto\|scroll` ancestor, `.blockNoteWrapper` | **662** — the parent element's content box, `.previewPane` | **no, 126 apart** |
| Diagram page | 974 − **2** — `.blockList`, minus a hardcoded `2` | 974 | 2 apart |

Measured on a 1440x900 window. On the note, the pointer path's ancestor walk stops at
`.blockNoteWrapper`, which is wider than the text column, so its ceiling is a width the block can
never occupy. On the Diagram page the same hardcoded `- 2` left the drag 2px short of the row it was
allowed to fill.

**What it cost.** Only a wrong number mid-drag. Measured on the note, dragging outward:

- the block reported `data-width: 788` while drawing **662**;
- the rendered box stayed at **662** — it did not grow, because `max-width: 100%` refuses;
- **nothing unreachable was stored**, because the drag commits the final *measured* rect, not the
  clamped request.

So no document ever held a width the page could not draw, and there was no data defect.

**Both objections to fixing it turned out to be wrong, and are recorded because they were believed:**

1. *"`widthCeiling`'s ancestor walk is justified on the Diagram page — growing past the column makes
   the wrapping flex row re-wrap, which is correct."* The walk was needed, but **not for that
   reason**: `max-width: 100%` prevents a block exceeding its parent regardless of reflow. It was
   needed because the immediate parent is the `Reorder.Item`, which **shrink-wraps** the block, so
   clamping to it would forbid all growth. Clamping to the *row* is right, and the row is a wrapping
   flex row, so the re-wrap this document wanted does happen.
2. *"Clamping the drag to the parent's content box, the number the keyboard already uses, would be a
   no-op on the Diagram page."* Measured: it forbids all growth, because that parent is the block's
   own width. The keyboard's number was only accidentally right — it was right for the **note**,
   where the parent is a genuine boundary, and wrong for the Diagram page.

A third attempt is worth recording too, because it was measured *after* the first fix and broke
something that had been working. A boundary that skips only ancestors **carrying** a width property
is still wrong on the Diagram page, because an **unsized** block's item carries neither: its
`width: auto` is a *share* of the wrapping row, not the block's width. Measured: a second-column block
481px wide was given a 481px ceiling and could not be widened by a single pixel, and the existing
"the block follows the pointer during a widening drag" check failed at `dx=15` with the box at 481
against an expected 496.

Adding a second clause fixed it — a definite `flex-basis` with growth — and then a third question had
to be asked, which is the one this section settles: **should the shared component keep guessing?** It
should not. Every attempt here was a way of avoiding one attribute per surface, and each was correct
only for the layouts that existed when it was written:

| attempt | correct for | wrong because |
|---|---|---|
| `contentBoxWidth(parent)` | the Rich Note | the Diagram page's parent shrink-wraps the block, so it forbade all growth |
| skip ancestors carrying a width property | a **sized** block | an unsized block's item carries none, and its share is not a constraint |
| add `flex: 1 1 <length>` as a share test | both surfaces, today | it is a *flex* distinction; no other CSS property carries it, and a third surface would need the reasoning re-derived by hand |
| **declare `data-block-width-boundary`** | any surface that declares it | nothing — and a surface that forgets is reported rather than silently wrong |

So the decision is: **the boundary is a surface contract.** 2.3 states it, each surface marks one
element, and `blockWidthBoundary` reads the nearest mark. The inference is gone from the code, not
merely deprecated.

**Decision: one authority, declared by the surface, read by the shared component.** `blockWidthBoundary`
resolves the nearest `[data-block-width-boundary]` and nothing else. Both `widthCeiling` and
`contentBoxWidth` are gone, and so is the `flex-grow`/`flex-basis` inference that replaced them.

Measured after the fix, at 1600x950 / 1440x900 / 700x800:

| surface | boundary | rendered after dragging 2400px past it | stored |
|---|---|---|---|
| Rich Note | 822 / 662 / 506 | 822 / 662 / 506 | identical |
| Diagram page | 974 / 814 / 646 | 974 / 814 / 646 | identical |

and no frame of any drag reports a width the block does not draw. Guarded by
`diagram-width-boundary.pwspec.ts` on both surfaces at all three viewports: the boundary is the same
box sized or unsized, the published width never exceeds the drawn width on any frame, and drag,
keyboard and the 960px preset all stop on exactly that boundary and survive a reload. Restoring
`widthCeiling` fails 12 of its 18 tests, including *"the 960px preset must store 662 at this viewport,
stored 788"* and *"the block must end on its 974px boundary, drew 972"*.

**One thing this never meant:** the keyboard was never broken. Pressing Arrow Right on the handle
widens a narrowed note block correctly.

---

## 7. Status

**Fixed and guarded by checks** — each confirmed to fail against the code as it was before the
fix:

| Item | Defect | Guarded by |
|---|---|---|
| 5.1 | "Fit width" did nothing; the border resized and the diagram did not | `diagram-view-controls.pwspec.ts` |
| 5.4 | A note's diagram was cropped by its own box — 82px unreachable | `diagram-note-scale-to-fit.pwspec.ts` |
| 5.5 | A note's diagram could not be widened sideways at all | `diagram-note-scale-to-fit.pwspec.ts` |
| 5.6 | Arrow Right shrank an unsized block, 820px to 280px | `diagram-note-scale-to-fit.pwspec.ts` |
| 5.10 | A short block's control pad was clipped away entirely | `diagram-view-controls.pwspec.ts` |
| 5.11 | Pan up moved the picture down | `diagram-view-controls.pwspec.ts` |
| 5.12 | Full screen was a dead end, did not grow the picture, and duplicated the diagram (24 ids) | `diagram-view-controls.pwspec.ts` |
| 5.13 | The template bar never grew again when the window widened | `diagram-template-bar-layout.pwspec.ts` |
| 5.14 | A template looked different in the bar, its dropdown, and a note's Insert menu | `diagram-template-bar-layout.pwspec.ts` |
| — | The Diagram page stretched a diagram to 2.3x its natural size while a note fitted it | `diagram-fit-consistency.pwspec.ts`, `diagram-template-fidelity.pwspec.ts` |
| — | The size-preset row covered the diagram, and the Diagram page's action bar | `diagram-workspace-layout.pwspec.ts` |
| 3 | A zoomed diagram was clipped by its box with nothing to scroll — the painted extent existed and was discarded | `diagram-zoom-reachability.pwspec.ts` |
| 3 | Full screen overflowed the window in both directions with no way to scroll | `diagram-zoom-reachability.pwspec.ts` |
| 3 | A centre transform origin stranded half the zoom's overflow on the scroll container's unreachable start side — `overflow: auto` alone did not fix it | `diagram-zoom-reachability.pwspec.ts` |
| 3 | The inert `align-items: safe center` on the full-screen overlay, which could not act and read as a guarantee | removed; `diagram-view-controls.pwspec.ts` |
| — | Releasing a drag snapped the Diagram page block to the full column width for ~280ms, then animated back | `diagram-block-resize-geometry.pwspec.ts` |
| 5.10 | The Diagram page's card was floored for a pad it does not carry, clipping 6px of the pad and 28px of canvas at 140px | `diagram-block-resize-geometry.pwspec.ts` |
| — | A user-visible ellipsis in the diagram block's loading placeholder was double-encoded UTF-8 | `bun test`; repaired at the byte level |
| 3 | A note block carried a second, width-based zoom beside the shared view, so its scale depended on which control was pressed | `diagram-view-controls.pwspec.ts`, `visual-blocks.pwspec.ts` |
| 2.3, 5.5 | Two side grips were specified and documented; only one exists, and one is enough | `block-movement.pwspec.ts` |
| 5.15 | The Diagram page carried a second zoom (`--zoom-level` on `.zoomHost`, 50–200%) that multiplied with the block's, with no way to see the product — and whose lower half did nothing at all | `diagram-zoom-fit-authority.pwspec.ts` |
| 5.15 | Nothing may sit between a diagram and its `.layer` and change its own size or carry a transform | `diagram-zoom-fit-authority.pwspec.ts` |
| 5.16 | A second zoom layer that multiplies by **width** is invisible to any painted-ratio check while it sits at 100%, so its existence needs its own structural check | `diagram-zoom-fit-authority.pwspec.ts` |
| 5.16 | Full screen's fit measured the **painted** box, so the reader's zoom cancelled it and fit silently stopped working at any zoom | `diagram-zoom-fit-authority.pwspec.ts` |
| 5.16 | A fitted picture was scaled about the layer's origin while the layout had already centred it — 2816px from the left edge of a 1440px overlay | `diagram-zoom-fit-authority.pwspec.ts` |
| 5.16 | A `translate()` written with space-separated values is invalid, and the browser drops the **whole** transform: zoom and pan both silently dead | `diagram-zoom-fit-authority.pwspec.ts` |
| 2.3, 6.3 | The drag's width ceiling and the keyboard's disagreed — 126px apart on a note, and 2px short of the row on the Diagram page — and the drag reported a width the block did not draw | `diagram-width-boundary.pwspec.ts` |
| 2.3 | Each block-bearing surface must declare its width boundary with `data-block-width-boundary`; discovery is read-only and must never write to the tree | `diagram-width-boundary.pwspec.ts` |
| 2.3 | No attribute may be written to the boundary or any ancestor during a drag, and the grip element must stay the same node for the whole gesture | `diagram-width-boundary.pwspec.ts` |
| 2.3 | A missing boundary must be reported and must not fall back to an unrelated ancestor | `diagram-width-boundary.pwspec.ts` |
| 2.3 | The clamp must follow the declared element, not the layout: declaring the boundary on the Diagram page's own item stops the drag at the item, not at the row | `diagram-width-boundary.pwspec.ts` |
| 2.3 | The boundary must be the same box whether the block is sized or not | `diagram-width-boundary.pwspec.ts` |
| 2.3 | Drag, keyboard and size preset must all stop on exactly that boundary, and it must survive a reload | `diagram-width-boundary.pwspec.ts` |

The last six rows are the geometry/zoom architecture pass. Each was **measured before being changed**,
each is measured again afterwards, and each was confirmed to fail against the code as it was before
the fix — the numbers quoted in 5.15, 5.16 and 6.3 are the failures, not paraphrases. Two of the
three faults were found by measuring rendered geometry rather than by reading properties, and one of
them — the invalid `translate()` — was invisible to every property-level check and to the full F1–F4
reachability suite, which is the argument for measuring what is painted.

The four before them are the most recent earlier pass. Each was **measured before being changed** —
the reachability table in section 3 is the measurement that made `.stage { overflow: auto }` the
minimal fix rather than a guessed one, and 2.3 and 5.5 were rewritten because re-measuring them
disproved what the document had claimed for two revisions.

Per-template status for all thirty types, on both surfaces, is recorded in the
[diagram tracker](DIAGRAM_TEMPLATE_TRACKER.md). That document is a snapshot of a
measurement; the spec that produces it is what keeps it honest.

**Open:**

| Item | Status |
|---|---|
| 5.2 | Did not reproduce. The likely cause is the two-second debounce; unexplained otherwise |
| 5.3 | Did not reproduce as reported. The chain in 5.10 and 5.12 reaches the same symptom from another direction, which is a better explanation but was not the one in the report |
| 5.7 | Use case 19, opening a resized block in a second window, not tested |
| 5.9 | One run of 3 unexplained failures, not reproduced in five subsequent runs |
| — | `info` has no `viewBox` and so no intrinsic size; drawn at the 300x150 replaced-element default. Recorded in the tracker, section 4 |

**Known limits of the geometry pass, stated rather than hidden:**

| Item | Status |
|---|---|
| Chromium only | The rendered-geometry checks were run in Chromium 153 alone. `translate()`'s comma grammar and `clientWidth` on an inline `<svg>` are long-standing and standard, but no Firefox or WebKit run backs these measurements |
| — | A hard page reload inside the 2000ms autosave debounce loses the size on both surfaces. Deliberate and documented at `App.tsx`, and unchanged by this work |
| — | The reader's zoom and pan are not persisted. Required by use case 18, and unchanged by this work |

**Withdrawn as wrong:** two claims in earlier drafts of this document — that the grip was
unreachable by keyboard, and that the size buttons were too. Both came from a faulty check rather
than a measurement. Section 5.6 records the correction.

## 8. How this document is used

1. Every row of the table in section 4 is a thing a person can do, and is either correct, wrong,
   or untested.
2. A defect is only recorded once it has been observed, with the measurement.
3. A fix is only kept once a check fails against the application as it was before the fix.
4. Section 6 is answered before the work that depends on it begins.
5. When every row in section 4 reads "correct" and section 5 holds no open item, this document is
   the record of what the feature does.
