import { UNSUPPORTED_BLOCK_MARKER } from '@rtwiki/shared/constants'

/**
 * Structural validation for canonical Rich Note content (BlockNote JSON).
 *
 * This module is deliberately dependency-free at runtime: it imports only a
 * shared constant, never `@blocknote/core`, React, or any browser API. BlockNote
 * 0.57.0's structural helpers (`plainContentToString`, `isLinkInlineContent`,
 * `isStyledTextInlineContent`) live in `@blocknote/core`, whose entry point pulls
 * in Tiptap/ProseMirror and DOM code, so they cannot be used on the server. The
 * rules below mirror the shapes in `@blocknote/core`'s `BlockFromConfig`,
 * `PartialBlock`, `InlineContent` and `TableContent` type declarations instead.
 *
 * Validation is structural, not schema-based: unknown block and inline types
 * are accepted. That is required for forward compatibility — the client's
 * `containUnknownBlocks()` rewrites a block it does not know into a `codeBlock`
 * whose string content starts with `UNSUPPORTED_BLOCK_MARKER`, and that
 * preserved block must survive every autosave round-trip.
 */

export type RichContentValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Bound on block nesting. A top-level block is depth 1. The client's
 * containment walk uses a smaller cap (16) and preserves anything deeper as
 * opaque JSON; this validator is stricter so a pathological document cannot
 * make the server recurse without end.
 */
export const MAX_RICH_BLOCK_DEPTH = 64

const TABLE_CONTENT_TYPE = 'tableContent'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(error: string): RichContentValidationResult {
  return { ok: false, error }
}

/** True when a code block's text is a preserved unknown-block payload. */
export function isPreservedUnknownBlockContent(content: string): boolean {
  return content.startsWith(UNSUPPORTED_BLOCK_MARKER)
}

interface WalkState {
  /** Objects on the current recursion path, for cycle detection. */
  readonly active: Set<object>
}

/**
 * Inline content: `text` (`{ type, text, styles }`), `link`
 * (`{ type, href, content: [...] }`), or a custom inline such as `math`
 * (`{ type, props?, content: string | [...] }`). `props` and `styles` are
 * optional because real documents omit them (e.g. a bare text node, or the
 * math inline written by `@blocknote/math-block`).
 */
function validateInlineContent(
  value: unknown,
  state: WalkState,
  depth: number,
  path: string
): RichContentValidationResult {
  if (depth > MAX_RICH_BLOCK_DEPTH) {
    return fail(`Rich Note content is nested too deeply (maximum ${MAX_RICH_BLOCK_DEPTH} levels).`)
  }
  if (!isRecord(value)) {
    return fail(`${path} must be an inline content object.`)
  }
  if (state.active.has(value)) {
    return fail(`${path} contains a cyclic reference.`)
  }
  if (typeof value.type !== 'string' || value.type.length === 0) {
    return fail(`${path} has a missing or invalid inline content type.`)
  }

  state.active.add(value)
  try {
    if ('text' in value && typeof value.text !== 'string') {
      return fail(`${path} has a non-string text value.`)
    }
    if ('styles' in value && value.styles !== undefined && !isRecord(value.styles)) {
      return fail(`${path} has invalid styles (expected an object).`)
    }
    if ('props' in value && value.props !== undefined && !isRecord(value.props)) {
      return fail(`${path} has invalid props (expected an object).`)
    }
    if ('href' in value && typeof value.href !== 'string') {
      return fail(`${path} has a non-string href.`)
    }
    if ('content' in value && value.content !== undefined && value.content !== null) {
      const nested = value.content
      if (typeof nested === 'string') {
        // Plain inline content (e.g. a math inline's LaTeX source).
      } else if (Array.isArray(nested)) {
        for (let index = 0; index < nested.length; index += 1) {
          const result = validateInlineContent(
            nested[index],
            state,
            depth + 1,
            `${path}.content[${index}]`
          )
          if (!result.ok) return result
        }
      } else {
        return fail(`${path} has invalid inline content (expected a string or an array).`)
      }
    }
    return { ok: true }
  } finally {
    state.active.delete(value)
  }
}

