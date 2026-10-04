import { ActionIcon, Popover, ScrollArea, Tooltip } from '@mantine/core'
import { Children, isValidElement, type ReactNode, useCallback, useMemo, useState } from 'react'

import { LAYOUT } from '../../config/index.js'
import { useToolbarOverflow } from '../../hooks/use-toolbar-overflow.js'
import {
  AVAILABLE,
  type Availability,
  type Capability,
  type EditorCapabilities,
  type EditorMenu
} from './capabilities.js'
import classes from './document-toolbar.module.css'
import {
  ICON_SIZE,
  OVERFLOW_CONTROL,
  TOOLBAR_CONTROLS,
  TOOLBAR_GROUPS,
  TOOLBAR_LABEL,
  type ToolbarControl
} from './toolbar-model.js'
import { useRovingFocus } from './use-roving-focus.js'

/**
 * The one toolbar shell. Every editor surface renders this; none of them
 * renders its own bar.
 *
 * ## What this component is not allowed to know
 *
 * It does not know that Markdown exists, that CodeMirror has a `view`, or that
 * BlockNote has `toggleStyles`. It is handed an {@link EditorCapabilities} and
 * renders `TOOLBAR_CONTROLS` filtered to what that record implements. Every
 * editor-specific decision belongs in an adapter, not here ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â that is the whole
 * reason the model in `toolbar-model.ts` is data.
 */
export interface DocumentToolbarProps {
  /** What the active editor can do. See `capabilities.ts` for the contract. */
  capabilities: EditorCapabilities
  /**
   * Rendered at the end of the bar, after the overflow control. For a surface
   * that owns actions which are not formatting commands ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the Diagram page's
   * "add diagram" buttons, the HTML page's pane switch.
   */
  trailing?: ReactNode
  /**
   * `data-testid` for the bar itself.
   *
   * A surface may name its own bar, because the ids already in the test suite are
   * part of the project's test surface: the HTML page's suite addresses its row by
   * `source-toolbar`, which is what that row was called before it joined this shell.
   *
   * It is a prop rather than a value the shell derives, because the shell cannot know
   * what a surface's row was called ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and guessing from the page type would put an
   * HTML-specific name in shared code. Optional, and unset on every other surface.
   */
  testId?: string
}

/**
 * One entry in the bar: the node to render, and whether it opens a
 * right-aligned group.
 *
 * The flag travels beside the node because the box that must carry
 * `margin-left: auto` is the slot wrapper the bar renders around the node, not
 * the node itself ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the slot is the flex child, and an `auto` margin on
 * something inside a shrink-wrapped flex item has no free space to consume.
 */
interface BarEntry {
  readonly node: ReactNode
  readonly pinned: boolean
}

/** One resolved control: the declared control plus this editor's answer. */
interface ResolvedControl {
  readonly control: ToolbarControl
  /**
   * The accessible name for this moment.
   *
   * The model's label, unless the surface supplied a different one for the current
   * state ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â which only a control whose action depends on where it is needs, today
   * that is fullscreen. Resolved once here so both button variants read the same
   * value rather than each consulting `state` separately.
   */
  readonly label: string
  /** Never undefined: the resolver substitutes AVAILABLE for a silent capability. */
  readonly availability: Availability
  readonly active: boolean
  /** The panel this control opens, when it opens one. */
  readonly menu: EditorMenu | null
  readonly run: (() => void) | null
}

function isDivider(node: ReactNode): boolean {
  return (
    isValidElement(node) && (node.props as { className?: string }).className === classes.divider
  )
}

/**
 * Separators are dropped from the overflowed run. They are rules between groups
 * on the bar; inside a wrapping panel they render as stray marks with nothing to
 * divide, and a leading one dangles at the top.
 */
function withoutDividers(nodes: ReactNode[]): ReactNode[] {
  return nodes.filter((node) => !isDivider(node))
}

