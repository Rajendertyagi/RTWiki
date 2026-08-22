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
