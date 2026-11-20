# Wunderbaum v0.15.0: Deep API Study & Upgrade Blueprint

## 1. Executive Summary

- **Current Version Installed**: `wunderbaum@0.15.0` (Latest release on npm).
- **Core Technology**: Zero-dependency modern TypeScript tree/treegrid library written by Martin Wendt (creator of Fancytree).
- **Primary Optimization Opportunity**: The tree currently runs on Wunderbaum's default settings, which includes default verbose console benchmark logging (`debugLevel: 3`), un-throttled constructor data loading, and missing modern configuration options.

---

## 2. Comprehensive API Study (Wunderbaum 0.15.0)

### 2.1 Debug & Logging System (`debugLevel`)
Wunderbaum's internal logger controls all `console.log`, `console.debug`, and `Load source took...` outputs.
* **Levels**:
  - `0`: Quiet (Mutes all benchmark timings, node traces, and info logs).
  - `1`: Errors only (`console.error`).
  - `2`: Warnings and errors (`console.warn`, `console.error`).
  - `3`: Info logs, timings, and benchmarks (Default: causes `Load source took X s` logs).
  - `4` / `5`: Verbose event traces.
* **Upgrade Decision**: Set `debugLevel: 0` in production / standard operation.

### 2.2 Data Loading Lifecycle & Redundancy Prevention
Wunderbaum's data loading lifecycle operates through:
- `constructor({ source: ... })`: Synchronously primes the tree's internal `forest` structure and sets up initial node maps.
- `tree.load({ children: ... })`: Discards and re-evaluates the internal data set, queuing a viewport recalculation.
* **Current Flaw in RTWiki**:
  When RTWiki boots, `PageTreeHost` primes initial data in `createInstance()`. Immediately following this, React's `useEffect([pages])` in `page-tree.tsx` calls `host.reload()` on the identical `pages` array, causing `Load source` to run multiple times back-to-back.
* **Upgrade Decision**:
  Implement a page version / shallow fingerprint check in `PageTreeHost.reload()`:
  ```ts
  if (this.pagesRef === options.pages && this.lastLoadedCount === options.pages.length) {
    // Only update active node selection; skip destructive tree.load()
    this.applyActive(options.activePageId);
    return;
  }
  ```

### 2.3 Native Drag and Drop (`dnd`) in 0.15.0
In Wunderbaum, `dnd` is a built-in feature utilizing the HTML5 Drag & Drop API.
* **Options in 0.15.0**:
  - `effectAllowed`: `'move'`
  - `dropEffectDefault`: `'move'`
  - `preventRecursion`: `true` (prevents dropping a parent into its own child)
  - `preventVoidMoves`: `true` (prevents no-op moves onto itself)
  - `scroll`: `true` (auto-scrolls when dragging near the edge of the tree)
  - `scrollSensitivity`: default `20` px boundary
  - `scrollSpeed`: scroll acceleration
* **Current Status in RTWiki**:
  RTWiki's `wb-tree-host.ts` already has a solid validation layer checking `isSelfOrDescendant` and rejecting virtual HTML subfiles.

### 2.4 Keyboard Navigation & Inline Editing (`edit`)
- `edit.trigger: ['F2']` triggers inline title editing.
- `edit.trim: true`, `minlength: 1`, `maxlength: 200`.
- In 0.15.0, `edit.saveOnBlur: true` can be configured so clicking away automatically commits the title without requiring an explicit Enter keypress.

---

## 3. Step-by-Step Upgrade Blueprint

### Step 1: Suppress Verbose Telemetry in `wb-tree-host.ts`
Pass `debugLevel: 0` to the `new Wunderbaum()` options:
```ts
const tree = new Wunderbaum({
  element: element as HTMLDivElement,
  id: 'rtwiki-page-tree',
  debugLevel: 0, // Mutes benchmark logging and console noise
  ...
})
```

### Step 2: Optimize Initial Reload Deduplication
In `PageTreeHost.reload()`:
Avoid re-running `tree.load()` when the incoming `pages` list has not changed (e.g. initial mount or pure active tab selection change):
```ts
if (this.pagesRef === options.pages) {
  this.applyActive(options.activePageId);
  return;
}
```

### Step 3: Enable Auto-Save on Blur for Inline Rename
Add `saveOnBlur: true` to the `edit` options object so that clicking away from an active inline rename safely commits rather than discarding the user's edits.

### Step 4: Verification
- Verify in browser console: `Load source took...` messages are silenced.
- Run `bun run typecheck`.
- Run `bun test tests/page-links.test.ts`.
