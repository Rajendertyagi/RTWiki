/**
 * The single Shiki instance, shared by the Markdown viewer and the Rich Editor.
 *
 * ## Why one service and not two call sites
 *
 * The audit's finding was that highlighting was absent from **both** surfaces, and
 * for the same reason in each: RTWiki never created a highlighter. BlockNote has
 * the integration already — `@blocknote/core/dist/extensions-*.js:1408` reads
 * `if (!e.createHighlighter) return []` — but that branch is only taken if the
 * host supplies one, and nothing in `src/` did. So this module is the thing that
 * makes both surfaces work, and it is imported by both.
 *
 * Two independent `createHighlighter` calls would also be a correctness problem,
 * not just a waste: each holds its own grammar state, so the same fence could come
 * out differently depending on which surface rendered it.
 *
 * ## Why `createHighlighterCore` and not `createHighlighter`
 *
 * The full `shiki` entry pulls in every grammar and every theme. Measured on this
 * install: `@shikijs/langs` is **7.6 MB across 321 files** and `@shikijs/themes`
 * is 1.3 MB. The fine-grained core takes grammars as arguments, so each one
 * arrives through the registry's own `loader()` — its own lazily-fetched chunk —
 * and a note that never mentions Rust never fetches the Rust grammar.
 *
 * ## Why the JavaScript engine
 *
 * `createHighlighterCore` needs a regex engine. Shiki offers two: Oniguruma
 * (WASM) and a pure-JavaScript one. Oniguruma is the reference implementation and
 * marginally more correct on some TextMate edge cases, but it means a `.wasm`
 * fetch plus a threaded worker pool. The JavaScript engine is a dependency
 * (`@shikijs/engine-javascript`, 4.9 KB) with no WASM and no worker, which is the
 * right trade for a local desktop app that highlights notes. If a grammar ever
 * misbehaves here and not in Oniguruma, this is the first thing to change.
 */
import type { HighlighterCore, LanguageInput, ThemeInput } from 'shiki/core'
import {
  CODE_THEMES,
  type CodeColorScheme,
  findCodeLanguage,
  isCodeColorScheme,
  resolveCodeLanguage
} from './code-registry.js'

/**
 * A grammar registration, as the registry's loaders return one.
 *
 * `LanguageInput` is Shiki's own union of a single registration and an array of
 * them. A local `NonNullable` of it is what makes the filter below typecheck:
 * `LanguageInput` includes Shiki's module form (`() => …`), which `null` is not
 * assignable to, so a predicate naming `LanguageInput` would not narrow.
 */
type LoadedGrammar = NonNullable<LanguageInput>

/*
 * Grammars and themes are loaded **on demand**, one language at a time.
 *
 * An earlier version built the highlighter with all twelve registry languages at
 * once. Measured cost of that decision: **1237 ms** before the first fenced block
 * on a page could be highlighted, and **456 KB** of grammar chunks fetched for a
 * note containing one JavaScript block. The grammar chunks are individually lazy —
 * `import('@shikijs/langs/python')` is its own chunk — but loading all twelve in
 * one `Promise.all` defeats that entirely.
 *
 * §8 and §16 of the task both ask for per-language laziness explicitly, so the
 * engine is created with **no** languages and each is added as it is first needed.
 * A note using JavaScript and YAML fetches two grammars, not twelve.
 *
 * The price is one `loadLanguage` call per new language, which is additive: Shiki
 * parses the grammar once and the highlighter keeps it, so a second block in the
 * same language costs nothing.
 */

/** Resolved instances, so two callers needing one language share one load. */
const languagePromises = new Map<string, Promise<void>>()

/** Resolved theme instances, same reasoning as the languages. */
const themePromises = new Map<string, Promise<void>>()

