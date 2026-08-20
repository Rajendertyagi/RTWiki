import { Card, Group, Text, Title, Menu, ActionIcon } from '@mantine/core'
import { IconDots, IconCopy, IconTrash } from '@tabler/icons-react'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { UI_TEXT } from '../../config/index.js'
import { PageTypeBadge } from '../../components/page-type-badge.js'
import classes from './dashboard.module.css'

interface PageCardProps {
  page: Page
  onOpen: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString()
  } catch {
    return value
  }
}

/**
 * Page card with explicit click/keyboard handling and isolated menu.
 *
 * The entire card is the primary interactive element for opening the page.
 * The menu (three-dot) is wrapped in a click-stopper so menu actions
 * (duplicate, delete) do not accidentally trigger the card's open action.
 */
export function PageCard({ page, onOpen, onDuplicate, onDelete }: PageCardProps): JSX.Element {
  const handleCardClick = (): void => {
    onOpen(page.id)
  }

  const handleCardKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen(page.id)
    }
  }

  const handleMenuClick = (event: React.MouseEvent): void => {
    event.stopPropagation()
  }

  const handleMenuKeyDown = (event: React.KeyboardEvent): void => {
    event.stopPropagation()
  }

  return (
    <Card
      component="button"
      type="button"
      withBorder
      padding="md"
      radius="md"
      className={classes.card}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      aria-label={`Open ${page.title || UI_TEXT.untitledPage}`}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Title order={4} lineClamp={2} className={classes.cardTitle}>
          {page.title || UI_TEXT.untitledPage}
        </Title>
        <div onClick={handleMenuClick} onKeyDown={handleMenuKeyDown}>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                aria-label={`Actions for ${page.title || UI_TEXT.untitledPage}`}
              >
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconCopy size={14} />} onClick={() => onDuplicate(page.id)}>
                {UI_TEXT.duplicateAction}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconTrash size={14} />}
                color="red"
                onClick={() => onDelete(page.id)}
              >
                {UI_TEXT.deleteAction}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </Group>

      <Text size="sm" c="dimmed" lineClamp={3} mt="xs">
        {page.content ? page.content.slice(0, 120) : UI_TEXT.editorPlaceholderContent}
      </Text>

      <div className={classes.cardFooter}>
        <PageTypeBadge pageType={page.pageType} />
        <Text size="xs" c="dimmed">
          {formatDate(page.updatedAt)}
        </Text>
      </div>
    </Card>
  )
}
