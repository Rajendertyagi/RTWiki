import { toAppTheme } from './theme-factory.js'
import { type AppTheme, DEFAULT_THEME_ID } from './tokens.js'

/**
 * Builds the theme map from discovered JSON entries. Shared by the web app
 * (which gets entries from import.meta.glob) and the tests (which get them from
 * node:fs), so the skip-on-error and fallback behaviour is testable under Bun.
 */
export function buildThemes(
  entries: Iterable<readonly [id: string, json: unknown]>,
  warn: (message: string, error: unknown) => void = (message, error) => console.warn(message, error)
): Record<string, AppTheme> {
  const themes: Record<string, AppTheme> = {}
  for (const [id, json] of entries) {
    try {
      themes[id] = toAppTheme(json)
    } catch (error) {
      // A bad added theme must never take down the app. The default is always
      // present, so getTheme() can fall back to it.
      warn(`[RTWiki] Skipping invalid theme "${id}":`, error)
    }
  }
  if (!themes[DEFAULT_THEME_ID]) {
    // The default ships in the repo and is validated in CI. If it is broken,
    // fail loudly rather than silently running with no usable theme.
    throw new Error(`[RTWiki] Default theme "${DEFAULT_THEME_ID}" is missing or invalid`)
  }
  return themes
}

/** Resolves a theme id, falling back to the default for unknown ids. */
export function resolveTheme(themes: Readonly<Record<string, AppTheme>>, id: string): AppTheme {
  return themes[id] ?? themes[DEFAULT_THEME_ID]
}
