import { FLOATING, NOTIFICATION, RTWIKI_SCROLL } from './constants.js'
import { buildThemes, resolveTheme } from './theme-collection.js'
import {
  type AppTheme,
  buildVariantVariables,
  DEFAULT_THEME_ID,
  REQUIRED_INTERACTION_TOKENS,
  REQUIRED_VARIANT_TOKENS,
  type RequiredInteractionToken,
  type RequiredVariantToken,
  type ThemeVariant,
  type ThemeVariants,
  VARIANT_TOKEN_NAMES
} from './tokens.js'

export type {
  AppTheme,
  RequiredInteractionToken,
  RequiredVariantToken,
  ThemeVariant,
  ThemeVariants
}
export {
  buildVariantVariables,
  DEFAULT_THEME_ID,
  FLOATING,
  NOTIFICATION,
  REQUIRED_INTERACTION_TOKENS,
  REQUIRED_VARIANT_TOKENS,
  RTWIKI_SCROLL,
  VARIANT_TOKEN_NAMES
}

/**
 * RTWiki theme registry.
 *
 * Themes are discovered at build time with Vite's standard `import.meta.glob`:
 * dropping a JSON file into `src/web/themes/` makes it available on the next
 * build with no code change. Each file is validated through the same Zod loader
 * the app uses. A malformed theme is skipped with a visible warning rather than
 * breaking the app; the default theme is always present as the fallback.
 *
 * Why this is a registry and not a set of loose CSS variables: the document
 * surface and the panels were previously addressed by a single ambiguous pair
 * of custom properties, and the two silently converged on the same tone in one
 * scheme. That ambiguity made the document read as a card inside a panel.
 * Region-named tokens remove the possibility of the collision. The superseded
 * names are recorded in docs/rtwiki-uiux.md and are deliberately absent from
 * source so they cannot be copied back into a stylesheet.
 *
 * Relationship that must hold in every variant, mirroring TriliumNext: the pane
 * is recessed and the document canvas is the brightest surface. The
 * `canvas !== pane` invariant is asserted for every theme and variant in
 * tests/theme-registry.test.ts.
 */

/**
 * Vite replaces import.meta.glob with static imports at build time. Bun (the
 * test runner) does not implement it, so under Bun we fall back to reading the
 * same directory with node:fs. Both paths feed the same buildThemes() factory,
 * so validation and behaviour are identical.
 */
const themeFiles: Record<string, unknown> =
  typeof import.meta.glob === 'function'
    ? (import.meta.glob('../themes/*.json', {
        eager: true,
        import: 'default'
      }) as Record<string, unknown>)
    : await (async () => {
        // biome-ignore lint/correctness/noNodejsModules: Bun-only test fallback; Vite replaces this branch and never bundles it.
        const { readdirSync, readFileSync } = await import('node:fs')
        // biome-ignore lint/correctness/noNodejsModules: Bun-only test fallback; Vite replaces this branch and never bundles it.
        const { join } = await import('node:path')
        const dir = join(import.meta.dir, '..', 'themes')
        const files: Record<string, unknown> = {}
        for (const name of readdirSync(dir)
          .filter((n) => n.endsWith('.json'))
          .sort()) {
          files[`../themes/${name}`] = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown
        }
        return files
      })()

function idFromPath(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.json$/, '')
}

export const APP_THEMES: Readonly<Record<string, AppTheme>> = buildThemes(
  Object.entries(themeFiles).map(([path, json]) => [idFromPath(path), json] as const)
)

export function getTheme(id: string): AppTheme {
  return resolveTheme(APP_THEMES, id)
}
