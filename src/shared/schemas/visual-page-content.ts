import { z } from 'zod'
import { DIAGRAM_STARTER_SOURCE } from '../constants/index.js'

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

/**
 * The dedicated visual page types RTWiki writes.
 *
 * Diagram is the only one. The Mind Map page was retired: it differed from the
 * Diagram page by one ternary and two starter strings, and Mermaid's `mindmap` is
 * an ordinary diagram type already offered from the shared template list.
 */
export const VISUAL_PAGE_TYPES = ['diagram'] as const

export type VisualPageType = (typeof VISUAL_PAGE_TYPES)[number]

/**
 * Values accepted when *reading* stored content, including retired ones.
 *
 * A stored page records its own `type` inside its JSON, independently of the
 * `pages.page_type` column that migration 010 rewrites. Narrowing the read schema
 * to {@link VISUAL_PAGE_TYPES} would therefore reject a Mind Map page's content
 * even after its row had been migrated. So the legacy value is accepted on read
 * and normalised away in {@link parseVisualPageContent}, which means the rewrite
 * needs no JSON surgery in SQL and cannot fail in a second, separate place.
 */
const LEGACY_VISUAL_PAGE_TYPES = ['mindmap'] as const

const STORED_VISUAL_PAGE_TYPES = [...VISUAL_PAGE_TYPES, ...LEGACY_VISUAL_PAGE_TYPES] as const

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
  source: z.string().max(MAX_VISUAL_SOURCE_LENGTH),
  /**
   * The block's own box, as pixel strings. Both optional, and a block that has
   * neither is laid out by the workspace rather than by a stored size.
   *
   * Optional rather than defaulted to a number, so a page written before the
   * workspace gained resizing needs no migration and no rewrite: the field is
   * simply absent, which the layout reads as "not resized". Stored as a string
   * for the same reason the rich editor stores its block dimensions as strings —
   * the value goes straight into a CSS length, and round-tripping it through a
   * number would lose units and invent precision that means nothing.
   */
  width: z.string().max(16).optional(),
  height: z.string().max(16).optional()
})

export type VisualPageBlock = z.infer<typeof VisualPageBlockSchema>

/** v2: an ordered list of blocks. */
export const VisualPageContentV2Schema = z.object({
  version: z.literal(2),
  type: z.enum(STORED_VISUAL_PAGE_TYPES),
  blocks: z.array(VisualPageBlockSchema).min(1).max(MAX_VISUAL_PAGE_BLOCKS)
})

/**
 * v1: a single source string. Retained so an existing page still parses; nothing
 * writes this version any more.
 */
const VisualPageContentV1Schema = z.object({
  version: z.literal(1),
  type: z.enum(STORED_VISUAL_PAGE_TYPES),
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
 * Maps a stored type marker onto the canonical one.
 *
 * Anything the schemas above rejected never reaches this. What is left is either
 * a canonical value or a retired one, and a retired one is reported as the page
 * type that replaced it — so a migrated Mind Map page reads as a Diagram page
 * from the first load, with no write-back needed.
 */
function toCanonicalVisualPageType(stored: string): VisualPageType {
  return VISUAL_PAGE_TYPES.find((candidate) => candidate === stored) ?? VISUAL_PAGE_TYPES[0]
}

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
    return {
      ok: true,
      value: {
        type: toCanonicalVisualPageType(asV2.data.type),
        blocks: asV2.data.blocks
      }
    }
  }
  const asV1 = VisualPageContentV1Schema.safeParse(raw)
  if (asV1.success) {
    return {
      ok: true,
      value: {
        type: toCanonicalVisualPageType(asV1.data.type),
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

/**
 * Starter content used when a dedicated Diagram page is created.
 *
 * Takes no page type: Diagram is the only visual page there is, so the starter is
 * a constant rather than a choice. A caller that reaches here with something else
 * has already failed the {@link VISUAL_PAGE_TYPES} check upstream.
 */
export function createStarterVisualContent(): string {
  return serializeVisualPageBlocks(VISUAL_PAGE_TYPES[0], [
    {
      id: LEGACY_SINGLE_BLOCK_ID,
      source: DIAGRAM_STARTER_SOURCE
    }
  ])
}
