import { useEditorState } from '@blocknote/react'
import { ActionIcon, Button, Menu, Popover, TextInput, Tooltip } from '@mantine/core'
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
  IconDotsVertical,
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
  IconQuote,
  IconSitemap,
  IconSortAscending,
  IconSortDescending,
  IconStrikethrough,
  IconTable,
  IconUnderline
} from '@tabler/icons-react'
import type { JSX, ReactNode } from 'react'
import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import { LAYOUT, OVERLAY_OWNER_ATTR, UI_TEXT } from '../../config/index.js'
import type { CSSVars } from '../../style-props.js'
import { getInsertEntries, type InsertEntry, runInsertEntry } from './insert-blocks.js'
import classes from './rich-toolbar.module.css'
import type { AnyRichEditor } from './schema.js'
import { type LinkablePage, WikiLinkToolbarAction } from './wiki-link.js'

type AnyEditor = AnyRichEditor

/** Icons for the shared Insert entries (one mapping, defined once). */
const INSERT_ICONS = {
  formula: IconLetterA,
  diagram: IconSitemap,
  mindMap: IconSitemap,
  linkedPage: IconLink,
  table: IconTable,
  code: IconCode,
  quote: IconQuote,
  calloutInfo: IconInfoCircle,
  calloutNote: IconNote,
  calloutTip: IconBulb,
  calloutWarning: IconAlertTriangle,
  calloutDanger: IconAlertOctagon
} as const

/** Width reserved for the trailing "more" button when deciding the split. */
const MORE_BUTTON_WIDTH = 28

function isDivider(node: ReactNode): boolean {
  return (
    isValidElement(node) && (node.props as { className?: string }).className === classes.divider
  )
}

/**
 * Separators are dropped from the overflowed run entirely. They are rules
 * between groups on the bar; inside a single-column menu they render as stray
 * marks with nothing to divide, and a leading one would dangle at the top.
 */
function withoutDividers(nodes: ReactNode[]): ReactNode[] {
  return nodes.filter((node) => !isDivider(node))
}

/**
 * Decides how many toolbar controls fit on one row, and reports the rest.
 *
 * Measured, not breakpoint-driven, so the split happens at the width the
 * controls actually need. The controls themselves are never re-implemented or
 * duplicated: the caller simply renders the tail somewhere else, which keeps
 * popover-backed and stateful controls working identically.
 *
 * `split === null` means everything fits and no "more" button is needed.
 */
function useToolbarOverflow(items: ReactNode[]): {
  split: number | null
  barRef: React.RefObject<HTMLDivElement | null>
  slotProps: (index: number) => { ref: (node: HTMLSpanElement | null) => void }
} {
  const barRef = useRef<HTMLDivElement | null>(null)
  const slots = useRef<Map<number, HTMLSpanElement>>(new Map())
  const widths = useRef<Map<number, number>>(new Map())
  // `items` is rebuilt on every render, so it is read through a ref rather than
  // captured: depending on it directly would give `measure` a new identity each
  // render and re-run the observer on every pass.
  const itemsRef = useRef<ReactNode[]>(items)
  itemsRef.current = items
  const [split, setSplit] = useState<number | null>(null)

  const measure = useCallback(() => {
    const bar = barRef.current
    if (!bar) return
    const total = itemsRef.current.length
    if (total === 0) return

    // Cache the natural width of every control that is currently rendered.
    // Widths are cached rather than read live because once a split is applied
    // the tail is no longer in the bar: measuring only what is visible would
    // report "it fits", clear the split, re-overflow, and loop forever.
    for (const [index, node] of slots.current) {
      widths.current.set(index, node.offsetWidth)
    }
    const list: number[] = []
    for (let i = 0; i < total; i += 1) {
      const w = widths.current.get(i)
      // Not every control has been seen at a real width yet; wait rather than
      // guess, or the first pass would strand the row.
      if (w === undefined) return
      list.push(w)
    }

    const cs = getComputedStyle(bar)
    const gap = Number.parseFloat(cs.columnGap || cs.gap || '0') || 0
    const padding =
      (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
    const available = bar.clientWidth - padding
    // Not laid out yet. Measuring against zero would move everything out.
    if (available <= 0) return

    let used = 0
    for (const w of list) used += (used === 0 ? 0 : gap) + w
    if (used <= available) {
      setSplit(null)
      return
    }

    // Recompute with room left for the button that will replace the tail.
    const budget = available - MORE_BUTTON_WIDTH - gap
    let fit = 0
    let running = 0
    for (let i = 0; i < list.length; i += 1) {
      const next = running + (running === 0 ? 0 : gap) + list[i]
      if (next > budget) break
      running = next
      fit = i + 1
    }
    // Never strand the row with a lone separator at the split.
    while (fit > 0 && isDivider(itemsRef.current[fit - 1])) fit -= 1
    setSplit(fit >= list.length ? null : Math.max(fit, 0))
  }, [])

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bar)
    for (const node of slots.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [measure, split])

  const slotProps = useCallback(
    (index: number) => ({
      ref: (node: HTMLSpanElement | null) => {
        if (node) slots.current.set(index, node)
        else slots.current.delete(node ? index : index)
      }
    }),
    []
  )

  return { split, barRef, slotProps }
}

