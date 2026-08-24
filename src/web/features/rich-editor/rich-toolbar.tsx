import { useEditorState } from '@blocknote/react'
import { ActionIcon, Button, Popover, TextInput, Tooltip } from '@mantine/core'
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconBulb,
  IconChevronDown,
  IconClearFormatting,
  IconCode,
  IconH1,
  IconH2,
  IconH3,
  IconInfoCircle,
  IconItalic,
  IconLetterA,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconNote,
  IconPencil,
  IconPlus,
  IconQuote,
  IconSitemap,
  IconSortAscending,
  IconSortDescending,
  IconStrikethrough,
  IconTable,
  IconUnderline
} from '@tabler/icons-react'
import type { JSX } from 'react'
import { useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { getInsertEntries, type InsertEntry, runInsertEntry } from './insert-blocks.js'
import classes from './rich-toolbar.module.css'

import type { AnyRichEditor } from './schema.js'

type AnyEditor = AnyRichEditor

/** Icons for the shared Insert entries (one mapping, defined once). */
const INSERT_ICONS = {
  formula: IconLetterA,
  diagram: IconSitemap,
  mindMap: IconSitemap,
  table: IconTable,
  code: IconCode,
  quote: IconQuote,
  calloutInfo: IconInfoCircle,
  calloutNote: IconNote,
  calloutTip: IconBulb,
  calloutWarning: IconAlertTriangle,
  calloutDanger: IconAlertOctagon
} as const

function InsertEntryIcon({ entry }: { entry: InsertEntry }): JSX.Element {
  const Icon = INSERT_ICONS[entry.icon]
  return <Icon size={16} />
}

interface RichToolbarProps {
  editor: AnyEditor
}

/** BlockNote's default palette (minus the 'default' sentinel handled apart). */
const COLOR_PRESETS = [
  'default',
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink'
] as const

const ALIGNMENTS = ['left', 'center', 'right'] as const

/**
 * Persistent Rich Document toolbar. Always visible for Rich Notes — it does
 * not depend on text selection — and wired directly to the public editor
 * command API of the installed BlockNote version. Active formatting state is
 * derived through the official useEditorState hook so buttons reflect the
 * cursor/selection without manual event plumbing.
 */
export function RichToolbar({ editor }: RichToolbarProps): JSX.Element {
  const [linkOpened, setLinkOpened] = useState(false)
  const [textColorOpened, setTextColorOpened] = useState(false)
  const [highlightOpened, setHighlightOpened] = useState(false)
  const [insertOpened, setInsertOpened] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const withEditor = (action: () => void) => (): void => {
    action()
    editor.focus()
  }

  // Reactive snapshot: active inline styles, current block identity/props,
  // and nesting capability. Recomputed by BlockNote on selection changes.
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      let block: ReturnType<typeof ed.getTextCursorPosition>['block'] | undefined
      try {
        block = ed.getTextCursorPosition().block
      } catch {
        return null
      }
      if (!block) return null
      return {
        activeStyles: ed.getActiveStyles(),
        blockType: block.type,
        headingLevel:
          block.type === 'heading' && typeof (block.props as { level?: number }).level === 'number'
            ? ((block.props as { level: number }).level as number)
            : 0,
        textAlignment:
          'textAlignment' in block.props
            ? (block.props.textAlignment as string | undefined)
            : undefined,
        canNest: ed.canNestBlock(),
        canUnnest: ed.canUnnestBlock()
      }
    }
  })

  const active = state ?? {
    activeStyles: {} as Record<string, unknown>,
    blockType: 'paragraph',
    headingLevel: 0,
    textAlignment: undefined,
    canNest: false,
    canUnnest: false
  }
  const styles = active.activeStyles as Record<string, string | boolean>

  const setBlock = (type: string, props?: Record<string, unknown>) => (): void => {
    const block = editor.getTextCursorPosition().block
    editor.updateBlock(block, { type, props } as never)
    editor.focus()
  }

  const applyAlignment = (alignment: string) => (): void => {
    const selected = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]
    for (const block of selected) {
      if ('textAlignment' in block.props) {
        editor.updateBlock(block, { props: { textAlignment: alignment } } as never)
      }
    }
    editor.focus()
  }

  const clearFormatting = (): void => {
    editor.removeStyles({
      bold: true,
      italic: true,
      underline: true,
      strike: true,
      code: true,
      textColor: 'default',
      backgroundColor: 'default'
    })
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

  const styleActive = (name: string): boolean => Boolean(styles[name])
  const toggleStyle = (name: string) =>
    withEditor(() => editor.toggleStyles({ [name]: !styleActive(name) } as never))

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

      <Tooltip label={UI_TEXT.paragraphLabel} position="bottom">
        <ActionIcon
          variant={active.blockType === 'paragraph' ? 'light' : 'subtle'}
          color={active.blockType === 'paragraph' ? 'blue' : undefined}
          aria-label={UI_TEXT.paragraphLabel}
          aria-pressed={active.blockType === 'paragraph'}
          onClick={setBlock('paragraph')}
        >
          <IconPencil size={16} />
        </ActionIcon>
      </Tooltip>
      {([1, 2, 3] as const).map((level) => {
        const isActive = active.blockType === 'heading' && level === active.headingLevel
        const label = `${UI_TEXT.headingLabel} ${level}`
        const Icon = level === 1 ? IconH1 : level === 2 ? IconH2 : IconH3
        return (
          <Tooltip key={level} label={label} position="bottom">
            <ActionIcon
              variant={isActive ? 'light' : 'subtle'}
              color={isActive ? 'blue' : undefined}
              aria-label={label}
              aria-pressed={isActive}
              onClick={setBlock('heading', { level })}
            >
              <Icon size={16} />
            </ActionIcon>
          </Tooltip>
        )
      })}

      <span className={classes.divider} />

      <Tooltip label={UI_TEXT.boldLabel} position="bottom">
        <ActionIcon
          variant={styleActive('bold') ? 'light' : 'subtle'}
          color={styleActive('bold') ? 'blue' : undefined}
          aria-label={UI_TEXT.boldLabel}
          aria-pressed={styleActive('bold')}
          onClick={toggleStyle('bold')}
        >
          <IconBold size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.italicLabel} position="bottom">
        <ActionIcon
          variant={styleActive('italic') ? 'light' : 'subtle'}
          color={styleActive('italic') ? 'blue' : undefined}
          aria-label={UI_TEXT.italicLabel}
          aria-pressed={styleActive('italic')}
          onClick={toggleStyle('italic')}
        >
          <IconItalic size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.underlineLabel} position="bottom">
        <ActionIcon
          variant={styleActive('underline') ? 'light' : 'subtle'}
          color={styleActive('underline') ? 'blue' : undefined}
          aria-label={UI_TEXT.underlineLabel}
          aria-pressed={styleActive('underline')}
          onClick={toggleStyle('underline')}
        >
          <IconUnderline size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.strikeLabel} position="bottom">
        <ActionIcon
          variant={styleActive('strike') ? 'light' : 'subtle'}
          color={styleActive('strike') ? 'blue' : undefined}
          aria-label={UI_TEXT.strikeLabel}
          aria-pressed={styleActive('strike')}
          onClick={toggleStyle('strike')}
        >
          <IconStrikethrough size={16} />
        </ActionIcon>
      </Tooltip>

      <Popover opened={textColorOpened} onChange={setTextColorOpened} width={220} position="bottom">
        <Popover.Target>
          <Tooltip label={UI_TEXT.textColorLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.textColorLabel}
              aria-haspopup="menu"
              onClick={() => setTextColorOpened((o) => !o)}
            >
              <IconLetterA size={16} />
              <IconChevronDown size={10} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <SwatchGrid
            active={(styles.textColor as string | undefined) ?? 'default'}
            onPick={(color) => {
              if (color === 'default') {
                editor.removeStyles({ textColor: color })
              } else {
                editor.addStyles({ textColor: color })
              }
              setTextColorOpened(false)
              editor.focus()
            }}
          />
        </Popover.Dropdown>
      </Popover>

      <Popover opened={highlightOpened} onChange={setHighlightOpened} width={220} position="bottom">
        <Popover.Target>
          <Tooltip label={UI_TEXT.highlightLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.highlightLabel}
              aria-haspopup="menu"
              onClick={() => setHighlightOpened((o) => !o)}
            >
              <IconLetterA size={16} style={{ fill: 'var(--mantine-color-yellow-filled)' }} />
              <IconChevronDown size={10} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <SwatchGrid
            highlight
            active={(styles.backgroundColor as string | undefined) ?? 'default'}
            onPick={(color) => {
              if (color === 'default') {
                editor.removeStyles({ backgroundColor: color })
              } else {
                editor.addStyles({ backgroundColor: color })
              }
              setHighlightOpened(false)
              editor.focus()
            }}
          />
        </Popover.Dropdown>
      </Popover>

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

      <span className={classes.divider} />

      <Tooltip label={UI_TEXT.bulletListLabel} position="bottom">
        <ActionIcon
          variant={active.blockType === 'bulletListItem' ? 'light' : 'subtle'}
          color={active.blockType === 'bulletListItem' ? 'blue' : undefined}
          aria-label={UI_TEXT.bulletListLabel}
          aria-pressed={active.blockType === 'bulletListItem'}
          onClick={setBlock('bulletListItem')}
        >
          <IconList size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.numberedListLabel} position="bottom">
        <ActionIcon
          variant={active.blockType === 'numberedListItem' ? 'light' : 'subtle'}
          color={active.blockType === 'numberedListItem' ? 'blue' : undefined}
          aria-label={UI_TEXT.numberedListLabel}
          aria-pressed={active.blockType === 'numberedListItem'}
          onClick={setBlock('numberedListItem')}
        >
          <IconListNumbers size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.checklistLabel} position="bottom">
        <ActionIcon
          variant={active.blockType === 'checkListItem' ? 'light' : 'subtle'}
          color={active.blockType === 'checkListItem' ? 'blue' : undefined}
          aria-label={UI_TEXT.checklistLabel}
          aria-pressed={active.blockType === 'checkListItem'}
          onClick={setBlock('checkListItem')}
        >
          <IconListCheck size={16} />
        </ActionIcon>
      </Tooltip>

      <span className={classes.divider} />

      {ALIGNMENTS.map((alignment) => {
        const alignLabel =
          UI_TEXT[`align${capitalize(alignment)}` as 'alignLeft' | 'alignCenter' | 'alignRight']
        return (
          <Tooltip key={alignment} label={alignLabel} position="bottom">
            <ActionIcon
              variant={active.textAlignment === alignment ? 'light' : 'subtle'}
              color={active.textAlignment === alignment ? 'blue' : undefined}
              aria-label={alignLabel}
              aria-pressed={active.textAlignment === alignment}
              onClick={applyAlignment(alignment)}
            >
              <AlignIcon alignment={alignment} />
            </ActionIcon>
          </Tooltip>
        )
      })}

      <Tooltip label={UI_TEXT.outdentLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.outdentLabel}
          disabled={!active.canUnnest}
          onClick={withEditor(() => editor.unnestBlock())}
        >
          <IconSortAscending size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={UI_TEXT.indentLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.indentLabel}
          disabled={!active.canNest}
          onClick={withEditor(() => editor.nestBlock())}
        >
          <IconSortDescending size={16} />
        </ActionIcon>
      </Tooltip>

      <span className={classes.divider} />

      {/* Insert menu: visual knowledge blocks plus the existing table/code/
          quote conversions, kept behind one control so the toolbar stays a
          single scrollable row. */}
      <Popover
        opened={insertOpened}
        onChange={setInsertOpened}
        position="bottom-start"
        withinPortal
      >
        <Popover.Target>
          <Tooltip label={UI_TEXT.insertMenuLabel} position="bottom">
            <ActionIcon
              variant={insertOpened ? 'light' : 'subtle'}
              aria-label={UI_TEXT.insertMenuLabel}
              aria-haspopup="menu"
              aria-expanded={insertOpened}
              data-testid="insert-menu-button"
              onClick={() => setInsertOpened((open) => !open)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown>
          <div role="menu" data-testid="insert-menu" className={classes.insertMenu}>
            {getInsertEntries(editor).map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="menuitem"
                className={classes.insertItem}
                data-testid={`insert-${entry.key}`}
                onClick={() => {
                  runInsertEntry(editor, entry)
                  setInsertOpened(false)
                }}
              >
                <InsertEntryIcon entry={entry} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </Popover.Dropdown>
      </Popover>

      <Tooltip label={UI_TEXT.clearFormattingLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.clearFormattingLabel}
          onClick={clearFormatting}
        >
          <IconClearFormatting size={16} />
        </ActionIcon>
      </Tooltip>
    </div>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const ALIGN_ICONS = {
  left: IconAlignLeft,
  center: IconAlignCenter,
  right: IconAlignRight
} as const

function AlignIcon({ alignment }: { alignment: string }): JSX.Element {
  const Icon = ALIGN_ICONS[alignment as keyof typeof ALIGN_ICONS]
  return <Icon size={16} />
}

function SwatchGrid({
  active,
  highlight,
  onPick
}: {
  active: string
  highlight?: boolean
  onPick: (color: string) => void
}): JSX.Element {
  return (
    <div
      className={classes.swatchGrid}
      role="menu"
      data-testid={highlight ? 'highlight-grid' : 'text-color-grid'}
    >
      {COLOR_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          role="menuitemradio"
          aria-checked={active === color}
          aria-label={`${highlight ? UI_TEXT.highlightLabel : UI_TEXT.textColorLabel}: ${color}`}
          className={
            active === color ? `${classes.swatch} ${classes.swatchActive}` : classes.swatch
          }
          style={{
            background:
              color === 'default'
                ? 'transparent'
                : `var(--bn-colors-${highlight ? 'background-color' : 'text-color'}-${color}, var(--mantine-color-${color}-filled))`
          }}
          onClick={() => onPick(color)}
        >
          {color === 'default' ? <span aria-hidden>∅</span> : null}
        </button>
      ))}
    </div>
  )
}
