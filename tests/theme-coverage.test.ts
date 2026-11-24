import { describe, expect, it } from 'bun:test'
import { DEFAULT_THEME } from '@mantine/core'
import { buildThemeBootstrap } from '../src/server/theme/bootstrap.js'
import { applyContrast } from '../src/web/theme/adjustments.js'
import { contrastRatio, parseOklch } from '../src/web/theme/contrast.js'
import {
  buildThemeCssVariables,
  type CssVariableFallback,
  formatFallbackMessage
} from '../src/web/theme/css-variables.js'
import { parseThemeDefinition } from '../src/web/theme/theme-definition.js'
import { REQUIRED_INTERACTION_TOKENS, REQUIRED_VARIANT_TOKENS } from '../src/web/theme/tokens.js'
import defaultThemeJson from '../src/web/themes/default.json'
import { loadThemesFromDisk, THEMES_DIR } from './helpers/theme-files.js'

/**
 * Phase 1 theme-coverage gate.
 *
 * The web resolver and the server pre-paint bootstrap both call
 * `buildThemeCssVariables`, so asserting that function here covers both paths.
 */
const themes = loadThemesFromDisk()
const themeIds = Object.keys(themes).sort()
const ADJUSTMENTS = { contrast: 100, glassOpacity: 100 }

/** The nine Mantine surfaces that map to an RTWiki region token. */
const SAFE_MAPPINGS: Record<string, string> = {
  '--mantine-color-text': '--rtwiki-text',
  '--mantine-color-body': '--rtwiki-canvas',
  '--mantine-color-default-border': '--rtwiki-border',
  '--mantine-color-dimmed': '--rtwiki-text-muted',
  '--mantine-color-placeholder': '--rtwiki-text-muted',
  '--mantine-color-default-hover': '--rtwiki-hover',
  '--mantine-color-default-color': '--rtwiki-text',
  '--mantine-color-bright': '--rtwiki-text',
  '--mantine-color-disabled-color': '--rtwiki-text-muted'
}
const ANCHOR_KEY = '--mantine-color-anchor'
const SAFE_KEYS = [...Object.keys(SAFE_MAPPINGS), ANCHOR_KEY]
const RISKY_KEYS = [
  '--mantine-color-default',
  '--mantine-color-disabled',
  '--mantine-color-disabled-border'
] as const

type Scheme = 'light' | 'dark'

function primaryShadeOf(id: string, scheme: Scheme): { primaryColor: string; shade: number } {
  const mantine = themes[id].mantine as unknown as {
    primaryColor: string
    primaryShade: { light: number; dark: number }
  }
  return { primaryColor: mantine.primaryColor, shade: mantine.primaryShade[scheme] }
}

describe('Phase 1: Mantine surface overrides', () => {
  it('covers the expected theme set', () => {
    expect(themeIds.length).toBeGreaterThanOrEqual(4)
  })

  for (const id of themeIds) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${id}/${scheme}: all 10 safe overrides are present and match the RTWiki token family`, () => {
        const map = buildThemeCssVariables(themes[id], ADJUSTMENTS)[scheme]
        for (const key of SAFE_KEYS) {
          expect(map[key], `${key} is present`).toBeDefined()
        }
        for (const [mantineKey, rtwikiKey] of Object.entries(SAFE_MAPPINGS)) {
          expect(map[mantineKey], `${mantineKey} === ${rtwikiKey}`).toBe(map[rtwikiKey])
        }
        const { primaryColor, shade } = primaryShadeOf(id, scheme)
        expect(map[ANCHOR_KEY]).toBe(`var(--mantine-color-${primaryColor}-${shade})`)
      })
    }
  }

  it.each(themeIds)('%s: risky surfaces are not overridden and fallbacks are logged', (id) => {
    const fallbacks: CssVariableFallback[] = []
    const css = buildThemeCssVariables(themes[id], ADJUSTMENTS, (fallback) => {
      fallbacks.push(fallback)
    })

    for (const scheme of ['light', 'dark'] as const) {
      for (const key of RISKY_KEYS) {
        expect(css[scheme][key], `${scheme}/${key} keeps Mantine's value`).toBeUndefined()
      }
    }

    expect(fallbacks).toHaveLength(RISKY_KEYS.length * 2)
    for (const fallback of fallbacks) {
      expect(fallback.themeId, 'theme id').toBe(id)
      expect(['light', 'dark'], 'scheme').toContain(fallback.scheme)
      expect(RISKY_KEYS as readonly string[], 'variable').toContain(fallback.variable)
      expect(typeof fallback.mappedValue, 'mapped value').toBe('string')
      expect(fallback.mappedValue.length, 'mapped value is non-empty').toBeGreaterThan(0)
      expect(typeof fallback.reason, 'reason').toBe('string')
      expect(fallback.reason.length, 'reason is non-empty').toBeGreaterThan(0)

      // The mapped value is the one we did NOT use; it is the region token the
      // risky key would have mapped to.
      const token =
        fallback.variable === '--mantine-color-disabled-border'
          ? '--rtwiki-border'
          : '--rtwiki-pane'
      expect(fallback.mappedValue).toBe(css[fallback.scheme][token])

      // The structured log line carries all five fields.
      const message = formatFallbackMessage(fallback)
      for (const field of [
        fallback.themeId,
        fallback.scheme,
        fallback.variable,
        fallback.mappedValue,
        fallback.reason
      ]) {
        expect(message).toContain(field)
      }
    }
  })
})

