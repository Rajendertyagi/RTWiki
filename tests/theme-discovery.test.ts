import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { buildThemes, resolveTheme } from '../src/web/theme/theme-collection.js'
import defaultJson from '../src/web/themes/default.json'
import { themeFileNames } from './helpers/theme-files.js'

/**
 * Drift guard for the two discovery methods.
 *
 * The web app discovers themes with Vite's import.meta.glob (Bun cannot execute
 * it); the tests read the same directory with node:fs. This test reads the glob
 * literal out of registry.ts, expands it against the theme directory, and
 * asserts it resolves to exactly the files the fs reader sees. If either side
 * changes — pattern, directory, or extension — this fails loudly.
 */
const REGISTRY_PATH = join(import.meta.dir, '..', 'src', 'web', 'theme', 'registry.ts')
const THEMES_DIR = join(import.meta.dir, '..', 'src', 'web', 'themes')

function globPatternFromRegistry(): string {
  const source = readFileSync(REGISTRY_PATH, 'utf8')
  const match = /import\.meta\.glob\(\s*['"]([^'"]+)['"]/.exec(source)
  if (!match) {
    throw new Error('registry.ts no longer contains an import.meta.glob theme pattern')
  }
  return match[1]
}

function filesFromGlobPattern(pattern: string): string[] {
  // The pattern is relative to registry.ts, e.g. '../themes/*.json'.
  const absolutePattern = resolve(dirname(REGISTRY_PATH), pattern)
  const patternDir = dirname(absolutePattern)
  const extension = basename(absolutePattern).replace(/^\*/, '')
  expect(patternDir).toBe(resolve(THEMES_DIR))
  return readdirSync(patternDir)
    .filter((name) => name.endsWith(extension))
    .sort()
}

describe('theme discovery parity', () => {
  it('the web glob pattern and the test fs reader find the same theme files', () => {
    const pattern = globPatternFromRegistry()
    const fromGlob = filesFromGlobPattern(pattern)
    const fromFs = themeFileNames()
    expect(fromGlob).toEqual(fromFs)
    expect(fromFs.length).toBeGreaterThan(0)
  })

  it('the default theme is always among the discovered files', () => {
    expect(themeFileNames()).toContain('default.json')
  })
})

describe('broken theme handling', () => {
  it('skips an invalid theme with a warning and keeps the default', () => {
    const warnings: string[] = []
    const themes = buildThemes(
      [
        ['default', defaultJson],
        ['broken', { id: 'broken', version: 999 }]
      ],
      (message) => warnings.push(message)
    )
    expect(Object.keys(themes)).toEqual(['default'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('broken')
  })

  it('falls back to the default for an unknown id', () => {
    const themes = buildThemes([['default', defaultJson]])
    expect(resolveTheme(themes, 'does-not-exist').id).toBe('default')
  })

  it('fails loudly if the default theme itself is invalid', () => {
    const silentWarn = () => {}
    expect(() => buildThemes([['default', { id: 'default', version: 999 }]], silentWarn)).toThrow(
      /Default theme "default" is missing or invalid/
    )
  })
})
