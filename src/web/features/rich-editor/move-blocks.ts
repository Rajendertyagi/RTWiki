import type { AnyRichEditor } from './schema.js'

/**
 * Block rearrangement through BlockNote's supported manipulation APIs.
 *
 * A move is performed as remove-then-insert so a block id never exists twice
 * in the document mid-operation (insert-first would transiently duplicate the
 * ProseMirror node id). The inserted copy carries the original id and full
 * content, so moving never alters block identity or payload, and the change
 * flows through the ordinary editor.onChange -> autosave pipeline.
 */

interface SiblingLocation {
  siblings: Array<{ id: string }>
  index: number
}

/** Finds the sibling array containing `blockId` at any nesting depth. */
function findSiblings(
  blocks: Array<{ id?: string; children?: unknown[] }>,
  blockId: string
): SiblingLocation | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.id === blockId) {
      return { siblings: blocks as Array<{ id: string }>, index }
    }
    if (Array.isArray(block.children) && block.children.length > 0) {
      const nested = findSiblings(
        block.children as Array<{ id?: string; children?: unknown[] }>,
        blockId
      )
      if (nested !== null) return nested
    }
  }
  return null
}

export type MoveDirection = 'up' | 'down'

/** True when the block exists among its siblings and is not at the boundary. */
export function canMoveBlock(
  editor: AnyRichEditor,
  blockId: string,
  direction: MoveDirection
): boolean {
  const location = findSiblings(editor.document as never, blockId)
  if (location === null) return false
  const { siblings, index } = location
  if (direction === 'up') return index > 0
  return index < siblings.length - 1
}

/**
 * Moves a block one position among its siblings. Returns false when the
 * block cannot move (unknown id, first block moving up, last block moving
 * down). Focus is returned to the moved block.
 */
export function moveBlock(
  editor: AnyRichEditor,
  blockId: string,
  direction: MoveDirection
): boolean {
  const location = findSiblings(editor.document as never, blockId)
  if (location === null) return false
  const { siblings, index } = location
  if (direction === 'up' && index === 0) return false
  if (direction === 'down' && index === siblings.length - 1) return false

  // Snapshot before removal: the full block JSON (id + content + props).
  const snapshot = JSON.parse(JSON.stringify(siblings[index])) as never
  const referenceId = direction === 'up' ? siblings[index - 1].id : siblings[index + 1].id

  editor.removeBlocks([{ id: blockId }])
  editor.insertBlocks([snapshot], { id: referenceId }, direction === 'up' ? 'before' : 'after')

  try {
    editor.setTextCursorPosition(blockId, 'start')
    editor.focus()
  } catch {
    // The moved block may briefly be unfocusable (e.g. pure preview blocks);
    // the move itself already succeeded.
  }
  return true
}
