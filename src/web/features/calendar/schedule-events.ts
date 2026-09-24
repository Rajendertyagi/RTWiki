import type { MantineColor } from '@mantine/core'
import type { ScheduleEventData } from '@mantine/schedule'
import { DEFAULT_PERIOD_NOTIFICATIONS } from '@rtwiki/shared/constants'
import type { CalendarEvent, Reminder, ScheduleEntry } from '@rtwiki/shared/contracts/schedule'
import { expandForRange } from '@rtwiki/shared/schedule/calendar'
import type { ReminderPayload, ScheduleEntryPayload } from '../../services/schedule-api.js'

/** A draggable study-block template shown in the left palette. */
export interface PaletteBlock {
  title: string
  durationMin: number
  color: string
}

/** Quick-add blocks the user can drag onto the schedule to create a period. */
export const PALETTE_BLOCKS: PaletteBlock[] = [
  { title: 'Study 1h', durationMin: 60, color: 'blue' },
  { title: 'Lecture 1.5h', durationMin: 90, color: 'indigo' },
  { title: 'Lab 2h', durationMin: 120, color: 'teal' },
  { title: 'Revision 1h', durationMin: 60, color: 'green' },
  { title: 'Break 30m', durationMin: 30, color: 'gray' },
  { title: 'Exam 2h', durationMin: 120, color: 'red' }
]

const PALETTE_MIME = 'application/x-rtwiki-block'

export function setPaletteDragData(e: React.DragEvent<HTMLElement>, block: PaletteBlock): void {
  const json = JSON.stringify(block)
  e.dataTransfer.setData(PALETTE_MIME, json)
  e.dataTransfer.setData('text/plain', json)
  e.dataTransfer.effectAllowed = 'copy'
}

export function readPaletteDragData(dataTransfer: DataTransfer): PaletteBlock | null {
  const raw = dataTransfer.getData(PALETTE_MIME) || dataTransfer.getData('text/plain')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PaletteBlock>
    if (typeof parsed.title === 'string' && typeof parsed.durationMin === 'number') {
      return {
        title: parsed.title,
        durationMin: parsed.durationMin,
        color: typeof parsed.color === 'string' ? parsed.color : 'blue'
      }
    }
  } catch {
    /* ignore malformed payloads */
  }
  return null
}

/** Maps a stored `CalendarEvent` onto Mantine's `ScheduleEventData`. */
export function toScheduleEvent(e: CalendarEvent): ScheduleEventData {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    color: e.color as MantineColor,
    variant: 'light',
    payload: { kind: e.kind, sourceId: e.sourceId }
  }
}

/** Expands entries/reminders across the given range into schedule events. */
export function buildScheduleEvents(
  entries: ScheduleEntry[],
  reminders: Reminder[],
  rangeStart: string,
  rangeEnd: string
): ScheduleEventData[] {
  return expandForRange(entries, reminders, rangeStart, rangeEnd).map(toScheduleEvent)
}

export function entryToPayload(e: ScheduleEntry): ScheduleEntryPayload {
  return {
    recurrenceKind: e.recurrenceKind,
    title: e.title,
    weekdays: e.weekdays,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    linkedPageId: e.linkedPageId,
    category: e.category,
    color: e.color,
    notes: e.notes,
    notifications: e.notifications ?? DEFAULT_PERIOD_NOTIFICATIONS
  }
}

export function reminderToPayload(r: Reminder): ReminderPayload {
  return {
    title: r.title,
    dueDatetime: r.dueDatetime,
    linkedPageId: r.linkedPageId,
    message: r.message,
    notifications: r.notifications
  }
}
