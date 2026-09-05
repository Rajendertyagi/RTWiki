import { LAYOUT } from '../../config/index.js'

/**
 * Versioned browser preference store for shell pane geometry (Slice 2).
 *
 * Stores ONLY explicit user layout choices: pane widths and collapse flags.
 * Never tabs, page IDs, note content, database data, or temporary responsive
 * state — document/session restoration stays in workspace-session.ts. The
 * version is part of the storage key, so a future schema change starts from
 * defaults instead of misreading old values. Unavailable storage (privacy
 * modes) degrades to session-only preferences.
 */

export const LAYOUT_PREFS_KEY = 'rtwiki.layout.preferences.v1'

export interface LayoutPreferences {
  treeWidth: number
  rightSidebarWidth: number
  treeCollapsed: boolean
  rightSidebarCollapsed: boolean
}

export function defaultLayoutPreferences(): LayoutPreferences {
  return {
    treeWidth: LAYOUT.treePaneWidth,
    rightSidebarWidth: LAYOUT.rightSidebarWidth,
    treeCollapsed: false,
    rightSidebarCollapsed: false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function clampPrefWidth(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function readStorage(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage.getItem(LAYOUT_PREFS_KEY)
  } catch {
    return null
  }
}

export function loadLayoutPreferences(): LayoutPreferences {
  const fallback = defaultLayoutPreferences()
  try {
    const raw = readStorage()
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return fallback
    return {
      treeWidth: clampPrefWidth(
        parsed.treeWidth,
        LAYOUT.treePaneMinWidth,
        LAYOUT.treePaneMaxWidth,
        fallback.treeWidth
      ),
      rightSidebarWidth: clampPrefWidth(
        parsed.rightSidebarWidth,
        LAYOUT.rightSidebarMinWidth,
        LAYOUT.rightSidebarMaxWidth,
        fallback.rightSidebarWidth
      ),
      treeCollapsed: parsed.treeCollapsed === true,
      rightSidebarCollapsed: parsed.rightSidebarCollapsed === true
    }
  } catch {
    return fallback
  }
}

export function saveLayoutPreferences(prefs: LayoutPreferences): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(LAYOUT_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Privacy modes can throw on access; preferences stay session-only.
  }
}
