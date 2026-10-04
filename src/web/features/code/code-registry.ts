/**
 * RTWiki's Markdown capability layer: one description of what Markdown can do.
 *
 * ## Why this file exists
 *
 * The audit found the same format knowledge repeated in four places that could
 * drift apart without any test failing:
 *
 *   - `markdown-render.ts` composed the micromark extension list inline, so
 *     "what extensions are on" was only answerable by reading an array literal.
 *   - `markdown-columns.ts` held its directive name as a local constant while
 *     `markdown-render.ts` referenced it, so a rename touched two files.
 *   - A code fence's language was carried as a raw `language-js` class that
 *     **nothing consumed**: BlockNote's highlighting is gated on a
 *     `createHighlighter` callback (`@blocknote/core/dist/extensions-*.js:1408`,
 *     `if (!e.createHighlighter) return []`) and RTWiki passed none, so neither
 *     the Markdown viewer nor the Rich Editor highlighted anything.
 *   - `js → javascript` had to exist somewhere for a highlighter to be usable
 *     at all, and there was nowhere to put it.
 *
 * So: one registry, imported by both surfaces. Adding a language is a data
 * change here and nowhere else.
 *
 * ## Layering
 *
 * ```text
 *   this file            capability data (no behaviour, no imports)
 *          ↓
 *   shiki-service.ts     the engine, one lazy instance
 *          ↓                ↘                        ↙
 *   markdown-code-*      Markdown viewer      BlockNote code blocks
 * ```
 *
 * The data and the engine are separate so the registry can be imported by tests,
 * by the Rich Editor, and by the Markdown viewer without any of them pulling in
 * Shiki's runtime. That is what keeps the engine out of the initial bundle.
 */
import type { LanguageInput } from 'shiki/core'

/**
 * A canonical language: the name Shiki knows it by.
 *
 * The union is derived from {@link CODE_LANGUAGES} rather than written by hand,
 * so adding a language to the registry cannot leave this type stale.
 */
export type CanonicalCodeLanguage = (typeof CODE_LANGUAGES)[number]['id']

/**
 * Shiki's own grammar-registration shape.
 *
 * A **type-only** import, so this file stays free of runtime imports — that is what
 * lets the tests, the Rich Editor and the Markdown viewer all read the registry
 * without any of them pulling in Shiki. `@shikijs/types` is already in the lockfile
 * as a transitive dependency of `@blocknote/core` and carries no runtime code.
 *
 * `LanguageInput` is Shiki's `LanguageRegistration | LanguageRegistration[]`, so a
 * loader returning either is correct — and the array form is what several
 * `@shikijs/langs/*` modules use for a grammar with variants.
 */
type LanguageRegistration = LanguageInput

/**
 * A registry entry.
 *
 * `loader` is a function rather than an imported module so the language's grammar
 * becomes its own lazily-fetched chunk. Importing `@shikijs/langs` for its side
 * effect at module scope would put all 321 grammars — 7.6 MB of `node_modules`
 * — into whichever bundle imports this file.
 */
export interface CodeLanguageDefinition {
  /** Canonical name, matching Shiki's grammar id. */
  readonly id: string
  /** Human-readable label, for a picker if one is ever added. */
  readonly label: string
  /**
   * Fence infos that resolve to this language.
   *
   * Lower-case and already normalised: {@link resolveCodeLanguage} lower-cases the
   * fence info before looking here, so `'JS'`, `'js'` and `'JavaScript'` all
   * resolve. An author writing ` ```JS ` is not an error.
   */
  readonly aliases: readonly string[]
  /**
   * Lazily imports this language's TextMate grammar.
   *
   * Returns the dynamic-import namespace, whose default export is the grammar.
   */
  readonly loader: () => Promise<{ default: LanguageRegistration }>
}

/**
 * The registry.
 *
 * ## Scope
 *
 * Twelve languages, chosen because they are what a personal notes/wiki actually
 * contains: prose code, data, and the shell. This is deliberately **not** all of
 * Shiki's ~200 grammars — `@shikijs/langs` is 7.6 MB, and a registry entry costs
 * one lazily-loaded chunk, so the cost of adding a language is one line here
 * plus one chunk that only loads if a note uses it.
 *
 * ## Extending it
 *
 * Add one entry. Nothing else in the codebase needs to change: the Markdown
 * viewer, the Rich Editor, the unknown-language fallback and the tests all read
 * this array. `tests/markdown-capabilities.test.ts` asserts that invariant, so a
 * language added without a loader, or a duplicate alias, fails the suite.
 *
 * ## Aliases are one-way on purpose
 *
 * `'js'` and `'javascript'` both map to `'javascript'`, but `'javascript'` is
 * also a valid `id`. Resolution is alias → id, so an id that is also an alias
 * resolves to itself. The alternative — treating ids and aliases as one
 * namespace — would make it impossible to add an alias that shadows an id.
 */
