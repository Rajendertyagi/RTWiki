import { z } from 'zod'
import { DIAGRAM_STARTER_SOURCE, MINDMAP_STARTER_SOURCE } from '../constants/index.js'

/**
 * Canonical stored content for the dedicated Diagram and Mind Map page
 * types. The Mermaid source is deliberately opaque page JSON — never parsed
 * as BlockNote blocks, never indexed verbatim, never rendered into dashboard
 * previews. The database column is unconstrained TEXT, so no migration is
 * required for these pages.
 */

export const VISUAL_PAGE_TYPES = ['diagram', 'mindmap'] as const

export type VisualPageType = (typeof VISUAL_PAGE_TYPES)[number]

export const VisualPageContentSchema = z.object({
  version: z.literal(1),
  type: z.enum(VISUAL_PAGE_TYPES),
  source: z.string().max(100_000)
})

export type VisualPageContent = z.infer<typeof VisualPageContentSchema>

export function serializeVisualPageContent(content: VisualPageContent): string {
  return JSON.stringify(content)
}

export type ParseVisualPageResult =
  | { ok: true; value: VisualPageContent }
  | { ok: false; error: string }

/** Total parse: malformed or foreign content yields a contained error. */
export function parseVisualPageContent(stored: string): ParseVisualPageResult {
  const trimmed = stored.trim()
  if (!trimmed) {
    return { ok: false, error: 'Stored content is empty.' }
  }
  try {
    const parsed = VisualPageContentSchema.parse(JSON.parse(trimmed))
    return { ok: true, value: parsed }
  } catch {
    return { ok: false, error: 'Stored content is not a valid visual page document.' }
  }
}

/** Starter content used when a dedicated Diagram / Mind Map page is created. */
export function createStarterVisualContent(pageType: VisualPageType): string {
  return serializeVisualPageContent({
    version: 1,
    type: pageType,
    source: pageType === 'diagram' ? DIAGRAM_STARTER_SOURCE : MINDMAP_STARTER_SOURCE
  })
}