describe('Phase 1: safe overrides use the contrast-adjusted variant', () => {
  it.each(themeIds)(
    '%s: --mantine-color-text follows the adjusted text token, not the raw variant',
    (id) => {
      const contrast = 50
      const adjustments = { contrast, glassOpacity: 100 }
      for (const scheme of ['light', 'dark'] as const) {
        const css = buildThemeCssVariables(themes[id], adjustments)
        const expected = applyContrast(themes[id].variants[scheme], scheme, contrast).text
        // The adjustment must actually change the value, or this proves nothing.
        expect(expected).not.toBe(themes[id].variants[scheme].text)
        expect(css[scheme]['--mantine-color-text']).toBe(expected)
        expect(css[scheme]['--rtwiki-text']).toBe(expected)
      }
    }
  )
})

describe('Phase 1: per-scheme floating background', () => {
  it("uses each scheme's own elevated value (glass 100)", () => {
    let differs = false
    for (const id of themeIds) {
      const css = buildThemeCssVariables(themes[id], ADJUSTMENTS)
      expect(css.light['--rtwiki-floating-bg']).toBe(css.light['--rtwiki-elevated'])
      expect(css.dark['--rtwiki-floating-bg']).toBe(css.dark['--rtwiki-elevated'])
      if (css.light['--rtwiki-floating-bg'] !== css.dark['--rtwiki-floating-bg']) {
        differs = true
      }
    }
    expect(differs, 'at least one theme floats a different colour per scheme').toBe(true)
  })

  it('still applies the glass slider to the floating background', () => {
    const css = buildThemeCssVariables(themes.default, { contrast: 100, glassOpacity: 50 })
    expect(css.light['--rtwiki-floating-bg']).not.toBe(css.light['--rtwiki-elevated'])
    expect(css.light['--rtwiki-floating-bg']).toContain('/ 0.5')
    expect(css.dark['--rtwiki-floating-bg']).not.toBe(css.dark['--rtwiki-elevated'])
  })
})

describe('Phase 1: D1/D2 canonical parity', () => {
  it('is deterministic for identical inputs', () => {
    for (const id of themeIds) {
      expect(buildThemeCssVariables(themes[id], ADJUSTMENTS)).toEqual(
        buildThemeCssVariables(themes[id], ADJUSTMENTS)
      )
    }
  })

  it('produces the same maps from the JSON the bootstrap parses', () => {
    const parsed = parseThemeDefinition(defaultThemeJson, {
      variantTokens: REQUIRED_VARIANT_TOKENS,
      interactionTokens: REQUIRED_INTERACTION_TOKENS
    })
    const fromBootstrap = buildThemeCssVariables(
      { id: parsed.id, variants: parsed.variants, mantine: parsed.mantine },
      ADJUSTMENTS
    )
    const fromResolver = buildThemeCssVariables(themes.default, ADJUSTMENTS)
    expect(fromBootstrap).toEqual(fromResolver)
  })
})

