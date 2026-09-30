import { DIAGRAM_STARTER_SOURCE } from '@rtwiki/shared/constants'

/**
 * The source a newly added diagram starts from.
 *
 * The same starter a brand-new page is created with, so a diagram added to an
 * existing page is immediately recognisable rather than a blank or broken
 * diagram. Read from the shared constants rather than repeated, so a page and a
 * block cannot end up with different starters.
 *
 * Takes no page type. Diagram is the only visual page there is, so this is a
 * constant rather than a choice — a mind map is added by picking the `mindmap`
 * template, not by arriving here with a different type.
 */
export function starterSourceFor(): string {
  return DIAGRAM_STARTER_SOURCE
}
