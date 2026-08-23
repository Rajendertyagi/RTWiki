import type { BlockNoteEditor } from '@blocknote/core'
import { ActionIcon, Button, Popover, TextInput, Tooltip } from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconPencil,
  IconUnderline
} from '@tabler/icons-react'
import { useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './rich-toolbar.module.css'

type AnyEditor = BlockNoteEditor

interface RichToolbarProps {
  editor: AnyEditor
}

/**
 * Persistent Rich Document toolbar. Always visible for Rich Notes — it does
 * not depend on text selection — and wired directly to the public editor
 * command API of the installed BlockNote version.
 */
export function RichToolbar({ editor }: RichToolbarProps): JSX.Element {
  const [linkOpened, setLinkOpened] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const withEditor = (action: () => void) => (): void => {
    action()
    editor.focus()
  }

  const setBlock = (type: string, props?: Record<string, unknown>) => (): void => {
    const block = editor.getTextCursorPosition().block
    editor.updateBlock(block, { type, props } as never)
    editor.focus()
  }

  const applyLink = (): void => {
    const url = linkUrl.trim()
    if (!url) return
    editor.createLink(url)
    setLinkUrl('')
    setLinkOpened(false)
    editor.focus()
  }

  return (
    <div className={classes.bar} role="toolbar" aria-label={UI_TEXT.richToolbarLabel}>
      <Tooltip label={UI_TEXT.undoLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.undoLabel}
          onClick={withEditor(() => editor.undo())}
        >
          <IconArrowBackUp size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.redoLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.redoLabel}
          onClick={withEditor(() => editor.redo())}
        >
          <IconArrowForwardUp size={16} />
        </ActionIcon>
      </Tooltip>

      <span className={classes.divider} />

      <Button
        size="compact-xs"
        variant="subtle"
        className={classes.textButton}
        aria-label={UI_TEXT.paragraphLabel}
        onClick={setBlock('paragraph')}
      >
        <IconPencil size={14} />
      </Button>
      {(['H1', 'H2', 'H3'] as const).map((label, index) => (
        <Button
          key={label}
          size="compact-xs"
          variant="subtle"
          className={classes.textButton}
          aria-label={`${UI_TEXT.headingLabel} ${index + 1}`}
          onClick={setBlock('heading', { level: index + 1 })}
        >
          {label}
        </Button>
      ))}

      <span className={classes.divider} />

      <Tooltip label={UI_TEXT.boldLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.boldLabel}
          onClick={withEditor(() => editor.toggleStyles({ bold: true }))}
        >
          <IconBold size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.italicLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.italicLabel}
          onClick={withEditor(() => editor.toggleStyles({ italic: true }))}
        >
          <IconItalic size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.underlineLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.underlineLabel}
          onClick={withEditor(() => editor.toggleStyles({ underline: true }))}
        >
          <IconUnderline size={16} />
        </ActionIcon>
      </Tooltip>

      <span className={classes.divider} />

      <Tooltip label={UI_TEXT.bulletListLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.bulletListLabel}
          onClick={setBlock('bulletListItem')}
        >
          <IconList size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.numberedListLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.numberedListLabel}
          onClick={setBlock('numberedListItem')}
        >
          <IconListNumbers size={16} />
        </ActionIcon>
      </Tooltip>

      <Popover opened={linkOpened} onChange={setLinkOpened} width={280} position="bottom">
        <Popover.Target>
          <Tooltip label={UI_TEXT.linkLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.linkLabel}
              onClick={() => setLinkOpened((open) => !open)}
            >
              <IconLink size={16} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <TextInput
            placeholder="https://example.com"
            label={UI_TEXT.linkLabel}
            value={linkUrl}
            data-testid="link-url-input"
            onChange={(event) => setLinkUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyLink()
            }}
          />
          <Button size="compact-xs" mt="xs" fullWidth onClick={applyLink}>
            {UI_TEXT.linkApply}
          </Button>
        </Popover.Dropdown>
      </Popover>
    </div>
  )
}
