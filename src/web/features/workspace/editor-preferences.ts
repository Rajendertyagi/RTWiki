import { useEffect, useState } from 'react'

/**
 * Versioned browser preference store for editor behaviour (Slice 3).
 *
 * Holds ONLY explicit user editor choices (word wrap, spell check and the
 * personal dictionary). It never stores note content, document state or
 * temporary session data. The version is part of the storage key, so a future
 * schema change starts from defaults instead of misreading old values.
 * Unavailable storage degrades to the in-memory default.
 *
 * The personal dictionary lives here rather than in the server settings API
 * because that API is deliberately narrow: it persists the listening port and
 * the desktop close behaviour into `data/server.json` and `data/desktop.json`
 * behind a 4 kB body cap. A hand-curated word list is none of those things and
 * would outgrow the cap. It is a per-user editor preference, which is exactly
 * what this store is for.
 */

const EDITOR_PREFS_KEY = 'rtwiki.editor.preferences.v1'

/** Ceiling on the personal dictionary, in words. */
export const MAX_PERSONAL_WORDS = 2000

export interface EditorPreferences {
  wordWrap: boolean
  /** On by default: inert until a dictionary has loaded. */
  spellCheck: boolean
  /**
   * Words the reader has chosen to accept. Bounded so a runaway loop cannot
   * fill localStorage, which would take every other stored preference with it.
   */
  personalWords: string[]
}

function defaultEditorPreferences(): EditorPreferences {
  return { wordWrap: true, spellCheck: true, personalWords: [] }
}

/** Trims, collapses internal whitespace, and rejects anything unusable. */
function normaliseWord(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const word = raw.trim().replace(/\s+/gu, ' ')
  if (word.length === 0 || word.length > 64) return null
  return word
}

function readStorage(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage.getItem(EDITOR_PREFS_KEY)
  } catch {
    return null
  }
}

function load(): EditorPreferences {
  const raw = readStorage()
  if (!raw) return defaultEditorPreferences()
  const fallback = defaultEditorPreferences()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    const record = parsed as Record<string, unknown>

    // Field by field rather than all-or-nothing: a payload written before a
    // field existed must still get that field's default instead of the whole
    // record being discarded.
    return {
      wordWrap: typeof record.wordWrap === 'boolean' ? record.wordWrap : fallback.wordWrap,
      spellCheck: typeof record.spellCheck === 'boolean' ? record.spellCheck : fallback.spellCheck,
      personalWords: Array.isArray(record.personalWords)
        ? record.personalWords
            .slice(0, MAX_PERSONAL_WORDS)
            .map(normaliseWord)
            .filter((word): word is string => word !== null)
        : fallback.personalWords
    }
  } catch {
    // Corrupt value: fall back to defaults rather than throwing during render.
    return fallback
  }
}

let current: EditorPreferences = load()
const listeners = new Set<() => void>()

function persist(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(current))
    }
  } catch {
    // Privacy modes can throw on access; the in-memory value still holds.
  }
}

export function loadEditorPreferences(): EditorPreferences {
  return current
}

export function setWordWrap(value: boolean): void {
  current = { ...current, wordWrap: value }
  persist()
  for (const listener of listeners) listener()
}

export function setSpellCheck(value: boolean): void {
  current = { ...current, spellCheck: value }
  persist()
  for (const listener of listeners) listener()
}

/**
 * Adds a word to the personal dictionary.
 *
 * Case-insensitively deduplicated, because "Zymurgy" and "zymurgy" are the same
 * word to a reader and storing both would make the list lie about its size.
 * Returns false when the list is full or the word is unusable, so a caller can
 * tell the user rather than silently dropping it.
 */
export function addPersonalWord(raw: string): boolean {
  const word = normaliseWord(raw)
  if (word === null) return false
  if (current.personalWords.length >= MAX_PERSONAL_WORDS) return false
  const exists = current.personalWords.some(
    (existing) => existing.toLowerCase() === word.toLowerCase()
  )
  if (exists) return true
  current = { ...current, personalWords: [...current.personalWords, word] }
  persist()
  for (const listener of listeners) listener()
  return true
}

export function removePersonalWord(raw: string): boolean {
  const word = normaliseWord(raw)
  if (word === null) return false
  const next = current.personalWords.filter(
    (existing) => existing.toLowerCase() !== word.toLowerCase()
  )
  if (next.length === current.personalWords.length) return false
  current = { ...current, personalWords: next }
  persist()
  for (const listener of listeners) listener()
  return true
}

export function subscribeEditorPreferences(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React binding for editor preferences; re-renders on any change. */
export function useEditorPreferences(): EditorPreferences {
  const [prefs, setPrefs] = useState<EditorPreferences>(current)
  useEffect(() => {
    setPrefs(loadEditorPreferences())
    return subscribeEditorPreferences(() => setPrefs(loadEditorPreferences()))
  }, [])
  return prefs
}
