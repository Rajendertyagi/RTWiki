import { Menu, ScrollArea } from '@mantine/core'
import { type JSX, useEffect, useRef } from 'react'
import { LAYOUT } from '../../../config/index.js'
import { diagramTemplateFor } from '../insert-blocks.js'
import { TemplateFamilyIcon } from './diagram-template-bar.js'
import {
  diagramTemplateOptions,
  type Family,
  presentationFor,
  ROW_ICON_SIZE,
  type Variant
} from './diagram-template-catalog.js'
import classes from './diagram-template-menu.module.css'

/**
 * The Mermaid template chooser, as menu contents with no trigger of its own.
 *
 * ## Why this exists as a shared component
 *
 * The template list had two renderings and they had drifted. The Diagram page drew
 * a row of 40px icon buttons on a bar; the Rich Note drew an 18px icon per menu
 * row in Mantine's default text colour. `TemplateFamilyIcon` had already been
 * introduced to stop exactly that drift, but only the *icon* was shared — the
 * surrounding menu markup was written twice, and the two copies had different test
 * ids, so a change to one was invisible to the suite covering the other.
 *
 * This is that menu, once. Both surfaces supply their own test-id prefixes, because
 * their specs address the rows by id and those ids predate this component:
 *
 * - the Rich Note's toolbar uses `insert-diagram-submenu` and
 *   `insert-diagram-option-<id>`, asserted by `diagram-templates.pwspec.ts` to
 *   contain every key in `DIAGRAM_TEMPLATES` and nothing else. That test is the
 *   statement that one catalogue backs both surfaces, so it is worth preserving
 *   exactly.
 * - the Diagram page's own dropdown uses `template-row-<id>` and
 *   `template-variant-<id>-<label>`, asserted by
 *   `diagram-template-bar-layout.pwspec.ts`.
 *
 * The catalogue is read through `diagramTemplateOptions()`, never from a local
 * list, which is what makes that Rich Note assertion meaningful: a template added
 * to `DIAGRAM_TEMPLATES` appears here without this file being edited.
 */
