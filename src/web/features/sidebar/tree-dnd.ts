import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
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
  onHintChange: (hint: RowHint | null) => void
  /** Commit: rowId null means empty-space root append. */
  onDropIntent: (rowId: string | null, edge: DropEdge | 'root-append') => void
}

function resolveRowUnderPointer(
  container: HTMLElement,
  clientX: number,
  clientY: number
): RowHint | null {
  const underPointer = getElementFromPointWithoutHoneypot({ x: clientX, y: clientY })
  const row = underPointer?.closest('[role="treeitem"]') as HTMLElement | null
  if (!row || !container.contains(row)) return null
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
 * committed verbatim on drop. Geometry is NEVER recomputed at drop time:
 * the sidebar scroll position can shift between the final dragover and the
 * drop event, and recomputing clientY against live row rects there flips
 * the edge (observed as an after-drop committing as before). Committing the
 * cached hint guarantees the move matches the indicator the user last saw.
 */
export function registerContainerDnd(options: ContainerDndOptions): () => void {
  // Latest valid hint of the CURRENT drag. Every drop on this target is
  // always preceded by onDragEnter/onDrag of that same drag, which rewrite
  // this cache — including after an Escape-cancelled drag — so a stale hint
  // from an earlier drag can never be committed. Invalid resolutions (null)
  // clear it, preserving empty-space root-append semantics.
  let lastRowHint: RowHint | null = null

  const updateHint = (clientX: number, clientY: number): void => {
    lastRowHint = resolveRowUnderPointer(options.element, clientX, clientY)
    options.onHintChange(lastRowHint)
  }

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
    onDrop: () => {
      const hint = lastRowHint
      lastRowHint = null
      options.onHintChange(null)
      if (hint) {
        options.onDropIntent(hint.rowId, hint.edge)
      } else {
        options.onDropIntent(null, 'root-append')
      }
    }
  })

  return cleanupDropTarget
}