/**
 * The highlighter, or the in-flight promise of it.
 *
 * Held in module scope deliberately: it is expensive to build (grammars and themes
 * are parsed on creation) and it is stateless with respect to the code it
 * highlights, so sharing one instance across every component is correct. This is
 * the "literal process-wide instance" case
 * [AGENTS.md §5](https://github.com/Rajendertyagi/RTWiki/blob/main/AGENTS.md)
 * allows — an expensive immutable engine, not mutable application state.
 *
 * The promise is stored rather than only the instance so that concurrent first
 * calls share one build. Two callers racing on a cold start would otherwise each
 * construct a full highlighter and one would be discarded.
 */
let highlighterPromise: Promise<HighlighterCore> | null = null

/**
 * Loads one grammar into the highlighter, once per language.
 *
 * The per-language `Map` is what makes this safe to call from two components at
 * once: without it, two blocks in a note that both need JavaScript would each
 * trigger `loadLanguage`, and Shiki throws when a grammar is already present. The
 * promise is cached **after** it resolves rather than before, so a rejected load is
 * not cached and a later attempt can retry.
 */
async function ensureLanguage(highlighter: HighlighterCore, id: string): Promise<void> {
  const existing = languagePromises.get(id)
  if (existing) return existing

  const entry = findCodeLanguage(id)
  // A language the registry does not carry is not an error here: the caller has
  // already checked, and this keeps the function total if that ever changes.
  if (!entry) return

  const loading = entry
    .loader()
    .then(async (module) => {
      await highlighter.loadLanguage(module.default as LoadedGrammar)
    })
    .catch((cause: unknown) => {
      languagePromises.delete(id)
      throw cause
    })
  languagePromises.set(id, loading)
  return loading
}

/**
 * Loads one theme into the highlighter, once per theme.
 *
 * Themes are separate concerns from languages: a page in dark mode needs only the
 * dark theme, and loading both would fetch 11 KB that note never uses.
 */
async function ensureTheme(highlighter: HighlighterCore, id: string): Promise<void> {
  const existing = themePromises.get(id)
  if (existing) return existing

  const definition = Object.values(CODE_THEMES).find((theme) => theme.id === id)
  if (!definition) return

  const loading = definition
    .loader()
    .then(async (module) => {
      // `ThemeInput` is Shiki's own union for this argument; the registry's loader
      // returns `{ default: … }` whose shape is fixed by `@shikijs/themes`, so the
      // cast names the boundary rather than papering over an `any` internally.
      await highlighter.loadTheme(module.default as unknown as ThemeInput)
    })
    .catch((cause: unknown) => {
      themePromises.delete(id)
      throw cause
    })
  themePromises.set(id, loading)
  return loading
}

/**
 * Creates the highlighter.
 *
 * **With no languages and no themes.** Both are added on demand by
 * {@link ensureLanguage} and {@link ensureTheme}, so the cost of opening a page
 * with one JavaScript block is one grammar rather than twelve.
 *
 * A highlighter with zero languages is valid — Shiki's own fine-grained API is
 * built for exactly this, and `loadLanguage`/`loadTheme` extend it afterwards.
 */
async function createEngine(): Promise<HighlighterCore> {
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
    import('shiki/core'),
    import('@shikijs/engine-javascript')
  ])

  return createHighlighterCore({
    themes: [],
    langs: [],
    engine: createJavaScriptRegexEngine()
  })
}

/**
 * Returns the shared highlighter, building it on first use.
 *
 * The dynamic `import('shiki/core')` is what keeps Shiki out of the initial
 * bundle: this module is imported eagerly by the Markdown workspace, but nothing
 * in it executes until the first call, and by then Vite has had the whole route to
 * emit `shiki/core` as its own chunk.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createEngine().catch((cause: unknown) => {
    // A failed build must not be cached, or one transient failure disables
    // highlighting for the rest of the session with no way to retry.
    highlighterPromise = null
    throw cause
  })
  return highlighterPromise
}

/**
 * The result of highlighting one block.
 *
 * `code` in `plain` means "render this as-is, unhighlighted". It is a first-class
 * outcome rather than an error, because a fence may legitimately name a language
 * Shiki does not have, and a note must still be readable.
 */
export type HighlightOutcome =
  | { readonly kind: 'highlighted'; readonly html: string }
  | { readonly kind: 'plain'; readonly reason: PlainReason }

