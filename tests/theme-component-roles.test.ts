import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_THEME,
  defaultVariantColorsResolver,
  type MantineTheme,
  type VariantColorsResolver
} from '@mantine/core'

import {
  COMPONENT_ROLES,
  CONTROL_TEXT_VAR,
  createVariantColorResolver,
  cssVarForRole,
  deriveControlTextColor,
  FIXED_STATUS_COLORS,
  INTERACTION_ROLES,
  isRtwikiAccent,
  MANTINE_LIGHT_COLOR_SHADE,
  measureControlTextContrast,
  VARIANT_ROLES
} from '../src/web/theme/component-roles.js'
import { contrastRatio, parseOklch } from '../src/web/theme/contrast.js'
import { TEXT_CONTRAST_MIN } from '../src/web/theme/contrast-rules.js'
import { buildThemeCssVariables, type CssVariableFallback } from '../src/web/theme/css-variables.js'
import type { AppTheme } from '../src/web/theme/tokens.js'
import { loadThemesFromDisk } from './helpers/theme-files.js'

/**
 * Phase 1 architectural gate for universal theming.
 *
 * These tests are pure: they read source text and call the theme factory's
 * resolver directly. No browser, server or network is involved. They assert the
 * CENTRAL mapping, not per-screen patches — a new Mantine component used in
 * `src/web` without a role entry fails the coverage gate below.
 */

const REPO_ROOT = join(import.meta.dir, '..')
const WEB_ROOT = join(REPO_ROOT, 'src', 'web')
const themes = loadThemesFromDisk()
const themeIds = Object.keys(themes).sort()
const ADJUSTMENTS = { contrast: 100, glassOpacity: 100 }
const SURFACES = ['canvas', 'pane', 'elevated'] as const
const COLOR_FIELDS = ['text', 'background', 'border', 'hover'] as const

/** The authoritative family -> variants table used by the coverage gates. */
const AUTHORITATIVE_COMPONENT_ROLES = COMPONENT_ROLES

type Scheme = 'light' | 'dark'

function resolverOf(theme: AppTheme): VariantColorsResolver {
  const resolver = theme.mantine.variantColorResolver
  if (typeof resolver !== 'function')
    throw new Error(`${theme.id}: no variantColorResolver installed`)
  return resolver
}

/**
 * MantineProvider merges the theme override with DEFAULT_THEME before calling
 * the resolver. Reproduce that merge here so tests exercise the same full theme
 * (with `white`/`black` present) the browser sees.
 */
function fullThemeOf(theme: AppTheme): MantineTheme {
  return { ...DEFAULT_THEME, ...theme.mantine } as MantineTheme
}

function collectSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) collectSource(full, out)
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Blank comments so prose mentioning a component is not mistaken for usage. */
function stripComments(source: string): string {
  const chars = source.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (chars[i] !== '\n') chars[i] = ' '
  }
  let i = 0
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '*') {
      const start = i
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      blank(start, Math.min(source.length, i + 2))
      i += 2
      continue
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      const start = i
      while (i < source.length && source[i] !== '\n') i++
      blank(start, i)
      continue
    }
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i]
      i++
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    i++
  }
  return chars.join('')
}

/** Mantine type names that are not components, even if imported without `type`. */
const NON_COMPONENT_TYPES = new Set([
  'MantineColor',
  'MantineTheme',
  'MantineThemeOverride',
  'MantineSize',
  'MantineRadius',
  'MantineSpacing',
  'MantineGradient',
  'MantineColorScheme',
  'MantineColorShade',
  'MantineColorsTuple',
  'MantinePrimaryShade',
  'MantineColorSchemeManager',
  'VariantColorsResolver',
  'VariantColorResolverResult',
  'VariantColorsResolverInput',
  'CSSVariablesResolver'
])

/**
 * Mantine components actually used in src/web. Scans both `.ts` and `.tsx` and
 * detects JSX, `createElement(Name` and direct identifier references (which
 * covers `Name.extend(` in theme-factory.ts). Type-only imports, lowercase
 * hooks and known type names are filtered out.
 */
