import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import { useEffect, useRef, useState } from 'react'
import { pageTypeLabel } from '../../components/page-type-badge.js'
import { UI_TEXT } from '../../config/index.js'
import { debugLog } from '../../diagnostics/debug-log.js'
import { PageTreeHost, type DropMove } from './wb-tree-host.js'
import { isMoveToAction, TreeContextMenu } from './tree-context-menu.js'
import classes from './page-tree.module.css'

export interface MoveTarget {
  id: string
  label: string
}

export interface PageTreeControllerHooks {
  onRename: (id: string, title: string) => Promise<boolean>
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  onCreateChildHtml?: (parentId: string) => void
  /** Creates a child of any type (Diagram / Mind Map entry points). */
  onCreateChildOfType?: (parentId: string, pageType: PageType) => void
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
  /** Session-restoration seed for the expansion set. */
  seedExpandedIds?: ReadonlySet<string>
  /** Expansion observation for session persistence. */
  onExpandedChange?: (ids: ReadonlySet<string>) => void
}

type ContextMenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'page'; pageId: string; x: number; y: number }

/** Imperative helpers the composition root drives through the ref. */
export interface PageTreeImperative {
  expandPage: (pageId: string) => void
  restoreFocus: (preferredId: string | null) => void
}

/**
 * Wunderbaum-backed page tree.
 *
 * The component owns only the host-instance lifecycle and the context-menu
 * presentation; all state (pages, selection, expansion persistence) stays
 * with RTWiki's controller, and interactions flow back through callbacks:
 *
 * - Blank tree space right-click opens the root/new-page menu (documented
 *   behaviour); any row region opens the per-page menu. The native browser
 *   menu is suppressed for the whole tree surface.
 * - The row action button (hover/focus) opens the same per-page menu; it
 *   never opens the page (stopPropagation in the host render hook).
 * - Row click / Enter opens pages through the controller's normal flow;
 *   the disclosure control only expands/collapses.
 * - Virtual HTML/CSS/JS rows open their source workspace and offer no
 *   lifecycle actions and no drop destinations.
 */