function InsertEntryIcon({ entry }: { entry: InsertEntry }): JSX.Element {
  const Icon = INSERT_ICONS[entry.icon]
  return <Icon size={16} />
}

/** One always-visible insertion control on the persistent toolbar. */
function InsertButton({ editor, entry }: { editor: AnyEditor; entry: InsertEntry }): JSX.Element {
  return (
    <Tooltip label={entry.label} position="bottom">
      <ActionIcon
        variant="subtle"
        aria-label={entry.label}
        data-testid={entry.key}
        onClick={() => runInsertEntry(editor, entry)}
      >
        <InsertEntryIcon entry={entry} />
      </ActionIcon>
    </Tooltip>
  )
}

interface RichToolbarProps {
  editor: AnyEditor
  /** Living pages for internal-link insertion. */
  linkablePages?: LinkablePage[]
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
export function RichToolbar({ editor, linkablePages = [] }: RichToolbarProps): JSX.Element {
  const [linkOpened, setLinkOpened] = useState(false)
  const [textColorOpened, setTextColorOpened] = useState(false)
  const [highlightOpened, setHighlightOpened] = useState(false)
  // The overflow menu is controlled so it can be dismissed on use. Left
  // uncontrolled, Mantine only closes it for its own `Menu.Item` children, and
  // these controls are bare `ActionIcon`s — see the Menu.Dropdown handler.
  const [moreOpen, setMoreOpen] = useState(false)
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

  const controls = (
    <>
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

      <Popover
        opened={textColorOpened}
        onChange={setTextColorOpened}
        width={220}
        position="bottom"
        withinPortal
        zIndex={LAYOUT.overlayZIndex}
      >
        <Popover.Target>
          <Tooltip label={UI_TEXT.textColorLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.textColorLabel}
              aria-haspopup="menu"
              {...{ [OVERLAY_OWNER_ATTR]: true }}
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

      <Popover
        opened={highlightOpened}
        onChange={setHighlightOpened}
        width={220}
        position="bottom"
        withinPortal
        zIndex={LAYOUT.overlayZIndex}
      >
        <Popover.Target>
          <Tooltip label={UI_TEXT.highlightLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.highlightLabel}
              aria-haspopup="menu"
              {...{ [OVERLAY_OWNER_ATTR]: true }}
              onClick={() => setHighlightOpened((o) => !o)}
            >
              <IconLetterA size={16} className={classes.swatchIconFill} />
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

      {linkablePages.length > 0 ? (
        <WikiLinkToolbarAction editor={editor} pages={linkablePages} />
      ) : null}

      <Popover
        opened={linkOpened}
        onChange={setLinkOpened}
        width={280}
        position="bottom"
        withinPortal
        zIndex={LAYOUT.overlayZIndex}
      >
        <Popover.Target>
          <Tooltip label={UI_TEXT.linkLabel} position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label={UI_TEXT.linkLabel}
              {...{ [OVERLAY_OWNER_ATTR]: true }}
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

      {/* Insertion controls live directly on the persistent toolbar — one
          compact icon per entry, grouped with separators. Nothing is hidden
          behind an Insert dropdown; the slash menu remains as an alternative
          surface. The row scrolls horizontally on narrow screens instead of
          wrapping or collapsing into menus. */}
      {(['insert-formula', 'insert-diagram', 'insert-mind-map', 'insert-linked-page'] as const).map(
        (key) => {
          const entry = getInsertEntries(editor).find((candidate) => candidate.key === key)
          return entry ? <InsertButton key={key} editor={editor} entry={entry} /> : null
        }
      )}

      <span className={classes.divider} />

      {(['insert-table', 'insert-code-block', 'insert-quote'] as const).map((key) => {
        const entry = getInsertEntries(editor).find((candidate) => candidate.key === key)
        return entry ? <InsertButton key={key} editor={editor} entry={entry} /> : null
      })}

      <span className={classes.divider} />

      {getInsertEntries(editor)
        .filter((entry) => entry.group === 'callout')
        .map((entry) => (
          <InsertButton key={entry.key} editor={editor} entry={entry} />
        ))}

      <span className={classes.divider} />

      <Tooltip label={UI_TEXT.clearFormattingLabel} position="bottom">
        <ActionIcon
          variant="subtle"
          aria-label={UI_TEXT.clearFormattingLabel}
          // Every other control on this bar carries a test id, including the
          // ones that move into the more menu when the row runs out of width.
          // This one had only a label, so it could not be addressed by either.
          data-testid="clear-formatting"
          onClick={clearFormatting}
        >
          <IconClearFormatting size={16} />
        </ActionIcon>
      </Tooltip>
    </>
  )

  // `Children.toArray` treats a Fragment as one opaque child, so it is handed
  // the fragment's children to get a flat list of individual controls.
  const items = Children.toArray(
    isValidElement<{ children?: ReactNode }>(controls) ? controls.props.children : null
  )
  const { split, barRef, slotProps } = useToolbarOverflow(items)
  const visible = split === null ? items : items.slice(0, split)
  const overflowed = split === null ? [] : withoutDividers(items.slice(split))

  return (
    <div className={classes.bar} role="toolbar" aria-label={UI_TEXT.richToolbarLabel} ref={barRef}>
      {visible.map((item, index) => (
        <span className={classes.slot} key={index} {...slotProps(index)}>
          {item}
        </span>
      ))}
      {overflowed.length > 0 ? (
        <Menu
          position="bottom-end"
          withinPortal
          opened={moreOpen}
          onChange={setMoreOpen}
          // Mantine's Popover default is already `false`; `Menu` is what raises
          // it, and the automatic return-focus on unmount runs after the
          // browser's own focus step, so it moved DOM focus to this trigger
          // button and the keystrokes that followed never reached the block the
          // menu had just inserted. Escape and a trigger click still return
          // focus by design; only the automatic outside-dismissal no longer does.
          returnFocus={false}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              className={classes.moreButton}
              data-testid="toolbar-more"
              aria-label={UI_TEXT.toolbarMoreLabel}
            >
              <IconDotsVertical size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown
            className={classes.moreMenu}
            onClick={(event) => {
              // Close when a control is actually used. Mantine only auto-closes
              // for its own `Menu.Item` children, and the controls here are moved
              // in whole — bare `ActionIcon`s — so nothing closed the menu. Left
              // open, the very next click anywhere in the document was consumed
              // dismissing it, and the block just inserted silently ignored the
              // user's typing.
              //
              // The exception is a control that owns its own overlay (a colour
              // grid, a link field). Closing the menu unmounts that control, which
              // tears down the popover it just opened, so the click would land on
              // a dropdown that no longer exists. Those triggers carry
              // OVERLAY_OWNER_ATTR and the menu stays open until the next click
              // lands outside it.
              if (!(event.target as HTMLElement).closest(`[${OVERLAY_OWNER_ATTR}]`))
                setMoreOpen(false)
            }}
          >
            {/* The same controls, moved whole. Nothing is re-implemented, so a
                popover-backed or stateful control behaves identically here. */}
            {overflowed.map((item, index) => (
              <span className={classes.moreItem} key={index}>
                {item}
              </span>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
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
          // The chosen colour is data; the paint rule stays in the stylesheet.
          style={
            {
              '--swatch-color':
                color === 'default'
                  ? 'transparent'
                  : `var(--bn-colors-${highlight ? 'background-color' : 'text-color'}-${color}, var(--mantine-color-${color}-filled))`
            } as CSSVars
          }
          onClick={() => onPick(color)}
        >
          {color === 'default' ? <span aria-hidden>∅</span> : null}
        </button>
      ))}
    </div>
  )
}
