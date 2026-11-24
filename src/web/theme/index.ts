import type { CSSVariablesResolver } from '@mantine/core'
import type { Adjustments } from './adjustments.js'
import { buildThemeCssVariables, formatFallbackMessage } from './css-variables.js'
import type { AppTheme } from './registry.js'

export { buildThemeCssVariables } from './css-variables.js'
export type {
  AppTheme,
  RequiredInteractionToken,
  RequiredVariantToken,
  ThemeVariant,
  ThemeVariants
} from './registry.js'
export {
  APP_THEMES,
  buildVariantVariables,
  DEFAULT_THEME_ID,
  getTheme,
  REQUIRED_INTERACTION_TOKENS,
  REQUIRED_VARIANT_TOKENS,
  VARIANT_TOKEN_NAMES
} from './registry.js'

/**
 * Builds the Mantine CSS variables resolver for one theme. Mantine applies the
 * returned `light` or `dark` map based on `data-mantine-color-scheme`, so the
 * binary scheme selects a variant *within* whichever theme is active.
 *
 * The values come from the same server-safe module the pre-paint bootstrap
 * uses, so the first screen and the final screen cannot disagree.
 */
export function createThemeCssVariablesResolver(
  theme: AppTheme,
  adjustments?: Adjustments
): CSSVariablesResolver {
  return () =>
    buildThemeCssVariables(theme, adjustments, (fallback) => {
      console.warn(formatFallbackMessage(fallback))
    })
}
