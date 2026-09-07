export type RecurrenceKind = 'weekly' | 'oneoff'

/** Per-period notification choices. Stored as JSON on each schedule entry. */
export interface PeriodNotificationPrefs {
  enabled: boolean
  /** Fire a notification when the period starts. */
  start: boolean
  /** Fire a notification 5 minutes before the period starts. */
  fiveMinBefore: boolean
  /** Signed minute offsets from the period start (e.g. -5 = 5 min before, +10 = 10 min after). */
  customOffsets: number[]
}

/** Per-reminder notification choices. Stored as JSON on each reminder. */
export interface ReminderNotificationPrefs {
  enabled: boolean
  /** Signed minute offsets from the reminder due time. */
  customOffsets: number[]
}

/** A recurring (weekly) or one-off (dated) study period. */
export interface ScheduleEntry {
  id: string
  recurrenceKind: RecurrenceKind
  title: string
  /** Weekday indices (0=Sun..6=Sat) for weekly periods; null for one-off. */
  weekdays: number[] | null
  /** Date in YYYY-MM-DD for one-off periods; null for weekly. */
  date: string | null
  /** Start time in HH:mm. */
  startTime: string
  /** End time in HH:mm (must be after startTime). */
  endTime: string
  linkedPageId: string | null
  category: string | null
  color: string | null
  notes: string | null
  notifications: PeriodNotificationPrefs
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** A one-off reminder with a specific due date/time. */
export interface Reminder {
  id: string
  title: string
  /** Due date/time in local YYYY-MM-DDTHH:mm. */
  dueDatetime: string
  linkedPageId: string | null
  message: string | null
  notifications: ReminderNotificationPrefs
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** Template period carried inside a preset. */
export interface PeriodTemplate {
  title: string
  recurrenceKind: RecurrenceKind
  weekdays: number[] | null
  date: string | null
  startTime: string
  endTime: string
  category?: string | null
  color?: string | null
  notes?: string | null
  linkedPageId?: string | null
  notifications?: PeriodNotificationPrefs
}

/** Template reminder carried inside a preset. */
export interface ReminderTemplate {
  title: string
  dueDatetime: string
  linkedPageId?: string | null
  message?: string | null
  notifications?: ReminderNotificationPrefs
}

export interface SchedulePresetData {
  periods: PeriodTemplate[]
  reminders: ReminderTemplate[]
}

/** A preset: either a built-in read-only constant or a user-created one. */
export interface SchedulePreset {
  id: string
  name: string
  data: SchedulePresetData
  builtin: boolean
  createdAt: string | null
  updatedAt: string | null
}

/**
 * A flattened, render-ready calendar occurrence. The frontend maps this onto
 * Mantine's `ScheduleEventData`. Generated (not stored) by expanding the
 * recurring/one-off models for a visible range.
 */
export interface CalendarEvent {
  id: string
  title: string
  /** YYYY-MM-DD HH:mm:ss */
  start: string
  /** YYYY-MM-DD HH:mm:ss */
  end: string
  color: string
  kind: 'period' | 'reminder'
  /** Original entry or reminder id. */
  sourceId: string
  allDay: boolean
}

/** How a preset is applied to the current timetable. */
export type PresetApplyMode = 'replace' | 'add'

/** Identifies which preset to apply: a built-in key or a custom preset id. */
export type PresetSource = { type: 'builtin'; key: string } | { type: 'custom'; id: string }
