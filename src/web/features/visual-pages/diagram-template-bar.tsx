import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconTemplate } from '@tabler/icons-react'
import { type ReactNode, useState } from 'react'
import { OVERLAY_OWNER_ATTR, UI_TEXT } from '../../config/index.js'
import { useToolbarOverflow } from '../../hooks/use-toolbar-overflow.js'
import { DIAGRAM_TEMPLATES } from '../rich-editor/insert-blocks.js'
import classes from './mermaid-workspace.module.css'

/**
 * Flat diagram-template bar.
 *
 * Same behaviour as the rich document toolbar: one row, never wrapping, never
 * scrolling, and whatever does not fit moves into a trailing dropdown. The
 * measurement is the shared `useToolbarOverflow`, so the two toolbars cannot
 * drift apart.
 *
 * Every template here is verified to render by
 * `tests/browser/diagram-templates.pwspec.ts`; a template that stops rendering
 * fails that test rather than reaching the user.
 */
export function DiagramTemplateBar({
  onPick,
  disabled
}: {
  onPick: (source: string) => void
  disabled?: boolean
}): JSX.Element {
  const entries = Object.entries(DIAGRAM_TEMPLATES)
  // Controlled so it can be dismissed on use. Mantine only auto-closes a Menu
  // for its own `Menu.Item` children, and these are bare ActionIcons.
  const [moreOpen, setMoreOpen] = useState(false)

  const items: ReactNode[] = entries.map(([id, def]) => (
    <Tooltip key={id} label={def.label} position="bottom">
      <ActionIcon
        variant="subtle"
        size="sm"
        disabled={disabled}
        aria-label={def.label}
        data-testid={`template-${id}`}
        onClick={() => onPick(def.source)}
      >
        <IconTemplate size={15} />
      </ActionIcon>
    </Tooltip>
  ))

  const { split, barRef, slotProps } = useToolbarOverflow(items)
  const visible = split === null ? items : items.slice(0, split)
  const overflowed = split === null ? [] : items.slice(split)

  return (
    <div
      className={classes.templateBar}
      ref={barRef}
      role="toolbar"
      data-testid="template-bar"
      aria-label={UI_TEXT.diagramTemplateLabel}
    >
      {visible.map((item, index) => (
        <span className={classes.templateSlot} key={index} {...slotProps(index)}>
          {item}
        </span>
      ))}
      {overflowed.length > 0 ? (
        <Menu
          position="bottom-end"
          withinPortal
          opened={moreOpen}
          onChange={setMoreOpen}
          // Mantine's Popover default is already false; Menu raises it, and the
          // automatic return-focus on unmount runs after the browser's own focus
          // step, so it moved DOM focus to this trigger and the keystrokes that
          // followed never reached the editor. See the rich toolbar for the full
          // account — the same defect, fixed the same way.
          returnFocus={false}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="sm"
              className={classes.moreButton}
              data-testid="template-more"
              aria-label={UI_TEXT.toolbarMoreLabel}
            >
              <IconTemplate size={15} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown
            className={classes.moreMenu}
            onClick={(event) => {
              // Close on use, unless the control owns its own overlay. None of
              // these do today, but the rule is kept so a future template cannot
              // reintroduce the same fault.
              if (!(event.target as HTMLElement).closest(`[${OVERLAY_OWNER_ATTR}]`))
                setMoreOpen(false)
            }}
          >
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
