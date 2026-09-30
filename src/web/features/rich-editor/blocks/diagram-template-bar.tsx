import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconDotsVertical } from '@tabler/icons-react'
import { isValidElement, type ReactNode, useState } from 'react'
import { UI_TEXT } from '../../../config/index.js'
import { useToolbarOverflow } from '../../../hooks/use-toolbar-overflow.js'
import { DIAGRAM_TEMPLATES, type DiagramTemplateId, diagramTemplateFor } from '../insert-blocks.js'
import classes from './diagram-template-bar.module.css'
import {
  BUTTON_SIZE,
  DIAGRAM_TEMPLATE_FAMILIES,
  type DiagramTemplateOption,
  diagramTemplateOptions,
  diagramTemplatePresentationIds,
  type Family,
  hasVariants,
  ICON_SIZE,
  presentationFor,
  ROW_ICON_SIZE,
  type Variant
} from './diagram-template-catalog.js'

/**
 * The flat diagram-template bar component.
 *
 * The catalogue itself lives in `./diagram-template-catalog.ts`. It is separate
 * because the Playwright specs that verify every template render run in Node,
 * which cannot parse a `.module.css` import - and `insert-blocks.ts` needs the
 * catalogue. The names below are re-exported so existing importers of this module
 * keep working unchanged.
 */
export {
  DIAGRAM_TEMPLATE_FAMILIES,
  type DiagramTemplateOption,
  diagramTemplateOptions,
  diagramTemplatePresentationIds
} from './diagram-template-catalog.js'

