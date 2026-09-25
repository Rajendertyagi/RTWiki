import type { MantineThemeOverride } from '@mantine/core'
import { createTheme } from '@mantine/core'

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
    }
  }),
  variants: {
    light: {
      canvas: '#ffffff',
      pane: '#f2f2f2',
      rail: '#e8e8e8',
      elevated: '#ffffff',
      border: '#dbdbdb',
      text: '#383838',
      textMuted: '#666666',
      hover: 'rgba(0, 0, 0, 0.032)',
      selected: '#ffffff'
    },
    dark: {
      // The canvas is TriliumNext's canvas tone. It is deliberately *declared*
      // rather than inherited from the rich editor, which paints its own
      // `#1f1f1f`; the editor surface is forced to follow this token instead.
      canvas: '#242424',
      pane: '#1f1f1f',
      rail: '#1a1a1a',
      elevated: '#262626',
      border: '#454545',
      text: '#cccccc',
      textMuted: '#bbbbbb',
      hover: '#ffffff0d',
      selected: '#ffffff25'
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
