/**
 * The diagram template catalogue, as data.
 *
 * ## Why the catalogue is not inside `diagram-template-bar.tsx`
 *
 * `tests/browser/diagram-templates.pwspec.ts` runs under the Playwright runner,
 * which executes specs in Node with no CSS pipeline. It imports `insert-blocks.ts`
 * for `DIAGRAM_TEMPLATES`, and `insert-blocks.ts` needs this same list to build the
 * rich-note submenu. The list lived in the bar's component file, so importing it
 * pulled in `diagram-template-bar.module.css`, and Node tried to parse the
 * stylesheet as JavaScript:
 *
 *     SyntaxError: diagram-template-bar.module.css: Unexpected token (9:0)
 *
 * The spec could not load at all. This is a view/data split rather than a
 * test-side workaround: the catalogue is plain data with no styling, so it belongs
 * in a module with no stylesheet dependency. The component imports it, and nothing
 * imports the component for data alone.
 *
 * The Tabler icon imports are kept on purpose. `PRESENTATION` stores icon
 * components, so this data is not icon-free - but importing `@tabler/icons-react`
 * is safe under Node, unlike a `.module.css` import.
 */

import {
  IconArrowsExchange,
  IconBinaryTree,
  IconBoltFilled,
  IconBuildingBridge2Filled,
  IconBulbFilled,
  IconCalendarEventFilled,
  IconChartAreaFilled,
  IconChartAreaLineFilled,
  IconChartPieFilled,
  IconCirclesRelation,
  IconColumns3Filled,
  IconDatabaseFilled,
  IconDotsVertical,
  IconFishBoneFilled,
  IconGitBranch,
  IconGridDots,
  IconHierarchy3,
  IconInfoCircleFilled,
  IconLayoutDashboardFilled,
  IconLayoutGridFilled,
  IconMap2,
  IconMoodCrazyHappyFilled,
  IconPlayerPlayFilled,
  IconRadarFilled,
  IconRobot,
  IconSitemapFilled,
  IconStack2Filled,
  IconStackFilled,
  IconTableFilled,
  IconTimelineEventFilled,
  IconTrain,
  type Icon as TablerIcon
} from '@tabler/icons-react'
import { UI_TEXT } from '../../../config/index.js'
import { DIAGRAM_TEMPLATES, type DiagramTemplateId, diagramTemplateFor } from '../insert-blocks.js'

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

/**
 * Sized to the shared toolbar row rather than chosen for effect.
 *
 * The bar lives in the page's toolbar row, which is `--rtwiki-toolbar-height`
 * (40px) and is the same height the Rich Note's toolbar uses. A larger control
 * overflows that row, and the point of putting the templates up here is that the
 * Diagram page reads like every other page type. These were 36/48 when the bar
 * sat inside the diagram edit pane, where a bigger primary control was correct.
 */
export const ICON_SIZE = 24
export const BUTTON_SIZE = ICON_SIZE + 8
/** Icons inside menu rows sit at text scale, not toolbar scale. */
export const ROW_ICON_SIZE = 18

export type Family = 'flow' | 'structures' | 'timing' | 'thinking' | 'analysis' | 'data'

