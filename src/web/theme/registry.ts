import type { MantineThemeOverride } from '@mantine/core'
import { createTheme, Menu, Modal, Popover, ScrollArea, Tooltip } from '@mantine/core'

import { LAYOUT } from '../config/index.js'
import defaultThemeJson from '../themes/default.json'
import { parseThemeDefinition } from './theme-definition.js'

/**
 * The one class every floating surface carries. Defined in customization.css,
 * which holds the layered recipe; wired here through component defaults so no
 * call site has to remember it and no menu can quietly ship without it.
 */
export const FLOATING = 'rtwiki-floating'

/**
 * The notification toast carries the floating recipe plus its own class, because
 * its auto-close countdown has to be repositioned and that must not leak onto
 * every other floating surface.
 */
export const NOTIFICATION = 'rtwiki-notification'

/**
 * The shared native-scrollbar class, applied to the scroll containers a library
 * owns and to the one-dimensional strips inside rendered text.
 *
 * It lives in `customization.css` rather than in a module because it has to reach
 * DOM that no component here renders — the Wunderbaum tree builds its own element —
 * and because a rule applied through `composes` could only ever live in a module.
 * So it is applied by name, and named here so no call site can mistype it.
 *
 * See the long note on `.rtwiki-scroll` in `customization.css` for why the standard
 * scrollbar properties and the vendor pseudo-elements are two separate mechanisms
 * rather than one rule.
 */
export const RTWIKI_SCROLL = 'rtwiki-scroll'

/**
 * RTWiki theme registry.
 *
 * Every surface colour in the application is declared here, once, as data. A
 * theme is a pair of variants (light and dark) plus a Mantine theme override, so
 * adding a theme is a data entry rather than a refactor.
 *
 * Why this is a registry and not a single set of CSS variables: the document
 * surface and the panels were previously addressed by a single ambiguous pair
 * of custom properties, and the two silently converged on the same tone in one
 * scheme. That ambiguity is what made the document read as a card inside a
 * panel. Region-named tokens remove the possibility of the collision. The
 * superseded names are recorded in docs/rtwiki-uiux.md and are deliberately
 * absent from source, so they cannot be copied back into a stylesheet.
 *
 * Relationship that must hold in every variant, mirroring TriliumNext: the pane
 * is recessed and the document canvas is the brightest surface. The
 * `canvas !== pane` invariant is asserted for every theme and variant in
 * tests/theme-registry.test.ts.
 */

export const REQUIRED_VARIANT_TOKENS = [
  'canvas',
  'pane',
  'rail',
  'elevated',
  'border',
  'text',
  'textMuted',
  'hover',
  'selected'
] as const

export type RequiredVariantToken = (typeof REQUIRED_VARIANT_TOKENS)[number]

/**
 * Interaction and chrome tokens that every variant must declare. These are not
 * oklch region colours — they carry shadows, hairlines and accent fills — so
 * they live in their own set rather than in REQUIRED_VARIANT_TOKENS. The
 * oklch-only invariant and the ladder assertions apply to the region set alone;
 * this set has its own presence and exact-value assertions.
 *
 * chromeHairline: chrome hairlines are deliberately fainter than the general
 * border token. The chrome stacks several full-width rows against each other, so
 * a full-strength separator turns the top of the window into a set of stacked
 * bands. At this strength the line reads as a seam rather than a rule, which is
 * what keeps the chrome light. Scheme-aware: a translucent black is invisible on
 * a dark surface, so the dark value is a translucent white.
 *
 * floatingShadow: the floating-layer recipe. A single blur says "there is a box
 * here"; a highlight along the top edge, a hairline inner rim, a solid outer
 * ring that separates the surface from whatever is behind it, and then three
 * progressively larger and softer drops, says "this is lifted off the page". The
 * ring is what keeps the edge readable when the drop is too soft to do it alone.
 * In dark mode the top highlight and inner rim are a translucent white. A drop
 * shadow is almost invisible on a near-black surface, so a light edge does the
 * work the shadow cannot.
 *
 * activeFill: shared selected/active row fill — tree rows and the Home/root nav
 * entry read this so their selection colour is identical. Opaque enough to keep
 * light text legible on a dark theme (the 16% tint was too faint there).
 *
 * treeSelected / treeSelectedHover: tree selection. Deliberately NOT
 * --rtwiki-selected: that token is white in the light scheme, so a selected row
 * became indistinguishable from an unselected one and from the hover fill.
 * Selection is an accent tint, and hover is a neutral fill, so the two can never
 * be confused.
 */
export const REQUIRED_INTERACTION_TOKENS = [
  'chromeHairline',
  'floatingShadow',
  'activeFill',
  'treeSelected',
  'treeSelectedHover',
  'tabDragShadow',
  'tabCloseHoverBg'
] as const

