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
useful. Specifically, from a box that is already as wide as the text, dragging sideways should
visibly do something.

**What was wrong:** a single grip in the bottom-right **corner**, on a box that already filled the
column. Dragging it sideways did nothing at all — measured, an 820px block stayed 820px — so a
block could be made smaller but never bigger again without reaching for a preset.

**What it is now:** **two grips, one on each side edge**, the way images and video already resize
in this editor. Moving an edge is always possible; growing an already-maximal box is not. The left
grip widens the block as it is pulled left.

**Nothing extends past the text column.** A block is capped at the column's own width, so a note
containing a resized diagram looks exactly like a note of plain text. The Diagram page is the one
deliberate exception: its blocks sit in a wrapping grid, so a wider block reflows into a second
column and the wider ceiling is correct there.

**Measured:** right grip pulled left 820 → 616; left grip pulled left 616 → 770; pulled 900px past
the edge, clamps at 820.

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

**What is wrong at the moment:** the Diagram page follows this behaviour. **The Rich Note does
not.** A note has no rule that scales the diagram into the box, so:

- Making the box smaller does not shrink the diagram. The diagram keeps its size and the box
  clips it.
- The bottom of the diagram can be cut off with no way to see it.
- This is why "resizing should autofit the diagram" and "the diagram goes to the edges and is not
  fully visible" are the same complaint.

**Measured:** on the Diagram page a stored height makes the diagram scale to fit. In a note, with
the same stored height, the diagram's drawn size does not change at all.

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

**Full screen, specifically required:**

- Opening full screen must not disturb the diagram in the box.
- Closing it — with the close button or the Escape key — must bring the diagram back **exactly as
  it was**, at the same zoom and the same position.
- **The diagram must not vanish from its box after returning from full screen.** This is currently
  broken; see section 5.3.

---

## 4. Every use case, and what must happen

Each row is something a person can do, and what they must see. "Currently" is what the
application does today.

| # | What the user does | What must happen | Currently |
|---|---|---|---|
| 1 | Opens a note with a diagram, no size set | Diagram drawn at its natural size, box snug around it | Correct — box 719, diagram 703 |
| 2 | Hovers a block | Grip and size buttons appear | Correct |
| 3 | Clicks the grip, releases without moving | **Nothing is saved** | Correct |
| 4 | Drags the grip down to make the box shorter | Box shrinks, **diagram scales down to fit** | Correct — fixed, see 5.4 |
| 5 | Drags the grip right to make the box wider | Box widens, diagram scales up to fit | In a note: nothing happens (5.5) |
| 6 | Drags the grip up-left to make the box smaller and shorter | Both shrink, diagram stays whole and centred | Correct — fixed, see 5.4 |
| 7 | Releases the grip | The size reached is saved to the note | Correct, after the debounce window |
| 8 | Presses Small / Medium / Large | The **diagram** visibly changes size, not just the border | Correct on both — 360 / 640 / 820 |
| 9 | Presses Full width | Box fills the column, height 400 | Correct |
| 10 | Presses Auto height | Box hugs the diagram, no empty space, nothing cut off | Correct — box 719, diagram 703 |
| 11 | Focuses the grip, presses arrow keys | Box resizes in 40px steps | Correct — fixed, see 5.6 |
| 12 | Hovers a diagram | The eight view buttons fade in | Correct |
| 13 | Presses zoom in three times | Diagram grows, box unchanged, nothing saved | Correct |
| 14 | Presses a pan arrow | Diagram shifts one step | Correct |
| 15 | Presses reset | Position and magnification back to normal | Correct |
| 16 | Presses full screen | Diagram fills the screen; the box behind is unchanged | Correct |
| 17 | Presses Escape in full screen | Returns to the box, same zoom, same position, diagram still there | Correct — did not reproduce (5.3) |
| 18 | Zooms, then reloads the page | Diagram is back at its normal size; the note is unchanged | Correct, and required |
| 19 | Resizes a block, then opens that note in a second window | Same size, same scaled diagram | Not checked (5.8) |
| 20 | Resizes the box so the diagram is much taller than the box | Whole diagram reachable, never cropped with no recourse | Correct — fixed, see 5.4 |
| 21 | Makes a diagram small, then presses zoom in repeatedly | Cannot zoom into invisibility | Correct |
| 22 | Narrows the window after sizing a block | Box shrinks to fit the window; the **stored** size is not overwritten by the narrow rendering | Correct — drawn 504px at a 700px window, stored still 640 |
| 23 | Sizes a block, then closes the note within two seconds | The change is still saved | Correct, but nothing on screen says "not yet" |

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

### 5.5 A note's diagram could not be widened sideways

**Measured.** The note's text column is 820px and a block already fills it. The single corner grip
had nowhere to grow into, so a sideways drag did nothing: 820px stayed 820px. Narrowing worked, so
the control looked alive, but a block made smaller could never be made bigger again without a
preset.

**Fixed** with two grips, one per side edge, matching how images and video already resize in this
editor. The left grip inverts the pointer delta so pulling it left widens the block. Nothing
extends past the column: dragging 900px past the edge clamps at 820.

See 6.1 for how the choice was made.

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

**Open:**

| Item | Status |
|---|---|
| 5.2 | Did not reproduce. The likely cause is the two-second debounce; unexplained otherwise |
| 5.3 | Did not reproduce. Needs the steps written down if it is still seen |
| 5.7 | Use case 19, opening a resized block in a second window, not tested |
| 5.9 | One run of 3 unexplained failures, not reproduced in five subsequent runs |

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
