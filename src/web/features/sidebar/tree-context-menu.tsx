import type { PageType } from '@rtwiki/shared/contracts/pages'
import { useEffect, useRef, useState } from 'react'
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
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Move-to picker view: the parent remounts this component per menu
  // invocation (key), so picker state always starts closed and empty. The
  // full page list never renders by default; targets appear only here,
  // filtered by the query.
  const [movePickerOpen, setMovePickerOpen] = useState(false)
  const [moveQuery, setMoveQuery] = useState('')

  // Move keyboard focus into the picker when it opens (replaces autoFocus,
  // which lint forbids); Escape and outside pointer-down still dismiss.
  useEffect(() => {
    if (movePickerOpen) searchRef.current?.focus()
  }, [movePickerOpen])

  // Unshifted menu top, hoisted null-safe for the flip effect below (hooks
  // run before the early return; nothing below may read menu directly).
  const baseY = menu === null ? 0 : Math.min(menu.y, (window.innerHeight ?? 768) - 240)

  // Flip the menu upward when it would run past the viewport bottom (e.g.
  // a low row with the full action list). offsetHeight is independent of
  // the current top, so this converges in one step from any prior shift
  // (reopened menu, actions/picker view switch).
  const [shiftUp, setShiftUp] = useState(0)
  // Flip re-measures when the picker view opens (it changes menu height);
  // movePickerOpen is read for change, not value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-measure trigger
  useEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const overflow = baseY + el.offsetHeight - (window.innerHeight - 8)
    const next = overflow > 0 ? Math.ceil(overflow) : 0
    setShiftUp((prev) => (prev === next ? prev : next))
  }, [movePickerOpen, baseY])

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

  // Menu is a fixed compact width (token); clamp against it with a margin.
  // shiftUp (measured post-mount) flips tall menus above the click point,
  // never above the viewport edge.
  const clampX = Math.min(menu.x, (window.innerWidth ?? 1024) - 248)
  const clampY = Math.max(8, baseY - shiftUp)

  const query = moveQuery.trim().toLowerCase()
  const filteredTargets =
    query.length === 0
      ? moveTargets
      : moveTargets.filter((target) => target.label.toLowerCase().includes(query))
  const visibleTargets = filteredTargets.slice(0, 50)

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
      ) : movePickerOpen ? (
        <>
          <input
            ref={searchRef}
            type="search"
            aria-label={UI_TEXT.searchLabel}
            placeholder={UI_TEXT.searchPlaceholder}
            value={moveQuery}
            onChange={(event) => setMoveQuery(event.currentTarget.value)}
            className={classes.movePickerSearch}
            data-testid="tree-move-picker-search"
          />
          <div className={classes.menuScroll}>
            {visibleTargets.length === 0 ? (
              <div className={classes.movePickerEmpty}>{UI_TEXT.noResults}</div>
            ) : (
              visibleTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className={classes.contextMenuItem}
                  title={target.label}
                  onClick={() => onAction(`moveTo:${target.id}`)}
                >
                  {target.label}
                </button>
              ))
            )}
          </div>
        </>
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
          <button
            type="button"
            role="menuitem"
            className={classes.contextMenuItem}
            data-testid="tree-move-to-picker"
            onClick={() => setMovePickerOpen(true)}
          >
            {UI_TEXT.moveToPickerLabel}
          </button>
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