/** Nesting site 2: a table's `content.rows[].cells[].content`. */
function validateTableContent(
  value: Record<string, unknown>,
  state: WalkState,
  depth: number,
  path: string
): RichContentValidationResult {
  if (!Array.isArray(value.rows)) {
    return fail(`${path} has invalid table content (expected a rows array).`)
  }
  for (let rowIndex = 0; rowIndex < value.rows.length; rowIndex += 1) {
    const row = value.rows[rowIndex]
    if (!isRecord(row)) {
      return fail(`${path}.rows[${rowIndex}] must be an object.`)
    }
    if (!Array.isArray(row.cells)) {
      return fail(`${path}.rows[${rowIndex}] has invalid cells (expected an array).`)
    }
    for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
      const cell = row.cells[cellIndex]
      // A cell is either a bare inline-content array or a `tableCell` wrapper.
      const items = Array.isArray(cell) ? cell : isRecord(cell) ? cell.content : undefined
      if (typeof items === 'string') continue
      if (!Array.isArray(items)) {
        return fail(
          `${path}.rows[${rowIndex}].cells[${cellIndex}] has invalid content (expected an array).`
        )
      }
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const result = validateInlineContent(
          items[itemIndex],
          state,
          depth + 1,
          `${path}.rows[${rowIndex}].cells[${cellIndex}].content[${itemIndex}]`
        )
        if (!result.ok) return result
      }
    }
  }
  return { ok: true }
}

/**
 * A block: `{ id?, type, props?, content?, children? }`. `id` is optional
 * because template-generated documents omit it. `content` may be an array of
 * inline content, a `tableContent` object, or a plain string — BlockNote's
 * `PartialPlainContent` explicitly allows the bare-string form, and real
 * documents use it for diagram source, math source and even short paragraphs.
 */
function validateBlock(
  value: unknown,
  state: WalkState,
  depth: number,
  path: string
): RichContentValidationResult {
  if (depth > MAX_RICH_BLOCK_DEPTH) {
    return fail(`Rich Note content is nested too deeply (maximum ${MAX_RICH_BLOCK_DEPTH} levels).`)
  }
  if (!isRecord(value)) {
    return fail(`${path} must be a block object.`)
  }
  if (state.active.has(value)) {
    return fail(`${path} contains a cyclic reference.`)
  }
  if (typeof value.type !== 'string' || value.type.length === 0) {
    return fail(`${path} has a missing or invalid block type.`)
  }

  state.active.add(value)
  try {
    if ('id' in value && value.id !== undefined && typeof value.id !== 'string') {
      return fail(`${path} has a non-string id.`)
    }
    if ('props' in value && value.props !== undefined && !isRecord(value.props)) {
      return fail(`${path} has invalid props (expected an object).`)
    }

    // Nesting site 1: nested blocks.
    if ('children' in value && value.children !== undefined && value.children !== null) {
      if (!Array.isArray(value.children)) {
        return fail(`${path} has invalid children (expected an array).`)
      }
      for (let index = 0; index < value.children.length; index += 1) {
        const result = validateBlock(
          value.children[index],
          state,
          depth + 1,
          `${path}.children[${index}]`
        )
        if (!result.ok) return result
      }
    }

    if ('content' in value && value.content !== undefined && value.content !== null) {
      const content = value.content
      if (typeof content === 'string') {
        // Plain content sugar (diagram/math source) and preserved unknown
        // blocks (text starting with UNSUPPORTED_BLOCK_MARKER) are both opaque
        // strings. Accepting them is what keeps forward compatibility intact;
        // `isPreservedUnknownBlockContent` lets callers tell them apart.
      } else if (Array.isArray(content)) {
        for (let index = 0; index < content.length; index += 1) {
          const result = validateInlineContent(
            content[index],
            state,
            depth + 1,
            `${path}.content[${index}]`
          )
          if (!result.ok) return result
        }
      } else if (isRecord(content)) {
        if (content.type !== TABLE_CONTENT_TYPE) {
          return fail(
            `${path} has invalid content (expected an array, a string, or table content).`
          )
        }
        const result = validateTableContent(content, state, depth + 1, `${path}.content`)
        if (!result.ok) return result
      } else {
        return fail(`${path} has invalid content (expected an array, a string, or table content).`)
      }
    }
    return { ok: true }
  } finally {
    state.active.delete(value)
  }
}

/** Validates an already-parsed value as a canonical Rich Note document. */
export function validateRichDocument(value: unknown): RichContentValidationResult {
  if (!Array.isArray(value)) {
    return fail('Rich Note content must be an array of blocks.')
  }
  const state: WalkState = { active: new Set() }
  for (let index = 0; index < value.length; index += 1) {
    const result = validateBlock(value[index], state, 1, `block[${index}]`)
    if (!result.ok) return result
  }
  return { ok: true }
}

/** Parses and validates a stored or submitted Rich Note content string. */
export function parseRichContent(raw: string): RichContentValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('Rich Note content must be valid JSON.')
  }
  return validateRichDocument(parsed)
}
