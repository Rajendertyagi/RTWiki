import { describe, expect, it } from 'bun:test'
import {
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
  GLASS_OPACITY_DEFAULT,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN
} from '@rtwiki/shared/constants'
import { adjustLightness, applyContrast, applyGlass } from '../src/web/theme/adjustments.js'
import { contrastRatio, parseOklch } from '../src/web/theme/contrast.js'
import {
  contrastRequirementFor,
  contrastRoleFor,
  READABILITY_FLOOR,
  rationaleFor
} from '../src/web/theme/contrast-rules.js'
import { buildThemeCssVariables } from '../src/web/theme/css-variables.js'
import { VARIANT_TOKEN_NAMES } from '../src/web/theme/tokens.js'
import { loadThemesFromDisk } from './helpers/theme-files.js'

/**
 * Phase 3 theme-coverage gates (A1–A7). Fast, pure-logic only: no browser, no
 * server, no DOM. The browser UI persistence race (rapid slider changes) is
 * DEFERRED to the consolidated browser phase — A6 covers only the pure-function
 * portion (determinism and last-write-wins at the function boundary).
 *
 * Measured WCAG ratios (contrastRatio, foreground token over surface token),
 * captured from the four on-disk themes. Recorded here so the owner can see the
 * actual numbers behind every gate:
 *
 *   theme/scheme       c   text/canvas text/pane textMuted/canvas textMuted/pane border/canvas border/pane
 *   catppuccin/light   50      5.78       5.11         3.86            3.41          1.54         1.36
 *   catppuccin/light  100      7.98       7.06         4.94            4.37          1.82         1.61
 *   catppuccin/light  150     10.93       9.67         6.38            5.64          2.16         1.91
 *   catppuccin/dark    50      8.86       9.54         5.91            6.36          1.10         1.18
 *   catppuccin/dark   100     11.34      12.21         7.37            7.93          1.30         1.40
 *   catppuccin/dark   150     14.29      15.39         9.08            9.78          1.59         1.71
 *   default/light      50      7.28       6.38         3.79            3.32          1.31         1.15
 *   default/light     100     10.00       8.78         4.85            4.25          1.53         1.34
 *   default/light     150     13.39      11.75         6.26            5.49          1.80         1.58
 *   default/dark       50      7.40       8.50         5.43            6.24          1.33         1.53
 *   default/dark      100      9.53      10.95         6.77            7.78          1.64         1.88
 *   default/dark      150     12.08      13.88         8.34            9.59          2.03         2.33
 *   pastel-dreams/lt   50      7.51       6.84         3.78            3.44          1.15         1.05
 *   pastel-dreams/lt  100     10.31       9.40         4.83            4.41          1.34         1.22
 *   pastel-dreams/lt  150     13.74      12.52         6.24            5.69          1.57         1.43
 *   pastel-dreams/dk   50      7.62       9.43         3.73            4.62          1.20         1.03
 *   pastel-dreams/dk  100      9.65      11.94         4.68            5.80          1.00         1.24
 *   pastel-dreams/dk  150     11.86      14.68         5.81            7.19          1.22         1.51
 *   vercel/light       50     20.82      19.09         6.00            5.50          1.09         1.00
 *   vercel/light      100     21.00      19.25         7.77            7.12          1.27         1.16
 *   vercel/light      150     21.00      19.25        10.01            9.18          1.48         1.36
 *   vercel/dark        50     15.07      15.95         6.04            6.40          1.06         1.12
 *   vercel/dark       100     18.81      19.91         7.58            8.02          1.21         1.28
 *   vercel/dark       150     18.81      19.91         9.40            9.95          1.43         1.51
 *
 * RESOLVED FINDING: the `border` token is a deliberately subtle divider. Even
 * at contrast 150 its ratio against canvas/pane is 1.00–2.33:1, below the 3:1
 * UI floor. The owner decision is a CENTRALIZED, DOCUMENTED waiver in
 * `src/web/theme/contrast-rules.ts` (role `decorative`), not a theme JSON edit
 * and not a silent weakening. Text and textMuted pass at 150 (min 5.49:1).
 */

type Scheme = 'light' | 'dark'

const themes = loadThemesFromDisk()
const themeIds = Object.keys(themes).sort()
const SCHEMES: readonly Scheme[] = ['light', 'dark']
const SURFACES = ['canvas', 'pane'] as const
const TEXT_TOKENS = ['text', 'textMuted'] as const
const ADJUSTED_TOKENS = ['text', 'textMuted', 'border'] as const

