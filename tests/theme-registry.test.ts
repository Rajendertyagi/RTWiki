import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_THEMES,
  buildVariantVariables,
  DEFAULT_THEME_ID,
  getTheme,
  REQUIRED_VARIANT_TOKENS,
  VARIANT_TOKEN_NAMES
} from '../src/web/theme/registry.js'

/**
 * These tests guard the theme registry, which is the single source of truth for
 * every RTWiki surface colour. They exist because a single ambiguous token pair
 * (`--rtwiki-background` / `--rtwiki-surface`) silently meant two different
 * things and produced the document-surface defect recorded as F1.
 */

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('theme registry', () => {
  it('exposes a non-empty set of themes', () => {
    expect(Object.keys(APP_THEMES).length).toBeGreaterThan(0)
  })

  it('registers the default theme', () => {
    expect(APP_THEMES[DEFAULT_THEME_ID]).toBeDefined()
  })

  it.each(Object.keys(APP_THEMES))('%s declares both a light and a dark variant', (id) => {
    const theme = getTheme(id)
    expect(theme.variants.light).toBeDefined()
    expect(theme.variants.dark).toBeDefined()
  })

  it.each(Object.keys(APP_THEMES))('%s declares every required token in both variants', (id) => {
    const { variants } = getTheme(id)
    for (const variantName of ['light', 'dark'] as const) {
      for (const token of REQUIRED_VARIANT_TOKENS) {
        const value = variants[variantName][token]
        expect(typeof value).toBe('string')
        // A declared-but-empty colour is as broken as a missing one.
        expect(value).not.toBe('')
      }
    }
  })

  /**
   * The F1 guard, generalised from two schemes to every theme and variant.
   * If the document canvas ever equals a panel tone, the document stops reading
   * as the page and becomes a card inside it.
   */
  it.each(Object.keys(APP_THEMES))('%s keeps the canvas distinct from the pane', (id) => {
    const { variants } = getTheme(id)
    for (const variantName of ['light', 'dark'] as const) {
      expect(variants[variantName].canvas).not.toBe(variants[variantName].pane)
    }
  })

  it.each(Object.keys(APP_THEMES))('%s keeps the rail distinct from the pane', (id) => {
    const { variants } = getTheme(id)
    for (const variantName of ['light', 'dark'] as const) {
      expect(variants[variantName].rail).not.toBe(variants[variantName].pane)
    }
  })

  it('maps every variant token to a --rtwiki-* custom property', () => {
    const { variants } = getTheme(DEFAULT_THEME_ID)
    const variables = buildVariantVariables(variants.light)
    for (const token of REQUIRED_VARIANT_TOKENS) {
      expect(variables[`--rtwiki-${VARIANT_TOKEN_NAMES[token]}`]).toBe(variants.light[token])
    }
    // No stray custom properties beyond the declared token set.
    expect(Object.keys(variables).length).toBe(REQUIRED_VARIANT_TOKENS.length)
  })

  it('falls back to the default theme for an unknown id', () => {
    expect(getTheme('no-such-theme').id).toBe(DEFAULT_THEME_ID)
  })
})

describe('legacy surface tokens', () => {
  // These names are deleted rather than aliased. An alias would preserve the
  // exact ambiguity that caused F1, so their absence is the contract.
  const legacyTokens = [
    '--rtwiki-background',
    '--rtwiki-surface',
    '--rtwiki-surface-raised',
    '--rtwiki-rail-bg'
  ]

  it('are no longer referenced anywhere in the web sources', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(join(import.meta.dir, '..', 'src', 'web'))) {
      const contents = readFileSync(file, 'utf8')
      for (const token of legacyTokens) {
        if (contents.includes(token)) {
          offenders.push(`${file}: ${token}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
