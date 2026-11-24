import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import {
  isValidColorScheme,
  isValidThemeId,
  readAppearanceSettings,
  writeAppearanceSettings
} from '../src/server/settings/index.js'
import { buildThemeBootstrap } from '../src/server/theme/bootstrap.js'

const THEMES_DIR = join(import.meta.dir, '..', 'src', 'web', 'themes')

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rtwiki-stage-d-'))
}

describe('appearance settings validation', () => {
  it('accepts only safe theme ids', () => {
    expect(isValidThemeId('default')).toBe(true)
    expect(isValidThemeId('high-contrast')).toBe(true)
    expect(isValidThemeId('../evil')).toBe(false)
    expect(isValidThemeId('has space')).toBe(false)
    expect(isValidThemeId('UPPER')).toBe(false)
  })

  it('accepts only the three color schemes', () => {
    expect(isValidColorScheme('auto')).toBe(true)
    expect(isValidColorScheme('light')).toBe(true)
    expect(isValidColorScheme('dark')).toBe(true)
    expect(isValidColorScheme('system')).toBe(false)
  })
})

describe('appearance settings storage', () => {
  it('round-trips through the settings table', async () => {
    const dir = tempDir()
    try {
      const db = initDatabase(dir)
      await runMigrations(db)
      const getDb = () => db
      expect(readAppearanceSettings(getDb)).toEqual({
        themeId: 'default',
        colorScheme: 'auto',
        contrast: 100,
        glassOpacity: 100
      })
      writeAppearanceSettings(getDb, {
        themeId: 'high-contrast',
        colorScheme: 'dark',
        contrast: 100,
        glassOpacity: 100
      })
      expect(readAppearanceSettings(getDb)).toEqual({
        themeId: 'high-contrast',
        colorScheme: 'dark',
        contrast: 100,
        glassOpacity: 100
      })
    } finally {
      await closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clamps out-of-range interface values on read and write', async () => {
    const dir = tempDir()
    try {
      const db = initDatabase(dir)
      await runMigrations(db)
      const getDb = () => db
      writeAppearanceSettings(getDb, {
        themeId: 'default',
        colorScheme: 'auto',
        contrast: 9999,
        glassOpacity: -50
      })
      const read = readAppearanceSettings(getDb)
      expect(read.contrast).toBe(150)
      expect(read.glassOpacity).toBe(30)
    } finally {
      await closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('normalises a saved theme id whose file was removed', async () => {
    const dir = tempDir()
    try {
      const db = initDatabase(dir)
      await runMigrations(db)
      const getDb = () => db
      writeAppearanceSettings(getDb, {
        themeId: 'high-contrast',
        colorScheme: 'dark',
        contrast: 100,
        glassOpacity: 100
      })
      const available = new Set(['default', 'pastel-dreams', 'catppuccin', 'vercel'])
      expect(readAppearanceSettings(getDb, available).themeId).toBe('default')
      expect(readAppearanceSettings(getDb).themeId).toBe('high-contrast')
    } finally {
      await closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pre-paint bootstrap', () => {
  it('emits Mantine-compatible selectors for both schemes', () => {
    const result = buildThemeBootstrap({
      themesDir: THEMES_DIR,
      themeId: 'default',
      colorScheme: 'auto',
      contrast: 100,
      glassOpacity: 100
    })
    expect(result.style).toContain(':root,:host{')
    expect(result.style).toContain(
      ':root[data-mantine-color-scheme="light"],:host([data-mantine-color-scheme="light"]){'
    )
    expect(result.style).toContain(
      ':root[data-mantine-color-scheme="dark"],:host([data-mantine-color-scheme="dark"]){'
    )
    expect(result.style).toContain('--rtwiki-canvas:')
    expect(result.style).toContain('--rtwiki-rail-width:')
  })

  it('escapes script values and resolves auto via matchMedia', () => {
    const result = buildThemeBootstrap({
      themesDir: THEMES_DIR,
      themeId: 'default',
      colorScheme: 'auto',
      contrast: 100,
      glassOpacity: 100
    })
    expect(result.script).toContain('matchMedia')
    expect(result.script).toContain('dataset.mantineColorScheme')
    expect(result.script).toContain('dataset.rtwikiColorSchemeChoice')
    expect(result.script).not.toContain('</script>')
  })

  it('falls back to default for a missing theme with a warning', () => {
    const warnings: string[] = []
    const result = buildThemeBootstrap({
      themesDir: THEMES_DIR,
      themeId: 'does-not-exist',
      colorScheme: 'light',
      contrast: 100,
      glassOpacity: 100,
      warn: (message) => warnings.push(message)
    })
    expect(result.themeId).toBe('default')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('does-not-exist')
  })

  it('rejects a theme with an unsafe CSS value and uses default', () => {
    const dir = tempDir()
    try {
      const bad = JSON.parse(readFileSync(join(THEMES_DIR, 'default.json'), 'utf8')) as {
        tokens: { semantic: { light: Record<string, { $value: unknown }> } }
      }
      bad.tokens.semantic.light.chromeHairline.$value = '</style><script>alert(1)</script>'
      writeFileSync(join(dir, 'bad.json'), JSON.stringify(bad))
      writeFileSync(join(dir, 'default.json'), readFileSync(join(THEMES_DIR, 'default.json')))
      const warnings: string[] = []
      const result = buildThemeBootstrap({
        themesDir: dir,
        themeId: 'bad',
        colorScheme: 'light',
        contrast: 100,
        glassOpacity: 100,
        warn: (message) => warnings.push(message)
      })
      expect(result.themeId).toBe('default')
      expect(result.style).not.toContain('<script>')
      expect(warnings.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('theme file parity', () => {
  it('build output matches authored themes byte for byte', () => {
    const buildDir = join(import.meta.dir, '..', 'build', 'web', 'themes')
    const authored = readdirSyncSafe(THEMES_DIR)
    const built = readdirSyncSafe(buildDir)
    expect(built).toEqual(authored)
    for (const file of authored) {
      expect(readFileSync(join(buildDir, file), 'utf8')).toBe(
        readFileSync(join(THEMES_DIR, file), 'utf8')
      )
    }
  })
})

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}
