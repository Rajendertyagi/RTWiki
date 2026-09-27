import { z } from 'zod'
import { DIAGRAM_STARTER_SOURCE, MINDMAP_STARTER_SOURCE } from '../constants/index.js'

/**
 * Canonical stored content for the dedicated Diagram and Mind Map page types.
 *
 * The Mermaid source is deliberately opaque page JSON — never parsed as BlockNote
 * blocks, never indexed verbatim, never rendered into dashboard previews. The
 * database column is unconstrained TEXT, so **no database migration is required**
 * to change this format: a new version is a new shape of the same column.
 *
 * ## Two versions coexist
 *
 * v1 holds a single `source` string. v2 holds an ordered list of blocks, so a
 * page can carry several diagrams and the reader can reorder them. A v1 page is
 * not rewritten on read: it simply *reads as* a one-block page, and becomes v2
 * the first time it is saved. That is why no data migration exists and why an
 * old page and a new page can sit in the same database.
 *
 * Both readers normalise to the same block list, so no caller has to branch on
 * the version.
 */

export const VISUAL_PAGE_TYPES = ['diagram', 'mindmap'] as const

export type VisualPageType = (typeof VISUAL_PAGE_TYPES)[number]

/**
 * Upper bound on blocks per page.
 *
 * A diagram page is a small set of related pictures, not a document. The cap
 * bounds the autosave payload, the re-render cost of the live previews, and the
 * work a reorder has to do. 50 is well above any real use.
 */
export const MAX_VISUAL_PAGE_BLOCKS = 50

/** Per-block source ceiling, matching the v1 limit it replaces. */
const MAX_VISUAL_SOURCE_LENGTH = 100_000

/** One diagram or mind map on a page. */
export const VisualPageBlockSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().max(MAX_VISUAL_SOURCE_LENGTH)
})

export type VisualPageBlock = z.infer<typeof VisualPageBlockSchema>

/** v2: an ordered list of blocks. */
export const VisualPageContentV2Schema = z.object({
  version: z.literal(2),
  type: z.enum(VISUAL_PAGE_TYPES),
  blocks: z.array(VisualPageBlockSchema).min(1).max(MAX_VISUAL_PAGE_BLOCKS)
})

/**
 * v1: a single source string. Retained so an existing page still parses; nothing
 * writes this version any more.
 */
const VisualPageContentV1Schema = z.object({
  version: z.literal(1),
  type: z.enum(VISUAL_PAGE_TYPES),
  source: z.string().max(MAX_VISUAL_SOURCE_LENGTH)
})

/** @deprecated Use {@link VisualPageContentV2Schema}; kept only for reading v1 pages. */
export const VisualPageContentSchema = VisualPageContentV1Schema

/** @deprecated Use {@link VisualPageBlock}; kept only for reading v1 pages. */
export type VisualPageContent = z.infer<typeof VisualPageContentV1Schema>

/**
 * The id given to the single block a v1 page reads as.
 *
 * Stable and readable rather than random: it is never persisted (a v1 page has
 * no block ids to persist), and the first save replaces it with a real id.
 */
const LEGACY_SINGLE_BLOCK_ID = 'main'

export function serializeVisualPageContent(content: VisualPageContent): string {
  return JSON.stringify(content)
}

/** The normalised shape every caller works with, whichever version was stored. */
export interface NormalisedVisualPage {
  type: VisualPageType
  blocks: VisualPageBlock[]
}

export type ParseVisualPageResult =
  | { ok: true; value: NormalisedVisualPage }
  | { ok: false; error: string }

/**
 * Parses stored visual-page content into blocks, accepting both versions.
 *
 * Total: malformed or foreign content yields a contained error rather than a
 * throw, so a corrupt page shows a message instead of taking the workspace down.
 */
export function parseVisualPageContent(stored: string): ParseVisualPageResult {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { ok: false, error: 'Stored content is empty.' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Stored content is not a valid visual page document.' }
  }
  const asV2 = VisualPageContentV2Schema.safeParse(raw)
  if (asV2.success) {
    return { ok: true, value: { type: asV2.data.type, blocks: asV2.data.blocks } }
  }
  const asV1 = VisualPageContentV1Schema.safeParse(raw)
  if (asV1.success) {
    return {
      ok: true,
      value: {
        type: asV1.data.type,
        blocks: [{ id: LEGACY_SINGLE_BLOCK_ID, source: asV1.data.source }]
      }
    }
  }
  return { ok: false, error: 'Stored content is not a valid visual page document.' }
}

/** Serialises a block list as v2. This is the only version written from now on. */
export function serializeVisualPageBlocks(
  type: VisualPageType,
  blocks: readonly VisualPageBlock[]
): string {
  return JSON.stringify({
    version: 2,
    type,
    blocks: blocks.slice(0, MAX_VISUAL_PAGE_BLOCKS)
  })
}

/** Starter content used when a dedicated Diagram / Mind Map page is created. */
export function createStarterVisualContent(pageType: VisualPageType): string {
  return serializeVisualPageBlocks(pageType, [
    {
      id: LEGACY_SINGLE_BLOCK_ID,
      source: pageType === 'diagram' ? DIAGRAM_STARTER_SOURCE : MINDMAP_STARTER_SOURCE
    }
  ])
}
