import type { MantineThemeOverride } from '@mantine/core'
import { createTheme, Menu, Modal, Popover, Tooltip } from '@mantine/core'

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

export type ThemeVariant = Record<RequiredVariantToken, string>

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
export const VARIANT_TOKEN_NAMES: Record<RequiredVariantToken, string> = {
  canvas: 'canvas',
  pane: 'pane',
  rail: 'rail',
  elevated: 'elevated',
  border: 'border',
  text: 'text',
  textMuted: 'text-muted',
  hover: 'hover',
  selected: 'selected'
}

export function buildVariantVariables(variant: ThemeVariant): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const token of REQUIRED_VARIANT_TOKENS) {
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
      Tooltip: Tooltip.extend({ classNames: { tooltip: FLOATING } })
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
      selected: 'oklch(1 0 0 / 0.14)'
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
      selected: 'oklch(1 0 0)'
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