export type RequiredInteractionToken = (typeof REQUIRED_INTERACTION_TOKENS)[number]

export type ThemeVariant = Record<RequiredVariantToken, string> &
  Record<RequiredInteractionToken, string>

export interface ThemeVariants {
  light: ThemeVariant
  dark: ThemeVariant
}

export interface AppTheme {
  id: string
  mantine: MantineThemeOverride
  variants: ThemeVariants
}

/**
 * Maps a variant key to its CSS custom property name. Declared once so the
 * registry, the resolver and the stylesheets cannot disagree about spelling.
 */
export const VARIANT_TOKEN_NAMES: Record<RequiredVariantToken | RequiredInteractionToken, string> =
  {
    canvas: 'canvas',
    pane: 'pane',
    rail: 'rail',
    elevated: 'elevated',
    border: 'border',
    text: 'text',
    textMuted: 'text-muted',
    hover: 'hover',
    selected: 'selected',
    chromeHairline: 'chrome-hairline',
    floatingShadow: 'floating-shadow',
    activeFill: 'active-fill',
    treeSelected: 'tree-selected',
    treeSelectedHover: 'tree-selected-hover',
    tabDragShadow: 'tab-drag-shadow',
    tabCloseHoverBg: 'tab-close-hover-bg'
  }

export function buildVariantVariables(variant: ThemeVariant): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const token of REQUIRED_VARIANT_TOKENS) {
    variables[`--rtwiki-${VARIANT_TOKEN_NAMES[token]}`] = variant[token]
  }
  for (const token of REQUIRED_INTERACTION_TOKENS) {
    variables[`--rtwiki-${VARIANT_TOKEN_NAMES[token]}`] = variant[token]
  }
  return variables
}

/**
 * The Default theme. All colour and Mantine scale values now live in
 * `src/web/themes/default.json` as DTCG-shaped tokens; the loader validates
 * them and resolves aliases into the exact CSS strings the app expects. The
 * losslessness test in `tests/theme-definition.test.ts` proves the JSON
 * reproduces the previous inline values byte for byte.
 *
 * What stays here is code-owned: the component defaults below wire code
 * constants (FLOATING, LAYOUT.scrollbar.size) and cannot be expressed as data.
 *
 * The oklch surface ladder is defined by its lightness channel alone, so the
 * steps are exact by construction rather than hand-picked. The canvas is
 * declared rather than inherited from the rich editor, which paints its own
 * background from a binary light/dark scheme and knows nothing about the
 * active theme. Both invariants are asserted in tests/theme-registry.test.ts.
 *
 * This is the only registered theme in the first slice. Catppuccin and Nord are
 * deliberately absent: they must be sourced from their official palettes in a
 * later change rather than invented here.
 */
const parsedDefault = parseThemeDefinition(defaultThemeJson, {
  variantTokens: REQUIRED_VARIANT_TOKENS,
  interactionTokens: REQUIRED_INTERACTION_TOKENS
})

const defaultTheme: AppTheme = {
  id: parsedDefault.id,
  mantine: createTheme({
    ...parsedDefault.mantine,
    components: {
      // Menu, Popover, Dialog, tooltip: the four things that genuinely float.
      Menu: Menu.extend({ classNames: { dropdown: FLOATING } }),
      Popover: Popover.extend({ classNames: { dropdown: FLOATING } }),
      Modal: Modal.extend({ classNames: { content: FLOATING } }),
      Tooltip: Tooltip.extend({ classNames: { tooltip: FLOATING } }),
      /*
       * Scrollbar thickness for every `ScrollArea` in the application.
       *
       * Set as a component default rather than at each call site, so the size has
       * one home: a `ScrollArea` added later is the right width without anyone
       * remembering to pass it. The value is `LAYOUT.scrollbar.size`, the same
       * number published to CSS as `--rtwiki-scrollbar-size` for the surfaces that
       * cannot use this component — the Wunderbaum tree, the BlockNote editor, and
       * the horizontal strips inside rendered Markdown. That shared source is what
       * keeps a `ScrollArea` scrollbar and a native one from looking like two
       * different applications.
       *
       * Mantine's own default is 12px. Left alone it would be the widest scrollbar
       * in the app, and the only one a reader would notice.
       */
      ScrollArea: ScrollArea.extend({
        defaultProps: { scrollbarSize: LAYOUT.scrollbar.size }
      })
    }
  }),
  variants: parsedDefault.variants
}

export const APP_THEMES: Readonly<Record<string, AppTheme>> = {
  [defaultTheme.id]: defaultTheme
}

export const DEFAULT_THEME_ID = defaultTheme.id

export function getTheme(id: string): AppTheme {
  return APP_THEMES[id] ?? APP_THEMES[DEFAULT_THEME_ID]
}
