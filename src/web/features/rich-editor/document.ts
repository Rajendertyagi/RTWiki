import { PROVISIONAL_AUTOSAVE_DEBOUNCE_MS } from '@rtwiki/shared/constants'

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
 */
const UNKNOWN_BLOCK_MARKER = '[unsupported block preserved below]'

export function containUnknownBlocks(
  document: BlockNoteDocument,
  knownTypes: ReadonlySet<string>
): BlockNoteDocument {
  return document.map((raw) => {
    const block = raw as { type?: unknown }
    if (typeof block.type === 'string' && knownTypes.has(block.type)) {
      return raw
    }
    return {
      type: 'codeBlock',
      props: { language: 'json' },
      content: `${UNKNOWN_BLOCK_MARKER}\n${JSON.stringify(raw, null, 2)}`
    }
  })
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