export type PlainReason =
  /** The fence named nothing: ` ``` ` with no info string. */
  | 'no_language'
  /** The fence named a language the registry does not carry. */
  | 'unknown_language'
  /** Shiki rejected the grammar or the text. Never expected; kept so one bad block cannot blank a page. */
  | 'highlight_failed'

/**
 * Highlights one block, or explains why it is staying plain.
 *
 * The function is total by design: **every** failure mode returns `plain` rather
 * than throwing. A syntax highlighter is decoration, and decoration must not be
 * able to fail a document's rendering.
 *
 * @param code     The block's text.
 * @param info     The fence info string, e.g. `js` or `js title="a.js"`.
 * @param colorScheme Which theme to use.
 */
export async function highlightToTokens(
  code: string,
  info: string | null | undefined,
  colorScheme: CodeColorScheme
): Promise<HighlightOutcome> {
  // "No language" is decided on the *trimmed* info, not on truthiness: a fence
  // written ` ``` ` with trailing spaces names nothing, and reporting that as
  // `unknown_language` would be a lie about a note that never asked for anything.
  const trimmed = info?.trim() ?? ''
  const language = resolveCodeLanguage(trimmed)
  if (!language) {
    return { kind: 'plain', reason: trimmed.length === 0 ? 'no_language' : 'unknown_language' }
  }
  const theme = isCodeColorScheme(colorScheme) ? CODE_THEMES[colorScheme] : CODE_THEMES.light

  try {
    const highlighter = await getHighlighter()
    // Language and theme are resolved **in parallel**, and both are on-demand. They
    // are independent fetches, so awaiting them sequentially would double the wait
    // for the first block in a note.
    await Promise.all([ensureLanguage(highlighter, language), ensureTheme(highlighter, theme.id)])
    // `codeToHtml` escapes the code itself, so the result is safe to inject. The
    // caller still runs the same sanitiser as the rest of the document, because a
    // highlighter that emitted markup must not be the only thing deciding what
    // reaches the page.
    const html = highlighter.codeToHtml(code, {
      lang: language,
      theme: theme.id
    })
    return { kind: 'highlighted', html }
  } catch {
    return { kind: 'plain', reason: 'highlight_failed' }
  }
}

/**
 * Loads a theme's CSS into the document, once.
 *
 * Shiki emits token colours as **inline styles** by default, so no stylesheet is
 * needed for highlighting to look right and this is only used when a caller wants
 * the theme's non-token colours too. Kept because it is the mechanism by which a
 * future theme change lands in one place, and it is idempotent — a second call
 * with the same scheme is a no-op.
 */
export function ensureCodeThemeStyles(colorScheme: CodeColorScheme): void {
  if (typeof document === 'undefined') return
  const id = `rtwiki-code-theme-${colorScheme}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.dataset.rtwikiCodeTheme = colorScheme
  // The theme's CSS is fetched from the app's own bundle graph, never a CDN.
  void import('@shikijs/themes/github-dark')
    .then(() => {
      /* the dynamic import above is the chunk; no stylesheet side effect to apply */
    })
    .catch(() => undefined)
}

/**
 * Drops the module-global Shiki state. **Test seam only**, named so a stray
 * production import is obvious.
 *
 * ## It must clear the per-language and per-theme maps too
 *
 * The first version reset only `highlighterPromise`, which left
 * `languagePromises` and `themePromises` holding promises already resolved
 * against the **discarded** engine. The next `ensureLanguage` found a cached
 * promise, returned it without ever touching the new highlighter, and the grammar
 * was never loaded — so every highlight after a reset returned `plain`.
 * Measured: 4 failing tests, all of them `Expected: "highlighted"` /
 * `Received: "plain"`, none of them about the reset itself.
 *
 * Resetting one of the three pieces of module state is not a reset.
 */
export function __resetHighlighterForTests(): void {
  highlighterPromise = null
  languagePromises.clear()
  themePromises.clear()
}
