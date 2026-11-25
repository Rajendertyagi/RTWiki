import {
  Card,
  Combobox,
  createTheme,
  Input,
  Kbd,
  Menu,
  Modal,
  Popover,
  ScrollArea,
  SegmentedControl,
  Tooltip
} from '@mantine/core'

import { LAYOUT } from '../config/index.js'
import { createVariantColorResolver } from './component-roles.js'
import { FLOATING } from './constants.js'
import { FIXED_MANTINE_BASE } from './mantine-base.js'
import { parseThemeDefinition } from './theme-definition.js'
import { type AppTheme, REQUIRED_INTERACTION_TOKENS, REQUIRED_VARIANT_TOKENS } from './tokens.js'

/**
 * The class of Mantine components that hardcode a palette shade as their own
 * surface instead of consuming `--mantine-color-body` (Paper does; Card, Kbd,
 * SegmentedControl and the Combobox dropdown do not). This is the same defect
 * the C4 gate found on Card: `Card.css:20,24` paints `white`/`dark-6` while
 * `Paper.css:11` paints `--mantine-color-body`.
 *
 * Each entry is a Styles API slot -> SSoT var reference. No literal colours,
 * no per-screen CSS: the override lives once on `theme.components` so every
 * call site inherits it.
 *
 * `vars` cannot express this. None of these components declares a CSS variable
 * for the hardcoded surface — verified in Mantine 9.8.2: `Card.varsResolver`
 * emits only `--card-padding`, `Kbd` only `--kbd-fz`, and SegmentedControl's
 * `--sc-color` drives the indicator, not the root. An inline style on the slot
 * wins over the hardcoded CSS rule in every state without touching the
 * state-specific rules (checked/disabled/hover) that own other surfaces.
 *
 * Checkbox, Radio and NavLink are deliberately NOT in this map: their
 * hardcoded surfaces live on pseudo-states (:checked/:disabled/:hover), which
 * an inline style cannot express without clobbering those states. They are
 * handled by scoped rules in customization.css instead.
 */
const HARDCODED_SURFACE_SLOTS = {
  Card: { root: 'var(--mantine-color-body)' },
  Kbd: { root: 'var(--rtwiki-pane)' },
  SegmentedControl: { root: 'var(--rtwiki-pane)' },
  Combobox: { dropdown: 'var(--rtwiki-floating-bg)' }
} as const

/**
 * Pure JSON -> AppTheme conversion. No filesystem or glob access, so it can be
 * used by both the Vite app (which discovers themes with import.meta.glob) and
 * the Bun tests (which read theme files with node:fs).
 *
 * Component defaults stay here rather than in JSON: they wire code constants
 * (FLOATING, LAYOUT.scrollbar.size) and cannot be expressed as data.
 */
export function toAppTheme(json: unknown): AppTheme {
  const parsed = parseThemeDefinition(json, {
    variantTokens: REQUIRED_VARIANT_TOKENS,
    interactionTokens: REQUIRED_INTERACTION_TOKENS
  })
  return {
    id: parsed.id,
    mantine: createTheme({
      ...FIXED_MANTINE_BASE,
      ...parsed.mantine,
      /*
       * One theme-level resolver maps every variant-colour consumer (Button,
       * ActionIcon, Badge, Alert, NavLink, …) to RTWiki semantic roles. Without
       * it, `variant="subtle"` falls back to the palette's `-light-color` shade,
       * which is unreadable for neutral accents such as vercel dark (1.67:1).
       * Owner decision 3 is narrow: ONLY --mantine-color-default,
       * --mantine-color-disabled and --mantine-color-disabled-border stay at
       * Mantine's values (css-variables.ts RISKY_SURFACE_MAPPINGS). It does not
       * exempt other control surfaces — those are mapped centrally here and in
       * customization.css.
       */
      variantColorResolver: createVariantColorResolver(),
      components: {
        /*
         * Hardcoded-surface class (see HARDCODED_SURFACE_SLOTS above). Each
         * slot gets an inline background-color that is a var(--...) reference
         * to an existing RTWiki token — never a literal colour.
         */
        Card: Card.extend({
          // A caller-supplied className owns its own surface (the dashboard
          // page-card sets --rtwiki-pane on Mantine Card). An inline style
          // would beat that CSS module rule, so only supply the default when
          // no class was passed — i.e. when Mantine's hardcoded shade is the
          // value actually in effect.
          styles: (_theme, props) => ({
            root: props.className ? {} : { backgroundColor: HARDCODED_SURFACE_SLOTS.Card.root }
          })
        }),
        Kbd: Kbd.extend({
          styles: { root: { backgroundColor: HARDCODED_SURFACE_SLOTS.Kbd.root } }
        }),
        SegmentedControl: SegmentedControl.extend({
          styles: { root: { backgroundColor: HARDCODED_SURFACE_SLOTS.SegmentedControl.root } }
        }),
        Combobox: Combobox.extend({
          styles: { dropdown: { backgroundColor: HARDCODED_SURFACE_SLOTS.Combobox.dropdown } }
        }),
        /*
         * Mantine's Input declares its border from the component-specific
         * `--input-bd` (Input.css: `--input-bd: var(--mantine-color-gray-4)`
         * in light, `dark-4` in dark) directly on the wrapper. That shadows the
         * resolver's `--mantine-color-default-border` override, so a TextInput
         * border never followed `--rtwiki-border`. Map the component variable
         * centrally for the default variant only: error/success/filled/unstyled
         * keep Mantine's own value, and focus is set on the inner <input> so it
         * still wins by inheritance.
         */
        Input: Input.extend({
          vars: (_theme, props) => {
            // Mantine's InputCssVariables type omits --input-bd (it is declared
            // in Input.css, not in the vars resolver), so use a widened key to
            // keep the central override type-checked without a blind cast.
            const borderVar: string = '--input-bd'
            return {
              wrapper: {
                [borderVar]:
                  // TextInput forwards `variant: undefined` through
                  // __stylesApiProps, so undefined means the default variant.
                  (props.variant === undefined || props.variant === 'default') &&
                  !props.error &&
                  !props.success
                    ? 'var(--rtwiki-border)'
                    : undefined
              }
            }
          }
        }),
        // Menu, Popover, Dialog, tooltip: the four things that genuinely float.
        Menu: Menu.extend({ classNames: { dropdown: FLOATING } }),
        Popover: Popover.extend({ classNames: { dropdown: FLOATING } }),
        Modal: Modal.extend({ classNames: { content: FLOATING } }),
        Tooltip: Tooltip.extend({ classNames: { tooltip: FLOATING } }),
        /*
         * Scrollbar thickness for every `ScrollArea` in the application.
         * Set as a component default rather than at each call site, so the size
         * has one home. The value is LAYOUT.scrollbar.size, the same number
         * published to CSS as --rtwiki-scrollbar-size for surfaces that cannot
         * use this component. Mantine's own default is 12px, which would be the
         * widest scrollbar in the app and the only one a reader would notice.
         */
        ScrollArea: ScrollArea.extend({
          defaultProps: { scrollbarSize: LAYOUT.scrollbar.size }
        })
      }
    }),
    variants: parsed.variants
  }
}
