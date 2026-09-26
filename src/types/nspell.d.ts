/**
 * Ambient types for `nspell`, which ships JavaScript only.
 *
 * The package publishes `lib/` with no `.d.ts`, so importing it fails typecheck
 * under `noImplicitAny`. Only the surface RTWiki uses is declared, and it is
 * deliberately narrow: declaring the whole Hunspell API would be a large
 * hand-written surface that could drift from the real one without notice.
 *
 * `nspell` is a factory: give it an affix document and an optional word list,
 * and it returns the checker.
 *
 * Verified against nspell 2.1.5, whose `lib/index.js` branches on
 * `typeof aff === 'string' || isBuffer(aff)` — so plain strings are supported,
 * which is what lets RTWiki serve its dictionary as text rather than shipping a
 * Node `Buffer` shim to the browser.
 */
declare module 'nspell' {
  interface NSpell {
    /** True when the word is in the dictionary, or derivable by its affix rules. */
    correct(word: string): boolean
    /** Replacement candidates, best first. */
    suggest(word: string): string[]
    /** Teaches the checker additional words, newline separated. */
    dictionary(words: string): void
    /** Characters treated as part of a word, if the dictionary declares any. */
    wordCharacters(): string | undefined
  }

  type NSpellFactory = (aff: string, dic?: string) => NSpell

  const nspell: NSpellFactory
  export default nspell
}