export function PageTree({
  pages,
  activePageId,
  onOpen,
  hooks,
  onOpenHtmlSource,
  onCreateRoot,
  seedExpandedIds,
  onExpandedChange
}: PageTreeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<PageTreeHost | null>(null)
  const imperativeRef = useRef<PageTreeImperative>({
    expandPage: () => undefined,
    restoreFocus: () => undefined
  })

  // Context menu state (portalled menu rendered by TreeContextMenu).
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editSignals, setEditSignals] = useState<Record<string, number>>({})
  const contextMenuRequestRef = useRef<(payload: ContextMenuState) => void>(() => {})
  const renameSignalRef = useRef<(pageId: string) => void>(() => {})

  contextMenuRequestRef.current = (payload) => {
    setContextMenu(payload)
  }
  renameSignalRef.current = (pageId) => {
    setEditSignals((prev) => ({ ...prev, [pageId]: (prev[pageId] ?? 0) + 1 }))
  }

  // Callback mirrors so mount-scoped effects always invoke latest closures.
  const callbacksRef = useRef({
    pages,
    activePageId,
    onOpen,
    hooks,
    onOpenHtmlSource,
    onCreateRoot,
    onExpandedChange
  })
  callbacksRef.current = {
    pages,
    activePageId,
    onOpen,
    hooks,
    onOpenHtmlSource,
    onCreateRoot,
    onExpandedChange
  }

  const isSelfOrDescendantRef = useRef<(a: string, c: string) => boolean>(() => false)
  const refreshParentMap = (list: Page[]): void => {
    const parents = new Map<string, string | null>()
    for (const p of list) parents.set(p.id, p.parentId ?? null)
    isSelfOrDescendantRef.current = (ancestorId, candidateId): boolean => {
      let cursor: string | null = candidateId
      const visited = new Set<string>()
      while (cursor !== null && !visited.has(cursor)) {
        visited.add(cursor)
        if (cursor === ancestorId) return true
        cursor = parents.get(cursor) ?? null
      }
      return false
    }
  }
  refreshParentMap(pages)

  // Mount exactly one host instance (strict-mode safe); data flows through
  // the reload effect below.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const host = new PageTreeHost()
    hostRef.current = host
    refreshParentMap(callbacksRef.current.pages)

    host.mount(element, {
      pages: callbacksRef.current.pages,
      activePageId: callbacksRef.current.activePageId,
      untitledLabel: UI_TEXT.untitledPage,
      seedExpandedIds: callbacksRef.current.seedExpandedIds,
      isSelfOrDescendant: (a, c) => isSelfOrDescendantRef.current(a, c),
      callbacks: {
        onOpenPage: (pageId) => {
          debugLog('ui', 'ui_tree_row_open', { pageId })
          callbacksRef.current.onOpen(pageId)
        },
        onOpenSubfile: (pageId, field) => {
          debugLog('ui', 'ui_subfile_open', { pageId, field })
          callbacksRef.current.onOpenHtmlSource(pageId, field)
        },
        onDropMove: (move: DropMove) => {
          debugLog('ui', 'ui_drag_drop', {
            pageId: move.pageId,
            targetId: move.newParentId ?? undefined,
            code: move.newPosition === null ? 'append' : String(move.newPosition)
          })
          callbacksRef.current.hooks.onDropMove(
            move.pageId,
            move.newParentId,
            move.newPosition ?? Number.MAX_SAFE_INTEGER
          )
        },
        onContextMenu: (payload) => contextMenuRequestRef.current(payload),
        onRenameRequest: (pageId) => renameSignalRef.current(pageId),
        onExpandedChange: (ids) => callbacksRef.current.onExpandedChange?.(ids)
      }
    })

    imperativeRef.current = {
      expandPage: (pageId) => host.expandPage(pageId),
      restoreFocus: (preferredId) => host.restoreFocus(preferredId)
    }

    return () => {
      host.destroy()
      hostRef.current = null
      imperativeRef.current = { expandPage: () => undefined, restoreFocus: () => undefined }
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-scoped; data flows through the reload effect
  }, [])

  // Reload data in place whenever the page list or selection changes.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    refreshParentMap(pages)
    host.reload({
      pages,
      activePageId,
      untitledLabel: UI_TEXT.untitledPage,
      isSelfOrDescendant: (a, c) => isSelfOrDescendantRef.current(a, c),
      callbacks: {
        onOpenPage: (pageId) => {
          debugLog('ui', 'ui_tree_row_open', { pageId })
          onOpen(pageId)
        },
        onOpenSubfile: (pageId, field) => {
          debugLog('ui', 'ui_subfile_open', { pageId, field })
          onOpenHtmlSource(pageId, field)
        },
        onDropMove: (move: DropMove) => {
          debugLog('ui', 'ui_drag_drop', {
            pageId: move.pageId,
            targetId: move.newParentId ?? undefined,
            code: move.newPosition === null ? 'append' : String(move.newPosition)
          })
          hooks.onDropMove(
            move.pageId,
            move.newParentId,
            move.newPosition ?? Number.MAX_SAFE_INTEGER
          )
        },
        onContextMenu: (payload) => contextMenuRequestRef.current(payload),
        onRenameRequest: (pageId) => renameSignalRef.current(pageId),
        onExpandedChange: (ids) => onExpandedChange?.(ids)
      }
    })
  }, [pages, activePageId, onOpen, onOpenHtmlSource, hooks, onExpandedChange])

  // Apply the session-expansion seed once per distinct identity.
  const seedRef = useRef<ReadonlySet<string> | null>(null)
  useEffect(() => {
    if (!seedExpandedIds || seedExpandedIds === seedRef.current) return
    seedRef.current = seedExpandedIds
    hostRef.current?.applySeed(seedExpandedIds)
  }, [seedExpandedIds])

  const moveTargets = buildMoveTargets(pages)
  const closeContextMenu = (): void => setContextMenu(null)

  const handleMenuAction = (rawAction: string): void => {
    const menu = contextMenu
    closeContextMenu()
    if (!menu) return
    if (isMoveToAction(rawAction)) {
      if (menu.kind === 'page') {
        const targetId = rawAction.slice('moveTo:'.length)
        debugLog('ui', 'ui_context_menu_action', { pageId: menu.pageId, code: 'moveTo' })
        hooks.onMoveTo(menu.pageId, targetId)
      }
      return
    }
    const action = rawAction
    debugLog('ui', 'ui_context_menu_action', {
      pageId: menu.kind === 'page' ? menu.pageId : undefined,
      code: action
    })
    if (menu.kind === 'root') {
      if (action === 'rootRich') onCreateRoot?.('rich')
      if (action === 'rootHtml') onCreateRoot?.('html')
      if (action === 'rootDiagram') onCreateRoot?.('diagram')
      if (action === 'rootMindMap') onCreateRoot?.('mindmap')
      return
    }
    const id = menu.pageId
    if (action === 'open') onOpen(id)
    if (action === 'childRich') {
      imperativeRef.current.expandPage(id)
      hooks.onCreateChild(id)
    }
    if (action === 'childHtml') {
      imperativeRef.current.expandPage(id)
      hooks.onCreateChildHtml?.(id)
    }
    if (action === 'childDiagram') {
      imperativeRef.current.expandPage(id)
      hooks.onCreateChildOfType?.(id, 'diagram')
    }
    if (action === 'childMindMap') {
      imperativeRef.current.expandPage(id)
      hooks.onCreateChildOfType?.(id, 'mindmap')
    }
    if (action === 'rename') renameSignalRef.current(id)
    if (action === 'duplicate') hooks.onDuplicate(id)
    if (action === 'delete') {
      hooks.onDelete(id)
      imperativeRef.current.restoreFocus(null)
    }
    if (action === 'moveUp') hooks.onMoveRelative(id, -1)
    if (action === 'moveDown') hooks.onMoveRelative(id, 1)
  }

  const menuPageId = contextMenu?.kind === 'page' ? contextMenu.pageId : null

  return (
    <>
      <div
        ref={containerRef}
        className={classes.wbHost}
        data-testid="page-tree"
        role="tree"
        aria-label={UI_TEXT.dashboardTitle}
      />
      <TreeContextMenu
        menu={contextMenu}
        moveTargets={moveTargets.filter((t) => t.id !== menuPageId)}
        onAction={handleMenuAction}
        onDismiss={closeContextMenu}
      />
      {/* Inline rename signal consumer: rename is initiated through
          Wunderbaum's title editor; the apply callback routes the committed
          title back through hooks.onRename. */}
      <RenameSignalConsumer signals={editSignals} hostRef={hostRef} />
    </>
  )
}

/**
 * Bridges rename requests to the Wunderbaum title editor (F2 contract).
 * Wunderbaum starts editing via startEditTitle; the apply callback routes
 * the committed title back through hooks.onRename.
 */
function RenameSignalConsumer({
  signals,
  hostRef
}: {
  signals: Record<string, number>
  hostRef: React.RefObject<PageTreeHost | null>
}): JSX.Element | null {
  const lastConsumedRef = useRef<Record<string, number>>({})
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    for (const [pageId, count] of Object.entries(signals)) {
      if ((lastConsumedRef.current[pageId] ?? 0) >= count) continue
      lastConsumedRef.current[pageId] = count
      const tree = host.getInstance()
      const node = tree?.findKey(pageId)
      if (node) {
        const startEdit = (
          node as unknown as { startEditTitle?: () => void }
        ).startEditTitle
        startEdit?.call(node)
      }
    }
  }, [signals, hostRef])
  return null
}

function buildMoveTargets(pages: Page[]): MoveTarget[] {
  return [...pages]
    .sort((a, b) => a.position - b.position)
    .map((page) => ({
      id: page.id,
      label: `${page.title || UI_TEXT.untitledPage} (${pageTypeLabel(page.pageType)})`
    }))
}
