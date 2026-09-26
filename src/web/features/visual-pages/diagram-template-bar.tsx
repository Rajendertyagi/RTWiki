import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import type { Icon as TablerIcon } from '@tabler/icons-react'
import {
  IconArrowsExchange,
  IconBinaryTree,
  IconBuildingBridge2Filled,
  IconCalendarEventFilled,
  IconChartAreaFilled,
  IconChartAreaLineFilled,
  IconChartGridDotsFilled,
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
  IconTimelineEventFilled
} from '@tabler/icons-react'
import { type ReactNode, useState } from 'react'
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

type Family = 'flow' | 'structures' | 'timing' | 'thinking' | 'analysis' | 'data'

interface Variant {
  /** Short mark shown at the left of the menu row, e.g. a direction arrow. */
  mark: string
  label: string
  source: string
}

interface Presentation {
  /** Tabler icon component. */
  Icon: TablerIcon
  family: Family
  /** Present only where Mermaid genuinely offers more than one form. */
  variants?: Variant[]
}

/** Family order also fixes the order of the separators. */
const FAMILY_ORDER: Family[] = ['flow', 'structures', 'timing', 'thinking', 'analysis', 'data']

const PRESENTATION: Record<string, Presentation> = {
  flowchart: {
    Icon: IconSitemapFilled,
    family: 'flow',
    variants: [
      {
        mark: '↓',
        label: 'Top to bottom',
        source:
          'flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Do thing]\n    B -->|No| D[Other thing]'
      },
      { mark: '↑', label: 'Bottom to top', source: 'flowchart BT\n    A[Start] --> B[End]' },
      { mark: '←', label: 'Right to left', source: 'flowchart RL\n    A[Start] --> B[End]' },
      { mark: '→', label: 'Left to right', source: 'flowchart LR\n    A[Start] --> B[End]' }
    ]
  },
  state: {
    Icon: IconPlayerPlayFilled,
    family: 'flow',
    variants: [
      {
        mark: 'v2',
        label: 'State diagram',
        source:
          'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Active: start\n    Active --> Idle: stop'
      },
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
  treemap: { Icon: IconChartGridDotsFilled, family: 'data' },
  info: { Icon: IconInfoCircleFilled, family: 'data' }
}

/** Fallback so a template added without an entry here still renders something. */
const FALLBACK: Presentation = { Icon: IconArrowsExchange, family: 'data' }

export function DiagramTemplateBar({ onPick }: { onPick: (source: string) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)

  const buttonFor = (id: string, onClick?: () => void, nativeTitle = false): ReactNode => {
    const def = DIAGRAM_TEMPLATES[id]
    const p = PRESENTATION[id] ?? FALLBACK
    const Icon = p.Icon
    const button = (
      <ActionIcon
        variant="subtle"
        size={BUTTON_SIZE}
        className={classes.templateButton}
        data-family={p.family}
        aria-label={def.label}
        // Native title rather than a Mantine Tooltip when this button is a
        // Menu.Target: Menu.Target attaches its ref to its child, and a Mantine
        // Toolotip in between swallows it, so the menu never opened. `title`
        // needs no ref and still names the button on hover.
        title={nativeTitle ? def.label : undefined}
        data-testid={`template-${id}`}
        onClick={onClick}
      >
        <Icon size={ICON_SIZE} />
      </ActionIcon>
    )
    if (nativeTitle) return button
    return (
      <Tooltip key={id} label={def.label} position="bottom" openDelay={200}>
        {button}
      </Tooltip>
    )
  }

  // A type with real variants gets its own menu; one without loads straight away.
  // The click handler lives on the ActionIcon itself rather than a wrapper, so it
  // is a real button and reachable by keyboard.
  const controlFor = (id: string): ReactNode => {
    const p = PRESENTATION[id] ?? FALLBACK
    if (!p.variants || p.variants.length < 2) {
      return buttonFor(id, () => onPick(DIAGRAM_TEMPLATES[id].source))
    }
    return (
      <Menu
        key={id}
        position="bottom-end"
        withinPortal
        returnFocus={false}
        // Mantine's Popover default is already false; Menu raises it, and the
        // automatic return-focus on unmount runs after the browser's own focus
        // step, which moved DOM focus to the trigger and sent the following
        // keystrokes to the button instead of the editor. See the rich toolbar.
      >
        <Menu.Target>{buttonFor(id, undefined, true)}</Menu.Target>
        {/* Real Menu.Items so Mantine dismisses the menu itself. Plain buttons
            would leave it open and the next click anywhere would be consumed
            closing it — the same fault the rich toolbar's menu had. */}
        <Menu.Dropdown className={classes.moreMenu}>
          {p.variants.map((v) => (
            <Menu.Item
              key={v.label}
              className={classes.variantRow}
              leftSection={<span className={classes.variantMark}>{v.mark}</span>}
              data-testid={`template-variant-${id}-${v.label.replace(/\s+/g, '-')}`}
              onClick={() => onPick(v.source)}
            >
              {v.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    )
  }

  // Entries, ordered by family, with a separator wherever the family changes.
  // Separators are part of the measured list so the fit calculation accounts for
  // their width rather than silently overflowing.
  const ordered = Object.keys(DIAGRAM_TEMPLATES).sort((a, b) => {
    const fa = FAMILY_ORDER.indexOf((PRESENTATION[a] ?? FALLBACK).family)
    const fb = FAMILY_ORDER.indexOf((PRESENTATION[b] ?? FALLBACK).family)
    return fa - fb
  })

  const items: ReactNode[] = []
  let lastFamily: Family | null = null
  for (const id of ordered) {
    const family = (PRESENTATION[id] ?? FALLBACK).family
    if (lastFamily !== null && family !== lastFamily) {
      items.push(<span className={classes.templateSep} key={`sep-${family}`} aria-hidden="true" />)
    }
    lastFamily = family
    items.push(controlFor(id))
  }

  const { split, barRef, slotProps } = useToolbarOverflow(items, {
    // The trailing button here is 48px, not the hook's 28px default. Left at the
    // default the fit calculation budgets too little room, and the row overflowed
    // by 13px instead of splitting.
    moreButtonWidth: BUTTON_SIZE
  })
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
          <Menu.Dropdown
            className={classes.moreMenu}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button')) setMoreOpen(false)
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
