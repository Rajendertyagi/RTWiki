import { ActionIcon, Divider, Stack, Text, Tooltip } from '@mantine/core'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { UI_TEXT } from '../../config/index.js'
import type { DocumentOutlineEntry } from '../rich-editor/document.js'
import classes from './right-sidebar.module.css'

interface RightSidebarProps {
  outline: DocumentOutlineEntry[]
  pageTypeLabel: string
  createdDate: string
  updatedDate: string
  onNavigateToHeading: (blockId: string) => void
  onCollapse: () => void
}

/**
 * Contextual right sidebar for an open Rich Note: heading outline plus
 * basic page information. Collapsible; the document expands when hidden.
 */
export function RightSidebar({
  outline,
  pageTypeLabel,
  createdDate,
  updatedDate,
  onNavigateToHeading,
  onCollapse
}: RightSidebarProps): JSX.Element {
  return (
    <aside className={classes.panel} aria-label={UI_TEXT.rightSidebarLabel}>
      <div className={classes.header}>
        <Text size="xs" fw={600} c="dimmed">
          {UI_TEXT.rightSidebarLabel}
        </Text>
        <Tooltip label={UI_TEXT.collapseSidebarLabel} position="left">
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={UI_TEXT.collapseSidebarLabel}
            onClick={onCollapse}
          >
            <IconLayoutSidebar size={16} />
          </ActionIcon>
        </Tooltip>
      </div>

      <div className={classes.scrollArea}>
        <Text size="xs" fw={600} c="dimmed" className={classes.sectionTitle}>
          {UI_TEXT.outlineTitle}
        </Text>
        {outline.length === 0 ? (
          <Text size="xs" c="dimmed" className={classes.emptyOutline}>
            {UI_TEXT.outlineEmpty}
          </Text>
        ) : (
          <Stack gap={2}>
            {outline.map((entry) => (
              <button
                key={entry.blockId}
                type="button"
                className={classes.outlineEntry}
                style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }}
                onClick={() => onNavigateToHeading(entry.blockId)}
              >
                {entry.text || UI_TEXT.untitledPage}
              </button>
            ))}
          </Stack>
        )}

        <Divider my="sm" />

        <Text size="xs" fw={600} c="dimmed" className={classes.sectionTitle}>
          {UI_TEXT.pageInfoTitle}
        </Text>
        <Stack gap={4} className={classes.infoBlock}>
          <Text size="xs">
            {UI_TEXT.pageInfoType}: {pageTypeLabel}
          </Text>
          <Text size="xs">
            {UI_TEXT.pageInfoCreated}: {createdDate}
          </Text>
          <Text size="xs">
            {UI_TEXT.pageInfoUpdated}: {updatedDate}
          </Text>
        </Stack>
      </div>
    </aside>
  )
}
