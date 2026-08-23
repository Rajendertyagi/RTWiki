import { ActionIcon, Button, Group, Menu, Text, TextInput, Tooltip } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconArrowLeft, IconCopy, IconDots, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { PageTypeBadge } from '../../components/page-type-badge.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './editor-header.module.css'

interface EditorHeaderProps {
  page: Page
  isDirty: boolean
  saveState: 'clean' | 'saving' | 'saved' | 'error'
  onSave: () => Promise<boolean>
  onRetry: () => Promise<boolean>
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
}

export function EditorHeader({
  page,
  isDirty,
  saveState,
  onSave,
  onRetry,
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

  const isSaving = saveState === 'saving'
  const isClean = saveState === 'clean' || saveState === 'saved'
  const isError = saveState === 'error'

  const saveLabel = isSaving
    ? UI_TEXT.saveStatusSaving
    : isError
      ? UI_TEXT.saveStatusError
      : isDirty
        ? UI_TEXT.saveStatusSaved
        : UI_TEXT.saveStatusSaved

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

        {isError ? (
          <Group gap="xs" className={classes.saveStatus}>
            <Text size="xs" c="red">
              {UI_TEXT.saveStatusError}
            </Text>
            <Button
              size="xs"
              variant="subtle"
              onClick={async () => {
                await onRetry()
              }}
            >
              {UI_TEXT.saveStatusRetry}
            </Button>
          </Group>
        ) : (
          <Text size="xs" c="dimmed" aria-live="polite">
            {saveLabel}
          </Text>
        )}
      </Group>

      <Group gap="xs" wrap="nowrap">
        <Button
          size="xs"
          variant={isDirty ? 'filled' : 'subtle'}
          disabled={isSaving || isClean}
          onClick={async () => {
            await onSave()
          }}
          aria-label="Save note"
        >
          {isSaving ? UI_TEXT.saveStatusSaving : UI_TEXT.saveStatusSaved}
        </Button>

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
              data-testid="editor-actions"
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
