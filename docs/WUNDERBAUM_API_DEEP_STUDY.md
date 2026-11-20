# Deep Study: Official Wunderbaum API Reference (`mar10.github.io/wunderbaum/api/`)

A comprehensive analysis of the official API documentation at `https://mar10.github.io/wunderbaum/api/` and how RTWiki can be upgraded to take advantage of its modern architecture and performance optimizations.

---

## 1. Wunderbaum Core Architecture & Modules

The official API is divided into several modules:
- `wb_tree.Wunderbaum`: The root tree controller.
- `wb_node.WunderbaumNode`: The individual node model representing items in the tree.
- `wb_options.WunderbaumOptions`: Complete typed configuration object.
- `wb_ext_dnd.DndExtension`: Native HTML5 drag-and-drop controller.
- `wb_ext_edit.EditExtension`: Inline title editor (F2).
- `wb_ext_filter.FilterExtension`: High-performance client-side node filtering.

---

## 2. Key API Insights & Modern Best Practices

### A. Logging & Telemetry: `debugLevel`
- **Location**: `wb_options.WunderbaumOptions.debugLevel`
- **Official Specification**:
  - `0`: Quiet. Mutes all informational output, benchmark timings, and diagnostic logs.
  - `1`: Errors only.
  - `2`: Warnings & Errors.
  - `3`: Standard Info & Benchmark Timings (`Load source took X seconds`). *(Default if omitted)*.
  - `4` / `5`: Detailed event tracing & mouse movements.
- **Finding**: RTWiki omitted `debugLevel` in `wb-tree-host.ts:382`, triggering the default level `3` benchmark logs on every single load. Setting `debugLevel: 0` explicitly silences all non-error console noise.

### B. High-Performance Batching: `tree.runWithDeferredUpdate()`
- **Location**: `wb_tree.Wunderbaum.runWithDeferredUpdate(fn)` & `runWithDeferredUpdateAsync(fn)`
- **Official Specification**:
  When performing multi-node mutations (such as expanding multiple branches during workspace session restoration or applying selection filters), calling individual node methods can cause multiple redundant DOM reflows.
  `runWithDeferredUpdate` suspends viewport redraws until the callback finishes, executing exactly one batch update.
- **Upgrade for RTWiki**:
  In `wb-tree-host.ts:applySeed()`, where multiple nodes are expanded on reload, wrapping the loop in `tree.runWithDeferredUpdate(() => { ... })` ensures zero intermediate layout passes.

### C. Filtering: `tree.filterNodes()`
- **Location**: `wb_tree.Wunderbaum.filterNodes(filter, options)`
- **Official Specification**:
  - `filter`: Can be a search query string, regex, or callback predicate.
  - `options`: `{ matchBranch: true, mode: 'hide' }`.
  - Replaces the deprecated `filterBranches()` method.
- **Upgrade for RTWiki**:
  Currently, searching pages in RTWiki performs an API query (`api.listPages({ q })`) and destroys/recreates the tree data. For local in-memory tree filtering, `tree.filterNodes()` can filter the tree instantly in sub-millisecond time.

### D. Deep Visibility & Viewport Scroll: `node.makeVisible()` vs `tree.scrollTo()`
- **Location**: `wb_node.WunderbaumNode.makeVisible(options)` and `tree.scrollTo(options)`
- **Official Specification**:
  - `node.makeVisible()` expands all ancestor parents up the hierarchy so the node is rendered in the virtual DOM.
  - `node.setActive(flag, { noEvents: true })` by default attempts to scroll the active node into the viewport.
- **Finding in RTWiki**:
  RTWiki already has a custom guard (`keepScroll`) checking bounding client rects before scrolling, which prevents page-switching clicks from jumping the viewport. We should keep this guard intact.

### E. Inline Editing: `wb_ext_edit`
- **Location**: `wb_options.WunderbaumOptions.edit`
- **Official Specification**:
  - `trigger: ['F2']` (or custom triggers).
  - `trim: true`, `minlength: 1`, `maxlength: 200`.
  - `saveOnBlur: true`: When the user clicks away from the input, automatically commits the edit rather than cancelling.
- **Upgrade for RTWiki**:
  Adding `saveOnBlur: true` prevents users from accidentally losing inline page renames if they click into the document without pressing Enter.

---

## 3. The Upgrade Roadmap for RTWiki

1. **Silence Console Noise**:
   Add `debugLevel: 0` to `new Wunderbaum()` in `src/web/features/sidebar/wb-tree-host.ts`.
2. **Deduplicate Reloads on Boot**:
   In `PageTreeHost.reload()`, check if `this.pagesRef === options.pages`. If the array reference has not changed, skip `tree.load()` and simply call `this.applyActive()`.
3. **Batch Expansion Restores**:
   Use `tree.runWithDeferredUpdate()` inside `applySeed()` to batch session-restored branch expansions into a single viewport paint.
4. **Enable `saveOnBlur`**:
   Add `saveOnBlur: true` under `edit:` options in `wb-tree-host.ts`.
