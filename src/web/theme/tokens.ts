/**
 * Shared token-name definitions. Kept separate from the registry so the
 * test-side filesystem reader can validate themes without importing the
 * registry (which uses Vite's import.meta.glob and cannot run under Bun).
 */

/** The theme that is always present and is the fallback for unknown ids. */
export const DEFAULT_THEME_ID = 'default'

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
  mantine: import('@mantine/core').MantineThemeOverride
  variants: ThemeVariants
}

/** Emits every variant token as a --rtwiki-* custom property. */
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

/** Maps a variant key to its CSS custom property name, declared once. */
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