function usedMantineComponents(): Set<string> {
  const used = new Set<string>()
  const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"]@mantine\/core['"]/g
  for (const file of collectSource(WEB_ROOT)) {
    // The mapping table names every family by design; counting it would make
    // the coverage gate self-fulfilling.
    if (file.endsWith(join('theme', 'component-roles.ts'))) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    // Remove the import declarations themselves, otherwise a bare identifier
    // match would count an unused import as usage.
    const usageSource = source.replace(importPattern, ' ')
    for (const match of source.matchAll(importPattern)) {
      for (const raw of (match[1] ?? '').split(',')) {
        const specifier = raw.trim()
        if (/^type\s+/.test(specifier)) continue
        const name =
          specifier
            .split(/\s+as\s+/)
            .pop()
            ?.trim() ?? ''
        if (!/^[A-Z]/.test(name) || NON_COMPONENT_TYPES.has(name)) continue
        const isComponentUse =
          new RegExp(`<${name}(?:[\\s/>]|\\.)`).test(usageSource) ||
          new RegExp(`createElement\\(\\s*${name}\\b`).test(usageSource) ||
          new RegExp(`\\b${name}\\b`).test(usageSource)
        if (isComponentUse) used.add(name)
      }
    }
  }
  return used
}

// ---------------------------------------------------------------------------
// 1. Coverage — every used family/variant has a defined role
// ---------------------------------------------------------------------------

describe('component roles: coverage', () => {
  it('maps every Mantine component rendered in src/web', () => {
    const used = usedMantineComponents()
    expect(used.size, 'source scan found components').toBeGreaterThan(20)
    const unmapped = [...used]
      .filter((name) => !Object.hasOwn(AUTHORITATIVE_COMPONENT_ROLES, name))
      .sort()
    expect(unmapped, `unmapped Mantine components: ${unmapped.join(', ')}`).toEqual([])
  })

  it('defines a complete role for every variant and interaction state', () => {
    const roles = [...Object.values(VARIANT_ROLES), ...Object.values(INTERACTION_ROLES)]
    for (const role of roles) {
      for (const field of COLOR_FIELDS) {
        const assignment = role[field]
        expect(typeof assignment.role, `${field}.role is a string`).toBe('string')
        expect(assignment.role.length, `${field}.role is non-empty`).toBeGreaterThan(0)
        expect(['rtwiki', 'mantine-default', 'fixed-status', 'neutral-default']).toContain(
          assignment.source
        )
        expect(typeof assignment.overridden, `${field}.overridden is a boolean`).toBe('boolean')
      }
    }
  })

  it('every family variant resolves to a defined variant role', () => {
    for (const [family, variants] of Object.entries(AUTHORITATIVE_COMPONENT_ROLES)) {
      for (const variant of variants) {
        expect(Object.hasOwn(VARIANT_ROLES, variant), `${family}/${variant}`).toBe(true)
      }
    }
  })

  it('covers the variant families called out by the task', () => {
    const expected: Record<string, readonly string[]> = {
      Button: ['filled', 'light', 'subtle', 'outline', 'default'],
      ActionIcon: ['filled', 'light', 'subtle', 'outline', 'default'],
      Badge: ['light', 'subtle', 'filled', 'outline'],
      Alert: ['light', 'filled', 'outline'],
      NavLink: ['light', 'subtle', 'filled'],
      MenuItem: ['subtle'],
      Table: [],
      Paper: [],
      Card: [],
      Tooltip: ['filled'],
      Popover: [],
      Modal: [],
      Drawer: [],
      Tabs: []
    }
    for (const [family, variants] of Object.entries(expected)) {
      const actual: string[] = [
        ...AUTHORITATIVE_COMPONENT_ROLES[family as keyof typeof AUTHORITATIVE_COMPONENT_ROLES]
      ].sort()
      const wanted: string[] = [...variants].sort()
      expect(actual).toEqual(wanted)
    }
  })

  it.each(themeIds)('%s: installs the central resolver on its Mantine theme', (id) => {
    const resolver = resolverOf(themes[id])
    expect(resolver).not.toBe(DEFAULT_THEME.variantColorResolver)
    const theme = fullThemeOf(themes[id])
    const result = resolver({ color: theme.primaryColor, theme, variant: 'subtle' })
    expect(result.color).toBe(CONTROL_TEXT_VAR)
  })
})

// ---------------------------------------------------------------------------
// 2. No flattening — default / disabled / filled stay distinct
// ---------------------------------------------------------------------------

