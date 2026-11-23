import { describe, expect, it } from 'bun:test'
import {
  getTheme,
  REQUIRED_INTERACTION_TOKENS,
  REQUIRED_VARIANT_TOKENS
} from '../src/web/theme/registry.js'
import { parseThemeDefinition } from '../src/web/theme/theme-definition.js'
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

  it('reproduces the Mantine theme data exactly', () => {
    const mantine = getTheme('default').mantine as unknown as {
      primaryColor: string
      primaryShade: { light: number; dark: number }
      colors: Record<string, string[]>
      fontFamily: string
      defaultRadius: string
      radius: Record<string, string>
      spacing: Record<string, string>
      fontSizes: Record<string, string>
      shadows: Record<string, string>
      focusRing: 'auto' | 'always' | 'never'
    }
    expect(parsed.mantine.primaryColor).toBe(mantine.primaryColor)
    expect(parsed.mantine.primaryShade as unknown).toEqual(mantine.primaryShade)
    expect(parsed.mantine.colors.blue as unknown).toEqual(mantine.colors.blue)
    expect(parsed.mantine.fontFamily).toBe(mantine.fontFamily)
    expect(parsed.mantine.defaultRadius).toBe(mantine.defaultRadius)
    expect(parsed.mantine.radius).toEqual(mantine.radius)
    expect(parsed.mantine.spacing).toEqual(mantine.spacing)
    expect(parsed.mantine.fontSizes).toEqual(mantine.fontSizes)
    expect(parsed.mantine.shadows).toEqual(mantine.shadows)
    expect(parsed.mantine.focusRing).toBe(mantine.focusRing)
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
