import { z } from 'zod'

/**
 * Loader for DTCG-shaped theme JSON files.
 *
 * The token payload follows the Design Tokens Community Group 2025.10 Format
 * and Color modules: a token is an object with `$value` and `$type`, colours
 * are structured `{ colorSpace, components, alpha?, hex? }` values, and
 * aliases are `{path.to.token}` strings. CSS expressions that DTCG cannot
 * represent (color-mix, multi-layer shadows) use `$type: "css"` with a plain
 * string `$value` and are preserved verbatim.
 *
 * This module is deliberately free of Mantine and registry imports so it can
 * be used by the registry without creating a cycle. It returns plain data;
 * the registry owns `createTheme` and the component defaults.
 */

const colorValueSchema = z.object({
  colorSpace: z.enum(['oklch', 'srgb']),
  components: z.array(z.number()),
  alpha: z.number().min(0).max(1).optional(),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
})

const tokenSchema = z.object({
  $type: z.enum(['color', 'css']),
  $value: z.union([colorValueSchema, z.string()])
})

const tokenGroupSchema = z.record(z.string(), tokenSchema)

export const themeDefinitionSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.literal(1),
  tokens: z.object({
    primitives: z.object({
      color: z.object({
        neutral: z.object({ light: tokenGroupSchema, dark: tokenGroupSchema }),
        accent: z.record(z.string(), tokenGroupSchema)
      })
    }),
    semantic: z.object({ light: tokenGroupSchema, dark: tokenGroupSchema })
  }),
  mantine: z.object({
    primaryColor: z.string().min(1),
    primaryShade: z.object({
      light: z.number().int().min(0).max(9),
      dark: z.number().int().min(0).max(9)
    }),
    colors: z.record(z.string(), z.string())
  })
})

export type ThemeDefinition = z.infer<typeof themeDefinitionSchema>
type Token = z.infer<typeof tokenSchema>
type ColorValue = z.infer<typeof colorValueSchema>

/** Mantine requires at least ten shades; the loader enforces exactly ten. */
type Palette = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  ...string[]
]
type Shade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Only colour data is theme-specific; shape/type/motion live in FIXED_MANTINE_BASE. */
export interface ParsedMantineData {
  primaryColor: string
  primaryShade: { light: Shade; dark: Shade }
  colors: Record<string, Palette>
}

export interface ParsedTheme<TName extends string = string> {
  id: string
  name: string
  variants: {
    light: Record<TName, string>
    dark: Record<TName, string>
  }
  mantine: ParsedMantineData
}

/** Flattens every token in the payload into a path -> token map. */
function collectTokens(node: unknown, path: string[], out: Map<string, Token>): void {
  if (typeof node !== 'object' || node === null) return
  const object = node as Record<string, unknown>
  if ('$value' in object) {
    out.set(path.join('.'), object as Token)
    return
  }
  for (const [key, value] of Object.entries(object)) {
    if (key.startsWith('$')) continue
    collectTokens(value, [...path, key], out)
  }
}

/** Serializes a resolved token value to the exact CSS string the app expects. */
function serialize(value: Token['$value'], tokens: Map<string, Token>, seen: Set<string>): string {
  if (typeof value === 'string') {
    const alias = /^\{([^}]+)\}$/.exec(value)
    if (!alias) return value
    const path = alias[1]
    if (seen.has(path)) throw new Error(`Circular token alias: ${path}`)
    const target = tokens.get(path)
    if (!target) throw new Error(`Unresolved token alias: ${path}`)
    seen.add(path)
    return serialize(target.$value, tokens, seen)
  }
  const color = value as ColorValue
  if (color.colorSpace === 'srgb') {
    if (!color.hex) throw new Error('srgb tokens must declare a hex fallback')
    return color.hex
  }
  const [lightness, chroma, hue] = color.components
  if (lightness === undefined || chroma === undefined || hue === undefined) {
    throw new Error('oklch tokens need [lightness, chroma, hue] components')
  }
  const base = `oklch(${lightness} ${chroma} ${hue})`
  return color.alpha === undefined ? base : `${base.slice(0, -1)} / ${color.alpha})`
}

function resolveGroup(
  group: Record<string, Token>,
  tokens: Map<string, Token>,
  names: readonly string[]
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of names) {
    const token = group[name]
    if (!token) throw new Error(`Missing semantic token: ${name}`)
    result[name] = serialize(token.$value, tokens, new Set())
  }
  return result
}

/** Collects a palette group's numbered children into Mantine's 10-shade array. */
function resolvePalette(path: string, tokens: Map<string, Token>): Palette {
  const prefix = `${path}.`
  const shades: Array<{ index: number; value: string }> = []
  for (const [tokenPath, token] of tokens) {
    if (!tokenPath.startsWith(prefix)) continue
    const key = tokenPath.slice(prefix.length)
    if (!/^\d+$/.test(key)) continue
    shades.push({ index: Number(key), value: serialize(token.$value, tokens, new Set()) })
  }
  shades.sort((a, b) => a.index - b.index)
  if (shades.length !== 10) {
    throw new Error(`Palette ${path} must have exactly 10 shades, found ${shades.length}`)
  }
  return shades.map((shade) => shade.value) as Palette
}

export interface ExpectedTokens<TName extends string = string> {
  variantTokens: readonly TName[]
  interactionTokens: readonly TName[]
}

/**
 * Validates a theme JSON payload and resolves it into plain CSS strings.
 * Throws with a precise message on any malformed token, alias or palette.
 */
export function parseThemeDefinition<TName extends string>(
  input: unknown,
  expected: ExpectedTokens<TName>
): ParsedTheme<TName> {
  const definition = themeDefinitionSchema.parse(input)
  const tokens = new Map<string, Token>()
  collectTokens(definition.tokens, [], tokens)

  const names = [...expected.variantTokens, ...expected.interactionTokens]
  const light = resolveGroup(definition.tokens.semantic.light, tokens, names)
  const dark = resolveGroup(definition.tokens.semantic.dark, tokens, names)

  const colors: Record<string, Palette> = {}
  for (const [name, path] of Object.entries(definition.mantine.colors)) {
    colors[name] = resolvePalette(path, tokens)
  }

  return {
    id: definition.id,
    name: definition.name,
    variants: { light, dark },
    mantine: {
      primaryColor: definition.mantine.primaryColor,
      primaryShade: definition.mantine.primaryShade as { light: Shade; dark: Shade },
      colors
    }
  }
}
