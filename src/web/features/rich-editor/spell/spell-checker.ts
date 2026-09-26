/**
 * Spell checking for the Rich editor, backed by a vendored Hunspell dictionary.
 *
 * Why not the browser's own spell checker: browsers deliberately refuse to let
 * JavaScript read or extend the system dictionary. Safari's dictionary can hold
 * personal entries, so treating it as script-readable is treated as a privacy
 * leak (ProseMirror/prosemirror#390, and the Electron thread on the same
 * issue). The practical consequence is that the native checker can be turned on
 * but a user's own vocabulary can never be added to it, which for a study wiki
 * full of subject terminology makes it close to useless.
 *
 * Why nspell and not cspell: cspell is built for source code and downloads its
 * dictionaries from a CDN at runtime, which RTWiki's offline rule forbids. nspell
 * is a small Hunspell-compatible engine with no runtime fetch, and it accepts
 * the dictionary as plain strings.
 *
 * Why the dictionary is vendored rather than installed: the `dictionary-en`
 * package reads its `.aff`/`.dic` from disk with `node:fs` at module load, so it
 * cannot run in a browser at all. The two files are committed under `public/dict`
 * (3 kB + 552 kB, MIT AND BSD, licence included) and served by RTWiki's own
 * static handler. Nothing is ever fetched from the internet.
 *
 * ProseMirror decorations are the only thing that consumes this module, so it is
 * deliberately free of any editor or DOM dependency and can be unit-tested.
 */

/** A misspelled word and where it sits in the text it came from. */
export interface Misspelling {
  word: string
  from: number
  to: number
}

/**
 * Words are letters and digits, optionally joined by apostrophes or hyphens, so
 * "don't" and "osmosis-driven" are one token each and "COVID19" or "640x480"
 * are single tokens too.
 *
 * Digits are part of the pattern on purpose. An earlier letters-only pattern
 * meant a token could never contain a digit, so the "skip anything with a digit"
 * rule below was unreachable and `COVID19` was split into `COVID`, which was
 * then flagged. A rule that cannot fire is worse than no rule, because it looks
 * like it is working.
 */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\u2019-][\p{L}\p{N}]+)*/gu

/** A token containing a digit is an identifier, a measurement or a year. */
const CONTAINS_DIGIT = /\p{N}/u

/**
 * All-caps tokens are acronyms - RNA, DNA, HTTP, CPU, PDF - and study notes are
 * full of them. Flagging them is the most common reason a spell checker gets
 * switched off, and unlike a misspelling an acronym is not something the reader
 * can be expected to correct.
 */
function isAcronym(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()
}

/**
 * Below this length a "misspelling" is almost always a real short word that the
 * dictionary simply lacks, and marking it is more irritating than useful. Two
 * characters covers the genuine cases ("teh", "adn") without flagging "qi" or
 * "xu".
 */
const MIN_LENGTH = 3

export interface SpellChecker {
  /** Every misspelling in `text`, in order of appearance. */
  check(text: string): Misspelling[]
  /** Replacement candidates for a single word, best first. */
  suggest(word: string): string[]
  /** Teaches the checker a word. Called for the personal dictionary. */
  addWord(word: string): void
  /** True once the dictionary is loaded and checking can be trusted. */
  isReady(): boolean
}

/** The subset of nspell this module uses, so tests can supply a fake. */
export interface NSpellLike {
  correct(word: string): boolean
  suggest(word: string): string[]
  dictionary(words: string): void
}

/**
 * Builds the engine from the loaded dictionary.
 *
 * May be async so the caller can dynamically import the engine, keeping it out
 * of the initial application chunk.
 */
export type NSpellFactory = (aff: string, dic: string) => NSpellLike | Promise<NSpellLike>

const DICTIONARY_AFF_URL = '/dict/en.aff'
const DICTIONARY_DIC_URL = '/dict/en.dic'

/**
 * Caches one decision per distinct word for the life of the page.
 *
 * A note repeats words constantly, and Hunspell's `correct` walks the affix
 * tries, so re-asking for a word already seen is pure waste. Bounded so a
 * pathological document cannot grow it without limit.
 */
const CACHE_LIMIT = 20_000

export function createSpellChecker(spell: NSpellLike, personal: readonly string[]): SpellChecker {
  const cache = new Map<string, boolean>()

  const known = (word: string): boolean => {
    const hit = cache.get(word)
    if (hit !== undefined) return hit
    const result = spell.correct(word)
    if (cache.size < CACHE_LIMIT) cache.set(word, result)
    return result
  }

  // The personal dictionary is taught to the engine once, so it participates in
  // the same affix handling as everything else rather than being a separate
  // lookup that could disagree with it.
  if (personal.length > 0) {
    spell.dictionary(personal.join('\n'))
  }

  return {
    isReady: () => true,
    addWord(word: string): void {
      const trimmed = word.trim()
      if (trimmed.length === 0) return
      spell.dictionary(trimmed)
      // A newly learned word must not stay marked in the memo.
      cache.delete(trimmed)
      cache.delete(trimmed.toLowerCase())
    },
    suggest: (word: string): string[] => spell.suggest(word),
    check(text: string): Misspelling[] {
      const found: Misspelling[] = []
      WORD_PATTERN.lastIndex = 0
      let match = WORD_PATTERN.exec(text)
      while (match !== null) {
        const word = match[0]
        if (
          word.length >= MIN_LENGTH &&
          !CONTAINS_DIGIT.test(word) &&
          !isAcronym(word) &&
          !known(word.toLowerCase())
        ) {
          found.push({ word, from: match.index, to: match.index + word.length })
        }
        match = WORD_PATTERN.exec(text)
      }
      return found
    }
  }
}

/**
 * The in-flight or resolved load, shared across every caller.
 *
 * Module scope on purpose: a per-call memo would re-fetch the 552 kB dictionary
 * on each editor mount, and the comment on the function would be a lie.
 */
let pendingLoad: Promise<SpellChecker | null> | null = null

/**
 * Loads the vendored dictionary once per page.
 *
 * A failure resolves to `null` rather than throwing: spell check is an
 * enhancement, and a missing dictionary must never stop the editor rendering.
 *
 * `personal` is applied only on the first load, because the engine keeps what it
 * is taught. Later additions go through `addWord`; a wholesale change should call
 * `resetSpellCheckerCache` first.
 */
export function loadSpellChecker(
  personal: readonly string[],
  loadNspell: NSpellFactory,
  fetchText: (url: string, signal?: AbortSignal) => Promise<string> = (url, signal) =>
    fetch(url, { signal }).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
      return res.text()
    })
): Promise<SpellChecker | null> {
  pendingLoad ??= (async () => {
    try {
      const [aff, dic] = await Promise.all([
        fetchText(DICTIONARY_AFF_URL),
        fetchText(DICTIONARY_DIC_URL)
      ])
      return createSpellChecker(await loadNspell(aff, dic), personal)
    } catch {
      return null
    }
  })()
  return pendingLoad
}

/**
 * Drops the memoised load so the next call rebuilds the engine.
 *
 * Needed after the personal dictionary changes wholesale: the engine retains
 * what it has been taught and there is no way to un-teach a word.
 */
export function resetSpellCheckerCache(): void {
  pendingLoad = null
}
