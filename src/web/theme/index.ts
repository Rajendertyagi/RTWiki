import type { CSSVariablesResolver } from '@mantine/core'
import { LAYOUT } from '../config/index.js'
import { type AppTheme, buildVariantVariables, DEFAULT_THEME_ID, getTheme } from './registry.js'

export type {
  AppTheme,
  RequiredVariantToken,
  ThemeVariant,
  ThemeVariants
} from './registry.js'
export {
  APP_THEMES,
  buildVariantVariables,
  DEFAULT_THEME_ID,
  getTheme,
  REQUIRED_VARIANT_TOKENS,
  VARIANT_TOKEN_NAMES
} from './registry.js'

/**
 * Persisted theme identifier. The light/dark variant is owned by Mantine, which
 * already persists it; only the theme identity is RTWiki's to store. The picker
 * that writes this key is not part of the first slice, so an unset or unknown
 * value resolves to the default theme.
 */
const THEME_STORAGE_KEY = 'rtwiki-theme-id'

interface ThemeStorage {
  getItem(key: string): string | null
}

export function resolveActiveTheme(storage?: ThemeStorage | null): AppTheme {
  let stored: string | null = null
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    stored = source?.getItem(THEME_STORAGE_KEY) ?? null
  } catch {
    // Storage can be unavailable (privacy mode, blocked cookies). The default
    // theme is always a safe answer, so a read failure is not fatal.
    stored = null
  }
  if (stored === null) {
    return getTheme(DEFAULT_THEME_ID)
  }
  return getTheme(stored)
}

/**
 * Builds the Mantine CSS variables resolver for one theme. Mantine applies the
 * returned `light` or `dark` map based on `data-mantine-color-scheme`, so the
 * binary scheme selects a variant *within* whichever theme is active.
 */
export function createThemeCssVariablesResolver(theme: AppTheme): CSSVariablesResolver {
  return () => ({
    variables: {
      // Shared overlay stacking level for every floating layer (menus,
      // popovers, portals, full-screen workspaces). Defined once here so
      // stylesheet consumers and inline styles never diverge.
      '--rtwiki-overlay-z-index': String(LAYOUT.overlayZIndex)
    },
    light: buildVariantVariables(theme.variants.light),
    dark: buildVariantVariables(theme.variants.dark)
  })
}
