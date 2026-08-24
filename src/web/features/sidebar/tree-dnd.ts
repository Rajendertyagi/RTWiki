import {
  draggable,
  dropTargetForElements,
  monitorForElements
} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { getElementFromPointWithoutHoneypot } from '@atlaskit/pragmatic-drag-and-drop/get-element-from-point-without-honey-pot'

/**
 * Core-only drag-and-drop wiring for the sidebar page tree.
 *
 * Uses @atlaskit/pragmatic-drag-and-drop element adapters exclusively.
 * Edge geometry is deliberately hand-maintained pointer-position math
 * (top third = before, bottom third = after, middle = inside) so the
 * proof of concept needs no hitbox package.
 *
 * Architecture: rows are draggable sources only. The tree container is
 * the SINGLE drop target; it resolves the hovered row and edge itself
 * via elementFromPoint. One drop target means no nested-target routing
 * ambiguity, and empty container space naturally means root placement.
 *
 * No titles or content travel in drag payloads: only identity fields.
 */

export const PAGE_TREE_DND_TYPE = 'rtwiki/page-tree-item'

// A type alias (not an interface) so the payload stays assignable to
// Record<string, unknown> as required by pragmatic-drag-and-drop APIs.
export type PageTreeDragData = {
  type: typeof PAGE_TREE_DND_TYPE
  pageId: string
  parentId: string | null
}

export function isPageTreeDragData(data: Record<string, unknown>): data is PageTreeDragData {
  return data.type === PAGE_TREE_DND_TYPE && typeof data.pageId === 'string'
}

export type DropEdge = 'before' | 'after' | 'inside'

/** Hand-maintained edge geometry: thirds of the row's visual height. */
export function pointerEdge(element: Element, clientY: number): DropEdge {
  const rect = element.getBoundingClientRect()
  if (rect.height <= 0) return 'inside'
  const ratio = (clientY - rect.top) / rect.height
  if (ratio < 1 / 3) return 'before'
  if (ratio > 2 / 3) return 'after'
  return 'inside'
}

/** Registers one tree row as a draggable source. Returns a cleanup fn. */
export function registerRowDraggable(element: HTMLElement, data: PageTreeDragData): () => void {
  return draggable({
    element,
    getInitialData: () => data
  })
}

export interface RowHint {
  rowId: string
  edge: DropEdge
}

export interface ContainerDndOptions {
  element: HTMLElement
  /** Throttled hover updates while dragging over the tree. */
  onHintChange: (hint: RowHint | 'blocked' | null) => void
  /** Commit: rowId null means empty-space root append. */
  onDropIntent: (rowId: string | null, edge: DropEdge | 'root-append') => void
}

type ResolvedHint = RowHint | 'blocked' | null

function resolveRowUnderPointer(
  container: HTMLElement,
  clientX: number,
  clientY: number
): ResolvedHint {
  const underPointer = getElementFromPointWithoutHoneypot({ x: clientX, y: clientY })
  const row = underPointer?.closest('[role="treeitem"]') as HTMLElement | null
  if (!row || !container.contains(row)) return null
  // Virtual HTML subfile rows are never drop targets: a drop over one is
  // swallowed instead of falling through to root-append.
  if (row.hasAttribute('data-subfile-id')) return 'blocked'
  const rowId = row.getAttribute('data-page-id')
  if (!rowId) return null
  return { rowId, edge: pointerEdge(row, clientY) }
}

/**
 * Registers the tree container as the single drop target.
 *
 * Row resolution uses pragmatic-drag-and-drop's exported honey-pot-aware
 * hit-test utility: during drags a honey-pot element sits under the cursor,
 * so plain document.elementFromPoint would only ever see that overlay and
 * every drop would resolve as root-append.
 *
 * The latest valid hint computed during dragenter/dragover is cached and
 * committed on drop, so the committed move matches the indicator the user
 * last saw. Drop-time hit testing is only a FALLBACK for sparse drag-event
 * streams (observed in CI: drags that deliver no enter/over before the
 * drop); the fallback recomputes once from the drop event's coordinates.
 * The cache is reset explicitly at monitor onDragStart because CI disproved
 * the assumption that every drag reliably emits enter/over events first.
 */
export function registerContainerDnd(options: ContainerDndOptions): () => void {
  // Latest valid hint of the CURRENT drag. Rewritten by every
  // onDragEnter/onDrag, cleared on dragleave/drop, and reset at drag start.
  let lastRowHint: ResolvedHint = null

  const updateHint = (clientX: number, clientY: number): void => {
    lastRowHint = resolveRowUnderPointer(options.element, clientX, clientY)
    options.onHintChange(lastRowHint)
  }

  // Explicit per-drag cache reset: a stale hint from an earlier drag can
  // never survive into the next one, even if that next drag drops without
  // emitting any enter/over events to this target.
  const cleanupMonitor = monitorForElements({
    onDragStart: ({ source }) => {
      if (!isPageTreeDragData(source.data)) return
      lastRowHint = null
      options.onHintChange(null)
    }
  })

  const cleanupDropTarget = dropTargetForElements({
    element: options.element,
    canDrop: ({ source }) => isPageTreeDragData(source.data),
    onDrag: ({ location }) => {
      const { clientX, clientY } = location.current.input
      updateHint(clientX, clientY)
    },
    onDragEnter: ({ location }) => {
      const { clientX, clientY } = location.current.input
      updateHint(clientX, clientY)
    },
    onDragLeave: () => {
      lastRowHint = null
      options.onHintChange(null)
    },
    onDrop: ({ location }) => {
      const { clientX, clientY } = location.current.input
      const hint = lastRowHint ?? resolveRowUnderPointer(options.element, clientX, clientY)

      lastRowHint = null
      options.onHintChange(null)

      if (hint === 'blocked') {
        // Over a subfile row: swallow the drop entirely.
        return
      }
      if (hint) {
        options.onDropIntent(hint.rowId, hint.edge)
        return
      }

      options.onDropIntent(null, 'root-append')
    }
  })

  return () => {
    cleanupMonitor()
    cleanupDropTarget()
  }
}
