# ADR-008: Page Hierarchy and the Workspace Tree

| Field | Value |
|-------|-------|
| **Status** | **Accepted** |
| **Date** | 2026-08-23 |
| **Deciders** | Project Owner, Lead Developer |
| **Supersedes** | — |

## Context

RTWiki's pages were a flat, most-recently-updated list. Real note-taking needs
nesting (sections, sub-pages) and manual ordering inside a parent. The sidebar
had to become an accessible tree that supports reordering by mouse
(drag-and-drop) and by keyboard, without weakening the security model, without
adding heavyweight dependencies, and without ever losing or silently moving a
page.

The questions: how should hierarchy be stored; how should sibling order be
represented and changed safely; and how should a tree this interactive remain
accessible while staying a core-only, dependency-light implementation?

## Decision

### Data model — adjacency list with sibling positions

- `pages.parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL` — nullable;
  `NULL` means root.
- `pages.position INTEGER NOT NULL DEFAULT 0` — zero-based ordinal among
  siblings under the same parent, among living (`deleted_at IS NULL`) rows.
- Migration `003_page_hierarchy` adds both columns and backfills deterministically:
  every living page becomes a root positioned to mirror the previous flat
  display order (`updated_at DESC`, `rowid DESC` tiebreak). Soft-deleted rows
  are excluded from sibling arithmetic. A partial covering index
  `idx_pages_parent_position ON pages(parent_id, position) WHERE deleted_at IS NULL`
  serves sibling reads.

### Referential integrity and cycle prevention

- The `parent_id` foreign key keeps every parent reference valid; deleting a
  parent promotes its children (`ON DELETE SET NULL`) at the parent's former
  position, shifting later siblings by the number of promoted children.
- All structural writes run inside `BEGIN IMMEDIATE … COMMIT/ROLLBACK`
  transactions, so validation reads happen after the write lock is acquired and
  concurrent moves serialize.
- Moving a page into itself or its own descendant is rejected by an iterative
  ancestor walk with a visited-ID set and a hard step ceiling (corruption
  tripwire), never by recursion.

### Mutation semantics (single authoritative implementation)

- **Create:** appends at `nextChildPosition` (max sibling position + 1).
- **Duplicate:** inserts the copy directly after its source; later siblings
  shift down contiguously.
- **Delete:** soft-delete only; children are promoted to the deleted page's
  parent at its position (delete-promotion).
- **Move:** `POST /api/pages/:id/move` takes `newParentId` plus `newPosition`,
  defined as the final zero-based index after removing the page from its origin
  siblings, clamped to the destination end. The server returns an authoritative
  reconciliation payload — `{ page, originParentId, originSiblings,
  destinationParentId, destinationSiblings }` — and clients replace their
  optimistic arrangement with it.

### Complete-page pagination requirement

The list endpoint returns the most-recently-updated pages in bounded windows
(50 rows by default) together with a full-count `total`. Sibling indexes are
**absolute** ordinals, so any client that computes them from a truncated window
places rows at wrong positions once a parent's siblings exceed the window.
The workspace controller therefore retrieves the complete living-page
collection through successive bounded windows of the same endpoint
(deduplicated, offset-drift-safe, loop-bounded, published atomically on
success) before building the hierarchy, computing sibling indexes, rendering
the tree, or committing moves. Search results remain windowed.

### Accessible tree architecture

- The sidebar is a WAI-ARIA tree: container `role="tree"`, rows
  `role="treeitem"` with `aria-level`, `aria-expanded`, and `aria-selected`.
- **Keyboard focus is independent of active-page selection.** The tree owns a
  roving-tabindex `focusedId`; the active open page stays selected (`aria-selected`)
  and its editor stays mounted while the user explores other rows.
- `Enter` opens the focused row; arrow keys move focus and toggle expansion.
- Drag-and-drop commits mirror keyboard parity paths: each row's context menu
  offers explicit "Move to…" (reparent) and Move up/Move down actions using the
  same validated move endpoint.

### Tree drag-and-drop — core-only pragmatic-drag-and-drop

- `@atlaskit/pragmatic-drag-and-drop@3.0.0` (element adapters) is the sole DnD
  dependency. Rows are draggable sources; the tree container is the **single
  drop target**, resolving the hovered row and edge itself from pointer
  position. Edge geometry is deliberately hand-maintained thirds of the row's
  visual height (top = before, middle = inside/reparent, bottom = after).
- During native HTML5 drags Chromium parks a top-layer "honey pot" element
  under the cursor, so row resolution uses pragmatic-drag-and-drop's exported
  honey-pot-aware lookup (`getElementFromPointWithoutHoneypot`) instead of raw
  hit testing.
- The latest valid hover hint is cached and committed at drop, matching the
  indicator the user last saw; a drop-time recomputation from the drop event's
  coordinates is the fallback for drags whose event stream delivers no
  enter/over before the drop. The cache resets explicitly at drag start.
- **No hitbox package and no auto-scroll were added**: they introduced
  viewport-edge autoscroll races in real-browser testing, expanded the
  dependency surface against the core-only constraint, and were unnecessary
  once targets scroll into view before a drop. The per-row sticky-edge variant
  was also rejected for masking genuine drops as accidental appends.
- No titles or content travel in drag payloads — identity fields only.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Materialized path / nested-set columns | Costly updates on every reorder; adjacency list matches the read pattern (children by parent) and SQLite FKs. |
| Fractional/large-gap position keys | Avoids shifts but complicates deterministic clamping and debugging; contiguous reindexing within one transaction is cheap at wiki scale. |
| Server-side relative moves ("before X") | Would hide absolute-position semantics from tests; the final-index contract is explicit, clamped, and fully covered. |
| Per-row nested drop targets | Nested-target routing ambiguity and duplicated edge logic; one container target resolves rows via pointer lookup and makes empty space mean root-append naturally. |
| Third-party tree/DnD kits (hitbox layers, auto-scroll) | Violates the core-only dependency posture and caused autoscroll races in browser testing. |
| Flat list with indentation only | Does not satisfy owner-required manual ordering or reparenting. |

## Consequences

**Positive:**
- Hierarchy, ordering, and reparenting are transactional, validated, and
  reconciled authoritatively by the server.
- The tree remains accessible by keyboard alone; DnD is additive, not required.
- Dependency footprint grows by one core library; no auto-scroll/hitbox code.

**Negative:**
- Clients must fetch the complete collection before index math; windowed loads
  are incorrect by construction (enforced by regression tests).
- Reordering shifts sibling positions, so stored `position` values change on
  moves; readers must always sort, never treat positions as stable IDs.
- Collapsed parents hide children from the DOM by design, so rendered-node
  counts legitimately differ from living-page totals.

**Neutral:**
- Drag payloads carry identity only; titles/content never leak into
  `dataTransfer`.

## Security Model

Unchanged. All mutations flow through existing localhost-only, schema-validated
endpoints; the move endpoint performs cycle/descendant rejection server-side;
no new network surface, no executable content, no changes to CSP, sandboxing,
or attachment handling ([SECURITY.md](../SECURITY.md)).

## Risks

- Very large sibling sets make full-collection pagination slower over time;
  mitigated by bounded batches and a future cursor-based list if needed.
- Concurrent structural edits from multiple tabs serialize on the SQLite write
  lock; last-committed reconciliation wins and clients resync from it.

## Revisit Conditions

- If sibling counts routinely exceed a few thousand, evaluate cursor-based
  listing or lazy subtree loading.
- If cross-window (LAN) use is ever authorized, revisit concurrent-move
  semantics and conflict surfacing.
