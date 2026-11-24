import { describe, expect, it } from 'bun:test'
import { FIXED_MANTINE_BASE } from '../src/web/theme/mantine-base.js'
import { parseThemeDefinition } from '../src/web/theme/theme-definition.js'
import { REQUIRED_INTERACTION_TOKENS, REQUIRED_VARIANT_TOKENS } from '../src/web/theme/tokens.js'
import { loadThemesFromDisk } from './helpers/theme-files.js'

const themesFromDisk = loadThemesFromDisk()
const getTheme = (id: string) => themesFromDisk[id]

import defaultThemeJson from '../src/web/themes/default.json'

/**
 * Losslessness gate for the JSON theme format. The default theme JSON must
 * reproduce every value the registry currently publishes, byte for byte.
 * If this passes, the registry can be switched to the JSON source with no
 * visual change.
 */
const parsed = parseThemeDefinition(defaultThemeJson, {
  variantTokens: REQUIRED_VARIANT_TOKENS,
  interactionTokens: REQUIRED_INTERACTION_TOKENS
})

describe('default theme JSON', () => {
  it('declares the expected identity', () => {
    expect(parsed.id).toBe('default')
    expect(parsed.name).toBe('Default')
  })

  it.each(['light', 'dark'] as const)('%s variant matches the registry exactly', (scheme) => {
    const registryVariant = getTheme('default').variants[scheme]
    for (const name of [...REQUIRED_VARIANT_TOKENS, ...REQUIRED_INTERACTION_TOKENS]) {
      expect(parsed.variants[scheme][name], `${scheme}/${name}`).toBe(registryVariant[name])
    }
  })

  it('reproduces the colour-only Mantine theme data exactly', () => {
    const mantine = getTheme('default').mantine as unknown as {
      primaryColor: string
      primaryShade: { light: number; dark: number }
      colors: Record<string, string[]>
    }
    expect(parsed.mantine.primaryColor).toBe(mantine.primaryColor)
    expect(parsed.mantine.primaryShade as unknown).toEqual(mantine.primaryShade)
    expect(parsed.mantine.colors.blue as unknown).toEqual(mantine.colors.blue)
  })

  it('supplies the fixed non-colour Mantine values unchanged', () => {
    const mantine = getTheme('default').mantine as unknown as Record<string, unknown>
    expect(mantine.fontFamily).toBe(FIXED_MANTINE_BASE.fontFamily)
    expect(mantine.fontFamilyMonospace).toBe(FIXED_MANTINE_BASE.fontFamilyMonospace)
    expect(mantine.respectReducedMotion).toBe(FIXED_MANTINE_BASE.respectReducedMotion)
    expect(mantine.defaultRadius).toBe(FIXED_MANTINE_BASE.defaultRadius)
    expect(mantine.radius).toEqual(FIXED_MANTINE_BASE.radius)
    expect(mantine.spacing).toEqual(FIXED_MANTINE_BASE.spacing)
    expect(mantine.fontSizes).toEqual(FIXED_MANTINE_BASE.fontSizes)
    expect(mantine.shadows).toEqual(FIXED_MANTINE_BASE.shadows)
    expect(mantine.focusRing).toBe(FIXED_MANTINE_BASE.focusRing)
  })
})

/** Mutable view used only by the negative tests below. */
type MutableTheme = {
  tokens: {
    semantic: {
      light: Record<string, { $value: string }>
      dark: Record<string, { $value: string }>
    }
    primitives: { color: { accent: { blue: Record<string, unknown> } } }
  }
}

describe('theme definition validation', () => {
  it('rejects an unresolved alias', () => {
    const broken = structuredClone(defaultThemeJson) as unknown as MutableTheme
    broken.tokens.semantic.light.canvas.$value = '{primitives.color.neutral.light.missing}'
    expect(() =>
      parseThemeDefinition(broken, {
        variantTokens: REQUIRED_VARIANT_TOKENS,
        interactionTokens: REQUIRED_INTERACTION_TOKENS
      })
    ).toThrow(/Unresolved token alias/)
  })

  it('rejects a circular alias', () => {
    const broken = structuredClone(defaultThemeJson) as unknown as MutableTheme
    broken.tokens.semantic.light.canvas.$value = '{semantic.light.pane}'
    broken.tokens.semantic.light.pane.$value = '{semantic.light.canvas}'
    expect(() =>
      parseThemeDefinition(broken, {
        variantTokens: REQUIRED_VARIANT_TOKENS,
        interactionTokens: REQUIRED_INTERACTION_TOKENS
      })
    ).toThrow(/Circular token alias/)
  })

  it('rejects a palette that is not 10 shades', () => {
    const broken = structuredClone(defaultThemeJson) as unknown as MutableTheme
    delete broken.tokens.primitives.color.accent.blue['9']
    expect(() =>
      parseThemeDefinition(broken, {
        variantTokens: REQUIRED_VARIANT_TOKENS,
        interactionTokens: REQUIRED_INTERACTION_TOKENS
      })
    ).toThrow(/exactly 10 shades/)
  })
})
