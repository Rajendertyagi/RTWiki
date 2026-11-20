# Architecture Audit & Engineering Plan: High-Performance, Flawless Diagram Workspace

## 1. Executive Summary & Root Problem

The Diagram Workspace (`src/web/features/visual-pages/mermaid-workspace.tsx` & `diagram-block-card.tsx`) is currently fragile and difficult to maintain because it conflates **two conflicting layout paradigms**:

1. **Card Reordering via Framer Motion (`motion/react`)**:
   - Uses `Reorder.Group` with `axis="xy"` and `Reorder.Item` inside a wrapping flexbox (`flex-flow: row wrap`).
   - Motion's internal physics engine constantly measures DOM boundaries, attempting to animate transitions while competing with live flexbox reflows.

2. **In-Flight Manual 2D Corner Resizing**:
   - When a user resizes a diagram card via the corner handle, `ResizableBlockContainer` mutates inline CSS properties (`--block-width-live`) directly on Motion's DOM node.
   - This hack was introduced to bypass React re-renders so Mermaid canvases wouldn't re-render 60 times a second during resize.
   - **The Consequence**: A documented "release rebound" glitch (documented in `diagram-block-resize-geometry.pwspec.ts`), where dropping a resize momentarily snaps the card to full width before snapping back down.

Our goal is to build an **optimized, clean, durable solution** that:
- Completely removes `motion/react`.
- Decouples **Resizing** from **Reordering** cleanly.
- Renders Mermaid diagrams with high frame rates and zero jitter.
- Strictly adheres to React 19 standards, Mantine theming, and Playwright geometry contracts.

---

## 2. Core Architecture: The Three Golden Pillars

To make the diagram workspace durable and flawless without patches, we divide responsibilities cleanly:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MermaidPageWorkspace                            │
│  (Holds page state: block list, active editor, template chooser bar)   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            DndContext + SortableContext (rectSortingStrategy)          │
│   • Powered by @dnd-kit (Zero new animation runtime dependencies)      │
│   • Reorder triggers ONLY from the dedicated <IconGripVertical /> grip │
│   • 2D grid/wrap collision detection (closestCenter)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌────────────────────────────────────┐ ┌────────────────────────────────────┐
│      DiagramBlockCard (#1)         │ │      DiagramBlockCard (#2)         │
│  ┌───────────────────────────────┐ │ │  ┌───────────────────────────────┐ │
│  │ Action Bar & Grip (dnd-kit)   │ │ │  │ Action Bar & Grip (dnd-kit)   │ │
│  ├───────────────────────────────┤ │ │  ├───────────────────────────────┤ │
│  │ DiagramCanvas (Memoized SVG)  │ │ │  │ DiagramCanvas (Memoized SVG)  │ │
│  │ - Pan / Zoom / Viewbox state  │ │ │  │ - Pan / Zoom / Viewbox state  │ │
│  ├───────────────────────────────┤ │ │  ├───────────────────────────────┤ │
│  │ Resize Handle (Bottom-Right)  │ │ │  │ Resize Handle (Bottom-Right)  │ │
│  │ - Native pointer capture      │ │ │  │ - Native pointer capture      │ │
│  │ - Pure CSS transform/variable │ │ │  │ - Pure CSS transform/variable │ │
│  └───────────────────────────────┘ │ │  └───────────────────────────────┘ │
└────────────────────────────────────┘ └────────────────────────────────────┘
```

---

## 3. Deep Dive into the Flaws & Durable Solutions

### Flaw 1: Competing Drag & Resize Hit Targets
* **The Problem**: A user dragging the resize handle or panning the Mermaid canvas can accidentally trigger a card reorder if the drag listeners are broadly scoped.
* **Flawless Solution**:
  - In `@dnd-kit`, event listeners (`{...attributes} {...listeners}`) are attached **exclusively to the grip handle (`<IconGripVertical />`)**.
  - The rest of the card (the header, the Mermaid SVG canvas, pan/zoom buttons, and the corner resize handle) has zero sortable drag listeners.
  - No `dragListener={false}` hacks or manual `controls.start()` event interception.

### Flaw 2: The "Release Rebound" During Resize
* **The Problem**: During resize, writing `--block-width-live` to the DOM and clearing it on `pointerup` before React commits the saved width creates a 1-frame race condition where the card snaps to 100% flex width.
* **Flawless Solution**:
  - Use a clean **optimistic commit lifecycle**:
    1. During resize: Update DOM `--block-width-live` via `PointerEvent.setPointerCapture` on the resize handle.
    2. On pointer release: **Do not synchronously delete `--block-width-live`**. Keep it active in the DOM until React’s commit phase sets `--block-width` to the identical committed value, ensuring 0 frames of layout flicker.

### Flaw 3: Canvas Re-rendering Overhead
* **The Problem**: Moving or resizing one card causes parent re-renders that could inadvertently re-trigger expensive Mermaid SVG layout calculations across all other cards.
* **Flawless Solution**:
  - `DiagramCanvas` must remain strictly memoized (`React.memo`).
  - Diagram rendering is cached against `(source, colorScheme, fit)`. Reordering cards only changes the array positions in the DOM; it must never re-trigger Mermaid's `renderMermaidSvg()`.

---

## 4. Step-by-Step Implementation Plan

### Phase 1: Diagram Card `@dnd-kit` Migration
1. **In `src/web/features/visual-pages/mermaid-workspace.tsx`**:
   - Replace `Reorder.Group` with `@dnd-kit`'s `<DndContext>` and `<SortableContext strategy={rectSortingStrategy}>`.
   - Wire standard sensors (`PointerSensor` with `distance: 5`, `KeyboardSensor` with `sortableKeyboardCoordinates`).
   - Wire `handleDragEnd` using the shared, tested `moveInTabs` / `reorderByIds` pure utility.
2. **In `src/web/features/visual-pages/diagram-block-card.tsx`**:
   - Replace `Reorder.Item` with `useSortable({ id: block.id })`.
   - Apply `transform: CSS.Translate.toString(transform)`.
   - Attach `{...attributes} {...listeners}` strictly to `<ActionIcon className={classes.dragGrip}>`.
   - Merge sortable ref with the resize container DOM ref.

### Phase 2: Eliminate Rebound in `block-resize.tsx`
1. Update `ResizableBlockContainer` release logic to maintain `--block-width-live` until React applies the newly stored `--block-width`.
2. Remove all Framer Motion references and legacy comments from `block-resize.tsx` and `mermaid-workspace.module.css`.

### Phase 3: Total Removal of `motion`
1. Run `bun remove motion`.
2. Audit `package.json` and `bun.lock` to ensure zero remaining references.
3. Verify with `bun run typecheck`.

### Phase 4: Test Suite Verification
1. Run `bun test tests/reorder.test.ts`.
2. Run Playwright geometry tests:
   - `tests/browser/diagram-block-resize-geometry.pwspec.ts` (verifies resize floor, view controls, and no rebound).
   - `tests/browser/diagram-workspace-layout.pwspec.ts` (verifies multi-block card positioning).
