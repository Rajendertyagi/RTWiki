import type { MantineThemeOverride } from '@mantine/core'
import { createTheme, Menu, Modal, Popover, ScrollArea, Tooltip } from '@mantine/core'

import { LAYOUT } from '../config/index.js'

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
 * The Default theme. Values are transcribed from TriliumNext's token palette;
 * see docs/trilium-uiux-reference.md.
 *
 * This is the only registered theme in the first slice. Catppuccin and Nord are
 * deliberately absent: they must be sourced from their official palettes in a
 * later change rather than invented here.
 */
const defaultTheme: AppTheme = {
  id: 'default',
  mantine: createTheme({
    primaryColor: 'blue',
    colors: {
      blue: [
        '#eaf4ff',
        '#d0e4ff',
        '#a5cbff',
        '#75afff',
        '#4c96ff',
        '#2f80ff',
        '#1c70ff',
        '#0d63fb',
        '#0058eb',
        '#004fd9'
      ]
    },
    primaryShade: { light: 6, dark: 8 },
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    defaultRadius: 'md',
    radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
    shadows: {
      xs: '0 1px 2px rgba(0,0,0,0.05)',
      sm: '0 2px 8px rgba(0,0,0,0.08)',
      md: '0 4px 16px rgba(0,0,0,0.12)'
    },
    focusRing: 'auto',
    spacing: {
      xs: '8px',
      sm: '12px',
      md: '16px',
      lg: '20px',
      xl: '24px'
    },
    fontSizes: {
      xs: '0.75rem',
      sm: '0.8125rem',
      md: '0.875rem',
      lg: '1rem',
      xl: '1.125rem'
    },
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
  variants: {
    dark: {
      // Oklch, not hex. The surface ladder is defined by its lightness channel
      // alone, so the steps are exact by construction rather than hand-picked:
      // 0.17 -> 0.22 -> 0.27 -> 0.32, a uniform 0.05 apart. A hex ladder can
      // only be *measured* into evenness; here it simply is even. The test
      // asserts the L channel directly.
      //
      // The canvas is deliberately declared rather than inherited from the rich
      // editor, which paints its own background from a binary light/dark scheme
      // and knows nothing about the active theme. The editor surface is forced
      // to follow this token instead.
      rail: 'oklch(0.17 0.005 255)',
      pane: 'oklch(0.22 0.005 255)',
      canvas: 'oklch(0.27 0.005 255)',
      elevated: 'oklch(0.32 0.006 255)',
      // Sits one clear step above every surface, so an edge always reads.
      border: 'oklch(0.4 0.008 255)',
      text: 'oklch(0.85 0.005 255)',
      textMuted: 'oklch(0.75 0.005 255)',
      hover: 'oklch(1 0 0 / 0.05)',
      selected: 'oklch(1 0 0 / 0.14)',
      chromeHairline: 'rgba(255, 255, 255, 0.09)',
      floatingShadow:
        'inset 0 1px 0 0 rgb(255 255 255 / 0.12), inset 0 0 0 1px rgb(255 255 255 / 0.08), 0 0 0 1px rgb(0 0 0 / 0.36), 0 1px 1px -0.5px rgb(0 0 0 / 0.22), 0 3px 3px -1.5px rgb(0 0 0 / 0.2), 0 6px 6px -3px rgb(0 0 0 / 0.16)',
      activeFill: 'color-mix(in srgb, var(--mantine-color-blue-filled) 22%, transparent)',
      treeSelected: 'color-mix(in srgb, var(--mantine-color-blue-filled) 18%, transparent)',
      treeSelectedHover: 'color-mix(in srgb, var(--mantine-color-blue-filled) 26%, transparent)',
      tabDragShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      tabCloseHoverBg: 'rgba(255, 255, 255, 0.1)'
    },
    light: {
      // Same idea in the other direction: the canvas is the brightest surface
      // and each panel steps away from it by an even 0.045.
      canvas: 'oklch(1 0 0)',
      pane: 'oklch(0.955 0.004 255)',
      rail: 'oklch(0.91 0.005 255)',
      elevated: 'oklch(1 0 0)',
      border: 'oklch(0.86 0.008 255)',
      text: 'oklch(0.38 0.01 255)',
      textMuted: 'oklch(0.55 0.01 255)',
      hover: 'oklch(0 0 0 / 0.032)',
      selected: 'oklch(1 0 0)',
      chromeHairline: 'rgba(0, 0, 0, 0.09)',
      floatingShadow:
        'inset 0 1px 0 0 rgb(255 255 255 / 0.8), inset 0 0 0 1px rgb(0 0 0 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.1), 0 1px 2px -0.5px rgb(0 0 0 / 0.08), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.08)',
      activeFill: 'color-mix(in srgb, var(--mantine-color-blue-filled) 22%, transparent)',
      treeSelected: 'color-mix(in srgb, var(--mantine-color-blue-filled) 18%, transparent)',
      treeSelectedHover: 'color-mix(in srgb, var(--mantine-color-blue-filled) 26%, transparent)',
      tabDragShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
      tabCloseHoverBg: 'rgba(255, 255, 255, 0.1)'
    }
  }
}

export const APP_THEMES: Readonly<Record<string, AppTheme>> = {
  [defaultTheme.id]: defaultTheme
}

export const DEFAULT_THEME_ID = defaultTheme.id

export function getTheme(id: string): AppTheme {
  return APP_THEMES[id] ?? APP_THEMES[DEFAULT_THEME_ID]
}
