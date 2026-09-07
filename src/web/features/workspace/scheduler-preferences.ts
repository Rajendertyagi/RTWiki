/**
 * Versioned browser preference store for the study Scheduler (Slice 2).
 *
 * Stores ONLY explicit user choices for notifications: whether in-app and/or
 * browser notifications are enabled, and an optional quiet-hours window. It
 * never holds timetable data, page content, or the fired-notification ledger
 * (that lives in schedule-notifier.ts). Storage is localStorage, matching the
 * existing layout/editor preference stores; unavailable storage degrades to the
 * in-memory defaults.
 */

export const SCHEDULER_PREFS_KEY = 'rtwiki.scheduler.preferences.v1'

export interface SchedulerPreferences {
  /** Show in-app toasts via @mantine/notifications. */
  inAppEnabled: boolean
  /** Attempt OS/browser notifications (requires granted permission). */
  browserEnabled: boolean
  /** Quiet hours start in HH:mm (local), or null to disable. */
  quietStart: string | null
  /** Quiet hours end in HH:mm (local), or null to disable. */
  quietEnd: string | null
}

export function defaultSchedulerPreferences(): SchedulerPreferences {
  return {
    inAppEnabled: true,
    browserEnabled: false,
    quietStart: null,
    quietEnd: null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readStorage(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage.getItem(SCHEDULER_PREFS_KEY)
  } catch {
    return null
  }
}

function parseTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{2}:\d{2}$/.test(value) ? value : null
}

export function loadSchedulerPreferences(): SchedulerPreferences {
  const fallback = defaultSchedulerPreferences()
  try {
    const raw = readStorage()
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return fallback
    return {
      inAppEnabled: parsed.inAppEnabled !== false,
      browserEnabled: parsed.browserEnabled === true,
      quietStart: parseTime(parsed.quietStart),
      quietEnd: parseTime(parsed.quietEnd)
    }
  } catch {
    return fallback
  }
}

export function saveSchedulerPreferences(prefs: SchedulerPreferences): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(SCHEDULER_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Privacy modes can throw on access; preferences stay session-only.
  }
}

export function resetSchedulerPreferences(): SchedulerPreferences {
  const defaults = defaultSchedulerPreferences()
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(SCHEDULER_PREFS_KEY)
    }
  } catch {
    // Privacy modes can throw on access; the in-memory reset still applies.
  }
  return defaults
}
