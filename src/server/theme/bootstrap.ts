import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CONTRAST_DEFAULT,
  CONTRAST_MAX,
  CONTRAST_MIN,
  type ColorScheme,
  clampSetting,
  GLASS_OPACITY_DEFAULT,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN
} from '@rtwiki/shared/constants'
import {
  buildThemeCssVariables,
  type CssVariableFallback,
  formatFallbackMessage
} from '../../web/theme/css-variables.js'
import { parseThemeDefinition } from '../../web/theme/theme-definition.js'
import { REQUIRED_INTERACTION_TOKENS, REQUIRED_VARIANT_TOKENS } from '../../web/theme/tokens.js'

/**
 * Builds the pre-paint theme bootstrap injected into the SPA document.
 *
 * Security rules (every value here reaches the HTML before React mounts):
 * - theme ids must match a strict allowlist;
 * - script payloads are JSON-serialized with `<` escaped, so no value can
 *   terminate the script element;
 * - CSS values are emitted only from the shared variable builder and pass a
 *   guard that rejects style-breakout characters;
 * - a theme that fails any check is skipped with a warning and the default is
 *   used instead.
 */

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_THEME_ID = 'default'
const UNSAFE_CSS = /[<>{};`'"\\]/

export interface ThemeBootstrap {
  /** Inline script (nonce applied by the caller) that sets the html attributes. */
  script: string
  /** Inline style with Mantine-compatible selectors for both schemes. */
  style: string
  /** The theme actually used (may be the default after a fallback). */
  themeId: string
  /** The user's raw scheme choice. */
  colorScheme: ColorScheme
  /** Clamped interface adjustment values (100 = no change). */
  contrast: number
  glassOpacity: number
}

function scriptString(value: string): string {
  // JSON.stringify handles quotes/backslashes; escaping `<` prevents a value
  // containing `</script>` from terminating the element.
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function cssBlock(selector: string, variables: Record<string, string>): string | null {
  const declarations: string[] = []
  for (const [name, value] of Object.entries(variables)) {
    if (!/^--[a-z0-9-]+$/.test(name) || UNSAFE_CSS.test(value)) return null
    declarations.push(`${name}:${value}`)
  }
  return `${selector}{${declarations.join(';')}}`
}

function readTheme(themesDir: string, id: string): unknown | null {
  if (!THEME_ID_PATTERN.test(id)) return null
  try {
    const file = join(themesDir, `${id}.json`)
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function buildThemeBootstrap(options: {
  themesDir: string
  themeId: string
  colorScheme: ColorScheme
  contrast: number
  glassOpacity: number
  warn?: (message: string, error?: unknown) => void
  /** Receives the structured surface-mapping fallbacks. Defaults to console.warn. */
  onFallback?: (fallback: CssVariableFallback) => void
}): ThemeBootstrap {
  const warn = options.warn ?? ((message, error) => console.warn(message, error))
  // Fallback notices are informational, not theme-validation warnings: keep
  // them off `warn` so its callers can rely on it reporting validation only.
  const logFallback =
    options.onFallback ??
    ((fallback: CssVariableFallback): void => {
      console.warn(formatFallbackMessage(fallback))
    })
  let themeId = options.themeId
  let json = readTheme(options.themesDir, themeId)
  if (json === null) {
    warn(`[RTWiki] Theme "${themeId}" is missing or invalid; using default`)
    themeId = DEFAULT_THEME_ID
    json = readTheme(options.themesDir, themeId)
  }
  if (json === null) {
    throw new Error('[RTWiki] Default theme is missing or invalid')
  }

  let css: ThemeCssVariablesLike
  try {
    const parsed = parseThemeDefinition(json, {
      variantTokens: REQUIRED_VARIANT_TOKENS,
      interactionTokens: REQUIRED_INTERACTION_TOKENS
    })
    css = buildThemeCssVariables(
      { id: themeId, variants: parsed.variants, mantine: parsed.mantine },
      { contrast: options.contrast, glassOpacity: options.glassOpacity },
      logFallback
    )
  } catch (error) {
    warn(`[RTWiki] Theme "${themeId}" failed validation; using default`, error)
    themeId = DEFAULT_THEME_ID
    const fallback = readTheme(options.themesDir, themeId)
    if (fallback === null) throw new Error('[RTWiki] Default theme is missing or invalid')
    const parsed = parseThemeDefinition(fallback, {
      variantTokens: REQUIRED_VARIANT_TOKENS,
      interactionTokens: REQUIRED_INTERACTION_TOKENS
    })
    css = buildThemeCssVariables(
      { id: themeId, variants: parsed.variants, mantine: parsed.mantine },
      { contrast: options.contrast, glassOpacity: options.glassOpacity },
      logFallback
    )
  }

  const shared = cssBlock(':root,:host', css.variables)
  const light = cssBlock(
    ':root[data-mantine-color-scheme="light"],:host([data-mantine-color-scheme="light"])',
    css.light
  )
  const dark = cssBlock(
    ':root[data-mantine-color-scheme="dark"],:host([data-mantine-color-scheme="dark"])',
    css.dark
  )
  if (!shared || !light || !dark) {
    warn(`[RTWiki] Theme "${themeId}" contains an unsafe CSS value; using default`)
    return buildThemeBootstrap({ ...options, themeId: DEFAULT_THEME_ID, warn })
  }

  // Interface adjustments are clamped again here so a bad value can never
  // reach the first-screen style, even if a caller bypasses settings validation.
  const contrast = clampSetting(options.contrast, CONTRAST_MIN, CONTRAST_MAX, CONTRAST_DEFAULT)
  const glassOpacity = clampSetting(
    options.glassOpacity,
    GLASS_OPACITY_MIN,
    GLASS_OPACITY_MAX,
    GLASS_OPACITY_DEFAULT
  )
  const adjustments = cssBlock(':root,:host', {
    '--rtwiki-contrast': String(contrast / 100),
    '--rtwiki-glass-opacity': String(glassOpacity / 100)
  })
  if (!adjustments) {
    throw new Error('[RTWiki] Interface adjustment values are unsafe')
  }

  const scheme = options.colorScheme
  const script =
    `(function(){var s=${scriptString(scheme)};` +
    `if(s==='auto'){s=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}` +
    `document.documentElement.dataset.mantineColorScheme=s;` +
    `document.documentElement.dataset.rtwikiColorSchemeChoice=${scriptString(scheme)};` +
    `document.documentElement.dataset.rtwikiTheme=${scriptString(themeId)};` +
    `document.documentElement.dataset.rtwikiContrast=${scriptString(String(contrast))};` +
    `document.documentElement.dataset.rtwikiGlassOpacity=${scriptString(String(glassOpacity))};})()`

  return {
    script,
    style: `${shared}${adjustments}${light}${dark}`,
    themeId,
    colorScheme: scheme,
    contrast,
    glassOpacity
  }
}

type ThemeCssVariablesLike = ReturnType<typeof buildThemeCssVariables>
