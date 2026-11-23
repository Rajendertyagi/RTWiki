import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { toAppTheme } from '../../src/web/theme/theme-factory.js'
import type { AppTheme } from '../../src/web/theme/tokens.js'

/**
 * Test-side theme discovery. The web app discovers themes with Vite's
 * import.meta.glob, which Bun cannot execute. This reader uses node:fs instead
 * and feeds the files through the SAME toAppTheme factory, so validation and
 * theme construction are shared. tests/theme-discovery.test.ts asserts the two
 * discovery methods find the same files.
 */
export const THEMES_DIR = join(import.meta.dir, '..', '..', 'src', 'web', 'themes')

export function themeFileNames(): string[] {
  return readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
}

export function loadThemesFromDisk(): Record<string, AppTheme> {
  const themes: Record<string, AppTheme> = {}
  for (const file of themeFileNames()) {
    const json = JSON.parse(readFileSync(join(THEMES_DIR, file), 'utf8')) as unknown
    themes[file.replace(/\.json$/, '')] = toAppTheme(json)
  }
  return themes
}
