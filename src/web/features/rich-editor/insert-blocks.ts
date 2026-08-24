import type { BlockNoteEditor } from '@blocknote/core'
import { UI_TEXT } from '../../config/index.js'
import type { AnyRichEditor, RTWikiPartialBlock } from './schema.js'

/**
 * Shared block-insertion definitions for the Rich Document toolbar Insert
 * menu and the slash menu. One source of truth: both surfaces render the
 * same entries with the same starter content, so inserted documents are
 * identical regardless of entry point.
 *
 * Starter content is intentionally minimal and valid; users edit from a
 * working preview rather than a blank schema shape.
 */

type AnyEditor = AnyRichEditor
type AnyPartialBlock = RTWikiPartialBlock

/** Starter Mermaid flowchart used by the Diagram insertion. */
export const DIAGRAM_STARTER = 'graph TD\n    A[Start] --> B[End]'

/** Starter Mermaid mind map used by the Mind Map insertion. */
export const MINDMAP_STARTER = 'mindmap\n  root((Main topic))\n    Topic A\n    Topic B'

/** Starter LaTeX formula used by the Formula insertion. */
export const FORMULA_STARTER = 'x^2 + y^2 = z^2'

/**
 * Inserts a partial block at the cursor: an empty paragraph in place is
 * replaced; otherwise the new block is added after the current one.
 * Shared by every insertion entry point so behaviour never diverges.
 */
function insertOrReplace(editor: AnyEditor, block: AnyPartialBlock): void {
  const current = editor.getTextCursorPosition().block
  const isEmptyParagraph =
    current.type === 'paragraph' && JSON.stringify(current.content) === JSON.stringify('')
  if (isEmptyParagraph) {
    editor.updateBlock(current, block as never)
  } else {
    editor.insertBlocks([block], current, 'after')
  }
}

export interface InsertEntry {
  /** Stable machine token (also used as the debug-log code field). */
  key: string
  label: string
  /** Tabler icon component for menu rendering. */
  icon:
    | 'formula'
    | 'diagram'
    | 'mindMap'
    | 'table'
    | 'code'
    | 'quote'
    | 'calloutInfo'
    | 'calloutNote'
    | 'calloutTip'
    | 'calloutWarning'
    | 'calloutDanger'
  group: 'visual' | 'callout'
  insert: (editor: AnyEditor) => void
}

function formulaEntry(): InsertEntry {
  return {
    key: 'insert-formula',
    label: UI_TEXT.formulaLabel,
    icon: 'formula',
    group: 'visual',
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'mathBlock',
        content: FORMULA_STARTER
      } as never)
  }
}

export function diagramEntry(starter: string): InsertEntry {
  return {
    key: 'insert-diagram',
    label: UI_TEXT.diagramLabel,
    icon: 'diagram',
    group: 'visual',
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'diagram',
        content: starter
      } as never)
  }
}

export function mindMapEntry(starter: string): InsertEntry {
  return {
    key: 'insert-mind-map',
    label: UI_TEXT.mindMapLabel,
    icon: 'mindMap',
    group: 'visual',
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'mindMap',
        content: starter
      } as never)
  }
}

const CALLOUT_VARIANT_ENTRIES: Array<{
  variant: 'info' | 'note' | 'tip' | 'warning' | 'danger'
  label: string
  icon: InsertEntry['icon']
}> = [
  { variant: 'info', label: UI_TEXT.calloutInfoLabel, icon: 'calloutInfo' },
  { variant: 'note', label: UI_TEXT.calloutNoteLabel, icon: 'calloutNote' },
  { variant: 'tip', label: UI_TEXT.calloutTipLabel, icon: 'calloutTip' },
  { variant: 'warning', label: UI_TEXT.calloutWarningLabel, icon: 'calloutWarning' },
  { variant: 'danger', label: UI_TEXT.calloutDangerLabel, icon: 'calloutDanger' }
]

function calloutEntries(): InsertEntry[] {
  return CALLOUT_VARIANT_ENTRIES.map(({ variant, label, icon }) => ({
    key: `insert-callout-${variant}`,
    label,
    icon,
    group: 'callout' as const,
    insert: (editor) =>
      insertOrReplace(editor, {
        type: 'callout',
        props: { variant },
        content: [{ type: 'text', text: '', styles: {} }]
      } as never)
  }))
}

/** Entries that exist regardless of optional blocks (always-available). */
function baseEntries(editor: AnyEditor): InsertEntry[] {
  const entries: InsertEntry[] = [formulaEntry()]
  // Diagram/mind-map entries join when their blocks are in the schema.
  if ('diagram' in editor.schema.blockSchema) {
    entries.push(diagramEntry(DIAGRAM_STARTER))
  }
  if ('mindMap' in editor.schema.blockSchema) {
    entries.push(mindMapEntry(MINDMAP_STARTER))
  }
  if ('callout' in editor.schema.blockSchema) {
    entries.push(...calloutEntries())
  }
  return entries
}

/**
 * All Insert-menu entries for the given editor, including the existing
 * table/code/quote conversions where appropriate.
 */
export function getInsertEntries(editor: AnyEditor): InsertEntry[] {
  return [
    ...baseEntries(editor),
    {
      key: 'insert-table',
      label: UI_TEXT.tableLabel,
      icon: 'table',
      group: 'visual',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        const table = {
          type: 'table',
          content: {
            type: 'tableContent',
            rows: [{ cells: ['', '', ''] }, { cells: ['', '', ''] }]
          }
        } as never
        if (
          current.type === 'paragraph' &&
          JSON.stringify(current.content) === JSON.stringify('')
        ) {
          ed.updateBlock(current, table)
        } else {
          ed.insertBlocks([table], current, 'after')
        }
      }
    },
    {
      key: 'insert-code-block',
      label: UI_TEXT.codeBlockLabel,
      icon: 'code',
      group: 'visual',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        if (
          current.type === 'paragraph' &&
          JSON.stringify(current.content) === JSON.stringify('')
        ) {
          ed.updateBlock(current, { type: 'codeBlock' } as never)
        } else {
          ed.insertBlocks([{ type: 'codeBlock' } as never], current, 'after')
        }
      }
    },
    {
      key: 'insert-quote',
      label: UI_TEXT.quoteLabel,
      icon: 'quote',
      group: 'visual',
      insert: (ed) => {
        const current = ed.getTextCursorPosition().block
        ed.updateBlock(current, { type: 'quote' } as never)
      }
    }
  ]
}

/** Runs an entry's insertion and returns focus to the editor. */
export function runInsertEntry(editor: AnyEditor, entry: InsertEntry): void {
  entry.insert(editor)
  editor.focus()
}