describe('Phase 1: bootstrap fallback logging', () => {
  it('captures all 6 fallbacks with all 5 fields via the injected logger', () => {
    const fallbacks: CssVariableFallback[] = []
    const warnings: string[] = []
    buildThemeBootstrap({
      themesDir: THEMES_DIR,
      themeId: 'default',
      colorScheme: 'light',
      contrast: 100,
      glassOpacity: 100,
      warn: (message) => warnings.push(message),
      onFallback: (fallback) => fallbacks.push(fallback)
    })

    // Fallbacks stay off the validation `warn` channel.
    expect(warnings).toHaveLength(0)
    expect(fallbacks).toHaveLength(RISKY_KEYS.length * 2)
    for (const fallback of fallbacks) {
      expect(fallback.themeId, 'theme id').toBe('default')
      expect(['light', 'dark'], 'scheme').toContain(fallback.scheme)
      expect(RISKY_KEYS as readonly string[], 'variable').toContain(fallback.variable)
      expect(typeof fallback.mappedValue, 'mapped value').toBe('string')
      expect(fallback.mappedValue.length, 'mapped value is non-empty').toBeGreaterThan(0)
      expect(typeof fallback.reason, 'reason').toBe('string')
      expect(fallback.reason.length, 'reason is non-empty').toBeGreaterThan(0)
    }
  })
})

/**
 * Decision 1: status colours must stay readable on every theme surface.
 *
 * The app's status colours are Mantine color *names* used directly by Alert
 * and Button (e.g. `color="red"` / `color="orange"` in rich-editor.tsx), which
 * Mantine resolves through its palette CSS variables. The source of truth is
 * therefore DEFAULT_THEME.colors, not duplicated hex literals: if the app's
 * palette changes to an unreadable value, this test fails.
 *
 * Semantic mapping: error -> red, success/info -> teal, warning -> orange.
 * Shade index is scheme-specific: 9 (darkest) on light surfaces, 5 on dark.
 * Mantine's palette is sRGB hex while `contrast.ts` works in Oklch, so each
 * hex is converted with the documented inverse of the Oklab -> linear sRGB
 * matrices used by that module, then parsed back through `parseOklch`.
 * WCAG AA allows 3:1 for UI components and large text.
 */
const STATUS_COLOR_NAMES = ['red', 'teal', 'orange'] as const
const STATUS_SHADE: Record<Scheme, number> = { light: 9, dark: 5 }
const WCAG_UI_MIN = 3.0
const SURFACES = ['canvas', 'pane', 'rail', 'elevated'] as const

function hexToOklchString(hex: string): string {
  const toLinear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const r = toLinear(Number.parseInt(hex.slice(1, 3), 16))
  const g = toLinear(Number.parseInt(hex.slice(3, 5), 16))
  const b = toLinear(Number.parseInt(hex.slice(5, 7), 16))
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const labB = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const chroma = Math.sqrt(a * a + labB * labB)
  let hue = (Math.atan2(labB, a) * 180) / Math.PI
  if (hue < 0) hue += 360
  return `oklch(${Math.max(0, L).toFixed(6)} ${chroma.toFixed(6)} ${hue.toFixed(6)})`
}

describe('hex -> oklch conversion sanity', () => {
  it('maps white and black to the WCAG maximum contrast ratio', () => {
    const white = parseOklch(hexToOklchString('#ffffff'))
    const black = parseOklch(hexToOklchString('#000000'))
    if (!white || !black) throw new Error('conversion failed')
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1)
  })
})

describe('Decision 1: status colour readability', () => {
  for (const id of themeIds) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${id}/${scheme}: red/teal/orange pass WCAG UI contrast on all surfaces`, () => {
        const map = buildThemeCssVariables(themes[id], ADJUSTMENTS)[scheme]
        for (const name of STATUS_COLOR_NAMES) {
          const hex = DEFAULT_THEME.colors[name][STATUS_SHADE[scheme]]
          const foreground = parseOklch(hexToOklchString(hex))
          if (!foreground) throw new Error(`could not parse ${hex}`)
          for (const surface of SURFACES) {
            const token = map[`--rtwiki-${surface}`]
            const background = parseOklch(token)
            if (!background) throw new Error(`could not parse ${surface}: ${token}`)
            const ratio = contrastRatio(foreground, background)
            expect(
              ratio,
              `${name} ${hex} on ${surface} = ${ratio.toFixed(2)}:1 (needs ${WCAG_UI_MIN}:1)`
            ).toBeGreaterThanOrEqual(WCAG_UI_MIN)
          }
        }
      })
    }
  }
})
