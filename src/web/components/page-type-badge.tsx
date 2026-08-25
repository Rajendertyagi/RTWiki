import { Badge } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from '../config/index.js'

const LABELS: Record<PageType, string> = {
  rich: UI_TEXT.richNote,
  html: UI_TEXT.htmlPage,
  diagram: UI_TEXT.diagramPage,
  mindmap: UI_TEXT.mindMapPage
}

const COLORS: Record<PageType, string> = {
  rich: 'blue',
  html: 'teal',
  diagram: 'violet',
  mindmap: 'grape'
}

interface PageTypeBadgeProps {
  pageType: PageType
}

/** Single readable label source for every page type. */
export function pageTypeLabel(pageType: PageType): string {
  return LABELS[pageType]
}

export function PageTypeBadge({ pageType }: PageTypeBadgeProps): JSX.Element {
  return (
    <Badge color={COLORS[pageType]} variant="light" size="sm">
      {LABELS[pageType]}
    </Badge>
  )
}
