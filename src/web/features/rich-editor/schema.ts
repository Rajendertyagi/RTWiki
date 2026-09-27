import { type BlockNoteEditor, BlockNoteSchema, type PartialBlock } from '@blocknote/core'
import { createReactInlineMathSpec, createReactMathBlockSpec } from '@blocknote/math-block'
import { createReactCalloutSpec } from './blocks/callout.js'
import { createReactDiagramSpec } from './blocks/diagram.js'
import { createReactDocumentSpec } from './blocks/document-block.js'
import { createReactLinkedPageSpec } from './blocks/linked-page-block.js'
import { createReactMindMapSpec } from './blocks/mindmap.js'

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
 * - `documentBlock`: an attached document, with three ways to open it — view the
 *   text RTWiki extracted, view the file in a tab, or download it. It exists
 *   because BlockNote's built-in `file` block renders the name in a `div` rather
 *   than an anchor, so an attached document was not clickable at all. See ADR-016
 *   for why the view route is separate and what it costs.
 *
 * Diagram, mind-map and linked-page blocks join this schema in their own
 * commits.
 */
export const rtwikiBlockSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    mathBlock: createReactMathBlockSpec(),
    callout: createReactCalloutSpec(),
    diagram: createReactDiagramSpec(),
    mindMap: createReactMindMapSpec(),
    linkedPage: createReactLinkedPageSpec(),
    documentBlock: createReactDocumentSpec()
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
