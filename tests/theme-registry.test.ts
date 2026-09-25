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
 * by different values. The palette is authored in Oklab, where the first channel
 * is perceptual lightness, so the step is read directly rather than inferred by
 * decoding a hex triple back into a colour space.
 */
const MIN_LADDER_STEP = 0.03

/** Reads the L channel of an `oklch(L C H)` token, ignoring any alpha. */
function lightnessOf(token: string): number {
  const m = /^oklch\(\s*([\d.]+)/i.exec(token.trim())
  if (!m) {
    throw new Error(`expected an oklch() colour, got: ${token}`)
  }
  return Number.parseFloat(m[1])
}

describe('surface ladder separation', () => {
  // rail -> pane -> canvas, ordered so a deeper region is a distinct step from
  // the one above it. `elevated` is deliberately excluded: it is a fill for
  // hover and selected rows, not a structural surface, and in the light scheme
  // it is intentionally the same white as the canvas.
  const ladder = ['rail', 'pane', 'canvas'] as const

  it('authors every surface token in Oklab', () => {
    for (const id of Object.keys(APP_THEMES)) {
      const { variants } = getTheme(id)
      for (const variantName of ['light', 'dark'] as const) {
        for (const token of REQUIRED_VARIANT_TOKENS) {
          expect(
            variants[variantName][token].startsWith('oklch('),
            `${id}/${variantName}/${token} must be authored in oklch()`
          ).toBe(true)
        }
      }
    }
  })

  it.each(Object.keys(APP_THEMES))(
    '%s separates rail, pane and canvas by a perceptible step',
    (id) => {
      const { variants } = getTheme(id)
      for (const variantName of ['light', 'dark'] as const) {
        const variant = variants[variantName]
        for (let i = 1; i < ladder.length; i += 1) {
          const upper = ladder[i - 1]
          const lower = ladder[i]
          const step = Math.abs(lightnessOf(variant[lower]) - lightnessOf(variant[upper]))
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
    expect(lightnessOf(variants.dark.pane)).toBeLessThan(lightnessOf(variants.dark.canvas))
    expect(lightnessOf(variants.dark.rail)).toBeLessThan(lightnessOf(variants.dark.pane))
  })

  it('makes the document the brightest large surface in both schemes', () => {
    const { variants } = getTheme(DEFAULT_THEME_ID)
    for (const variantName of ['light', 'dark'] as const) {
      expect(lightnessOf(variants[variantName].canvas)).toBeGreaterThan(
        lightnessOf(variants[variantName].pane)
      )
      expect(lightnessOf(variants[variantName].canvas)).toBeGreaterThan(
        lightnessOf(variants[variantName].rail)
      )
    }
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

describe('inline style objects', () => {
  /**
   * The codebase had 15 `style={{ ... }}` objects that hardcoded layout and
   * paint rules into individual components. All were moved into stylesheets.
   *
   * What may remain is a style object that carries *only* CSS custom
   * properties. That is the modern idiom for handing a data-driven value to
   * CSS - a resized pane width, a tree depth, a zoom level - and it keeps the
   * box model in the stylesheet. A literal property in a style object means
   * the size or colour is now defined in two places, which is the drift this
   * test exists to prevent.
   */
  const LITERAL_STYLE_PROPERTIES = [
    'width',
    'height',
    'minWidth',
    'minHeight',
    'maxWidth',
    'flex',
    'flexBasis',
    'flexShrink',
    'flexGrow',
    'padding',
    'paddingLeft',
    'paddingRight',
    'margin',
    'background',
    'backgroundColor',
    'color',
    'display',
    'position',
    'top',
    'left',
    'right',
    'bottom',
    'border',
    'textAlign',
    'letterSpacing',
    'fontSize',
    'gap'
  ]

  /** Every character of every `style={...}` object, brace-matched. */
  function collectStyleObjects(source: string): string[] {
    const found: string[] = []
    for (const match of source.matchAll(/style=\{\{/g)) {
      let depth = 0
      let i = match.index + 'style='.length
      for (; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1
        else if (source[i] === '}') {
          depth -= 1
          if (depth === 0) {
            found.push(source.slice(match.index, i + 1))
            break
          }
        }
      }
    }
    return found
  }

  it('carry no layout or paint properties, only custom properties', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(join(import.meta.dir, '..', 'src', 'web'))) {
      if (!file.endsWith('.tsx')) continue
      const contents = readFileSync(file, 'utf8')
      for (const styleObject of collectStyleObjects(contents)) {
        // Every top-level key in the object literal.
        const keys = [...styleObject.matchAll(/(?:^|[{,])\s*'?([A-Za-z][\w-]*)'?\s*:/g)].map(
          (m) => m[1]
        )
        for (const key of keys) {
          if (key.startsWith('--')) continue
          if (LITERAL_STYLE_PROPERTIES.includes(key)) {
            const line = contents.slice(0, contents.indexOf(styleObject)).split('\n').length
            offenders.push(`${file}:${line} style={{ ${key} }}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('are gone entirely, or carry only custom properties', () => {
    // A count, not a rule: it makes an accidental fifth inline object visible
    // in a diff rather than silently accepted.
    let count = 0
    for (const file of collectSourceFiles(join(import.meta.dir, '..', 'src', 'web'))) {
      if (!file.endsWith('.tsx')) continue
      count += collectStyleObjects(readFileSync(file, 'utf8')).length
    }
    // Currently 4: two Mermaid zoom hosts and two right-sidebar values.
    expect(count).toBeLessThanOrEqual(6)
  })
})
