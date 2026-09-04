import type { PageType } from '@rtwiki/shared/contracts/pages'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { UI_TEXT } from '../../config/index.js'
import type { MoveTarget } from './page-tree.js'
import classes from './page-tree.module.css'

export type TreeContextMenuState =
  | { kind: 'root'; x: number; y: number }
  | { kind: 'page'; pageId: string; x: number; y: number }

interface TreeContextMenuProps {
  menu: TreeContextMenuState | null
  moveTargets: MoveTarget[]
  onAction: (action: string) => void
  onDismiss: () => void
}

const ROOT_ACTIONS = [
  ['rootRich', UI_TEXT.newRichPage],
  ['rootHtml', UI_TEXT.newHtmlRootPage],
  ['rootDiagram', UI_TEXT.createDiagramPage],
  ['rootMindMap', UI_TEXT.createMindMapPage]
] as const

const PAGE_ACTIONS = [
  ['open', UI_TEXT.openAction],
  ['childRich', UI_TEXT.newChildRichPage],
  ['childHtml', UI_TEXT.newChildHtmlPage],
  ['childDiagram', UI_TEXT.newDiagramPage],
  ['childMindMap', UI_TEXT.newMindMapPage],
  ['rename', UI_TEXT.renameAction],
  ['duplicate', UI_TEXT.duplicateAction],
  ['delete', UI_TEXT.deleteAction]
] as const

/**
 * RTWiki's portalled tree context menu. Rendered into document.body with a
 * fixed position and the shared overlay z-index, so it always paints above
 * the rail, editor, toolbars, tabs, and right sidebar while being clamped
 * into the viewport. Dismisses on Escape, outside pointer-down, and action
 * completion.
 */
export function TreeContextMenu({
  menu,
  moveTargets,
  onAction,
  onDismiss
}: TreeContextMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (menu === null) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = menuRef.current
      if (el && !el.contains(event.target as Node)) onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menu, onDismiss])

  if (menu === null) return null

  const clampX = Math.min(menu.x, (window.innerWidth ?? 1024) - 230)
  const clampY = Math.min(menu.y, (window.innerHeight ?? 768) - 240)

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-testid="tree-context-menu"
      className={classes.contextMenu}
      style={{ left: clampX, top: clampY }}
    >
      {menu.kind === 'root' ? (
        ROOT_ACTIONS.map(([action, label]) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            className={classes.contextMenuItem}
            data-testid={
              action === 'rootDiagram'
                ? 'tree-new-root-diagram'
                : action === 'rootMindMap'
                  ? 'tree-new-root-mindmap'
                  : undefined
            }
            onClick={() => onAction(action)}
          >
            {label}
          </button>
        ))
      ) : (
        <>
          {PAGE_ACTIONS.map(([action, label]) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              className={
                action === 'delete'
                  ? `${classes.contextMenuItem} ${classes.contextMenuDanger}`
                  : classes.contextMenuItem
              }
              onClick={() => onAction(action)}
            >
              {label}
            </button>
          ))}
          <div className={classes.contextMenuDivider} />
          <button
            type="button"
            role="menuitem"
            className={classes.contextMenuItem}
            onClick={() => onAction('moveUp')}
          >
            {UI_TEXT.moveUpLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            className={classes.contextMenuItem}
            onClick={() => onAction('moveDown')}
          >
            {UI_TEXT.moveDownLabel}
          </button>
          <div className={classes.contextMenuDivider} />
          <div className={classes.menuScroll}>
            {moveTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                role="menuitem"
                className={classes.contextMenuItem}
                onClick={() => onAction(`moveTo:${target.id}`)}
              >
                {UI_TEXT.moveToParentLabel}: {target.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

/** Type guard for the composed moveTo:<pageId> action payloads. */
export function isMoveToAction(action: string): action is `moveTo:${string}` {
  return action.startsWith('moveTo:')
}

export function pageTypeOf(action: string): PageType | null {
  if (action === 'rootRich' || action === 'childRich') return 'rich'
  if (action === 'rootHtml' || action === 'childHtml') return 'html'
  if (action === 'rootDiagram' || action === 'childDiagram') return 'diagram'
  if (action === 'rootMindMap' || action === 'childMindMap') return 'mindmap'
  return null
}