export function DiagramTemplateBar({ onPick }: { onPick: (source: string) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)

  const pickDefault = (id: string): void => onPick(diagramTemplateFor(id).source)

  /**
   * The toolbar button. A template with variants opens a menu instead, so it
   * gets no click handler; one without loads its source on a single click.
   */
  const barButton = (id: string): ReactNode => {
    const def = diagramTemplateFor(id)
    const { Icon } = presentationFor(id)
    const button = (
      <ActionIcon
        variant="subtle"
        size={BUTTON_SIZE}
        className={classes.templateButton}
        data-family={presentationFor(id).family}
        aria-label={def.label}
        // A native title rather than a Mantine Tooltip when this button is a
        // Menu.Target: the Tooltip sits between the target and the DOM node and
        // takes the ref, so the menu never opened. `title` needs no ref.
        title={hasVariants(id) ? def.label : undefined}
        data-testid={`template-${id}`}
        onClick={hasVariants(id) ? undefined : () => pickDefault(id)}
      >
        <Icon size={ICON_SIZE} />
      </ActionIcon>
    )
    if (hasVariants(id)) return button
    return (
      <Tooltip key={id} label={def.label} position="bottom" openDelay={200}>
        {button}
      </Tooltip>
    )
  }

  /**
   * The source a variant row loads: its own, or the template's canonical source
   * when the row is the default form. One definition per diagram, never two.
   */
  const variantSource = (id: string, variant: Variant): string =>
    variant.source ?? diagramTemplateFor(id).source

  /** One row inside the trailing dropdown, as a real menu item. */
  const menuRow = (id: string): ReactNode => {
    const def = diagramTemplateFor(id)
    const { Icon, variants } = presentationFor(id)
    const section = <Icon size={ROW_ICON_SIZE} />
    if (!variants || variants.length < 2) {
      return (
        <Menu.Item
          key={id}
          leftSection={section}
          data-testid={`template-row-${id}`}
          onClick={() => pickDefault(id)}
        >
          {def.label}
        </Menu.Item>
      )
    }
    // Mantine documents Menu.Sub as the supported nesting mechanism. A Menu
    // inside a Menu.Dropdown does not work: the outer dropdown's focus handling
    // fights the inner one and the submenu never opens.
    return (
      <Menu.Sub key={id} openDelay={120} closeDelay={150}>
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={section} data-testid={`template-row-${id}`}>
            {def.label}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>
          {variants.map((v) => (
            <Menu.Item
              key={v.label}
              leftSection={<span className={classes.variantMark}>{v.mark}</span>}
              data-testid={`template-variant-${id}-${v.label.replace(/\s+/g, '-')}`}
              onClick={() => onPick(variantSource(id, v))}
            >
              {v.label}
            </Menu.Item>
          ))}
        </Menu.Sub.Dropdown>
      </Menu.Sub>
    )
  }

  // Ordered by family, with a separator wherever the family changes. Separators
  // take part in the measurement so the fit calculation accounts for them.
  const ordered = diagramTemplateOptions().map((option) => option.id)

  // `slots[i]` records what item i is, so the overflow dropdown can be rebuilt
  // as real menu rows instead of the nodes that overflowed.
  const slots: Array<{ kind: 'template'; id: string } | { kind: 'separator'; family: Family }> = []
  const items: ReactNode[] = []
  let lastFamily: Family | null = null
  for (const id of ordered) {
    const family = presentationFor(id).family
    if (lastFamily !== null && family !== lastFamily) {
      slots.push({ kind: 'separator', family })
      items.push(<span className={classes.templateSep} key={`sep-${family}`} aria-hidden="true" />)
    }
    lastFamily = family
    slots.push({ kind: 'template', id })
    if (hasVariants(id)) {
      items.push(
        <Menu key={id} position="bottom-end" withinPortal returnFocus={false}>
          <Menu.Target>{barButton(id)}</Menu.Target>
          <Menu.Dropdown className={classes.moreMenu}>
            {presentationFor(id).variants?.map((v) => (
              <Menu.Item
                key={v.label}
                leftSection={<span className={classes.variantMark}>{v.mark}</span>}
                data-testid={`template-variant-${id}-${v.label.replace(/\s+/g, '-')}`}
                onClick={() => onPick(variantSource(id, v))}
              >
                {v.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )
    } else {
      items.push(barButton(id))
    }
  }

  const { split, barRef, slotProps } = useToolbarOverflow(items, {
    // The trailing button is the same width as every other control in the bar, so
    // the fit calculation budgets exactly the row it will actually occupy.
    moreButtonWidth: BUTTON_SIZE,
    // Without this the split can land immediately after a separator, and the
    // dropdown then opens on a divider with no family above it.
    isDivider: (node) =>
      isValidElement(node) &&
      (node.props as { className?: string }).className === classes.templateSep
  })

  const visible = split === null ? items : items.slice(0, split)
  const overflowedSlots = split === null ? [] : slots.slice(split)

  /**
   * A control's stable identity, for the wrapper that carries its measured width.
   * Every node pushed into `items` above is keyed by its template id, so this
   * keeps a button's DOM node across a resize instead of rebuilding it, which
   * would drop the tooltip's open state and the menu's own open state with it.
   */
  const keyFor = (item: ReactNode): string =>
    isValidElement(item) && item.key !== null ? String(item.key) : ''

  return (
    <div
      className={classes.templateBar}
      ref={barRef}
      role="toolbar"
      data-testid="template-bar"
      aria-label={UI_TEXT.diagramTemplateLabel}
    >
      {visible.map((item, index) => (
        <span className={classes.templateSlot} key={keyFor(item)} {...slotProps(index)}>
          {item}
        </span>
      ))}
      {overflowedSlots.length > 0 ? (
        <Menu
          position="bottom-end"
          withinPortal
          opened={moreOpen}
          onChange={setMoreOpen}
          returnFocus={false}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size={BUTTON_SIZE}
              className={classes.moreButton}
              data-testid="template-more"
              aria-label={UI_TEXT.toolbarMoreLabel}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <IconDotsVertical size={ICON_SIZE} />
            </ActionIcon>
          </Menu.Target>
          {/* Real Menu.Items and Menu.Subs rather than the nodes that overflowed.
              As well as making the submenus open, this is what makes the
              dropdown reachable by keyboard: Mantine moves focus with the arrow
              keys and gives each row role="menuitem". */}
          <Menu.Dropdown className={classes.moreMenu}>
            {overflowedSlots.map((slot) =>
              slot.kind === 'separator' ? (
                // Each family appears once in the ordered list, so the family
                // names the separator uniquely - no array index needed.
                <Menu.Divider key={`sep-${slot.family}`} />
              ) : (
                menuRow(slot.id)
              )
            )}
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </div>
  )
}
