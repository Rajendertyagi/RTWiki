import { notifications } from '@mantine/notifications'
import type { Reminder, ScheduleEntry } from '@rtwiki/shared/contracts/schedule'
import {
  defaultSchedulerPreferences,
  type SchedulerPreferences
} from '../features/workspace/scheduler-preferences.js'
import { listEntries, listReminders } from '../services/schedule-api.js'
import { showOsNotification } from './os-notify.js'

/**
 * Study Scheduler notification engine (Slice 2).
 *
 * A single client-side controller that turns the per-entry / per-reminder
 * notification preferences (already stored via Slice 1) into fired
 * notifications. RTWiki is local-first with no push server, so this runs in the
 * browser: it periodically loads the timetable, expands each item into concrete
 * "notification moments" from its offset preferences, and fires in-app toasts
 * (always) plus optional browser notifications (when enabled + permitted).
 *
 * Design notes:
 * - Dedupe: each moment gets a stable key including its occurrence date, so a
 *   weekly period refires next week (different date) but never twice for the
 *   same occurrence. Fired keys persist across restarts (localStorage).
 * - Missed sweep: on startup and each tick, moments that became due while the
 *   app was closed (within MISSED_WINDOW_MS) are fired once.
 * - Quiet hours: moments due during the quiet window are deferred (not marked
 *   fired) so they can surface shortly after it ends, bounded by MISSED_WINDOW.
 */

const TICK_MS = 30_000
const MISSED_WINDOW_MS = 2 * 60 * 60 * 1000
const FIRED_KEY = 'rtwiki.scheduler.fired.v1'
const FIRED_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000

interface NotificationMoment {
  key: string
  title: string
  body: string
  when: Date
  sourceId: string
  linkedPageId: string | null
}

interface FiredRecord {
  key: string
  at: number
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addMinutes(d: Date, minutes: number): Date {
  const next = new Date(d)
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const next = new Date(day)
  next.setHours(h, m, 0, 0)
  return next
}

function parseMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function isWithinQuiet(now: Date, start: string | null, end: string | null): boolean {
  if (!start || !end || start === end) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const s = parseMin(start)
  const e = parseMin(end)
  if (s < e) return cur >= s && cur < e
  return cur >= s || cur < e
}

function pushPeriodOffsets(out: NotificationMoment[], entry: ScheduleEntry, occ: Date): void {
  const prefs = entry.notifications
  const offsets: number[] = []
  if (prefs.start) offsets.push(0)
  if (prefs.fiveMinBefore) offsets.push(-5)
  for (const o of prefs.customOffsets ?? []) offsets.push(o)
  const body = `Starts at ${entry.startTime}`
  for (const o of offsets) {
    out.push({
      key: `${entry.id}:${ymd(occ)}:${o}`,
      title: entry.title,
      body,
      when: addMinutes(occ, o),
      sourceId: entry.id,
      linkedPageId: entry.linkedPageId
    })
  }
}

function computeMoments(
  entries: ScheduleEntry[],
  reminders: Reminder[],
  now: Date
): NotificationMoment[] {
  const out: NotificationMoment[] = []

  // Weekly occurrences across [yesterday .. +7 days] so this and next week's
  // instances (and recently-passed ones for the missed sweep) are covered.
  const base = new Date(now)
  base.setDate(base.getDate() - 1)
  for (let i = 0; i < 9; i++) {
    const day = new Date(base)
    day.setDate(base.getDate() + i)
    const dow = day.getDay()
    for (const e of entries) {
      if (!e.enabled || !e.notifications.enabled) continue
      if (e.recurrenceKind === 'weekly') {
        if (!e.weekdays?.includes(dow)) continue
        pushPeriodOffsets(out, e, atTime(day, e.startTime))
      }
    }
  }

  for (const e of entries) {
    if (!e.enabled || !e.notifications.enabled) continue
    if (e.recurrenceKind === 'oneoff' && e.date) {
      pushPeriodOffsets(out, e, atTime(new Date(`${e.date}T00:00:00`), e.startTime))
    }
  }

  for (const r of reminders) {
    if (!r.enabled || !r.notifications.enabled) continue
    const due = new Date(r.dueDatetime)
    if (Number.isNaN(due.getTime())) continue
    for (const o of r.notifications.customOffsets ?? []) {
      out.push({
        key: `${r.id}:${ymd(due)}:${o}`,
        title: r.title,
        body: r.message ?? '',
        when: addMinutes(due, o),
        sourceId: r.id,
        linkedPageId: r.linkedPageId
      })
    }
  }

  return out
}

class ScheduleNotifier {
  private prefs: SchedulerPreferences = defaultSchedulerPreferences()
  private timer: ReturnType<typeof setInterval> | null = null
  private fired = new Set<string>()
  private started = false

  applyPreferences(prefs: SchedulerPreferences): void {
    this.prefs = prefs
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.loadFired()
    void this.run()
    this.timer = setInterval(() => void this.run(), TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.started = false
  }

  refresh(): void {
    if (this.started) void this.run()
  }

  fireTest(): void {
    this.emit('Test notification', 'Scheduler notifications are working.', null)
  }

  private async run(): Promise<void> {
    const now = new Date()
    let entries: ScheduleEntry[] = []
    let reminders: Reminder[] = []
    try {
      const [e, r] = await Promise.all([listEntries(), listReminders()])
      entries = e
      reminders = r
    } catch {
      return
    }

    const moments = computeMoments(entries, reminders, now)
    const quiet = isWithinQuiet(now, this.prefs.quietStart, this.prefs.quietEnd)

    for (const m of moments) {
      const t = m.when.getTime()
      if (t > now.getTime()) continue
      if (t < now.getTime() - MISSED_WINDOW_MS) continue
      if (this.fired.has(m.key)) continue
      if (quiet) continue
      this.emit(m.title, m.body, m.linkedPageId)
      this.fired.add(m.key)
    }

    this.persistFired()
  }

  private emit(title: string, body: string, _linkedPageId: string | null): void {
    if (this.prefs.inAppEnabled) {
      notifications.show({
        title,
        message: body || undefined,
        color: 'blue',
        autoClose: 8000
      })
    }
    if (this.prefs.browserEnabled) {
      // Native toast in the desktop shell, Web Notification API otherwise.
      void showOsNotification(title, body || undefined)
    }
  }

  private loadFired(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      const raw = window.localStorage.getItem(FIRED_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as FiredRecord[]
      const cutoff = Date.now() - FIRED_MAX_AGE_MS
      for (const rec of parsed) {
        if (typeof rec?.key === 'string' && rec.at >= cutoff) this.fired.add(rec.key)
      }
    } catch {
      this.fired.clear()
    }
  }

  private persistFired(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      const cutoff = Date.now() - FIRED_MAX_AGE_MS
      const records: FiredRecord[] = []
      for (const key of this.fired) records.push({ key, at: Date.now() })
      const pruned = records.filter((r) => r.at >= cutoff)
      window.localStorage.setItem(FIRED_KEY, JSON.stringify(pruned))
    } catch {
      // Privacy modes can throw; the in-memory ledger still prevents duplicates
      // for this session.
    }
  }
}

export const scheduleNotifier = new ScheduleNotifier()
