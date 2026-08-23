import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'

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
  startElement: Element | null,
  clientY: number
): RowHint | null {
  const row = startElement?.closest('[role="treeitem"]') as HTMLElement | null
  if (!row || !container.contains(row)) return null
  const rowId = row.getAttribute('data-page-id')
  if (!rowId) return null
  return { rowId, edge: pointerEdge(row, clientY) }
}

/**
 * Registers the tree container as the single drop target.
 *
 * Row resolution deliberately uses the NATIVE drag event's target captured
 * in the capture phase: pragmatic-drag-and-drop mounts a honey-pot element
 * under the cursor during drags, so document.elementFromPoint would only
 * ever see that overlay and every drop would resolve as root-append.
 */
export function registerContainerDnd(options: ContainerDndOptions): () => void {
  // The most recent real element under the pointer, per native drag events.
  let lastNativeTarget: Element | null = null
  const captureNativeTarget = (event: DragEvent): void => {
    lastNativeTarget = event.target instanceof Element ? event.target : null
  }
  const captureOptions: AddEventListenerOptions = { capture: true }

  const cleanupDropTarget = dropTargetForElements({
    element: options.element,
    canDrop: ({ source }) => isPageTreeDragData(source.data),
    onDrag: ({ location }) => {
      options.onHintChange(
        resolveRowUnderPointer(
          options.element,
          lastNativeTarget,
          location.current.input.clientY
        )
      )
    },
    onDragEnter: ({ location }) => {
      options.onHintChange(
        resolveRowUnderPointer(
          options.element,
          lastNativeTarget,
          location.current.input.clientY
        )
      )
    },
    onDragLeave: () => options.onHintChange(null),
    onDrop: ({ location }) => {
      const hint = resolveRowUnderPointer(
        options.element,
        lastNativeTarget,
        location.current.input.clientY
      )
      options.onHintChange(null)
      if (hint) {
        options.onDropIntent(hint.rowId, hint.edge)
      } else {
        options.onDropIntent(null, 'root-append')
      }
    }
  })

  options.element.addEventListener('dragover', captureNativeTarget, captureOptions)
  options.element.addEventListener('drop', captureNativeTarget, captureOptions)

  return () => {
    options.element.removeEventListener('dragover', captureNativeTarget, captureOptions)
    options.element.removeEventListener('drop', captureNativeTarget, captureOptions)
    cleanupDropTarget()
  }
}
