import { DIAGRAM_STARTER_SOURCE, MINDMAP_STARTER_SOURCE } from '@rtwiki/shared/constants'
import type { VisualPageType } from '@rtwiki/shared/schemas/visual-page-content'

/**
 * The source a newly added diagram starts from.
 *
 * The same starters a brand-new page is created with, so a diagram added to an
 * existing page is immediately recognisable rather than a blank or broken
 * diagram. Read from the shared constants rather than repeated, so a page and a
 * block cannot end up with different starters.
 */
export function starterSourceFor(pageType: VisualPageType): string {
  return pageType === 'diagram' ? DIAGRAM_STARTER_SOURCE : MINDMAP_STARTER_SOURCE
}