export function DocumentToolbar({
  capabilities,
  trailing,
  testId
}: DocumentToolbarProps): React.ReactElement {
  const [moreOpen, setMoreOpen] = useState(false)
  /**
   * Which control's own menu is open, by capability.
   *
   * One piece of shared state rather than one per control: a toolbar has at most
   * one menu open, and a state entry per control would mean 35 booleans and no
   * way to close one by opening another. Held by capability key, not by index,
   * so a control that moves into the overflow keeps its menu.
   */
  const [menuCapability, setMenuCapability] = useState<Capability | null>(null)

  /*
   * The live state, read on **every render** rather than memoised.
   *
   * This was memoised on `[capabilities]` and it was wrong, in a way only a
   * cross-surface test could find. `capabilities.state()` is a *reader*, not a
   * value: a surface implements it over its own reactive primitive ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â BlockNote's
   * `useEditorState`, or a CodeMirror view. Memoising the result froze it at the
   * first read, and because a capabilities object is built once per surface, the
   * memo never recomputed.
   *
   * The failure was quiet and total. On a Rich Note every command worked ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â bold
   * painted a `<strong>`, undo removed it ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â while every pressed indicator stayed
   * `false` forever. Nothing threw. The Markdown tests passed, because that
   * adapter is a plain function over a live view and its surface re-renders for
   * other reasons.
   *
   * The cost of dropping the memo is one `state()` call per render, which is
   * cheap and is the only way a reactive editor's state can reach the bar at all.
   * A surface that wanted to be lazier would push a new value down rather than
   * have the shell guess when to look.
   */
  const state = capabilities.state()

  /**
   * The control list, as this editor resolves it.
   *
   * Built from the single declared list, so every surface gets the same controls
   * in the same order and the row cannot reflow between page types.
   *
   * Every declared control is rendered, whether or not this editor has a command
   * for it. That is the decision that matters here, and it is the opposite of the
   * obvious one: a capability with no command is *not* dropped, it is rendered
   * greyed with the reason the surface gave for it.
   *
   * Dropping it was tried first and measured: on a Markdown page it produced a bar
   * with **zero** disabled controls, because the very capabilities Markdown lacks ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
   * align, colour, diagram, image ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â are exactly the ones with no command. The bar
   * then silently omitted them, so the row was shorter on Markdown than on a Rich
   * Note and a reader could not tell the difference between "not applicable here"
   * and "not built yet". A greyed control with a reason is the honest rendering,
   * and it is what keeps the row the same length on every page type.
   *
   * A control with neither a command nor a stated reason would render as an enabled
   * button that does nothing, which is the dead-button defect this whole model
   * exists to prevent ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so that case is rejected rather than rendered.
   */
  const resolved = useMemo<ResolvedControl[]>(() => {
    const out: ResolvedControl[] = []
    for (const control of TOOLBAR_CONTROLS) {
      const run = capabilities.commands[control.key] ?? null
      const menu = capabilities.menus?.[control.key] ?? null
      const live = state[control.key] ?? {}
      const stated = live.available
      // No command, no panel, and no stated unavailability would be a dead
      // control. It is dropped, and the omission is deliberate rather than
      // silent-by-accident.
      //
      // `menu` counts as being able to act. Without it, a menu-only capability ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
      // text colour, which does nothing until a colour is chosen ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â matched this
      // rule and was dropped, which is why the earlier seam could not express
      // the controls that most needed migrating.
      if (!run && !menu && !stated) continue
      // Above this line the control can do something, so it is available unless
      // the surface said otherwise. There is deliberately no "no command means
      // unavailable" branch: a control only reaches here *because* it has a
      // command or a panel, so the old `stated ?? unavailable(...)` fallback would
      // have been unreachable.
      const availability: Availability = stated ?? AVAILABLE
      out.push({
        control,
        label: live.label ?? control.label,
        availability,
        active: live.active === true,
        menu,
        run
      })
    }
    return out
  }, [capabilities, state])

  const renderOne = useCallback(
    (item: ResolvedControl, close?: () => void): ReactNode => {
      const { control, label, availability, active, menu, run } = item

      // Narrowed once, at the top, so the reason is reachable below without
      // re-testing the discriminant. `availability` is never undefined ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the
      // resolver substitutes AVAILABLE ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so this is a real narrowing and not a
      // `?.` that could silently produce "ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â " with no reason after it.
      const isAvailable = availability.available
      const reason = availability.available ? null : availability.reason
      const isOpen = menuCapability === control.key

      /*
       * What the click does.
       *
       * A control with a panel has **no click handler of its own**. `Popover.Target`
       * attaches the toggle and calls `onChange`, and a second handler here would
       * fight it: the button would set the key while the popover's handler cleared
       * it, and the panel would never open.
       *
       * A control without a panel runs its command, and an unavailable one has no
       * handler at all, so a greyed control cannot be pressed into acting.
       */
      /*
       * A control's click: run its command, then dismiss the panel it is in.
       *
       * `close` is present only for a control that has been moved into the overflow
       * panel, and it is the *control's own handler* that dismisses it rather than a
       * click handler on the panel's container. A static element with a click
       * handler is what biome is right to object to, and it would be wrong anyway:
       * the panel would close for a click on dead space, and for a nested panel
       * whose trigger is inside it.
       *
       * A panel-backed control does not run a command, so it does not take this
       * path ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â it opens its own panel, and the shell's `onChange` handles the rest.
       */
      const onClick =
        !isAvailable || menu
          ? undefined
          : close
            ? () => {
                run?.()
                close()
              }
            : (run ?? undefined)

      /**
       * The button, for a control that opens a panel.
       *
       * A second element rather than a branch inside the one below, because a
       * controlled `Popover` attaches no click handler of its own ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â see the note at
       * `Popover.Target` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so a panel-backed control must supply the toggle itself.
       * Built from the same parts as `button` so the two cannot drift: the same
       * label, the same availability treatment, the same icon, the same size.
       */
      const menuButton = (
        <ActionIcon
          variant={active ? 'light' : 'subtle'}
          color={active ? 'blue' : undefined}
          aria-label={label}
          aria-pressed={active}
          aria-haspopup="menu"
          // The shell owns this panel, so the expanded state is known here rather
          // than inferred. Without it a screen reader announces a trigger with no
          // way to tell whether its panel is open.
          aria-expanded={isOpen}
          data-toolbar-item=""
          data-testid={control.testId}
          onClick={() => setMenuCapability(isOpen ? null : control.key)}
        >
          <control.Icon size={ICON_SIZE} />
        </ActionIcon>
      )

      // The button. One element, built once, in every state apart from the
      // variant ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the defect that made the previous attempt's dead buttons
      // possible was three near-copies of this markup drifting apart.
      const button = (
        <ActionIcon
          variant={active ? 'light' : 'subtle'}
          color={active ? 'blue' : undefined}
          // The label says it cannot be used, so a screen reader user is not told
          // only that the control exists.
          /*
           * The name is the control's name, unchanged, whether or not it can act.
           *
           * An earlier version appended `" (unavailable)"` on a greyed control. That
           * was wrong twice over: it renamed the control, so anything matching on
           * its accessible name stopped finding it ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â measured, the existing suite's
           * `Outdent` locator timed out against a working toolbar ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and it said
           * something the `disabled` attribute already says, in the part of the
           * interface that is meant to be the name.
           *
           * Unavailability is carried by three things that each do a distinct job:
           * the native `disabled` for the platform and assistive technology,
           * `data-disabled` for the CSS and for keeping the tooltip alive, and
           * `title` for a reason a user can reach by hovering.
           */
          aria-label={label}
          aria-pressed={active}
          // `aria-expanded` alongside `aria-haspopup` because the panel is
          // controlled state: without it a screen reader announces the control as
          // a trigger with no way to tell whether its panel is open.
          aria-haspopup={menu ? 'menu' : undefined}
          aria-expanded={menu ? isOpen : undefined}
          data-toolbar-item=""
          /*
           * The model's declared test id, when it has one.
           *
           * Applied here rather than in each adapter so the shell is the only place
           * a control's identity is attached, and so a control the existing suite
           * addresses by id keeps working when it moves between surfaces. The ids
           * predate this model ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â `clear-formatting`, `wiki-link-button`,
           * `toolbar-more` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and are part of the project's test surface, so they are
           * declared on the control rather than derived from its capability name,
           * which would have silently renamed all of them.
           */
          data-testid={control.testId}
          // `data-disabled` and not `disabled`: a natively disabled button does
          // not fire `onMouseLeave` in every engine, and that is what kills the
          // tooltip ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so a greyed control could not say why it was greyed. Mantine
          // matches `[data-disabled]` in its own stylesheet and paints a filled box
          // for it, which the module resets; both halves were measured, see there.
          data-disabled={isAvailable ? undefined : true}
          // The reason as an attribute too, so a test can assert every greyed
          // control explains itself without hovering thirty-five tooltips.
          data-unavailable-reason={reason ?? undefined}
          /*
           * A native `title` on an unavailable control.
           *
           * Both attributes are present on purpose, because each answers something
           * the other cannot, and both were established by measurement:
           *
           * - `disabled` (native) is what assistive technology and the platform
           *   read, and the existing suite asserts it. A `data-` attribute is not
           *   exposed to either.
           * - `data-disabled` is what keeps a Mantine `Tooltip` open, because a
           *   natively disabled button does not fire `onMouseLeave` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â measured, the
           *   tooltip opened on a `data-disabled` control and did not on a natively
           *   disabled one.
           * - `title` is the browser's own tooltip, and it *does* appear on a
           *   disabled element, which is the gap the Mantine tooltip leaves.
           *
           * So an unavailable control carries the platform semantics, the CSS hook
           * that keeps the dim consistent, and a reason a user can reach by
           * hovering without any of it depending on JavaScript events firing.
           */
          disabled={isAvailable ? undefined : true}
          title={
            reason ? `${control.label} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ${reason}` : undefined
          }
          onClick={onClick}
          // The tooltip still needs mouseenter not to be cancelled, hence
          // preventDefault rather than stopPropagation.
          onMouseEnter={isAvailable ? undefined : (event) => event.preventDefault()}
        >
          <control.Icon size={ICON_SIZE} />
        </ActionIcon>
      )

      if (!isAvailable && reason) {
        return (
          <Tooltip
            key={control.key}
            // One phrasing for every surface, so a reason cannot disagree with
            // the label it is attached to.
            label={`${control.label} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ${reason}`}
            position="bottom"
          >
            {button}
          </Tooltip>
        )
      }

      /*
       * A control with a panel of its own.
       *
       * The shell owns the trigger, the tooltip, the availability, the roving
       * order and the panel's open state; the surface supplies only the panel's
       * contents. That split is what stops a surface becoming a second toolbar ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
       * it cannot render a trigger, so it cannot add a control of its own.
       *
       * Controlled rather than left to Mantine, because a Popover does not close
       * when a child is activated and these panels are arbitrary buttons: an
       * uncontrolled panel would stay open after a colour was chosen. The
       * `close` handed to the panel is the same setter, so "act, then dismiss"
       * is one call the surface can make without owning any state.
       */
      if (menu) {
        return (
          <Popover
            key={control.key}
            opened={isOpen}
            onChange={(open) => setMenuCapability(open ? control.key : null)}
            withinPortal
            zIndex={LAYOUT.overlayZIndex}
          >
            <Popover.Target
              popupType="menu"
              /*
               * `popupType="menu"` is what makes the trigger's `aria-haspopup` agree
               * with its panel.
               *
               * `PopoverTarget` builds its own accessibility props and spreads them
               * over the child, so whatever `aria-haspopup` the button declares is
               * replaced by the popover's `popupType` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â which defaults to `dialog`.
               * Measured: the colour trigger reported `aria-haspopup="dialog"` while
               * the button underneath declared `"menu"`, so the shell's own markup
               * was silently discarded.
               *
               * `menu` is the honest value here. The panel is a swatch grid or a URL
               * field, and the swatch grid really is a menu: `role="menu"` with
               * `menuitemradio` children and arrow-key navigation. Claiming `dialog`
               * would promise a structure the panel does not have.
               *
               * The overflow panel is the opposite case and keeps the default, because
               * it holds ordinary buttons rather than menu items ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and the existing
               * suite asserts `role="dialog"` there.
               */
            >
              {/*
               * The button is the target directly, and it carries the toggle itself.
               *
               * Two Mantine behaviours make both of those necessary, and both were
               * found by measurement rather than by reading:
               *
               * 1. **A controlled `Popover` attaches no click handler.**
               *    `PopoverTarget` composes `onClick` only when the popover is
               *    *uncontrolled* ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â its source reads
               *    `...!ctx.controlled ? { onClick: ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ } : null`. Every popover here is
               *    controlled, because the shell owns which panel is open so only
               *    one can be. So the trigger needs its own handler, or it is simply
               *    inert.
               *    Measured: with no handler, both the overflow trigger and the
               *    colour trigger reported `aria-expanded="false"` after a click,
               *    with no console error and no panel in the DOM.
               *
               * 2. **A `Tooltip` between the target and the DOM node takes the ref**,
               *    so the popover's own wiring lands on the wrong element. The
               *    repository has already paid for this twice, in
               *    `diagram-template-bar.tsx` and in the old rich toolbar; this shell
               *    walked into it a third time before being caught. Hence the
               *    button, not a wrapped one.
               *
               * The accessible name is not lost: the trigger keeps `aria-label`,
               * which is what a screen reader reads and what the tests address it
               * by.
               */}
              {menuButton}
            </Popover.Target>
            <Popover.Dropdown>{menu.content(() => setMenuCapability(null))}</Popover.Dropdown>
          </Popover>
        )
      }

      return (
        <Tooltip key={control.key} label={label} position="bottom">
          {button}
        </Tooltip>
      )
    },
    /*
     * Deliberately the ONLY dependency, and that is a correction rather than an
     * optimisation.
     *
     * The control's own state arrives as the `item` argument. A `useCallback` that
     * returns a ReactNode hands back the SAME element object while its arguments are
     * unchanged, and React treats an identical element as nothing to do and skips the
     * subtree. Keeping only `menuCapability` in the list meant Bold's node was the one
     * built before the selection existed, so pressing Bold painted a strong element in
     * the document while aria-pressed stayed false permanently.
     *
     * It cannot be fixed by listing `resolved` instead, because `item` is a fresh
     * object each render and the cache would then miss every time.
     *
     * `menuCapability` is in the list because the nodes it produces read it: the
     * Popover's `opened` and the trigger's `aria-expanded` are both derived from it.
     * Leaving it out was not a performance decision, it was a **broken panel** ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
     * `onChange` fired and set the state, but the node that carried `opened` was
     * the one built before any panel had ever opened, so `opened` stayed `false`
     * and nothing ever appeared. Measured: the overflow trigger and the colour
     * trigger both reported `aria-expanded="false"` after a click, with no error
     * and no panel in the DOM.
     *
     * The `item` argument cannot be a dependency, because it is a fresh object
     * each render ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â that would make the cache miss on every pass, which is
     * equivalent to not memoising. So the memo is kept for the one value it must
     * track, and the cost of rebuilding the rest is accepted deliberately.
     */
    [menuCapability]
  )

  /**
   * The bar as a flat list of children, dividers included.
   *
   * Flat on purpose. `Children.toArray` in the overflow hook treats a Fragment as
   * one opaque child, so wrapping each group would make ten units out of thirty
   * five controls and the measured split would be meaningless.
   *
   * `close` is threaded through so the *same* `renderOne` can produce both the
   * on-bar control and its overflow twin, the only difference being that the twin
   * dismisses the panel when used. Building the panel's controls from the same
   * function is what keeps them identical ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â a second construction would be a
   * second implementation, which is the whole fault this migration exists to fix.
   */
  const buildItems = useCallback(
    (close?: () => void): BarEntry[] => {
      const entries: BarEntry[] = []
      // `push` returns a number, so this must not be an arrow returning the push
      // result: biome's `useIterableCallbackReturn` catches exactly that.
      const push = (node: ReactNode, pinned = false): void => {
        entries.push({ node, pinned })
      }
      TOOLBAR_GROUPS.forEach((group, groupIndex) => {
        const inGroup = resolved.filter((item) =>
          group.controls.some((c) => c.key === item.control.key)
        )
        if (inGroup.length === 0) return
        // The divider belongs to the group it precedes, keyed by the group's own
        // name. A positional key would move the rule when a group emptied.
        if (groupIndex > 0) {
          push(<span key={`${group.key}-divider`} className={classes.divider} />)
        }
        for (const [index, item] of inGroup.entries()) {
          /*
           * A right-aligned group's first control is pinned to the row's right edge.
           *
           * The flag travels with the entry rather than being applied to the button
           * here, because the box that has to carry the margin is the **slot
           * wrapper**, not the button. The slot is the flex child of the bar; the
           * button sits inside it, and the slot shrink-wraps its content, so an
           * `auto` margin on the button had no free space to consume and did
           * nothing at all. Measured on the running app: `margin-left` on the slot
           * read `0px` while the model declared the group pinned, and the
           * Preview / HTML / CSS / JS switch sat 1070px from the right edge on the
           * preview and 86px on a source view.
           *
           * It is deliberately the flex primitive rather than an extra spacer
           * element: a spacer between the groups would have to be a child of the row,
           * and the overflow hook measures children to decide the split ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â a
           * zero-width spacer would measure as a unit and a real one would swallow
           * the whole bar.
           */
          push(renderOne(item, close), group.align === 'end' && index === 0)
        }
      })
      return entries
    },
    [renderOne, resolved]
  )

  const entries = useMemo(() => buildItems(), [buildItems])
  const items = useMemo(() => entries.map((entry) => entry.node), [entries])

  // `Children.toArray` assigns a key to every child, which the slot wrappers key
  // off so a control keeps its node across a re-render among its siblings.
  const keyed = Children.toArray(items)
  const { split, barRef, slotProps } = useToolbarOverflow(keyed, {
    isDivider,
    moreButtonWidth: OVERFLOW_CONTROL_WIDTH
  })

  const visible = split === null ? keyed : keyed.slice(0, split)

  /*
   * The overflowed controls: the same elements, rebuilt so each dismisses the
   * panel when it is used.
   *
   * The tail is rebuilt from `buildItems` rather than sliced from `keyed`, because
   * a control's dismissal is baked into the element it is ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and slicing would give
   * the panel the *on-bar* version, which has nothing to dismiss. The split index
   * is measured against `keyed` and both lists are built by the same function in the
   * same order, so the index refers to the same control in each.
   *
   * Three other approaches were tried and each was wrong, which is why the reasoning
   * is recorded:
   *
   * - A `click` handler on the panel's container. Biome is right that a static
   *   element with a click handler needs a keyboard equivalent, and it would also
   *   close the panel for a click on dead space.
   * - `cloneElement` composing an `onClick` onto each moved control, which
   *   *duplicated* every control: measured, `insert-code-block` resolved to 24
   *   elements, because the children are `Tooltip` wrappers and cloning one
   *   re-renders its subtree rather than replacing it.
   * - `closeOnItemClick`, which Mantine 9 removed.
   */
  const overflowed = useMemo(() => {
    if (split === null) return []
    const close = (): void => setMoreOpen(false)
    // Rebuilt with the same function, then sliced at the same measured index.
    return withoutDividers(
      Children.toArray(buildItems(close).map((entry) => entry.node)).slice(split)
    )
  }, [buildItems, split])

  const roving = useRovingFocus(keyed.length)

  const keyFor = (item: ReactNode): string =>
    isValidElement(item) && item.key !== null ? String(item.key) : ''

  return (
    <div
      className={classes.bar}
      role="toolbar"
      aria-label={TOOLBAR_LABEL}
      data-testid={testId}
      ref={(node) => {
        barRef.current = node
        roving.setContainer(node)
      }}
      onKeyDown={roving.onKeyDown}
    >
      {visible.map((item, index) => (
        <span
          className={entries[index]?.pinned ? `${classes.slot} ${classes.pinnedEnd}` : classes.slot}
          key={keyFor(item)}
          {...slotProps(index)}
          // The wrapper carries the roving tabindex rather than the button, so
          // the measured box and the focusable box are the same box. Splitting
          // them is how a control ends up focusable somewhere it is not drawn.
          tabIndex={roving.tabIndexAt(index)}
        >
          {item}
        </span>
      ))}
      {overflowed.length > 0 ? (
        <Popover
          opened={moreOpen}
          onChange={setMoreOpen}
          withinPortal
          zIndex={LAYOUT.overlayZIndex}
          /*
           * `trapFocus`, because the panel is portalled and Mantine leaves trapping
           * off by default.
           *
           * Without it the trigger keeps focus after the panel opens, so Tab moves
           * on down the page rather than into the panel ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and the controls the user
           * opened it to reach are unreachable by keyboard. Trapping also gives
           * Escape and Tab-outside a place to go, so the panel closes the way a
           * dialog is expected to.
           */
          trapFocus
        >
          <Popover.Target>
            {/*
             * No `Tooltip` here either, for the same reason as on a control's own
             * panel: a `Tooltip` between the target and the DOM node takes the ref
             * and the panel never opens. The button's own `aria-label` carries the
             * name, and the panel is reachable by keyboard through the roving
             * focus, so nothing is lost.
             */}
            <ActionIcon
              variant="subtle"
              aria-label={OVERFLOW_CONTROL.label}
              /*
               * `aria-expanded` because this is a controlled trigger, exactly as on
               * a control that opens its own panel. Without it a screen reader
               * announces a button that reveals something with no way to tell
               * whether the panel is currently open ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and the existing suite asserts
               * this attribute, which is how its absence was found.
               */
              aria-expanded={moreOpen}
              /*
               * `dialog`, not `menu`.
               *
               * The overflow used to be a Mantine `Menu` and was changed to a
               * `Popover` because a `Menu` moves focus by querying
               * `[data-menu-item]`, which the bare `ActionIcon`s it held did not
               * carry ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so a keyboard user could not get into it at all. The panel
               * now renders `role="dialog"`, and this says so. Claiming `menu`
               * would promise arrow-key navigation between menu items that do not
               * exist as menu items.
               */
              aria-haspopup="dialog"
              // The toggle, because this popover is controlled and a controlled
              // Mantine popover attaches no click handler to its target. Same
              // reason, same fix as on a control's own panel.
              onClick={() => setMoreOpen((open) => !open)}
              className={classes.moreButton}
              data-toolbar-item=""
              // Both ids predate this shell: `toolbar-more` and
              // `toolbar-overflow-panel` are used by eighteen assertions across six
              // existing specs, so they are the shell's contract, not a detail to be
              // tidied away.
              data-testid="toolbar-more"
            >
              <OVERFLOW_CONTROL.Icon size={ICON_SIZE} />
            </ActionIcon>
          </Popover.Target>
          {/*
           * The panel IS the Popover dropdown, not a wrapper inside it.
           *
           * That is what makes it a `dialog` rather than a group of loose buttons:
           * Mantine puts `role="dialog"` on the dropdown itself, and the test suite
           * asserts `toolbar-overflow-panel` carries that role. An inner div would
           * have had no role of its own, so the panel would have claimed a
           * relationship it did not have.
           *
           * The controls are moved in, not reimplemented: same props, same command,
           * same identity as the on-bar control. The only difference is the
           * `close` threaded through `buildItems`, so using one dismisses the panel.
           */}
          <Popover.Dropdown className={classes.moreMenu} data-testid="toolbar-overflow-panel">
            {/*
             * `ScrollArea` inside the dropdown, so this panel carries RTWiki's
             * scrollbar like every other floating list. At the narrowest window
             * twenty-odd controls overflow into here and the panel is taller than
             * an ordinary screen.
             *
             * The class that carries the cap and the wrap stays on the dropdown,
             * which is the element the test suite addresses by
             * `data-testid="toolbar-overflow-panel"`, so the measured panel and the
             * visible panel are the same box. The scrollbar lives one level in,
             * around the items only.
             */}
            <ScrollArea.Autosize
              mah={LAYOUT.panelMaxHeight}
              type="always"
              scrollbars="y"
              className={classes.moreScroll}
            >
              {overflowed.map((item) => (
                <span className={classes.moreItem} key={keyFor(item)}>
                  {item}
                </span>
              ))}
            </ScrollArea.Autosize>
          </Popover.Dropdown>
        </Popover>
      ) : null}
      {trailing}
    </div>
  )
}

/**
 * Room reserved for the overflow button when deciding the split.
 *
 * 28 is Mantine's default `ActionIcon` size, which the button is.
 */
const OVERFLOW_CONTROL_WIDTH = 28
