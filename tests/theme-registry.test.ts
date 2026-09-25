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

/**
 * The structural surfaces must be separated by a *perceptible* step, not merely
 * by different hex digits. Lightness is measured in Oklab, which is perceptually
 * uniform, so a fixed L* step looks like the same amount of change in both
 * schemes. Comparing raw hex or sRGB values would let a two-digit difference
 * pass as a distinction the eye cannot make.
 */
const MIN_LADDER_STEP = 0.03

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`)
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Oklab lightness. For a neutral grey this is the cube root of linear luminance. */
function oklabL(hex: string): number {
  const [r, g, b] = parseHex(hex)
  const y = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  return Math.cbrt(y)
}

describe('surface ladder separation', () => {
  // rail -> pane -> canvas, ordered so a deeper region is a distinct step from
  // the one above it. `elevated` is deliberately excluded: it is a fill for
  // hover and selected rows, not a structural surface, and in the light scheme
  // it is intentionally the same white as the canvas.
  const ladder = ['rail', 'pane', 'canvas'] as const

  it.each(Object.keys(APP_THEMES))(
    '%s separates rail, pane and canvas by a perceptible step',
    (id) => {
      const { variants } = getTheme(id)
      for (const variantName of ['light', 'dark'] as const) {
        const variant = variants[variantName]
        for (let i = 1; i < ladder.length; i += 1) {
          const upper = ladder[i - 1]
          const lower = ladder[i]
          const step = Math.abs(oklabL(variant[lower]) - oklabL(variant[upper]))
          expect(
            step,
            `${id}/${variantName}: ${lower} (${variant[lower]}) must differ from ${upper} (${variant[upper]}) by at least ${MIN_LADDER_STEP} in Oklab L`
          ).toBeGreaterThanOrEqual(MIN_LADDER_STEP)
        }
      }
    }
  )

  it('keeps a deeper region darker than the one above it in the dark scheme', () => {
    // The relationship the upstream reference relies on: the pane is recessed
    // and the document canvas is the brighter surface.
    const { variants } = getTheme(DEFAULT_THEME_ID)
    expect(oklabL(variants.dark.pane)).toBeLessThan(oklabL(variants.dark.canvas))
    expect(oklabL(variants.dark.rail)).toBeLessThan(oklabL(variants.dark.pane))
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
