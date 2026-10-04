import { useState } from 'react'

import { UI_TEXT } from '../../config/index.js'
import classes from './document-toolbar.module.css'

/**
 * The colour swatch panel, shared by every surface that offers one.
 *
 * ## Why this lives beside the toolbar rather than inside an adapter
 *
 * The colour choices are not editor-specific. Every surface that can set a colour
 * offers the same ten, in the same order, with the same semantics — `default`
 * means "remove the colour" and the rest are named colours. Only the act of
 * applying one differs, and that is a single callback.
 *
 * So the panel is one component with a `onPick` prop rather than a copy per
 * adapter. That matters: the first version of the Rich Note toolbar had this
 * markup inline, and a second adapter wanting the same panel would have had to
 * either import across a feature boundary or reimplement it.
 *
 * ## The `role="menu"` is load-bearing
 *
 * The trigger declares `aria-haspopup="menu"`, and that promise has to be kept:
 * Mantine's `Popover.Dropdown` renders `role="dialog"`, so the menu role is
 * supplied here, inside it, by the component that actually contains the items.
 * Declaring `aria-haspopup="menu"` over a dialog with no menu inside is the
 * mismatch this avoids — it was the reason the earlier seam was inspected rather
 * than assumed.
 */

/** The colour choices, in order. `default` removes the colour. */
export const COLOR_PRESETS = [
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

export type ColorPreset = (typeof COLOR_PRESETS)[number]

export interface SwatchPanelProps {
  /** The colour currently in effect, so its swatch is marked checked. */
  active: string
  /**
   * Whether this panel sets a highlight rather than a text colour.
   *
   * Changes the accessible name and the CSS variable the swatch paints from.
   * BlockNote exposes the two as separate colour sets, so the value is genuinely
   * different rather than cosmetic.
   */
  highlight: boolean
  /** Applied when a swatch is chosen. The caller closes the panel. */
  onPick: (color: ColorPreset) => void
  /** Stable id for tests and for `aria-controls` on the trigger. */
  testId: string
}

export function SwatchPanel({
  active,
  highlight,
  onPick,
  testId
}: SwatchPanelProps): React.ReactElement {
  const label = highlight ? UI_TEXT.highlightLabel : UI_TEXT.textColorLabel
  /*
   * Arrow-key roving within the menu.
   *
   * The APG's menu pattern moves between items with the arrow keys, and a grid of
   * ten buttons that can only be reached by Tab is not a menu to a screen reader
   * user — `role="menu"` promises arrow navigation, so it has to exist. Home and
   * End jump to the ends, matching the toolbar's own navigation.
   *
   * Implemented here rather than through the toolbar's roving focus because this
   * is a different widget: the toolbar is one tab stop holding all controls, and
   * this is a panel that is opened from one of them. They share no state, and
   * forcing them together would mean the toolbar's index moved when a panel
   * opened.
   */
  const [focused, setFocused] = useState(0)
  // The list is a module constant, so its length cannot change while the panel is
  // mounted. An effect clamping the index was written and then removed: it guarded
  // a case that cannot occur, and it cost a render on every mount.
  const items = COLOR_PRESETS

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = focused + 1
    else next = focused - 1
    // Stop at the ends rather than wrapping, so arrowing does not silently jump
    // from the last swatch to the first.
    if (next < 0 || next >= items.length) return
    setFocused(next)
    // The roving tabindex has to be followed by a real focus move, or the visual
    // position and the focus position disagree.
    const target = event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[next]
    target?.focus()
  }

  return (
    <div
      className={classes.swatchGrid}
      role="menu"
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      {COLOR_PRESETS.map((color, index) => (
        <button
          key={color}
          type="button"
          role="menuitemradio"
          aria-checked={active === color}
          aria-label={`${label}: ${color}`}
          // One tab stop inside the panel, the same roving rule the toolbar uses.
          tabIndex={index === focused ? 0 : -1}
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
            } as React.CSSProperties
          }
          onClick={() => onPick(color)}
        >
          {color === 'default' ? <span aria-hidden>⌫</span> : null}
        </button>
      ))}
    </div>
  )
}
