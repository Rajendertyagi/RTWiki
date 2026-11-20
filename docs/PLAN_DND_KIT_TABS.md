# Plan: Upgrading Tab System to @dnd-kit (Chrome & Trilium Experience)

## 1. Context & Motivation

RTWiki currently renders document tabs in `src/web/features/tabs/tab-strip.tsx` using `motion/react` (`Reorder.Group`, `Reorder.Item`, `useDragControls`). 
While functional, our goal is to:
1. Provide an authentic, high-quality **Chrome / Trilium Notes** user experience:
   - **No top color line** on active tabs.
   - **No bottom dividing line** under the tabs: the active tab seamlessly merges into the workspace surface below with subtle corner curve fillets.
   - **Enlarged, right-aligned close button** (`24×24px` comfortable hit target) with generous hover feedback.
   - Smooth horizontal drag-and-drop locked to the X-axis.
2. Move to the modern industry-standard drag-and-drop ecosystem for React (**`@dnd-kit`**), preparing the codebase to systematically eliminate `motion` dependencies.
3. Ensure strict adherence to React 19 standards, Mantine theming, and full keyboard/screen-reader accessibility without workarounds or hacks.

---

## 2. Dependency Audit & Package Selection

All selected `@dnd-kit` packages support React 19 natively via peer dependencies (`"react": ">=16.8.0"`):

- **`@dnd-kit/core` (`6.3.1`)**: Provides `DndContext`, pointer and keyboard sensors, collision detection, and drag lifecycle events.
- **`@dnd-kit/sortable` (`10.0.0`)**: Provides `SortableContext`, `useSortable`, `horizontalListSortingStrategy`, and reorder utilities.
- **`@dnd-kit/utilities` (`3.2.2`)**: Provides `CSS.Translate.toString(transform)` to constrain transformations without vertical layout jitter.
- **`@dnd-kit/modifiers` (`9.0.0`)**: Provides `restrictToHorizontalAxis`, locking drag operations strictly to the horizontal tab rail.

### Note on `motion` in the codebase
`motion/react` is currently also used in the visual diagram workspace (`src/web/features/visual-pages/diagram-block-card.tsx` and `mermaid-workspace.tsx`). Therefore:
- **Phase 1**: Migrate the Tab Strip to `@dnd-kit` and verify all tab behavior, tests, and accessibility.
- **Phase 2 (Subsequent)**: Migrate the diagram cards reordering to `@dnd-kit` in a dedicated task, after which `motion` can be completely uninstalled from `package.json`.

---

## 3. Architecture & Functional Requirements

### 3.1 Strict Accessibility & Test Compatibility
Existing Playwright browser suites (`tests/browser/tab-reorder.pwspec.ts`, `tests/browser/shell-layout.pwspec.ts`, `tests/browser/chrome-rows.pwspec.ts`) require:
1. **Container semantics**: The scroller must declare `role="tablist"` and `aria-label={UI_TEXT.tabStripLabel}` with `data-testid="tab-scroll-container"`.
2. **Item semantics**: Each tab must have `role="tab"`, `aria-selected={active}`, `tabIndex={active ? 0 : -1}`, and `id={"tab-" + tab.pageId}`.
3. **Dedicated Drag Handle**: `data-testid={"tab-drag-handle-" + tab.pageId}` overlaying the tab body so clicks on the close button or text can be distinguished from drag gestures.
4. **Middle-Click to Close**: Support `onAuxClick` with `event.button === 1` to close tabs.
5. **Keyboard Navigation & Reordering**:
   - `Ctrl+ArrowLeft` / `Ctrl+ArrowRight`: Reorder tabs and update focus/announcer.
   - Bare `ArrowLeft` / `ArrowRight`: Switch between open tabs.
   - `Home` / `End`: Jump to first / last tab.
   - Screen reader live region: `#tab-reorder-announcer` (`aria-live="polite"`).

### 3.2 Visual Styling (Chrome / Trilium Alignment)
1. **Clean Surfaces**:
   - No top accent color bar.
   - No bottom divider line under the tabs or between tab strip and editor.
   - Active tab background directly matches the workspace background (`var(--bg-tab-active)` / Mantine surface).
2. **Close Button Improvements**:
   - Enlarged to a comfortable `24×24px` touch target with rounded corners.
   - Pushed to the far right edge of each tab (`margin-left: auto`).
   - Smooth hover transition with a gentle circular background highlight.
3. **Dynamic Shrinkage & Max-Width**:
   - Tabs dynamically size between `min-width: 130px` and `max-width: 230px` with clean ellipsis, preventing crowded screens from overflowing prematurely.
4. **Z-Index Layering**:
   - The dragged tab floats with an elevated z-index and subtle drop-shadow while neighboring tabs slide smoothly into position.

---

## 4. Implementation Steps

### Step 1: Install Pinned Packages
```bash
bun add @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2 @dnd-kit/modifiers@9.0.0
```

### Step 2: Implement New Tab Strip (`src/web/features/tabs/tab-strip.tsx`)
- Replace `Reorder.Group` with:
  ```tsx
  <DndContext
    sensors={sensors}
    collisionDetection={closestCenter}
    modifiers={[restrictToHorizontalAxis]}
    onDragStart={handleDragStart}
    onDragEnd={handleDragEnd}
  >
    <SortableContext items={tabs.map(t => t.pageId)} strategy={horizontalListSortingStrategy}>
      ...
    </SortableContext>
  </DndContext>
  ```
- Configure sensors:
  - `PointerSensor` with `activationConstraint: { distance: 5 }` to prevent accidental drag initiation on single clicks.
  - `KeyboardSensor` with `sortableKeyboardCoordinates`.
- In `TabItem`, wire `useSortable({ id: tab.pageId })`, applying `CSS.Translate.toString(transform)`.

### Step 3: Update CSS (`src/web/features/tabs/tab-strip.module.css`)
- Remove top border accent line.
- Remove bottom border separating tab strip and editor.
- Increase close button sizing to 24px and align to right.

### Step 4: Verification
- Execute typecheck: `bun run typecheck`
- Execute unit tests: `bun test tests/tabs-model.test.ts`
- Execute Playwright tab suite: `npx playwright test tests/browser/tab-reorder.pwspec.ts`
