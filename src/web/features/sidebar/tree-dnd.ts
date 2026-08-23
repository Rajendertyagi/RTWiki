import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'

/**
 * Core-only drag-and-drop wiring for the sidebar page tree.
 *
 * Uses @atlaskit/pragmatic-drag-and-drop element adapters exclusively.
 * Edge geometry is deliberately hand-maintained pointer-position math
 * (top third = before, bottom third = after, middle = inside) so the
 * proof of concept needs no hitbox package. If nested/collapsed rows
 * later prove this unreliable, hitbox is a separately authorized option.
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

export interface DropIntent {
  sourceId: string
  targetId: string | null
  edge: DropEdge | 'root-append'
}

/** Hand-maintained edge geometry: thirds of the row's visual height. */
export function pointerEdge(element: Element, clientY: number): DropEdge {
  const rect = element.getBoundingClientRect()
  if (rect.height <= 0) return 'inside'
  const ratio = (clientY - rect.top) / rect.height
  if (ratio < 1 / 3) return 'before'
  if (ratio > 2 / 3) return 'after'
  return 'inside'
}

export interface RowDndOptions {
  element: HTMLElement
  data: PageTreeDragData
  /** Returns false when this row must not accept the current drag. */
  canAccept: (source: PageTreeDragData) => boolean
  onHintChange: (hint: DropEdge | null) => void
  onDropOnRow: (edge: DropEdge) => void
}

/**
 * Registers one tree row as both a draggable and an edge-aware drop
 * target. Returns a cleanup function.
 */
export function registerRowDnd(options: RowDndOptions): () => void {
  const cleanupDraggable = draggable({
    element: options.element,
    getInitialData: () => options.data
  })

  let hint: DropEdge | null = null
  const setHint = (next: DropEdge | null): void => {
    if (hint !== next) {
      hint = next
      options.onHintChange(next)
    }
  }

  const cleanupDropTarget = dropTargetForElements({
    element: options.element,
    canDrop: ({ source }) => {
      const data = source.data
      if (!isPageTreeDragData(data)) return false
      return data.pageId !== options.data.pageId && options.canAccept(data)
    },
    onDrag: ({ self, location }) => {
      setHint(pointerEdge(self.element, location.current.input.clientY))
    },
    onDragEnter: ({ self, location }) => {
      setHint(pointerEdge(self.element, location.current.input.clientY))
    },
    onDragLeave: () => setHint(null),
    onDrop: ({ self, location }) => {
      const edge = pointerEdge(self.element, location.current.input.clientY)
      setHint(null)
      options.onDropOnRow(edge)
    }
  })

  return () => {
    cleanupDropTarget()
    cleanupDraggable()
  }
}

export interface ContainerDndOptions {
  element: HTMLElement
  canAccept: (source: PageTreeDragData) => boolean
  onHoverChange: (hovering: boolean) => void
  onDropInRoot: () => void
}

/**
 * Registers the tree container as a fallback root-level drop target.
 * Because pragmatic-drag-and-drop dispatches to the innermost target
 * only, this receives drops solely on empty container space.
 */
export function registerRootContainerDnd(options: ContainerDndOptions): () => void {
  return dropTargetForElements({
    element: options.element,
    canDrop: ({ source }) => {
      const data = source.data
      return isPageTreeDragData(data) && options.canAccept(data)
    },
    onDragEnter: () => options.onHoverChange(true),
    onDragLeave: () => options.onHoverChange(false),
    onDrop: () => {
      options.onHoverChange(false)
      options.onDropInRoot()
    }
  })
}
