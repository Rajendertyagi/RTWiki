import dayjs from 'dayjs'
import { SCHEDULE_REMINDER_COLOR } from '../constants/index.js'
import type { CalendarEvent, Reminder, ScheduleEntry } from '../contracts/schedule.js'

/** Returns the YYYY-MM-DD of the first day of the week containing `date`. */
export function getWeekStart(date: string, firstDayOfWeek = 1): string {
  const d = dayjs(date.length === 10 ? `${date} 00:00:00` : date)
  const diff = (d.day() - firstDayOfWeek + 7) % 7
  return d.subtract(diff, 'day').format('YYYY-MM-DD')
}

/** Returns the YYYY-MM-DD of the last day (Sunday) of the week starting at `weekStart`. */
export function getWeekEnd(weekStart: string): string {
  return dayjs(`${weekStart} 00:00:00`).add(6, 'day').format('YYYY-MM-DD')
}

function periodToEvent(entry: ScheduleEntry, date: string): CalendarEvent {
  return {
    id: `entry-${entry.id}-${date}`,
    title: entry.title,
    start: `${date} ${entry.startTime}:00`,
    end: `${date} ${entry.endTime}:00`,
    color: entry.color ?? 'blue',
    kind: 'period',
    sourceId: entry.id,
    allDay: false
  }
}

/**
 * Expands the recurring/one-off models into render-ready calendar occurrences
 * for the week that starts on `weekStart`. Pure and deterministic so the same
 * logic powers both the calendar grid and the notification engine.
 */
export function expandForWeek(
  entries: ScheduleEntry[],
  reminders: Reminder[],
  weekStart: string
): CalendarEvent[] {
  const weekEnd = getWeekEnd(weekStart)
  const events: CalendarEvent[] = []

  for (const entry of entries) {
    if (!entry.enabled) continue
    if (entry.recurrenceKind === 'weekly') {
      const days = entry.weekdays ?? []
      for (let i = 0; i < 7; i += 1) {
        const dayDate = dayjs(`${weekStart} 00:00:00`).add(i, 'day')
        if (days.includes(dayDate.day())) {
          events.push(periodToEvent(entry, dayDate.format('YYYY-MM-DD')))
        }
      }
    } else if (entry.date && entry.date >= weekStart && entry.date <= weekEnd) {
      events.push(periodToEvent(entry, entry.date))
    }
  }

  for (const reminder of reminders) {
    if (!reminder.enabled) continue
    const date = reminder.dueDatetime.slice(0, 10)
    if (date >= weekStart && date <= weekEnd) {
      const start = dayjs(reminder.dueDatetime).format('YYYY-MM-DD HH:mm:ss')
      const end = dayjs(reminder.dueDatetime).add(30, 'minute').format('YYYY-MM-DD HH:mm:ss')
      events.push({
        id: `reminder-${reminder.id}`,
        title: reminder.title,
        start,
        end,
        color: SCHEDULE_REMINDER_COLOR,
        kind: 'reminder',
        sourceId: reminder.id,
        allDay: false
      })
    }
  }

  return events
}

/** True when two timed ranges on the same day overlap. */
export function rangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA
}

/**
 * Returns the set of entry ids that overlap at least one other enabled entry
 * (same weekday for weekly, same date for one-off). Used to surface a warning
 * in the form, not to block saves.
 */
export function findOverlappingEntryIds(entries: ScheduleEntry[]): Set<string> {
  const active = entries.filter((e) => e.enabled)
  const overlaps = new Set<string>()
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i]
      const b = active[j]
      const sameDay =
        a.recurrenceKind === 'weekly' && b.recurrenceKind === 'weekly'
          ? (a.weekdays ?? []).some((d) => (b.weekdays ?? []).includes(d))
          : a.recurrenceKind === 'oneoff' &&
            b.recurrenceKind === 'oneoff' &&
            a.date != null &&
            a.date === b.date
      if (!sameDay) continue
      if (rangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
        overlaps.add(a.id)
        overlaps.add(b.id)
      }
    }
  }
  return overlaps
}
