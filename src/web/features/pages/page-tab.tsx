import { ActionIcon, Badge, Group, Text, Tooltip } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconX } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import classes from './page-tab.module.css'

interface PageTabProps {
  page: Page
  onClose: () => void
}

export function PageTab({ page, onClose }: PageTabProps): JSX.Element {
  return (
    <div
      className={classes.tab}
      role="tab"
      aria-selected="true"
      aria-label={UI_TEXT.activePageTabLabel}
      tabIndex={0}
    >
      <Group gap="xs" wrap="nowrap" className={classes.tabInner}>
        <Text size="sm" fw={600} truncate className={classes.title}>
          {page.title || UI_TEXT.untitledPage}
        </Text>
        <Badge size="xs" variant="light" className={classes.badge}>
          {page.pageType === 'rich' ? UI_TEXT.richNote : UI_TEXT.htmlPage}
        </Badge>
      </Group>

      <Tooltip label={UI_TEXT.closeTabLabel}>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onClose}
          aria-label={UI_TEXT.closeTabLabel}
          className={classes.close}
        >
          <IconX size={14} />
        </ActionIcon>
      </Tooltip>
    </div>
  )
}