export interface Variant {
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

export interface Presentation {
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
export const FAMILY_ORDER: Family[] = [
  'flow',
  'structures',
  'timing',
  'thinking',
  'analysis',
  'data'
]

/**
 * The icon and family every template is shown with.
 *
 * ## Typed as a total map on purpose
 *
 * `Record<DiagramTemplateId, Presentation>` means this object must have an entry
 * for **every** template and must not have an entry for anything that is not a
 * template. Both directions are compile errors, so a template can no longer be
 * added without an icon, and an icon cannot linger for a deleted template.
 *
 * This is the fix for the defect, not the icons themselves. There were nine
 * templates with no entry here — `quadrantChart`, `treemap`, `treeView`, `venn`,
 * `railroad`, `wardley`, `eventmodeling`, `usecase`, `agentflow` — and all nine
 * silently rendered the *same* `FALLBACK` glyph, so a third of the bar was
 * indistinguishable. A shared fallback is what made that invisible: it renders
 * happily, so nothing fails and nothing reports it. There is no fallback here any
 * more, and `tests/diagram-template-presentation.test.ts` asserts the same parity
 * at runtime, because a type is not a test.
 */
const PRESENTATION: Record<DiagramTemplateId, Presentation> = {
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
  info: { Icon: IconInfoCircleFilled, family: 'data' },
  // The nine that were missing. Each is a distinct glyph, verified to exist in
  // the installed @tabler/icons-react rather than assumed — an import of a
  // non-existent name is a build error, but a *mistaken* choice is not, so these
  // were checked against the package's own declarations.
  //
  // Families place them with what they are rather than at the end:
  //   analysis    - quadrantChart, treemap, venn (comparison and area charts)
  //   structures  - treeView, railroad (shapes and sequences)
  //   thinking    - wardley, eventmodeling, usecase (domain and evolution views)
  //   flow        - agentflow (a flow of participants)
  quadrantChart: { Icon: IconGridDots, family: 'analysis' },
  treemap: { Icon: IconLayoutDashboardFilled, family: 'analysis' },
  venn: { Icon: IconCirclesRelation, family: 'analysis' },
  treeView: { Icon: IconHierarchy3, family: 'structures' },
  railroad: { Icon: IconTrain, family: 'structures' },
  wardley: { Icon: IconMap2, family: 'thinking' },
  eventmodeling: { Icon: IconBoltFilled, family: 'thinking' },
  usecase: { Icon: IconBulbFilled, family: 'thinking' },
  agentflow: { Icon: IconRobot, family: 'flow' }
}

/**
 * The presentation for a template id.
 *
 * No fallback, deliberately. The type signature is what guarantees an entry
 * exists, so a `??` here would be unreachable code that also re-opens the exact
 * silent-failure path this map was typed to close. Callers hold a `string` only
 * because they are driven by DOM ids; the value they pass always came from
 * `Object.keys(DIAGRAM_TEMPLATES)`.
 */
/**
 * Presentation lookup for the bar's own rendering, and for the overflow
 * measurement it shares. Exported because the component needs it; it is not part
 * of the catalogue's public surface.
 */
export const presentationFor = (id: string): Presentation =>
  PRESENTATION[id as DiagramTemplateId] satisfies Presentation
/** @see presentationFor */
export const hasVariants = (id: string): boolean => (presentationFor(id).variants?.length ?? 0) > 1

/** One template with the presentation the bar gives it, for any surface. */
export interface DiagramTemplateOption {
  id: string
  label: string
  /** The Mermaid source inserted when this template is chosen. */
  source: string
  Icon: TablerIcon
  family: Family
}

/**
 * The family ids, in bar order.
 *
 * Exported for the parity test, which asserts every template's family is one of
 * these — a typo'd family would otherwise sort to the end of the row and colour
 * it as nothing, which is invisible rather than loud.
 */
export const DIAGRAM_TEMPLATE_FAMILIES: readonly Family[] = FAMILY_ORDER

/**
 * The ids PRESENTATION actually holds, for the parity test.
 *
 * `PRESENTATION` is private on purpose — nothing outside this module should read
 * it, because the supported way to get a template's presentation is
 * `diagramTemplateOptions()`. This one accessor exists so the test can compare
 * the two key sets in **both** directions at runtime, which the type system
 * already guarantees but a test must still demonstrate: a type is not a test, and
 * a future refactor could widen the annotation back to `Record<string, …>` and
 * only this would notice.
 */
export function diagramTemplatePresentationIds(): string[] {
  return Object.keys(PRESENTATION)
}

/**
 * Every template in the shared list, in the same family order the bar uses.
 *
 * Exported so the rich-note toolbar's Mermaid submenu offers exactly what this
 * bar offers. The list, the labels, the sources and the presentation all come
 * from here and from DIAGRAM_TEMPLATES; no second Mermaid template list exists
 * anywhere in the application.
 *
 * Order is by family, and by declaration order within a family — `sort` is
 * stable, so a template added to DIAGRAM_TEMPLATES lands beside its neighbours
 * rather than at an end. A template with no entry in PRESENTATION is now a
 * compile error rather than a silent generic icon, so the list and what is
 * offered cannot disagree about what exists.
 */
export function diagramTemplateOptions(): DiagramTemplateOption[] {
  return Object.entries(DIAGRAM_TEMPLATES)
    .map(([id, def]) => {
      const { Icon, family } = presentationFor(id)
      return { id, label: def.label, source: def.source, Icon, family }
    })
    .sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family))
}
