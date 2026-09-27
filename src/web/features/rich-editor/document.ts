import {
  PROVISIONAL_AUTOSAVE_DEBOUNCE_MS,
  UNSUPPORTED_BLOCK_MARKER
} from '@rtwiki/shared/constants'

export const AUTOSAVE_DEBOUNCE_MS = PROVISIONAL_AUTOSAVE_DEBOUNCE_MS

export type BlockNoteDocument = Array<Record<string, unknown>>

export interface DocumentParseResult {
  status: 'ok' | 'empty' | 'error'
  document: BlockNoteDocument | null
  originalValue: string
  errorMessage?: string
}

// Canonical empty BlockNote document: a single paragraph without inline
// content. Omitting `content` is the valid PartialBlock form for an empty
// paragraph (verified against @blocknote/core 0.54 typings and docs).
const DEFAULT_DOCUMENT: BlockNoteDocument = [
  {
    type: 'paragraph'
  }
]

export function createDefaultDocument(): BlockNoteDocument {
  return JSON.parse(JSON.stringify(DEFAULT_DOCUMENT)) as BlockNoteDocument
}

export function parseStoredDocument(storedValue: string): DocumentParseResult {
  const trimmed = storedValue.trim()

  if (!trimmed) {
    return {
      status: 'empty',
      document: createDefaultDocument(),
      originalValue: storedValue
    }
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown

    if (!Array.isArray(parsed)) {
      return {
        status: 'error',
        document: null,
        originalValue: storedValue,
        errorMessage: 'Stored content is not a valid BlockNote document (expected array).'
      }
    }

    // Validate that each block has a type
    for (const block of parsed) {
      if (
        !block ||
        typeof block !== 'object' ||
        typeof (block as Record<string, unknown>).type !== 'string'
      ) {
        return {
          status: 'error',
          document: null,
          originalValue: storedValue,
          errorMessage: 'Stored content contains invalid block structure.'
        }
      }
    }

    // Empty array is treated as empty, not error
    if (parsed.length === 0) {
      return {
        status: 'empty',
        document: createDefaultDocument(),
        originalValue: storedValue
      }
    }

    return {
      status: 'ok',
      document: parsed as BlockNoteDocument,
      originalValue: storedValue
    }
  } catch {
    return {
      status: 'error',
      document: null,
      originalValue: storedValue,
      errorMessage: 'Stored content is not valid JSON and cannot be loaded as a Rich Note.'
    }
  }
}

export function serializeDocument(document: BlockNoteDocument): string {
  return JSON.stringify(document)
}

/**
 * Containment for block types the current schema does not know (e.g.
 * documents written by a newer RTWiki with additional blocks).
 *
 * Contract: unknown blocks are NEVER dropped silently. Each one is converted
 * into a code block containing its exact JSON, prefixed with a stable marker
 * so the original data survives every autosave round-trip and can be
 * recovered by hand or by a future version that understands the type. The
 * rest of the page keeps loading — one foreign block can never crash the
 * whole document.
 *
 * The walk is recursive because an undeclared type crashes BlockNote's
 * converter wherever it sits, not only at the top level: the converter
 * dereferences `schema.nodes[block.type]` for every child and every table
 * cell item, so a foreign block inside a list item or a table cell would take
 * the whole page down. There are exactly two nesting sites in BlockNote JSON
 * and both are handled here:
 *
 * 1. `children` — list items, quotes and any other block with nested blocks.
 * 2. `content.rows[].cells[].content` — a table's `children` is `[]`; its
 *    cells live inside the `tableContent` object, not under `children`.
 *
 * Inline content (the `content` of a paragraph or of a cell) is never treated
 * as a block; see `isInlineContentItem` for why cell prose must survive.
 */
const UNKNOWN_BLOCK_MARKER = UNSUPPORTED_BLOCK_MARKER

/**
 * How deep the containment walk descends; a top-level block is depth 1.
 *
 * The page body arrives over the network and rich content is unvalidated
 * server-side, so the walk is bounded instead of trusting the input to be
 * shallow. At the cap the block is contained whole: it is replaced by a
 * preservation code block whose payload is that block's entire subtree, so
 * everything below the cap is still recoverable verbatim, the walk terminates
 * for that subtree (a code block has no children), and nothing is dropped.
 */
export const MAX_CONTAINMENT_DEPTH = 16

/**
 * Inline content type names BlockNote routes away from the block converter,
 * so they never need protection from containment.
 */
const BUILTIN_INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set(['text', 'link', 'hardBreak'])

