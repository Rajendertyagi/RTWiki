import { type BlockNoteEditor, BlockNoteSchema, type PartialBlock } from '@blocknote/core'
import { createReactInlineMathSpec, createReactMathBlockSpec } from '@blocknote/math-block'
import { createReactCalloutSpec } from './blocks/callout.js'

/**
 * The RTWiki Rich Document schema: BlockNote's default blocks plus the
 * visual knowledge blocks.
 *
 * - `mathBlock` / inline `math`: the official @blocknote/math-block 0.54
 *   integration. LaTeX lives in the block/inline node's plain-text content,
 *   so stored documents stay canonical BlockNote JSON (ADR-004) with no
 *   custom attributes and no migration.
 * - `callout`: official custom-block API with a stored `variant` prop and
 *   editable inline rich text.
 *
 * Diagram and mind-map blocks join this schema in their own commit.
 */
export const rtwikiBlockSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    mathBlock: createReactMathBlockSpec(),
    callout: createReactCalloutSpec()
  },
  inlineContentSpecs: {
    math: createReactInlineMathSpec()
  }
})

/** Every block type the editor schema understands. */
export const KNOWN_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(rtwikiBlockSchema.blockSchema)
])

/** The concrete RTWiki rich-editor instance type shared across UI helpers. */
export type AnyRichEditor = BlockNoteEditor<
  typeof rtwikiBlockSchema.blockSchema,
  typeof rtwikiBlockSchema.inlineContentSchema,
  typeof rtwikiBlockSchema.styleSchema
>

/** Partial block shape matching the RTWiki schema (for typed inserts). */
export type RTWikiPartialBlock = PartialBlock<
  typeof rtwikiBlockSchema.blockSchema,
  typeof rtwikiBlockSchema.inlineContentSchema,
  typeof rtwikiBlockSchema.styleSchema
>
