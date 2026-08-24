import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { Text } from '@mantine/core'
import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { type UsePageTreeResult, usePageTree } from '../../hooks/use-page-tree.js'
import classes from './page-tree.module.css'
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
  /** Creates a new child HTML page beneath an existing page. */
  onCreateChildHtml?: (parentId: string) => void
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
  /** Opens an HTML page's virtual source subfile in the central workspace. */
  onOpenHtmlSource: (pageId: string, field: 'html' | 'css' | 'javascript') => void
  /** Creates a new ROOT page from the tree's empty-space context menu. */
  onCreateRoot?: (pageType: PageType) => void
}

type ContextMenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'page'; pageId: string; x: number; y: number }

/**
 * Accessible hierarchical page tree (WAI-ARIA tree pattern).
 *
 * Owns keyboard focus/expansion state only; the active/open page remains
 * controller-owned. Enter and mouse click open; every other interaction is
 * exploration or mutation that never navigates.
 *
 * Right-click creation follows Trilium's proven pattern: the menu opens at
 * the pointer, operates on the right-clicked row (or offers root creation
 * over empty space), and closes on outside click or Escape.
 */
export function PageTree({
  pages,
  activePageId,
  onOpen,
  hooks,
  onOpenHtmlSource,
  onCreateRoot
}: PageTreeProps): JSX.Element {
  const tree = usePageTree({ pages, activePageId, onOpen, onOpenHtmlSource })

  const moveTargets = buildMoveTargets(pages)

  // Right-click / keyboard context menu. Null = closed.
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editSignals, setEditSignals] = useState<Record<string, number>>({})
  const contextMenuRef = useRef<HTMLDivElement | null>(null)

  const openContextMenu = useCallback((state: ContextMenuState): void => {
    setContextMenu(state)
  }, [])
  const closeContextMenu = useCallback((): void => setContextMenu(null), [])
  const requestRenameViaMenu = (pageId: string): void => {
    setEditSignals((prev) => ({ ...prev, [pageId]: (prev[pageId] ?? 0) + 1 }))
  }

  // Outside pointer-down and global Escape dismiss the context menu.
  useEffect(() => {
    if (contextMenu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const menu = contextMenuRef.current
      if (menu && !menu.contains(event.target as Node)) closeContextMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu, closeContextMenu])

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
  // hovered row and edge itself (honey-pot-aware hit testing), so empty
  // container space naturally means root placement, and a global monitor
  // tracks the dragged source for the commit path.
  const [dropHint, setDropHint] = useState<RowHint | 'blocked' | null>(null)
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
        if (rowId === null || edge === 'root-append') {
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

  /** Container-level right-click: empty space yields the root creation menu. */
  const handleContainerContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    const row = (event.target as HTMLElement).closest('[role="treeitem"]')
    if (row) return // rows handle their own menus
    event.preventDefault()
    openContextMenu({
      kind: 'root',
      x: event.clientX,
      y: event.clientY
    })
  }

  const createChildAndExpand = (parentId: string, kind: 'rich' | 'html'): void => {
    // The child must be visible immediately: force-expand the parent before
    // the creation round-trip lands.
    tree.expandPage(parentId)
    if (kind === 'html') {
      hooks.onCreateChildHtml?.(parentId)
    } else {
      hooks.onCreateChild(parentId)
    }
  }

  const rowDropHint = (rowId: string): DropEdge | null =>
    !dropHint || dropHint === 'blocked' || dropHint.rowId !== rowId ? null : dropHint.edge

  return (
    <div
      ref={(el) => {
        containerElementRef.current = el
        tree.containerRef.current = el
      }}
      role="tree"
      aria-label={UI_TEXT.dashboardTitle}
      onKeyDown={tree.handleTreeKeyDown}
      onContextMenu={handleContainerContextMenu}
      data-testid="page-tree"
    >
      {tree.rows.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center">
          {UI_TEXT.emptyDescription}
        </Text>
      ) : (
        tree.rows.map((row) => {
          const subfile = row.subfile
          const node = row.node
          if (subfile) {
            return (
              <PageTreeRow
                key={row.id}
                subfile={{ ...subfile }}
                pageId={row.id}
                title=""
                pageType="rich"
                parentId={null}
                hasChildren={false}
                expanded={false}
                focused={tree.focusedId === row.id}
                active={false}
                indentLevel={row.depth}
                tabIndex={tree.focusedId === row.id ? 0 : -1}
                onOpen={() => onOpenHtmlSource(subfile.pageId, subfile.field)}
                onOpenSubfile={() => onOpenHtmlSource(subfile.pageId, subfile.field)}
                onToggleExpand={() => undefined}
                onFocusRow={() => tree.focusRow(row.id)}
                onRenameCommit={() => undefined}
                onRenameCancel={() => tree.restoreFocusAfterChange(row.id)}
                onCreateChild={() => undefined}
                onDuplicate={() => undefined}
                onDelete={() => undefined}
                onMoveUp={() => undefined}
                onMoveDown={() => undefined}
                moveTargets={[]}
                onMoveTo={() => undefined}
                dropHint={rowDropHint(row.id)}
              />
            )
          }
          if (!node) return null
          return (
            <PageTreeRow
              key={row.id}
              pageId={row.id}
              title={node.page.title}
              pageType={node.page.pageType}
              parentId={node.page.parentId ?? null}
              indentLevel={row.depth}
              // HTML pages always show the expand chevron: their virtual
              // source subfiles live behind it even with no real children.
              hasChildren={node.children.length > 0 || node.page.pageType === 'html'}
              expanded={row.expanded}
              focused={tree.focusedId === row.id}
              active={activePageId === row.id}
              tabIndex={tree.focusedId === row.id ? 0 : -1}
              onOpen={() => onOpen(row.id)}
              onToggleExpand={() => tree.toggleExpand(row.id)}
              onFocusRow={() => tree.focusRow(row.id)}
              onRenameCommit={(title) => handleRenameCommit(row.id, title)}
              onRenameCancel={() => tree.restoreFocusAfterChange(row.id)}
              onCreateChild={() => createChildAndExpand(row.id, 'rich')}
              onCreateChildHtml={() => createChildAndExpand(row.id, 'html')}
              onDuplicate={() => hooks.onDuplicate(row.id)}
              onDelete={() => handleDelete(row.id)}
              onMoveUp={() => hooks.onMoveRelative(row.id, -1)}
              onMoveDown={() => hooks.onMoveRelative(row.id, 1)}
              moveTargets={moveTargets.filter((t) => t.id !== row.id)}
              onMoveTo={(newParentId) => handleMoveTo(row.id, newParentId)}
              dropHint={rowDropHint(row.id)}
              editSignal={editSignals[row.id] ?? 0}
              onRequestContextMenu={(rect) =>
                openContextMenu({
                  kind: 'page',
                  pageId: row.id,
                  x: rect.left,
                  y: rect.bottom + 2
                })
              }
            />
          )
        })
      )}

      {contextMenu !== null ? (
        <div
          ref={contextMenuRef}
          role="menu"
          data-testid="tree-context-menu"
          className={classes.contextMenu}
          style={{
            // Clamp into the viewport: a menu anchored near a screen edge
            // must never extend beyond it.
            left: Math.min(contextMenu.x, (window.innerWidth ?? 1024) - 230),
            top: Math.min(contextMenu.y, (window.innerHeight ?? 768) - 240)
          }}
        >
          {contextMenu.kind === 'root' ? (
            <>
              <button
                type="button"
                role="menuitem"
                className={classes.contextMenuItem}
                onClick={() => {
                  closeContextMenu()
                  onCreateRoot?.('rich')
                }}
              >
                {UI_TEXT.newRichPage}
              </button>
              <button
                type="button"
                role="menuitem"
                className={classes.contextMenuItem}
                onClick={() => {
                  closeContextMenu()
                  onCreateRoot?.('html')
                }}
              >
                {UI_TEXT.newHtmlRootPage}
              </button>
            </>
          ) : (
            <>
              {(
                [
                  ['open', UI_TEXT.openAction],
                  ['childRich', UI_TEXT.newChildRichPage],
                  ['childHtml', UI_TEXT.newChildHtmlPage],
                  ['rename', UI_TEXT.renameAction],
                  ['duplicate', UI_TEXT.duplicateAction],
                  ['delete', UI_TEXT.deleteAction]
                ] as const
              ).map(([actionKey, label]) => (
                <button
                  key={actionKey}
                  type="button"
                  role="menuitem"
                  className={
                    actionKey === 'delete'
                      ? `${classes.contextMenuItem} ${classes.contextMenuDanger}`
                      : classes.contextMenuItem
                  }
                  onClick={() => {
                    const id = contextMenu.pageId
                    closeContextMenu()
                    if (actionKey === 'open') onOpen(id)
                    if (actionKey === 'childRich') createChildAndExpand(id, 'rich')
                    if (actionKey === 'childHtml') createChildAndExpand(id, 'html')
                    if (actionKey === 'rename') requestRenameViaMenu(id)
                    if (actionKey === 'duplicate') hooksRef.current.onDuplicate(id)
                    if (actionKey === 'delete') handleDelete(id)
                  }}
                >
                  {label}
                </button>
              ))}
              <div className={classes.contextMenuDivider} />
              {(['up', 'down'] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  role="menuitem"
                  className={classes.contextMenuItem}
                  onClick={() => {
                    const id = contextMenu.pageId
                    closeContextMenu()
                    hooksRef.current.onMoveRelative(id, dir === 'up' ? -1 : 1)
                  }}
                >
                  {dir === 'up' ? UI_TEXT.moveUpLabel : UI_TEXT.moveDownLabel}
                </button>
              ))}
              <div className={classes.contextMenuDivider} />
              <div className={classes.menuScroll}>
                {moveTargets
                  .filter((mt) => mt.id !== contextMenu.pageId)
                  .map((target) => (
                    <button
                      key={target.id}
                      type="button"
                      role="menuitem"
                      className={classes.contextMenuItem}
                      onClick={() => {
                        const id = contextMenu.pageId
                        closeContextMenu()
                        handleMoveTo(id, target.id)
                      }}
                    >
                      {UI_TEXT.moveToParentLabel}: {target.label}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      ) : null}
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
