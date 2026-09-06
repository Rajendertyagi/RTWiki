import { ActionIcon, Menu, TextInput, Tooltip } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconArrowLeft, IconCopy, IconDots, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { PageTypeIcon } from '../../components/page-type-icon.js'
import { UI_TEXT } from '../../config/index.js'
import classes from './editor-header.module.css'

interface EditorHeaderProps {
  page: Page
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onDuplicate: () => void
  onDelete: () => void
}

/**
 * Slim page header. Holds only navigation, the editable title and a small
 * page-type icon; save state and the Duplicate/Delete actions live elsewhere
 * (the bottom status bar and the overflow menu) so the top row stays calm.
 */
export function EditorHeader({
  page,
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
      <div className={classes.left}>
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

        <span className={classes.typeIcon} aria-hidden="true">
          <PageTypeIcon pageType={page.pageType} size={16} />
        </span>
      </div>

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
          <Menu.Item
            leftSection={<IconCopy size={14} />}
            onClick={onDuplicate}
            data-testid="editor-duplicate"
          >
            {UI_TEXT.duplicateAction}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconTrash size={14} />}
            color="red"
            onClick={onDelete}
            data-testid="editor-delete"
          >
            {UI_TEXT.deleteAction}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}
