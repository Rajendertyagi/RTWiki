import type { PageType } from '@rtwiki/shared/contracts/pages'
import { IconFileText, IconGitFork, IconLetterM, IconNetwork, IconWorld } from '@tabler/icons-react'
import type { JSX } from 'react'

const ICONS: Record<PageType, typeof IconFileText> = {
  rich: IconFileText,
  html: IconWorld,
  markdown: IconLetterM,
  diagram: IconNetwork,
  mindmap: IconGitFork
}

/** Single React source of truth for the small page-type icon in chrome. */
export function PageTypeIcon({
  pageType,
  size = 16
}: {
  pageType: PageType
  size?: number
}): JSX.Element {
  const Icon = ICONS[pageType]
  return <Icon size={size} />
}