/** Thresholds come from the rule book only — never duplicated in this gate. */
const TEXT_REQUIREMENT = contrastRequirementFor('text')
if (TEXT_REQUIREMENT === null) throw new Error('rule book must classify text tokens')

/**
 * Colour-valued keys emitted by buildThemeCssVariables. Most interaction tokens
 * are CSS expressions (shadows/hairlines), but the editor semantic and template
 * family tokens are oklch colours and belong here too.
 */
const COLOUR_KEYS = [
  '--rtwiki-spellcheck-underline',
  '--rtwiki-tpl-flow',
  '--rtwiki-tpl-structures',
  '--rtwiki-tpl-timing',
  '--rtwiki-tpl-thinking',
  '--rtwiki-tpl-analysis',
  '--rtwiki-tpl-data',
  '--rtwiki-canvas',
  '--rtwiki-pane',
  '--rtwiki-rail',
  '--rtwiki-elevated',
  '--rtwiki-border',
  '--rtwiki-text',
  '--rtwiki-text-muted',
  '--rtwiki-hover',
  '--rtwiki-selected',
  '--rtwiki-floating-bg',
  '--mantine-color-text',
  '--mantine-color-body',
  '--mantine-color-default-border',
  '--mantine-color-dimmed',
  '--mantine-color-placeholder',
  '--mantine-color-default-hover',
  '--mantine-color-default-color',
  '--mantine-color-bright',
  '--mantine-color-disabled-color'
] as const

function parse(value: string) {
  const result = parseOklch(value)
  if (!result) throw new Error(`expected an oklch colour, got: ${value}`)
  return result
}

function assertClean(value: string, label: string): void {
  expect(value, `${label} has no NaN/undefined/Infinity`).not.toMatch(/NaN|undefined|Infinity/)
}

/** Reference clamp using the centralized constants, independent of the module under test. */
function referenceClamp(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(lo, Math.min(hi, value))
    : fallback
}

function expectedContrast(input: unknown): number {
  return referenceClamp(input, CONTRAST_MIN, CONTRAST_MAX, CONTRAST_DEFAULT)
}

function expectedGlass(input: unknown): number {
  return referenceClamp(input, GLASS_OPACITY_MIN, GLASS_OPACITY_MAX, GLASS_OPACITY_DEFAULT)
}

function ratioOf(foreground: string, background: string): number {
  return contrastRatio(parse(foreground), parse(background))
}

describe('A1: contrast extremes', () => {
  it('covers all four themes', () => {
    expect(themeIds.length).toBeGreaterThanOrEqual(4)
  })

  for (const id of themeIds) {
    for (const scheme of SCHEMES) {
      const baseline = themes[id].variants[scheme]

      it(`${id}/${scheme}: contrast 100 returns the identical baseline object`, () => {
        expect(applyContrast(baseline, scheme, CONTRAST_DEFAULT)).toBe(baseline)
      })

      it(`${id}/${scheme}: contrast 150 keeps text/textMuted >= ${TEXT_REQUIREMENT.min}:1 on canvas/pane`, () => {
        const adjusted = applyContrast(baseline, scheme, CONTRAST_MAX)
        for (const token of TEXT_TOKENS) {
          for (const surface of SURFACES) {
            const ratio = ratioOf(adjusted[token], adjusted[surface])
            expect(
              ratio,
              `${token}/${surface} = ${ratio.toFixed(2)}:1 (needs ${TEXT_REQUIREMENT.min}:1 — ${TEXT_REQUIREMENT.rationale})`
            ).toBeGreaterThanOrEqual(TEXT_REQUIREMENT.min)
          }
        }
      })

      // The border gate now reads the rule book. `contrastRequirementFor` returns
      // null for the documented `decorative` waiver, so no 3:1 assertion is made;
      // instead the waiver itself is asserted, keeping the decision reviewable.
      const adjusted150 = applyContrast(baseline, scheme, CONTRAST_MAX)
      const borderRatios = SURFACES.map(
        (surface) => `${surface}=${ratioOf(adjusted150.border, adjusted150[surface]).toFixed(2)}`
      ).join(', ')

      it(`${id}/${scheme}: contrast 150 border (${borderRatios}) is a documented decorative waiver`, () => {
        expect(contrastRoleFor('border'), 'border role').toBe('decorative')
        expect(
          contrastRequirementFor('border'),
          'decorative tokens have no numeric floor'
        ).toBeNull()
        expect(rationaleFor('border'), 'waiver rationale is documented').toContain(
          'Subtle divider by design'
        )
      })

      it(`${id}/${scheme}: contrast 50 keeps text readability floor >= ${READABILITY_FLOOR}:1 on canvas/pane`, () => {
        const adjusted = applyContrast(baseline, scheme, CONTRAST_MIN)
        for (const token of TEXT_TOKENS) {
          for (const surface of SURFACES) {
            const ratio = ratioOf(adjusted[token], adjusted[surface])
            expect(
              ratio,
              `${token}/${surface} = ${ratio.toFixed(2)}:1 (needs ${READABILITY_FLOOR}:1 — reduced-contrast slider floor)`
            ).toBeGreaterThanOrEqual(READABILITY_FLOOR)
          }
        }
      })
    }
  }
})