export const CODE_LANGUAGES = [
  {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['javascript', 'js', 'jsx', 'mjs', 'cjs'],
    loader: () => import('@shikijs/langs/javascript')
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['typescript', 'ts', 'tsx', 'mts', 'cts'],
    loader: () => import('@shikijs/langs/typescript')
  },
  {
    id: 'python',
    label: 'Python',
    aliases: ['python', 'py'],
    loader: () => import('@shikijs/langs/python')
  },
  {
    id: 'json',
    label: 'JSON',
    aliases: ['json', 'jsonc'],
    loader: () => import('@shikijs/langs/json')
  },
  {
    id: 'bash',
    label: 'Bash',
    aliases: ['bash', 'sh', 'shell', 'zsh'],
    loader: () => import('@shikijs/langs/bash')
  },
  {
    id: 'css',
    label: 'CSS',
    aliases: ['css'],
    loader: () => import('@shikijs/langs/css')
  },
  {
    id: 'html',
    label: 'HTML',
    aliases: ['html', 'htm'],
    loader: () => import('@shikijs/langs/html')
  },
  {
    id: 'markdown',
    label: 'Markdown',
    aliases: ['markdown', 'md'],
    loader: () => import('@shikijs/langs/markdown')
  },
  {
    id: 'yaml',
    label: 'YAML',
    aliases: ['yaml', 'yml'],
    loader: () => import('@shikijs/langs/yaml')
  },
  {
    id: 'sql',
    label: 'SQL',
    aliases: ['sql'],
    loader: () => import('@shikijs/langs/sql')
  },
  {
    id: 'java',
    label: 'Java',
    aliases: ['java'],
    loader: () => import('@shikijs/langs/java')
  },
  {
    id: 'csharp',
    label: 'C#',
    aliases: ['csharp', 'cs'],
    loader: () => import('@shikijs/langs/csharp')
  }
] as const satisfies readonly CodeLanguageDefinition[]

/**
 * Alias → definition, built once.
 *
 * Built from the registry rather than maintained separately, so an alias cannot
 * exist in one place and be missing from the other. A later duplicate wins, which
 * is arbitrary but harmless: `CODE_LANGUAGES` cannot contain duplicates today
 * (`tests/markdown-capabilities.test.ts` asserts it) so the question never arises.
 */
const BY_ALIAS: ReadonlyMap<string, CodeLanguageDefinition> = new Map(
  CODE_LANGUAGES.flatMap((entry) => entry.aliases.map((alias) => [alias, entry] as const))
)

/**
 * Resolves a fenced-code info string to a canonical language.
 *
 * Returns `undefined` for an unknown or absent language, and the caller then
 * leaves the code unhighlighted. **That is the required behaviour, not a
 * degraded one:** a note with a typo in its fence info should read as plain code,
 * not fail to render.
 */
export function resolveCodeLanguage(info: string | null | undefined): string | undefined {
  if (!info) return undefined
  // A fence info may carry more than the language — `js title="x"`, or
  // `js {1,3}`. Only the first whitespace-delimited word is the language, and a
  // brace-enclosed range must not become part of it.
  const first = info.trim().split(/\s+/, 1)[0]?.toLowerCase()
  if (!first) return undefined
  return BY_ALIAS.get(first)?.id
}

/** The definition for a canonical id, if the registry has one. */
export function findCodeLanguage(id: string): CodeLanguageDefinition | undefined {
  return CODE_LANGUAGES.find((entry) => entry.id === id)
}

/** Every alias the registry accepts, for tests and for a future settings UI. */
export function codeLanguageAliases(): readonly string[] {
  return [...BY_ALIAS.keys()]
}

/**
 * The Shiki themes, paired by colour scheme.
 *
 * Both are Shiki's own bundled themes rather than colours written here, so there
 * are no hardcoded hex values in RTWiki to keep in step with anything. They are
 * the pair GitHub uses, which is the most recognisable light/dark pairing
 * available and reads well against Mantine's greys.
 *
 * Replacing this pair is a change to this object and nothing else — the renderer
 * asks for a theme by scheme, never by name.
 */
export const CODE_THEMES = Object.freeze({
  light: { id: 'github-light', loader: () => import('@shikijs/themes/github-light') },
  dark: { id: 'github-dark', loader: () => import('@shikijs/themes/github-dark') }
} as const)

export type CodeColorScheme = keyof typeof CODE_THEMES

/** The themes the registry will accept, so a typo cannot reach Shiki. */
export function isCodeColorScheme(value: unknown): value is CodeColorScheme {
  return value === 'light' || value === 'dark'
}
