import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { Text } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { type UsePageTreeResult, usePageTree } from '../../hooks/use-page-tree.js'
import { PageTreeRow } from './page-tree-row.js'
import {
  type DropEdge,
  isPageTreeDragData,
  type RowHint,
  registerContainerDnd
} from './tree-dnd.js'

export interface MoveTarget {
  id: string
  label: string
}

export interface PageTreeControllerHooks {
  onRename: (id: string, title: string) => Promise<boolean>
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  onMoveTo: (id: string, newParentId: string | null) => void
  onMoveRelative: (id: string, delta: number) => void
  /** Positional move used by drag-and-drop (optimistic + rollback). */
  onDropMove: (id: string, newParentId: string | null, newPosition: number) => void
}

interface PageTreeProps {
  pages: Page[]
  activePageId: string | null
  onOpen: (id: string) => void
  hooks: PageTreeControllerHooks
}

/**
 * Accessible hierarchical page tree (WAI-ARIA tree pattern).
 *
 * Owns keyboard focus/expansion state only; the active/open page remains
 * controller-owned. Enter and mouse click open; every other interaction is
 * exploration or mutation that never navigates.
 */
export function PageTree({ pages, activePageId, onOpen, hooks }: PageTreeProps): JSX.Element {
  const tree = usePageTree({ pages, activePageId, onOpen })

  const moveTargets = buildMoveTargets(pages)

  /**
   * Commits a completed row drop. Before/after targets compute the
   * final-index-after-removal position among the target's siblings;
   * inside appends under the target. Descendant/self rejection mirrors
   * the keyboard "Move to" parity path.
   */
  const handleRowDrop = (sourceId: string, targetId: string, edge: DropEdge): void => {
    if (edge === 'inside') {
      if (tree.isSelfOrDescendantChecker(sourceId, targetId)) return
      hooks.onDropMove(sourceId, targetId, Number.MAX_SAFE_INTEGER)
    } else {
      const target = pages.find((page) => page.id === targetId)
      if (!target) return
      const newParentId = target.parentId ?? null
      // A null parent is the root list, which can never be inside the
      // dragged subtree, so the descendant check only applies to pages.
      if (newParentId !== null && tree.isSelfOrDescendantChecker(sourceId, newParentId)) {
        return
      }
      const siblings = pages
        .filter((page) => (page.parentId ?? null) === newParentId && page.id !== sourceId)
        .sort((a, b) => a.position - b.position)
      const index = siblings.findIndex((page) => page.id === targetId)
      if (index < 0) return
      hooks.onDropMove(sourceId, newParentId, edge === 'before' ? index : index + 1)
    }
    tree.restoreFocusAfterChange(sourceId)
  }

  // Drag-and-drop: the container is the SINGLE drop target. It resolves the
  // hovered row and edge itself (elementFromPoint), so empty container space
  // naturally means root placement, and a global monitor tracks the dragged
  // source for the commit path.
  const [dropHint, setDropHint] = useState<RowHint | null>(null)
  const containerElementRef = useRef<HTMLDivElement | null>(null)
  const hooksRef = useRef(hooks)
  hooksRef.current = hooks
  const draggingSourceIdRef = useRef<string | null>(null)
  // Stable refs so the container registration effect can stay mount-scoped
  // while always invoking the latest commit/focus logic.
  const handleRowDropRef = useRef(handleRowDrop)
  handleRowDropRef.current = handleRowDrop
  const restoreFocusRef = useRef(tree.restoreFocusAfterChange)
  restoreFocusRef.current = tree.restoreFocusAfterChange

  useEffect(() => {
    return monitorForElements({
      onDragStart: ({ source }) => {
        if (isPageTreeDragData(source.data)) {
          draggingSourceIdRef.current = source.data.pageId
        }
      },
      // Fires for both real drops and cancellations (empty targets), which
      // is exactly the reset signal rows need.
      onDrop: () => {
        draggingSourceIdRef.current = null
        setDropHint(null)
      }
    })
  }, [])

  useEffect(() => {
    const element = containerElementRef.current
    if (!element) return
    return registerContainerDnd({
      element,
      onHintChange: setDropHint,
      onDropIntent: (rowId, edge) => {
        const sourceId = draggingSourceIdRef.current
        if (sourceId === null) return
        if (rowId === null) {
          // Root append: oversized position clamps to the destination end.
          hooksRef.current.onDropMove(sourceId, null, Number.MAX_SAFE_INTEGER)
          restoreFocusRef.current(sourceId)
          return
        }
        handleRowDropRef.current(sourceId, rowId, edge)
      }
    })
  }, [])

  const handleRenameCommit = (id: string, title: string): void => {
    void hooks.onRename(id, title).then(() => {
      tree.restoreFocusAfterChange(id)
    })
  }

  const handleDelete = (id: string): void => {
    hooks.onDelete(id)
    // Focus restoration happens after the controller refreshes the list;
    // the hook's visible-set effect keeps focus inside the tree meanwhile.
    tree.restoreFocusAfterChange(null)
  }

  const handleMoveTo = (id: string, newParentId: string): void => {
    if (!tree.isSelfOrDescendantChecker(id, newParentId)) {
      hooks.onMoveTo(id, newParentId)
    }
  }

  return (
    <div
      ref={(el) => {
        containerElementRef.current = el
        tree.containerRef.current = el
      }}
      role="tree"
      aria-label={UI_TEXT.dashboardTitle}
      onKeyDown={tree.handleTreeKeyDown}
      data-testid="page-tree"
    >
      {tree.rows.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">
          {UI_TEXT.emptyDescription}
        </Text>
      ) : (
        tree.rows.map((row) => (
          <PageTreeRow
            key={row.id}
            pageId={row.id}
            title={row.node.page.title}
            pageType={row.node.page.pageType}
            parentId={row.node.page.parentId ?? null}
            indentLevel={row.depth}
            hasChildren={row.node.children.length > 0}
            expanded={row.expanded}
            focused={tree.focusedId === row.id}
            active={activePageId === row.id}
            tabIndex={tree.focusedId === row.id ? 0 : -1}
            onOpen={() => onOpen(row.id)}
            onToggleExpand={() => tree.toggleExpand(row.id)}
            onFocusRow={() => tree.focusRow(row.id)}
            onRenameCommit={(title) => handleRenameCommit(row.id, title)}
            onRenameCancel={() => tree.restoreFocusAfterChange(row.id)}
            onCreateChild={() => hooks.onCreateChild(row.id)}
            onDuplicate={() => hooks.onDuplicate(row.id)}
            onDelete={() => handleDelete(row.id)}
            onMoveUp={() => hooks.onMoveRelative(row.id, -1)}
            onMoveDown={() => hooks.onMoveRelative(row.id, 1)}
            moveTargets={moveTargets.filter((t) => t.id !== row.id)}
            onMoveTo={(newParentId) => handleMoveTo(row.id, newParentId)}
            dropHint={dropHint?.rowId === row.id ? dropHint.edge : null}
          />
        ))
      )}
    </div>
  )
}

function buildMoveTargets(pages: Page[]): MoveTarget[] {
  return [...pages]
    .sort((a, b) => a.position - b.position)
    .map((page) => {
      const typeLabel = page.pageType === 'rich' ? UI_TEXT.richNote : UI_TEXT.htmlPage
      return {
        id: page.id,
        label: `${page.title || UI_TEXT.untitledPage} (${typeLabel})`
      }
    })
}

// Re-exported for consumers that need the expanded-state shape in tests.
export type { UsePageTreeResult }
