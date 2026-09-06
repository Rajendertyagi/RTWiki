import { useEffect, useState } from 'react'

/**
 * Versioned browser preference store for editor behaviour (Slice 3).
 *
 * Holds ONLY explicit user editor choices (currently word wrap). It never stores
 * note content, document state or temporary session data. The version is part of
 * the storage key, so a future schema change starts from defaults instead of
 * misreading old values. Unavailable storage degrades to the in-memory default.
 */

const EDITOR_PREFS_KEY = 'rtwiki.editor.preferences.v1'

export interface EditorPreferences {
  wordWrap: boolean
}

function defaultEditorPreferences(): EditorPreferences {
  return { wordWrap: true }
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
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { wordWrap?: unknown }).wordWrap === 'boolean'
    ) {
      return { wordWrap: (parsed as { wordWrap: boolean }).wordWrap }
    }
  } catch {
    // Corrupt value: fall back to defaults rather than throwing during render.
  }
  return defaultEditorPreferences()
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