describe('A2: glass alpha', () => {
  it('glass 100 returns the input unchanged', () => {
    for (const value of ['oklch(0.95 0.01 255)', 'oklch(0.32 0.006 255 / 0.8)']) {
      expect(applyGlass(value, GLASS_OPACITY_DEFAULT)).toBe(value)
    }
  })

  it('glass 30 yields alpha 0.3 for a light and a dark floating surface', () => {
    const light = 'oklch(1 0 0)'
    const dark = 'oklch(0.32 0.006 255)'
    for (const value of [light, dark]) {
      const output = applyGlass(value, GLASS_OPACITY_MIN)
      assertClean(output, `glass 30 of ${value}`)
      expect(parse(output).alpha).toBeCloseTo(0.3, 4)
    }
  })
})

describe('A3: reset returns exact baseline values', () => {
  it('contrast 100 and glass 100 are identity operations', () => {
    for (const id of themeIds) {
      for (const scheme of SCHEMES) {
        const baseline = themes[id].variants[scheme]
        expect(applyContrast(baseline, scheme, CONTRAST_DEFAULT)).toBe(baseline)
        expect(applyGlass(baseline.elevated, GLASS_OPACITY_DEFAULT)).toBe(baseline.elevated)
      }
    }
  })
})

describe('A4: invalid inputs are clamped, never NaN/undefined/Infinity', () => {
  const INVALID_INPUTS: ReadonlyArray<{ label: string; value: unknown }> = [
    { label: 'NaN', value: Number.NaN },
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: '-1', value: -1 },
    { label: '999', value: 999 },
    { label: '1.5 (non-integer)', value: 1.5 },
    { label: 'corrupt string "150"', value: '150' }
  ]

  for (const { label, value } of INVALID_INPUTS) {
    it(`contrast input ${label} clamps to ${expectedContrast(value)}`, () => {
      for (const id of themeIds) {
        for (const scheme of SCHEMES) {
          const baseline = themes[id].variants[scheme]
          const actual = applyContrast(baseline, scheme, value as number)
          const expected = applyContrast(baseline, scheme, expectedContrast(value))
          expect(actual).toEqual(expected)
          if (expectedContrast(value) === CONTRAST_DEFAULT) {
            expect(actual).toBe(baseline)
          }
          for (const token of ADJUSTED_TOKENS) {
            assertClean(actual[token], `${id}/${scheme}/${token}`)
            expect(parseOklch(actual[token]), `${token} parses as oklch`).not.toBeNull()
          }
        }
      }
    })

    it(`glass input ${label} clamps to ${expectedGlass(value)}`, () => {
      const floating = 'oklch(0.9 0.02 255)'
      const actual = applyGlass(floating, value as number)
      const expected = applyGlass(floating, expectedGlass(value))
      expect(actual).toBe(expected)
      assertClean(actual, 'glass output')
      expect(parseOklch(actual), 'output parses as oklch').not.toBeNull()
      if (expectedGlass(value) === GLASS_OPACITY_DEFAULT) {
        expect(actual).toBe(floating)
      }
    })
  }
})