describe('component roles: meaningful differences are preserved', () => {
  it('does not flatten default or disabled into primary', () => {
    for (const name of ['default', 'disabled'] as const) {
      const role = INTERACTION_ROLES[name]
      for (const field of COLOR_FIELDS) {
        const assignment = role[field]
        expect(assignment.source, `${name}/${field} source`).toBe('neutral-default')
        expect(assignment.overridden, `${name}/${field} not overridden`).toBe(false)
        expect(assignment.role, `${name}/${field} role`).not.toBe('accent')
        expect(assignment.role, `${name}/${field} role`).not.toBe('accent-contrast')
      }
    }
    expect(INTERACTION_ROLES.default.background.role).toBe('neutral-default')
    expect(INTERACTION_ROLES.disabled.text.role).toBe('muted')
    for (const field of COLOR_FIELDS) {
      expect(VARIANT_ROLES.default[field].source, `default/${field} source`).toBe('neutral-default')
      expect(VARIANT_ROLES.default[field].overridden, `default/${field} overridden`).toBe(false)
    }
  })

  it('keeps filled, light and subtle visually distinct', () => {
    expect(VARIANT_ROLES.filled.background.role).toBe('accent')
    expect(VARIANT_ROLES.filled.text.role).toBe('accent-contrast')
    expect(VARIANT_ROLES.light.background.role).toBe('accent')
    expect(VARIANT_ROLES.subtle.background.role).toBe('none')
    expect(VARIANT_ROLES.light.background.role).not.toBe(VARIANT_ROLES.subtle.background.role)
    expect(VARIANT_ROLES.outline.border.role).toBe('foreground')
  })

  it('every field marked overridden is actually emitted by the resolver', () => {
    const resolver = createVariantColorResolver()
    for (const theme of Object.values(themes)) {
      const mantine = fullThemeOf(theme)
      for (const [variant, role] of Object.entries(VARIANT_ROLES)) {
        const input = { color: mantine.primaryColor, theme: mantine, variant }
        const result = resolver(input)
        const baseline = defaultVariantColorsResolver(input)
        for (const field of COLOR_FIELDS) {
          const assignment = role[field]
          const key = field === 'text' ? 'color' : field
          if (assignment.overridden) {
            const expected =
              field === 'border'
                ? `1px solid ${cssVarForRole(assignment.role)}`
                : cssVarForRole(assignment.role)
            expect(result[key], `${theme.id}/${variant}/${field} emitted`).toBe(expected)
          } else {
            expect(result[key], `${theme.id}/${variant}/${field} left to Mantine`).toBe(
              baseline[key]
            )
          }
        }
      }
    }
  })

  it('leaves the default variant byte-for-byte to Mantine', () => {
    const resolver = createVariantColorResolver()
    for (const theme of Object.values(themes)) {
      const mantine = fullThemeOf(theme)
      for (const variant of ['default', 'filled', 'white', 'gradient', 'none']) {
        const input = { color: mantine.primaryColor, theme: mantine, variant }
        expect(resolver(input), `${theme.id}/${variant}`).toEqual(
          defaultVariantColorsResolver(input)
        )
      }
    }
  })

  it('does not override a non-accent colour even for a mapped variant', () => {
    const resolver = createVariantColorResolver()
    const theme = fullThemeOf(themes.vercel)
    for (const variant of ['subtle', 'light', 'outline', 'transparent']) {
      const input = { color: 'red', theme, variant }
      expect(resolver(input), `red/${variant}`).toEqual(defaultVariantColorsResolver(input))
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Status colours stay fixed (owner decision 1)
// ---------------------------------------------------------------------------

describe('component roles: status colours stay fixed', () => {
  it('no fixed status colour is a theme accent', () => {
    for (const theme of Object.values(themes)) {
      expect(FIXED_STATUS_COLORS, `${theme.id} primary`).not.toContain(theme.mantine.primaryColor)
    }
  })

  it.each(FIXED_STATUS_COLORS)('%s resolves identically to Mantine in every theme', (color) => {
    const resolver = createVariantColorResolver()
    for (const theme of Object.values(themes)) {
      const mantine = fullThemeOf(theme)
      for (const variant of ['light', 'filled', 'outline', 'subtle']) {
        const input = { color, theme: mantine, variant }
        expect(resolver(input), `${theme.id}/${color}/${variant}`).toEqual(
          defaultVariantColorsResolver(input)
        )
      }
    }
  })

  it('only the accent (including shade-qualified) is recognised as RTWiki-owned', () => {
    const theme = fullThemeOf(themes.vercel)
    expect(isRtwikiAccent('vercel', theme)).toBe(true)
    expect(isRtwikiAccent('vercel.5', theme)).toBe(true)
    expect(isRtwikiAccent('red', theme)).toBe(false)
    expect(isRtwikiAccent(undefined, theme)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. The three risky keys stay un-overridden with fallback logs (decision 3)
// ---------------------------------------------------------------------------

const RISKY_KEYS = [
  '--mantine-color-default',
  '--mantine-color-disabled',
  '--mantine-color-disabled-border'
] as const

describe('component roles: risky surface keys are preserved', () => {
  it.each(themeIds)('%s: risky keys absent from both schemes and logged', (id) => {
    const fallbacks: CssVariableFallback[] = []
    const css = buildThemeCssVariables(themes[id], ADJUSTMENTS, (fallback) => {
      fallbacks.push(fallback)
    })
    for (const scheme of ['light', 'dark'] as const) {
      for (const key of RISKY_KEYS) {
        expect(css[scheme][key], `${scheme}/${key}`).toBeUndefined()
      }
    }
    expect(fallbacks).toHaveLength(RISKY_KEYS.length * 2)
    for (const fallback of fallbacks) {
      expect(RISKY_KEYS).toContain(fallback.variable as (typeof RISKY_KEYS)[number])
      expect(fallback.reason).toContain('owner decision 3')
    }
  })

  it('the default variant still references Mantine default surface variables', () => {
    const resolver = createVariantColorResolver()
    const theme = fullThemeOf(themes.vercel)
    const result = resolver({ color: theme.primaryColor, theme, variant: 'default' })
    expect(result.background).toBe('var(--mantine-color-default)')
    expect(result.color).toBe('var(--mantine-color-default-color)')
    expect(result.border).toContain('var(--mantine-color-default-border)')
  })
})

// ---------------------------------------------------------------------------
// 5. Contrast — subtle/light text reaches the central 4.5:1 floor everywhere
// ---------------------------------------------------------------------------

describe('component roles: contrast floor', () => {
  it.each(themeIds)(
    '%s: derived control text meets 4.5:1 on every surface in both schemes',
    (id) => {
      for (const scheme of ['light', 'dark'] as const) {
        const variant = themes[id].variants[scheme]
        for (const surface of SURFACES) {
          const ratio = measureControlTextContrast(variant, surface)
          expect(
            ratio,
            `${id}/${scheme}/${surface} = ${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN)
        }
      }
    }
  )

  it('the resolver emits the RTWiki text variable for subtle and light in every theme', () => {
    const resolver = createVariantColorResolver()
    for (const theme of Object.values(themes)) {
      const mantine = fullThemeOf(theme)
      for (const variant of ['subtle', 'light', 'outline', 'transparent']) {
        const result = resolver({ color: mantine.primaryColor, theme: mantine, variant })
        expect(result.color, `${theme.id}/${variant}`).toBe(CONTROL_TEXT_VAR)
      }
    }
  })

  it('fixes the measured vercel-dark subtle-button defect centrally', () => {
    const scheme: Scheme = 'dark'
    const variant = themes.vercel.variants[scheme]
    const mantine = fullThemeOf(themes.vercel)
    const shade = MANTINE_LIGHT_COLOR_SHADE[scheme]
    const palette = mantine.colors[mantine.primaryColor] as readonly string[]

    // Before: Mantine's -light-color alias points at the accent's shade 0.
    const before = parseOklch(palette[shade] ?? '')
    const surface = parseOklch(variant.elevated)
    if (before === null || surface === null) throw new Error('vercel tokens must be oklch()')
    const beforeRatio = contrastRatio(before, surface)
    expect(beforeRatio, `before = ${beforeRatio.toFixed(2)}:1`).toBeLessThan(TEXT_CONTRAST_MIN)

    // After: the resolver emits --rtwiki-text, which is the variant's text token.
    const resolver = resolverOf(themes.vercel)
    const result = resolver({ color: mantine.primaryColor, theme: mantine, variant: 'subtle' })
    expect(result.color).toBe(CONTROL_TEXT_VAR)
    const after = parseOklch(deriveControlTextColor(variant))
    if (after === null) throw new Error('vercel text token must be oklch()')
    const afterRatio = contrastRatio(after, surface)
    expect(afterRatio, `after = ${afterRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      TEXT_CONTRAST_MIN
    )
    expect(afterRatio).toBeGreaterThan(beforeRatio)
  })
})
