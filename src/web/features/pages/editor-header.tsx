import { useState, useEffect } from 'react'
import { Group, TextInput, Button, Menu, ActionIcon, Tooltip } from '@mantine/core'
import { IconDots, IconCopy, IconTrash, IconArrowLeft } from '@tabler/icons-react'
import type { Page } from '@rtwiki/shared/contracts/pages'
import type { MutationStatus } from '../../hooks/use-pages-controller.js'
import { UI_TEXT } from '../../config/index.js'
import { PageTypeBadge } from '../../components/page-type-badge.js'
import { SaveStatus } from '../../components/save-status.js'
import classes from './editor-header.module.css'

interface EditorHeaderProps {
  page: Page
  mutationStatus: MutationStatus
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
}

export function EditorHeader({
  page,
  mutationStatus,
  onBack,
  onRename,
  onDuplicate,
  onDelete
}: EditorHeaderProps): JSX.Element {
  const [title, setTitle] = useState(page.title)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setTitle(page.title)
  }, [page.title])

  const handleBlur = async (): Promise<void> => {
    setEditing(false)
    const trimmed = title.trim()
    if (!trimmed || trimmed === page.title) {
      setTitle(page.title)
      return
    }
    await onRename(trimmed)
  }

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>): Promise<void> => {
    if (event.key === 'Enter') {
      ;(event.target as HTMLInputElement).blur()
    }
    if (event.key === 'Escape') {
      setTitle(page.title)
      setEditing(false)
      ;(event.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className={classes.header}>
      <Group gap="sm" wrap="nowrap" className={classes.left}>
        <Tooltip label={UI_TEXT.backToDashboard}>
          <ActionIcon variant="subtle" onClick={onBack} aria-label={UI_TEXT.backToDashboard}>
            <IconArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>

        <TextInput
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onFocus={() => setEditing(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={UI_TEXT.editorPlaceholderTitle}
          aria-label={UI_TEXT.titleLabel}
          className={classes.titleInput}
          variant={editing ? 'default' : 'unstyled'}
          size="md"
          fw={600}
        />

        <PageTypeBadge pageType={page.pageType} />
        <SaveStatus status={mutationStatus} />
      </Group>

      <Group gap="xs" wrap="nowrap">
        <Button
          variant="light"
          size="xs"
          leftSection={<IconCopy size={14} />}
          onClick={onDuplicate}
        >
          {UI_TEXT.duplicateAction}
        </Button>

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
            <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
              {UI_TEXT.deleteAction}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </div>
  )
}
