import { Badge } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from '../config/index.js'

const LABELS: Record<PageType, string> = {
  rich: UI_TEXT.richNote,
  html: UI_TEXT.htmlPage
}

const COLORS: Record<PageType, string> = {
  rich: 'blue',
  html: 'teal'
}

interface PageTypeBadgeProps {
  pageType: PageType
}

export function PageTypeBadge({ pageType }: PageTypeBadgeProps): JSX.Element {
  return (
    <Badge color={COLORS[pageType]} variant="light" size="sm">
      {LABELS[pageType]}
    </Badge>
  )
}
