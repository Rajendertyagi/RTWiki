import type { NSpellLike } from './spell-checker.js'

/**
 * Loads the nspell engine on demand.
 *
 * Imported dynamically rather than statically so the engine joins the
 * dictionary as a lazily-fetched chunk: together they are the largest thing
 * spell check adds, and a user who never opens a note should never pay for it.
 *
 * nspell is CommonJS, so the interop shape is normalised here rather than at
 * every call site: depending on the bundler the callable lands on `default` or
 * on the namespace itself.
 */
export async function loadNspellEngine(aff: string, dic: string): Promise<NSpellLike> {
  const imported = (await import('nspell')) as unknown
  const candidate =
    typeof imported === 'function'
      ? imported
      : ((imported as { default?: unknown }).default as unknown)

  if (typeof candidate !== 'function') {
    throw new Error('nspell module did not expose a factory function')
  }

  return (candidate as (a: string, d: string) => NSpellLike)(aff, dic)
}
