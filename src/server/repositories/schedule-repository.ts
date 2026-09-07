import type { Database, SQLQueryBindings } from 'bun:sqlite'
import type {
  Reminder,
  ScheduleEntry,
  SchedulePreset,
  SchedulePresetData
} from '@rtwiki/shared/contracts/schedule'

function parseNotifications<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const DEFAULT_PERIOD_NOTIFICATIONS = {
  enabled: true,
  start: true,
  fiveMinBefore: true,
  customOffsets: [] as number[]
}
const DEFAULT_REMINDER_NOTIFICATIONS = { enabled: true, customOffsets: [] as number[] }

function rowToEntry(row: Record<string, unknown>): ScheduleEntry {
  return {
    id: row.id as string,
    recurrenceKind: row.recurrence_kind as ScheduleEntry['recurrenceKind'],
    title: row.title as string,
    weekdays: row.weekdays ? (JSON.parse(row.weekdays as string) as number[]) : null,
    date: (row.date as string) || null,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    linkedPageId: (row.linked_page_id as string) || null,
    category: (row.category as string) || null,
    color: (row.color as string) || null,
    notes: (row.notes as string) || null,
    notifications: parseNotifications(row.notifications as string, DEFAULT_PERIOD_NOTIFICATIONS),
    enabled: Number(row.enabled ?? 1) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function rowToReminder(row: Record<string, unknown>): Reminder {
  return {
    id: row.id as string,
    title: row.title as string,
    dueDatetime: row.due_datetime as string,
    linkedPageId: (row.linked_page_id as string) || null,
    message: (row.message as string) || null,
    notifications: parseNotifications(row.notifications as string, DEFAULT_REMINDER_NOTIFICATIONS),
    enabled: Number(row.enabled ?? 1) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

function rowToPreset(row: Record<string, unknown>): SchedulePreset {
  return {
    id: row.id as string,
    name: row.name as string,
    data: parseNotifications<SchedulePresetData>(row.data as string, {
      periods: [],
      reminders: []
    }),
    builtin: false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listScheduleEntries(db: Database): ScheduleEntry[] {
  return (
    db
      .query(
        'SELECT id, recurrence_kind, title, weekdays, date, start_time, end_time, linked_page_id, category, color, notes, notifications, enabled, created_at, updated_at FROM schedule_entries'
      )
      .all() as Array<Record<string, unknown>>
  ).map(rowToEntry)
}

export function getScheduleEntry(db: Database, id: string): ScheduleEntry | null {
  const row = db
    .query(
      'SELECT id, recurrence_kind, title, weekdays, date, start_time, end_time, linked_page_id, category, color, notes, notifications, enabled, created_at, updated_at FROM schedule_entries WHERE id = ?'
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToEntry(row) : null
}

export function insertScheduleEntry(db: Database, entry: ScheduleEntry): void {
  db.run(
    'INSERT INTO schedule_entries (id, recurrence_kind, title, weekdays, date, start_time, end_time, linked_page_id, category, color, notes, notifications, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      entry.id,
      entry.recurrenceKind,
      entry.title,
      entry.weekdays ? JSON.stringify(entry.weekdays) : null,
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.linkedPageId,
      entry.category,
      entry.color,
      entry.notes,
      JSON.stringify(entry.notifications),
      entry.enabled ? 1 : 0,
      entry.createdAt,
      entry.updatedAt
    ]
  )
}

export function updateScheduleEntry(
  db: Database,
  id: string,
  entry: ScheduleEntry
): ScheduleEntry | null {
  const existing = getScheduleEntry(db, id)
  if (!existing) return null
  db.run(
    'UPDATE schedule_entries SET recurrence_kind = ?, title = ?, weekdays = ?, date = ?, start_time = ?, end_time = ?, linked_page_id = ?, category = ?, color = ?, notes = ?, notifications = ?, enabled = ?, updated_at = ? WHERE id = ?',
    [
      entry.recurrenceKind,
      entry.title,
      entry.weekdays ? JSON.stringify(entry.weekdays) : null,
      entry.date,
      entry.startTime,
      entry.endTime,
      entry.linkedPageId,
      entry.category,
      entry.color,
      entry.notes,
      JSON.stringify(entry.notifications),
      entry.enabled ? 1 : 0,
      entry.updatedAt,
      id
    ]
  )
  return getScheduleEntry(db, id)
}

export function deleteScheduleEntry(db: Database, id: string): boolean {
  const result = db.run('DELETE FROM schedule_entries WHERE id = ?', [id])
  return result.changes > 0
}

export function deleteAllScheduleEntries(db: Database): void {
  db.run('DELETE FROM schedule_entries')
}

export function bulkInsertScheduleEntries(db: Database, entries: ScheduleEntry[]): void {
  const stmt = db.query(
    'INSERT INTO schedule_entries (id, recurrence_kind, title, weekdays, date, start_time, end_time, linked_page_id, category, color, notes, notifications, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const entry of entries) {
    stmt.run(
      ...([
        entry.id,
        entry.recurrenceKind,
        entry.title,
        entry.weekdays ? JSON.stringify(entry.weekdays) : null,
        entry.date,
        entry.startTime,
        entry.endTime,
        entry.linkedPageId,
        entry.category,
        entry.color,
        entry.notes,
        JSON.stringify(entry.notifications),
        entry.enabled ? 1 : 0,
        entry.createdAt,
        entry.updatedAt
      ] as SQLQueryBindings[])
    )
  }
}

export function listReminders(db: Database): Reminder[] {
  return (
    db
      .query(
        'SELECT id, title, due_datetime, linked_page_id, message, notifications, enabled, created_at, updated_at FROM reminders'
      )
      .all() as Array<Record<string, unknown>>
  ).map(rowToReminder)
}

export function getReminder(db: Database, id: string): Reminder | null {
  const row = db
    .query(
      'SELECT id, title, due_datetime, linked_page_id, message, notifications, enabled, created_at, updated_at FROM reminders WHERE id = ?'
    )
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToReminder(row) : null
}

export function insertReminder(db: Database, reminder: Reminder): void {
  db.run(
    'INSERT INTO reminders (id, title, due_datetime, linked_page_id, message, notifications, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      reminder.id,
      reminder.title,
      reminder.dueDatetime,
      reminder.linkedPageId,
      reminder.message,
      JSON.stringify(reminder.notifications),
      reminder.enabled ? 1 : 0,
      reminder.createdAt,
      reminder.updatedAt
    ]
  )
}

export function updateReminder(db: Database, id: string, reminder: Reminder): Reminder | null {
  const existing = getReminder(db, id)
  if (!existing) return null
  db.run(
    'UPDATE reminders SET title = ?, due_datetime = ?, linked_page_id = ?, message = ?, notifications = ?, enabled = ?, updated_at = ? WHERE id = ?',
    [
      reminder.title,
      reminder.dueDatetime,
      reminder.linkedPageId,
      reminder.message,
      JSON.stringify(reminder.notifications),
      reminder.enabled ? 1 : 0,
      reminder.updatedAt,
      id
    ]
  )
  return getReminder(db, id)
}

export function deleteReminder(db: Database, id: string): boolean {
  const result = db.run('DELETE FROM reminders WHERE id = ?', [id])
  return result.changes > 0
}

export function deleteAllReminders(db: Database): void {
  db.run('DELETE FROM reminders')
}

export function bulkInsertReminders(db: Database, reminders: Reminder[]): void {
  const stmt = db.query(
    'INSERT INTO reminders (id, title, due_datetime, linked_page_id, message, notifications, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  for (const reminder of reminders) {
    stmt.run(
      ...([
        reminder.id,
        reminder.title,
        reminder.dueDatetime,
        reminder.linkedPageId,
        reminder.message,
        JSON.stringify(reminder.notifications),
        reminder.enabled ? 1 : 0,
        reminder.createdAt,
        reminder.updatedAt
      ] as SQLQueryBindings[])
    )
  }
}

export function listCustomPresets(db: Database): SchedulePreset[] {
  return (
    db.query('SELECT id, name, data, created_at, updated_at FROM schedule_presets').all() as Array<
      Record<string, unknown>
    >
  ).map(rowToPreset)
}

export function getCustomPreset(db: Database, id: string): SchedulePreset | null {
  const row = db
    .query('SELECT id, name, data, created_at, updated_at FROM schedule_presets WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToPreset(row) : null
}

export function insertCustomPreset(db: Database, preset: SchedulePreset): void {
  db.run(
    'INSERT INTO schedule_presets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [preset.id, preset.name, JSON.stringify(preset.data), preset.createdAt, preset.updatedAt]
  )
}

export function updateCustomPreset(
  db: Database,
  id: string,
  preset: SchedulePreset
): SchedulePreset | null {
  const existing = getCustomPreset(db, id)
  if (!existing) return null
  db.run('UPDATE schedule_presets SET name = ?, data = ?, updated_at = ? WHERE id = ?', [
    preset.name,
    JSON.stringify(preset.data),
    preset.updatedAt,
    id
  ])
  return getCustomPreset(db, id)
}

export function deleteCustomPreset(db: Database, id: string): boolean {
  const result = db.run('DELETE FROM schedule_presets WHERE id = ?', [id])
  return result.changes > 0
}
