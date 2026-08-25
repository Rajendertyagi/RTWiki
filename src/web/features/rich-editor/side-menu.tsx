import { SideMenuExtension } from '@blocknote/core/extensions'
import {
  AddBlockButton,
  DragHandleButton,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  useComponentsContext,
  useExtensionState
} from '@blocknote/react'
import type { JSX } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { canMoveBlock, moveBlock } from './move-blocks.js'
import type { AnyRichEditor } from './schema.js'

/**
 * Custom block side menu (drag handle gutter control).
 *
 * The default BlockNote side menu is replaced so the drag-handle action menu
 * carries explicit keyboard-accessible Move up / Move down actions next to
 * Delete. Movement uses BlockNote's supported manipulation APIs (see
 * move-blocks.ts) — never manual document JSON rewrites.
 *
 * Stacking: the controller portals into the editor container, which sits
 * inside AppShell.Main. A collision-shifted menu near the document's left
 * edge can extend over the sidebar's visual area, and the shell navbar paints
 * above Main by default — so every floating layer here is raised with the
 * shared overlay z-index token and collision-aware flip/shift middleware.
 */

function useHoveredBlock(editor: AnyRichEditor): { id: string } | undefined {
  return useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block as { id: string } | undefined
  })
}

function MoveItem({
  editor,
  direction,
  children
}: {
  editor: AnyRichEditor
  direction: 'up' | 'down'
  children: string
}): JSX.Element | null {
  const components = useComponentsContext()
  const block = useHoveredBlock(editor)
  if (!components || !block) return null

  // Boundary rule: first block cannot move up; last block cannot move down.
  const canMove = canMoveBlock(editor, block.id, direction)
  if (!canMove) return null

  const label = direction === 'up' ? UI_TEXT.moveUpLabel : UI_TEXT.moveDownLabel
  const MenuItem = components.Generic.Menu.Item
  return (
    <MenuItem
      className="bn-menu-item"
      aria-label={label}
      data-testid={`move-${direction}`}
      onClick={() => {
        moveBlock(editor, block.id, direction)
      }}
    >
      {children}
    </MenuItem>
  )
}

export function RTSideMenu({ editor }: { editor: AnyRichEditor }): JSX.Element {
  return (
    <SideMenuController
      floatingUIOptions={{
        elementProps: { style: { zIndex: LAYOUT.overlayZIndex } }
      }}
      sideMenu={(props) => (
        <SideMenu {...props}>
          <DragHandleButton
            dragHandleMenu={(menuProps) => (
              <DragHandleMenu {...menuProps}>
                <MoveItem editor={editor} direction="up">
                  {UI_TEXT.moveUpLabel}
                </MoveItem>
                <MoveItem editor={editor} direction="down">
                  {UI_TEXT.moveDownLabel}
                </MoveItem>
                <RemoveBlockItem>{UI_TEXT.removeBlockLabel}</RemoveBlockItem>
              </DragHandleMenu>
            )}
          />
          <AddBlockButton />
        </SideMenu>
      )}
    />
  )
}
