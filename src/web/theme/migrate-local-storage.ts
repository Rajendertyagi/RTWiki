import { updateAppearance } from '../services/server-settings-api.js'

/**
 * One-time migration of the two legacy localStorage preferences into the
 * SQLite settings table. The database wins if a value is already stored; the
 * legacy keys are removed either way so they can never override the DB again.
 *
 * Called before the first render and awaited, so the manager and the picker
 * cannot race with persistence.
 */
const LEGACY_THEME_KEY = 'rtwiki-theme-id'
const LEGACY_SCHEME_KEY = 'mantine-color-scheme-value'

function isScheme(value: string | null): value is 'auto' | 'light' | 'dark' {
  return value === 'auto' || value === 'light' || value === 'dark'
}

export async function migrateLocalStorageToDatabase(): Promise<void> {
  let themeId: string | null = null
  let colorScheme: string | null = null
  try {
    themeId = localStorage.getItem(LEGACY_THEME_KEY)
    colorScheme = localStorage.getItem(LEGACY_SCHEME_KEY)
  } catch {
    // Storage may be unavailable; nothing to migrate.
  }

  const input: { themeId?: string; colorScheme?: 'auto' | 'light' | 'dark' } = {}
  if (themeId && /^[a-z0-9][a-z0-9-]*$/.test(themeId)) input.themeId = themeId
  if (isScheme(colorScheme)) input.colorScheme = colorScheme

  if (Object.keys(input).length > 0) {
    try {
      // The server merges with stored values, so an existing DB choice wins.
      await updateAppearance(input)
    } catch (error) {
      console.warn('[RTWiki] Could not migrate appearance preferences:', error)
    }
  }

  try {
    localStorage.removeItem(LEGACY_THEME_KEY)
    localStorage.removeItem(LEGACY_SCHEME_KEY)
  } catch {
    // Best effort; the keys are inert once the DB-backed manager is installed.
  }
}
