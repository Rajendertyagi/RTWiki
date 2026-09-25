import type { CSSProperties } from 'react'

/**
 * A React style object that may also carry CSS custom properties.
 *
 * `CSSProperties` deliberately excludes `--*` keys, so passing a custom
 * property in a `style` object is a type error without this. It is the modern
 * way to hand a *value* to CSS: the component supplies the number, the
 * stylesheet keeps the box model, and nothing is hardcoded into an inline
 * layout rule.
 *
 * Use for values that are genuinely data-driven — a user-resized pane, a zoom
 * level, a tree depth. A value that is a constant belongs in the stylesheet or
 * in a published custom property, not here.
 */
export type CSSVars = CSSProperties & Record<`--${string}`, string | number>