describe('A5: cross-product states emit valid colours and keep the text floor', () => {
  const STATES = [
    { contrast: CONTRAST_MIN, glass: GLASS_OPACITY_MIN },
    { contrast: CONTRAST_MIN, glass: GLASS_OPACITY_DEFAULT },
    { contrast: CONTRAST_DEFAULT, glass: GLASS_OPACITY_MIN },
    { contrast: CONTRAST_DEFAULT, glass: GLASS_OPACITY_DEFAULT },
    { contrast: CONTRAST_MAX, glass: GLASS_OPACITY_MIN },
    { contrast: CONTRAST_MAX, glass: GLASS_OPACITY_DEFAULT }
  ] as const

  for (const id of themeIds) {
    for (const scheme of SCHEMES) {
      for (const state of STATES) {
        const label = `${id}/${scheme} contrast=${state.contrast} glass=${state.glass}`
        it(`${label}: every colour variable is valid oklch with no NaN`, () => {
          const map = buildThemeCssVariables(themes[id], {
            contrast: state.contrast,
            glassOpacity: state.glass
          })[scheme]

          for (const [key, value] of Object.entries(map)) {
            if (!key.startsWith('--rtwiki-') && !key.startsWith('--mantine-color-')) continue
            assertClean(value, `${label} ${key}`)
            if (key === '--mantine-color-anchor') {
              expect(value, `${key} is a var() reference`).toMatch(/^var\(--.+\)$/)
            } else if ((COLOUR_KEYS as readonly string[]).includes(key)) {
              expect(parseOklch(value), `${key} parses as oklch`).not.toBeNull()
            }
          }
        })

        it(`${label}: text/textMuted stay >= ${READABILITY_FLOOR}:1 on canvas/pane`, () => {
          const map = buildThemeCssVariables(themes[id], {
            contrast: state.contrast,
            glassOpacity: state.glass
          })[scheme]
          for (const token of TEXT_TOKENS) {
            for (const surface of SURFACES) {
              const foreground = map[`--rtwiki-${VARIANT_TOKEN_NAMES[token]}`]
              const background = map[`--rtwiki-${VARIANT_TOKEN_NAMES[surface]}`]
              const ratio = ratioOf(foreground, background)
              expect(
                ratio,
                `${token}/${surface} = ${ratio.toFixed(2)}:1 (needs ${READABILITY_FLOOR}:1)`
              ).toBeGreaterThanOrEqual(READABILITY_FLOOR)
            }
          }
        })
      }
    }
  }
})

describe('A6: rapid-change pure logic is deterministic and last-write-wins', () => {
  // Browser UI persistence race is DEFERRED to the consolidated browser phase.
  // Here we only prove the pure functions carry no stale state between calls.
  it('repeated calls are deterministic and the last call wins', () => {
    for (const id of themeIds) {
      for (const scheme of SCHEMES) {
        const baseline = themes[id].variants[scheme]
        const low = applyContrast(baseline, scheme, CONTRAST_MIN)
        const high = applyContrast(baseline, scheme, CONTRAST_MAX)

        expect(applyContrast(baseline, scheme, CONTRAST_MAX)).toEqual(high)

        let state = low
        state = applyContrast(baseline, scheme, CONTRAST_MAX)
        expect(state).toEqual(high)
        expect(state).not.toEqual(low)

        const glassLow = applyGlass(baseline.elevated, GLASS_OPACITY_MIN)
        const glassHigh = applyGlass(baseline.elevated, GLASS_OPACITY_DEFAULT)
        expect(applyGlass(baseline.elevated, GLASS_OPACITY_DEFAULT)).toBe(glassHigh)

        let glassState = glassLow
        glassState = applyGlass(baseline.elevated, GLASS_OPACITY_DEFAULT)
        expect(glassState).toBe(glassHigh)
      }
    }
  })
})

describe('A7: saturation policy — clamp L and preserve ordering/readability', () => {
  // Policy: clamp the lightness channel to [0,1] at extreme deltas, and keep the
  // authored token ordering (text darker than textMuted in the light scheme) so
  // readability never inverts when the slider moves.
  it('clamps L to [0,1] at extreme deltas and stays valid oklch', () => {
    const high = adjustLightness('oklch(0.95 0.02 255)', 100)
    const low = adjustLightness('oklch(0.05 0.02 255)', -100)
    expect(high).toBe('oklch(1 0.02 255)')
    expect(low).toBe('oklch(0 0.02 255)')
    for (const output of [high, low]) {
      assertClean(output, 'extreme lightness output')
      expect(parseOklch(output)).not.toBeNull()
    }
  })

  it('keeps text darker than textMuted in the light scheme at every contrast', () => {
    for (const id of themeIds) {
      for (const contrast of [CONTRAST_MIN, CONTRAST_DEFAULT, CONTRAST_MAX]) {
        const adjusted = applyContrast(themes[id].variants.light, 'light', contrast)
        expect(parse(adjusted.text).l, `${id} @${contrast}: text L < textMuted L`).toBeLessThan(
          parse(adjusted.textMuted).l
        )
      }
    }
  })
})
