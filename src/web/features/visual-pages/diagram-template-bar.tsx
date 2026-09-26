import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import {
  IconArrowsExchange,
  IconBinaryTree,
  IconBuildingBridge2Filled,
  IconCalendarEventFilled,
  IconChartAreaFilled,
  IconChartAreaLineFilled,
  IconChartPieFilled,
  IconColumns3Filled,
  IconDatabaseFilled,
  IconDotsVertical,
  IconFishBoneFilled,
  IconGitBranch,
  IconInfoCircleFilled,
  IconLayoutGridFilled,
  IconMoodCrazyHappyFilled,
  IconPlayerPlayFilled,
  IconRadarFilled,
  IconSitemapFilled,
  IconStack2Filled,
  IconStackFilled,
  IconTableFilled,
  IconTimelineEventFilled,
  type Icon as TablerIcon
} from '@tabler/icons-react'
import { isValidElement, type ReactNode, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { useToolbarOverflow } from '../../hooks/use-toolbar-overflow.js'
import { DIAGRAM_TEMPLATES } from '../rich-editor/insert-blocks.js'
import classes from './mermaid-workspace.module.css'

/**
 * Flat diagram-template bar.
 *
 * Same behaviour as the rich document toolbar: one row, never wrapping, never
 * scrolling, and whatever does not fit moves into a trailing dropdown, measured
 * by the shared `useToolbarOverflow` so the two toolbars cannot drift apart.
 *
 * Icons are Tabler's FILLED variants, at 36px, coloured by family. The first
 * attempt used 15px outline glyphs and read badly: at that size several were
 * near-identical thin strokes, which is what made the bar unusable rather than
 * merely plain. Filled icons carry the meaning in the shape, colour groups the
 * families, and the name is on hover.
 *
 * Every template listed here is verified to render by
 * `tests/browser/diagram-templates.pwspec.ts`; one that stops rendering fails
 * that test rather than reaching the user.
 */

/** Deliberately large. These are the primary control on the page. */
const ICON_SIZE = 36
const BUTTON_SIZE = ICON_SIZE + 12
/** Icons inside menu rows sit at text scale, not toolbar scale. */
const ROW_ICON_SIZE = 18

type Family = 'flow' | 'structures' | 'timing' | 'thinking' | 'analysis' | 'data'

interface Variant {
  /** Short mark shown at the left of the menu row, e.g. a direction arrow. */
  mark: string
  label: string
  /**
   * Omitted on the first row of a template's variants, which then uses the
   * template's own `source` from `DIAGRAM_TEMPLATES`.
   *
   * That row is the default form, so restating its source here would give the
   * same diagram two definitions that can drift apart - which is exactly what
   * had happened: the copy here had lost a line the canonical one still had.
   */
  source?: string
}

interface Presentation {
  /** Tabler icon component. */
  Icon: TablerIcon
  family: Family
  /**
   * Present only where Mermaid genuinely offers more than one form. Ordered with
   * the default form first, reusing the template's own source.
   */
  variants?: Variant[]
}

/** Family order also fixes where the separators fall. */
const FAMILY_ORDER: Family[] = ['flow', 'structures', 'timing', 'thinking', 'analysis', 'data']

const PRESENTATION: Record<string, Presentation> = {
  flowchart: {
    Icon: IconSitemapFilled,
    family: 'flow',
    variants: [
      { mark: '↓', label: 'Top to bottom' },
      { mark: '↑', label: 'Bottom to top', source: 'flowchart BT\n    A[Start] --> B[End]' },
      { mark: '←', label: 'Right to left', source: 'flowchart RL\n    A[Start] --> B[End]' },
      { mark: '→', label: 'Left to right', source: 'flowchart LR\n    A[Start] --> B[End]' }
    ]
  },
  state: {
    Icon: IconPlayerPlayFilled,
    family: 'flow',
    variants: [
      { mark: 'v2', label: 'State diagram' },
      {
        mark: 'v1',
        label: 'State (older syntax)',
        source: 'stateDiagram\n    [*] --> Idle\n    Idle --> Active'
      }
    ]
  },
  er: { Icon: IconDatabaseFilled, family: 'flow' },
  class: { Icon: IconStack2Filled, family: 'structures' },
  kanban: { Icon: IconColumns3Filled, family: 'structures' },
  block: { Icon: IconLayoutGridFilled, family: 'structures' },
  sequence: { Icon: IconArrowsExchange, family: 'timing' },
  gantt: { Icon: IconCalendarEventFilled, family: 'timing' },
  timeline: { Icon: IconTimelineEventFilled, family: 'timing' },
  pie: { Icon: IconChartPieFilled, family: 'timing' },
  mindmap: { Icon: IconBinaryTree, family: 'thinking' },
  userJourney: { Icon: IconMoodCrazyHappyFilled, family: 'thinking' },
  gitGraph: { Icon: IconGitBranch, family: 'thinking' },
  ishikawa: { Icon: IconFishBoneFilled, family: 'thinking' },
  sankey: { Icon: IconChartAreaFilled, family: 'analysis' },
  xychart: { Icon: IconChartAreaLineFilled, family: 'analysis' },
  radar: { Icon: IconRadarFilled, family: 'analysis' },
  packet: { Icon: IconStackFilled, family: 'data' },
  requirement: { Icon: IconTableFilled, family: 'data' },
  c4: { Icon: IconBuildingBridge2Filled, family: 'data' },
  info: { Icon: IconInfoCircleFilled, family: 'data' }
}

/** Fallback so a template added without an entry here still renders something. */
const FALLBACK: Presentation = { Icon: IconArrowsExchange, family: 'data' }

const presentationFor = (id: string): Presentation => PRESENTATION[id] ?? FALLBACK
const hasVariants = (id: string): boolean => (presentationFor(id).variants?.length ?? 0) > 1

export function DiagramTemplateBar({ onPick }: { onPick: (source: string) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)

  const pickDefault = (id: string): void => onPick(DIAGRAM_TEMPLATES[id].source)

  /**
   * The toolbar button. A template with variants opens a menu instead, so it
   * gets no click handler; one without loads its source on a single click.
   */
  const barButton = (id: string): ReactNode => {
    const def = DIAGRAM_TEMPLATES[id]
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
    variant.source ?? DIAGRAM_TEMPLATES[id].source

  /** One row inside the trailing dropdown, as a real menu item. */
  const menuRow = (id: string): ReactNode => {
    const def = DIAGRAM_TEMPLATES[id]
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
  const ordered = Object.keys(DIAGRAM_TEMPLATES).sort((a, b) => {
    const fa = FAMILY_ORDER.indexOf(presentationFor(a).family)
    const fb = FAMILY_ORDER.indexOf(presentationFor(b).family)
    return fa - fb
  })

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
    // The trailing button here is 48px, not the hook's 28px default. Left at the
    // default the fit calculation budgets too little room and the row overflowed
    // by 13px instead of splitting.
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