export interface DiagramTemplateMenuProps {
  /** Called with the Mermaid source to load. */
  onPick: (source: string) => void
  /** `data-testid` for each template row: `${prefix}-<templateId>`. */
  optionTestIdPrefix: string
  /** `data-testid` for the container the rows live in. */
  containerTestId: string
  /** Accessible name for the group of rows. */
  label: string
}
export function DiagramTemplateMenu({
  onPick,
  optionTestIdPrefix,
  containerTestId,
  label
}: DiagramTemplateMenuProps): JSX.Element {
  const ordered = diagramTemplateOptions().map((option) => option.id)
  const panelRef = useRef<HTMLDivElement>(null)

  /*
   * Focus the panel when it opens, and let the arrow keys walk the rows.
   *
   * Both halves are needed for the panel to behave like the menu it presents.
   * Focus on open is what puts Escape inside the dropdown, where Mantine's
   * `onKeyDownCapture` can see it — without it the chooser cannot be dismissed from
   * the keyboard at all. The arrow keys then move between rows, which is what
   * `role="menuitem"` promises; `Menu.Item` styles the focused row, so the visible
   * focus and the roving index are the same thing.
   *
   * Home/End jump to the ends, matching the roving rule the shared toolbar uses.
   */
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const rows = () =>
      Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])'))

    const first = rows()[0]
    first?.focus()

    const onPanelKeyDown = (event: KeyboardEvent): void => {
      const items = rows()
      if (items.length === 0) return
      const current = items.indexOf(document.activeElement as HTMLElement)
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        const next = current === -1 ? 0 : (current + step + items.length) % items.length
        items[next]?.focus()
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        ;(event.key === 'Home' ? items[0] : items[items.length - 1])?.focus()
      }
    }
    panel.addEventListener('keydown', onPanelKeyDown)
    return () => panel.removeEventListener('keydown', onPanelKeyDown)
  }, [])

  return (
    /*
     * `Menu`, forced open, and **no `Menu.Dropdown`**.
     *
     * The `Menu` stays for one reason: `Menu.Item` reads menu context, so the rows
     * keep their `role="menuitem"`, their padding and their keyboard behaviour.
     *
     * The `Menu.Dropdown` is gone, and its absence was the bug. A `Menu.Dropdown` is
     * itself a positioned floating element: it resolves its own position against a
     * `Menu.Target`, and this component has no target, because the shell's `Popover`
     * *is* the trigger. With no reference to measure against, floating-ui falls back
     * to the viewport origin, so the panel was drawn at the bottom-left of the
     * window with no relation to the button that opened it. Measured at 1440x900:
     * the chooser reported `x: 0, y: 900` with `inset: 0px 1276.97px -123.906px 0px`
     * and `height: 1024`, while the trigger sat at `x: 1115, y: 46`. Every row was
     * at `x: 5`, the panel ran off the bottom of the window, and the rows were
     * unclickable — which is why the chooser appeared at the left edge of the page
     * and why picking a template inserted nothing.
     *
     * `Popover.Dropdown` is the element that places this panel, and it does that
     * correctly: the shared `SwatchPanel` sits in the very same slot as a plain
     * `div` and lands under its button. So the rows go straight into a plain
     * container and the one popover in the path owns the geometry. One positioner per
     * panel, not two that disagree.
     *
     * Visibility is unchanged: the shell only renders this component while the
     * popover is open, and unmounting it is what closes the panel.
     *
     * `tabIndex={-1}` plus the focus effect below is what keeps Escape working, and
     * it is not incidental. Mantine's `PopoverDropdown` closes on Escape through
     * `onKeyDownCapture` **on the dropdown**, so the key only reaches it when focus is
     * inside the panel. The old `Menu.Dropdown` focused itself when it opened, which
     * is why Escape used to close this chooser and why dropping the dropdown silently
     * broke it — measured, the panel stayed visible after Escape and the trigger kept
     * reporting `aria-expanded="true"`. Focus moves to the first row, which is what a
     * menu is expected to do when it opens, so the same key closes it again.
     */
    <Menu opened aria-label={label}>
      {/*
       * `ScrollArea.Autosize`, which is the shape Mantine's own docs use for a
       * scrolling list inside a `Popover`: the panel grows to fit its rows and only
       * scrolls once it reaches the cap. Thirty templates is about 1000px, which does
       * not fit an ordinary window, so something has to cap it — and doing that with
       * the component rather than with `overflow-y: auto` on a plain `div` is what
       * puts RTWiki's scrollbar on this panel.
       *
       * `type="always"` rather than the default `hover`: a dropdown's scrollbar is
       * also the only signal that there are more templates below, and hiding it until
       * the pointer happens to be over the panel trades discoverability for a
       * slightly quieter row. `scrollbars="y"` because this list is one column; the
       * horizontal axis is meaningless here and `Autosize` would have to suppress it.
       *
       * `mah` is `LAYOUT.panelMaxHeight`, the same number the stylesheets read as
       * `--rtwiki-panel-max-height`.
       */}
      <ScrollArea.Autosize mah={LAYOUT.panelMaxHeight} type="always" scrollbars="y">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a menu container takes focus when it opens so the arrow keys and Escape reach it; see the note above. */}
        <div
          className={classes.panel}
          data-testid={containerTestId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          ref={panelRef}
        >
          {ordered.map((id) => {
            const def = diagramTemplateFor(id)
            const { Icon, family } = presentationFor(id)
            // The same coloured glyph the bar shows, at text scale. A bare
            // `<Icon size={18} />` would be painted in the default text colour, so
            // every template would look alike and unlike itself on the bar.
            const section = <TemplateFamilyIcon option={{ Icon, family }} size={ROW_ICON_SIZE} />

            /*
             * Every row inserts its template's canonical source. No row opens a
             * submenu, which is a deliberate difference from the Diagram page's bar.
             *
             * The bar is a row of icon buttons with room for a submenu beside each
             * one, and there it is right that a click must never choose a variant on
             * the user's behalf. A menu row has no such room and, more to the point,
             * this chooser never offered variants: the existing spec clicks
             * `insert-diagram-option-flowchart` and expects the flowchart inserted,
             * and flowchart is precisely the template that has variants. Rendering it
             * as a submenu target made the click do nothing — measured, the row was
             * visible and clicked and no block was inserted.
             *
             * So the variants are unchanged and still reachable, on the bar, where
             * they were always offered. Nothing is removed here; a row that never
             * inserted is not a feature.
             *
             * The row's `data-testid` is exactly `${prefix}-<id>` and nothing else,
             * because `diagram-templates.pwspec.ts` asserts that the chooser offers
             * every key in `DIAGRAM_TEMPLATES` and nothing else. A nested variant row
             * carrying the same prefix would fail that, correctly.
             */
            return (
              <Menu.Item
                key={id}
                leftSection={section}
                data-testid={`${optionTestIdPrefix}-${id}`}
                data-family={family satisfies Family}
                onClick={() => onPick(def.source)}
              >
                {def.label}
              </Menu.Item>
            )
          })}
        </div>
      </ScrollArea.Autosize>
    </Menu>
  )
}
