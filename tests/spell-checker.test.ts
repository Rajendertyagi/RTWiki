import { describe, expect, it } from 'bun:test'
import {
  createSpellChecker,
  loadSpellChecker,
  type NSpellLike,
  resetSpellCheckerCache
} from '../src/web/features/rich-editor/spell/spell-checker.js'

/**
 * A stand-in for nspell, so these tests exercise our tokenising, filtering and
 * caching rules rather than the dictionary's contents. The dictionary itself is
 * proven separately by `scripts/spellcheck-spike.ts`, which runs the real
 * engine against the real vendored files.
 */
function fakeEngine(
  known: readonly string[],
  taught: string[] = []
): NSpellLike & {
  taught: string[]
  correctCalls: number
} {
  const correctCalls = { value: 0 }
  return {
    taught,
    get correctCalls() {
      return correctCalls.value
    },
    correct(word: string): boolean {
      correctCalls.value += 1
      return known.includes(word) || taught.some((t) => t.toLowerCase() === word.toLowerCase())
    },
    suggest: (word: string): string[] => [`${word}s`, `re${word}`],
    dictionary(words: string): void {
      for (const line of words.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length > 0) taught.push(trimmed)
      }
    }
  }
}

const KNOWN = ['hello', 'world', 'diagram', 'mermaid', 'running', 'runs', 'studies', 'the', 'a']

describe('spell checker', () => {
  it('reports a misspelling with its exact offsets', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    const text = 'hello wrold'
    const found = spell.check(text)
    expect(found).toEqual([{ word: 'wrold', from: 6, to: 11 }])
    // The offsets must index back to the original text, or a click-to-fix
    // would replace the wrong span.
    expect(text.slice(found[0].from, found[0].to)).toBe('wrold')
  })

  it('reports every misspelling in order', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('wrold hllo wrold').map((m) => m.word)).toEqual(['wrold', 'hllo', 'wrold'])
  })

  it('accepts words the dictionary knows and inflections of them', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('hello running runs studies diagram')).toEqual([])
  })

  it('ignores anything containing a digit', () => {
    // Identifiers, measurements and years are not spelling mistakes, and
    // flagging them is the fastest way to make someone switch this off.
    // `COVID19` must arrive as ONE token, or its `COVID` half gets flagged.
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('COVID19 5th 12 kg 640x480 H2O')).toEqual([])
  })

  it('ignores acronyms', () => {
    // RNA, DNA, HTTP and friends are not misspellings, and a study note is full
    // of them. Flagging acronyms is the classic reason a spell checker is off.
    // Only the acronyms are asserted, so the test states that property rather
    // than depending on the fake dictionary happening to know "and" or "use".
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('RNA DNA HTTP CPU PDF SQL').map((m) => m.word)).toEqual([])
  })

  it('ignores very short tokens', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('qi xu ok')).toEqual([])
  })

  it('treats an apostrophe or hyphen inside a word as one token', () => {
    const spell = createSpellChecker(fakeEngine([...KNOWN, "don't", 'osmosis-driven']), [])
    expect(spell.check("don't osmosis-driven")).toEqual([])
    expect(spell.check("don'tt").map((m) => m.word)).toEqual(["don'tt"])
  })

  it('matches case-insensitively but reports the word as written', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('Hello')).toEqual([])
    expect(spell.check('Wrold')).toEqual([{ word: 'Wrold', from: 0, to: 5 }])
  })

  it('honours the personal dictionary passed at construction', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), ['Zymurgy'])
    expect(spell.check('Zymurgy')).toEqual([])
  })

  it('learns a word added later and stops flagging it', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('nephron')).toHaveLength(1)
    spell.addWord('nephron')
    // The decision cache must be invalidated, or the word stays flagged for the
    // rest of the session even though the engine now accepts it.
    expect(spell.check('nephron')).toEqual([])
  })

  it('asks the engine once per distinct word', () => {
    const engine = fakeEngine(KNOWN)
    const spell = createSpellChecker(engine, [])
    spell.check('hello hello hello world hello')
    // Four lookups, not five: the point of the cache is that prose repeats.
    expect(engine.correctCalls).toBe(2)
  })

  it('returns no findings for empty or punctuation-only text', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    expect(spell.check('')).toEqual([])
    expect(spell.check('   ... 123 -- ')).toEqual([])
  })

  it('handles text containing newlines and multiple blocks', () => {
    const spell = createSpellChecker(fakeEngine(KNOWN), [])
    const found = spell.check('hello\nwrold\n\nhllo')
    expect(found.map((m) => m.word)).toEqual(['wrold', 'hllo'])
  })
})

describe('dictionary loading', () => {
  it('fetches both files once and builds one engine', async () => {
    resetSpellCheckerCache()
    const urls: string[] = []
    const fetchText = async (url: string): Promise<string> => {
      urls.push(url)
      return url.endsWith('.aff') ? 'AFF' : 'DIC'
    }
    const factory = (): NSpellLike => fakeEngine(KNOWN)

    const [first, second] = await Promise.all([
      loadSpellChecker([], factory, fetchText),
      loadSpellChecker([], factory, fetchText)
    ])

    expect(first).not.toBeNull()
    // The same instance, so a second editor mount does not rebuild the engine
    // or re-fetch 552 kB.
    expect(second).toBe(first)
    expect(urls.sort()).toEqual(['/dict/en.aff', '/dict/en.dic'])
    resetSpellCheckerCache()
  })

  it('resolves to null when the dictionary cannot be fetched', async () => {
    resetSpellCheckerCache()
    const failing = async (): Promise<string> => {
      throw new Error('offline')
    }
    // Spell check is an enhancement: a missing dictionary must never stop the
    // editor rendering, so this resolves rather than throwing.
    const result = await loadSpellChecker([], () => fakeEngine(KNOWN), failing)
    expect(result).toBeNull()
    resetSpellCheckerCache()
  })
})