/** The code block emitted in place of a block the schema does not know. */
function preservedCodeBlock(raw: unknown): Record<string, unknown> {
  return {
    type: 'codeBlock',
    props: { language: 'json' },
    content: `${UNKNOWN_BLOCK_MARKER}\n${JSON.stringify(raw, null, 2)}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * True when a table-cell item is inline content rather than a block.
 *
 * A table cell legitimately holds inline content only, so the walk must not
 * rewrite cell prose: `text`, `link`, `hardBreak` and any custom inline spec
 * (RTWiki's `math`) all take this path. An item counts as inline when its type
 * is a known inline type or when it carries an inline payload — a `text`
 * string, an `href`, or plain-string `content`. That second clause is
 * deliberately biased towards leaving content alone: a cell is inline content
 * in every shape BlockNote writes, so a cell item that merely looks like
 * inline content is left untouched even if its type is unknown. Rewriting real
 * text would be worse than preserving a future inline type verbatim.
 */
function isInlineContentItem(
  item: Record<string, unknown>,
  knownInlineTypes: ReadonlySet<string>
): boolean {
  const type = item.type
  if (typeof type === 'string' && knownInlineTypes.has(type)) return true
  if (typeof item.text === 'string') return true
  if (typeof item.href === 'string') return true
  return typeof item.content === 'string'
}

interface ContainmentWalk {
  readonly knownTypes: ReadonlySet<string>
  readonly knownInlineTypes: ReadonlySet<string>
}

/** A value plus whether it was rewritten, so untouched subtrees keep identity. */
interface Rewritten<T> {
  readonly value: T
  readonly changed: boolean
}

function unchanged<T>(value: T): Rewritten<T> {
  return { value, changed: false }
}

/** Nesting site 2: contained unknown-typed items in one cell's content. */
function containCellItems(items: unknown, walk: ContainmentWalk): Rewritten<unknown> {
  if (!Array.isArray(items)) return unchanged(items)
  let changed = false
  const next = items.map((item) => {
    if (!isRecord(item)) return item
    const type = item.type
    if (typeof type !== 'string') return item
    if (walk.knownTypes.has(type) || isInlineContentItem(item, walk.knownInlineTypes)) {
      return item
    }
    changed = true
    return preservedCodeBlock(item)
  })
  return changed ? { value: next, changed: true } : unchanged(items)
}

/** A cell is either a `tableCell` wrapper or a bare inline-content array. */
function containCell(cell: unknown, walk: ContainmentWalk): Rewritten<unknown> {
  if (Array.isArray(cell)) return containCellItems(cell, walk)
  if (!isRecord(cell)) return unchanged(cell)
  const content = containCellItems(cell.content, walk)
  if (!content.changed) return unchanged(cell)
  return { value: { ...cell, content: content.value }, changed: true }
}

function containRow(row: unknown, walk: ContainmentWalk): Rewritten<unknown> {
  if (!isRecord(row) || !Array.isArray(row.cells)) return unchanged(row)
  const cells: unknown[] = row.cells
  const next = cells.map((cell) => containCell(cell, walk).value)
  const changed = next.some((cell, index) => cell !== cells[index])
  return changed ? { value: { ...row, cells: next }, changed: true } : unchanged(row)
}

/** Nesting site 2 entry: the `tableContent` object of a `table` block. */
function containTableContent(content: unknown, walk: ContainmentWalk): Rewritten<unknown> {
  if (!isRecord(content) || content.type !== 'tableContent') return unchanged(content)
  if (!Array.isArray(content.rows)) return unchanged(content)
  const rows = content.rows
  const next = rows.map((row) => containRow(row, walk).value)
  const changed = next.some((row, index) => row !== rows[index])
  return changed ? { value: { ...content, rows: next }, changed: true } : unchanged(content)
}

/** Nesting site 1: nested blocks, recursing one level deeper each time. */
function containChildren(
  children: unknown,
  walk: ContainmentWalk,
  depth: number
): Rewritten<unknown> {
  if (!Array.isArray(children)) return unchanged(children)
  const next = children.map((child) => containBlock(child, walk, depth).value)
  const changed = next.some((child, index) => child !== children[index])
  return changed ? { value: next, changed: true } : unchanged(children)
}

function containBlock(raw: unknown, walk: ContainmentWalk, depth: number): Rewritten<unknown> {
  if (!isRecord(raw)) return { value: preservedCodeBlock(raw), changed: true }
  const type = raw.type
  if (typeof type !== 'string' || !walk.knownTypes.has(type)) {
    return { value: preservedCodeBlock(raw), changed: true }
  }
  // Depth guard: contain the whole subtree instead of descending past the cap.
  if (depth >= MAX_CONTAINMENT_DEPTH) {
    return { value: preservedCodeBlock(raw), changed: true }
  }
  const children = containChildren(raw.children, walk, depth + 1)
  const table = containTableContent(raw.content, walk)
  if (!children.changed && !table.changed) return unchanged(raw)
  return {
    value: {
      ...raw,
      ...(children.changed ? { children: children.value } : {}),
      ...(table.changed ? { content: table.value } : {})
    },
    changed: true
  }
}

export function containUnknownBlocks(
  document: BlockNoteDocument,
  knownTypes: ReadonlySet<string>,
  knownInlineTypes: ReadonlySet<string> = BUILTIN_INLINE_CONTENT_TYPES
): BlockNoteDocument {
  const walk: ContainmentWalk = { knownTypes, knownInlineTypes }
  return document.map((raw) => containBlock(raw, walk, 1).value as Record<string, unknown>)
}

/** True when the block content is the preservation marker code block. */
export function isUnknownBlockPreserved(content: string): boolean {
  return content.startsWith(UNKNOWN_BLOCK_MARKER)
}

export interface DocumentOutlineEntry {
  blockId: string
  level: number
  text: string
}

interface OutlineBlock {
  id?: string
  type?: string
  props?: { level?: number }
  content?: Array<{ text?: string }>
}

/**
 * Derives a heading outline from a canonical BlockNote document. Pure and
 * total: malformed or empty documents yield an empty outline.
 */
export function extractOutline(document: BlockNoteDocument): DocumentOutlineEntry[] {
  const entries: DocumentOutlineEntry[] = []
  for (const raw of document) {
    const block = raw as OutlineBlock
    if (block.type !== 'heading' || !block.id) continue
    const level = typeof block.props?.level === 'number' ? block.props.level : 1
    const text = (block.content ?? [])
      .map((inline) => (typeof inline.text === 'string' ? inline.text : ''))
      .join('')
      .trim()
    entries.push({ blockId: block.id, level, text })
  }
  return entries
}
