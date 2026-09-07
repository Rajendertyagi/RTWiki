import type { Database } from 'bun:sqlite'
import {
  DEFAULT_PERIOD_NOTIFICATIONS,
  DEFAULT_REMINDER_NOTIFICATIONS
} from '@rtwiki/shared/constants'
import type {
  PeriodNotificationPrefs,
  PresetApplyMode,
  PresetSource,
  Reminder,
  ReminderNotificationPrefs,
  ReminderTemplate,
  ScheduleEntry,
  SchedulePreset,
  SchedulePresetData
} from '@rtwiki/shared/contracts/schedule'
import { BUILTIN_PRESETS, getBuiltinPreset } from '@rtwiki/shared/schedule/presets'
import type { ReminderInput, ScheduleEntryInput } from '@rtwiki/shared/schemas/schedule'
import * as repo from '../repositories/schedule-repository.js'

/** Raised when submitted schedule data violates the canonical rules. */
export class ScheduleValidationError extends Error {}

function nowIso(): string {
  return new Date().toISOString()
}

function toEntry(input: ScheduleEntryInput, id: string, createdAt: string): ScheduleEntry {
  return {
    id,
    recurrenceKind: input.recurrenceKind,
    title: input.title,
    weekdays: input.weekdays ?? null,
    date: input.date ?? null,
    startTime: input.startTime,
    endTime: input.endTime,
    linkedPageId: input.linkedPageId ?? null,
    category: input.category ?? null,
    color: input.color ?? null,
    notes: input.notes ?? null,
    notifications: input.notifications ?? DEFAULT_PERIOD_NOTIFICATIONS,
    enabled: true,
    createdAt,
    updatedAt: createdAt
  }
}

function toReminder(input: ReminderInput, id: string, createdAt: string): Reminder {
  return {
    id,
    title: input.title,
    dueDatetime: input.dueDatetime,
    linkedPageId: input.linkedPageId ?? null,
    message: input.message ?? null,
    notifications: input.notifications ?? DEFAULT_REMINDER_NOTIFICATIONS,
    enabled: true,
    createdAt,
    updatedAt: createdAt
  }
}

// ---------------- Entries ----------------

export function listScheduleEntries(db: Database): ScheduleEntry[] {
  return repo.listScheduleEntries(db)
}

export function createScheduleEntry(db: Database, input: ScheduleEntryInput): ScheduleEntry {
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  const entry = toEntry(input, id, createdAt)
  repo.insertScheduleEntry(db, entry)
  return entry
}

export function updateScheduleEntry(
  db: Database,
  id: string,
  input: ScheduleEntryInput
): ScheduleEntry | null {
  const existing = repo.getScheduleEntry(db, id)
  if (!existing) return null
  const entry: ScheduleEntry = { ...toEntry(input, id, existing.createdAt), updatedAt: nowIso() }
  return repo.updateScheduleEntry(db, id, entry)
}

export function deleteScheduleEntry(db: Database, id: string): boolean {
  return repo.deleteScheduleEntry(db, id)
}

// ---------------- Reminders ----------------

export function listReminders(db: Database): Reminder[] {
  return repo.listReminders(db)
}

export function createReminder(db: Database, input: ReminderInput): Reminder {
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  const reminder = toReminder(input, id, createdAt)
  repo.insertReminder(db, reminder)
  return reminder
}

export function updateReminder(db: Database, id: string, input: ReminderInput): Reminder | null {
  const existing = repo.getReminder(db, id)
  if (!existing) return null
  const reminder: Reminder = { ...toReminder(input, id, existing.createdAt), updatedAt: nowIso() }
  return repo.updateReminder(db, id, reminder)
}

export function deleteReminder(db: Database, id: string): boolean {
  return repo.deleteReminder(db, id)
}

// ---------------- Presets ----------------

export function listPresets(db: Database): SchedulePreset[] {
  return [...BUILTIN_PRESETS, ...repo.listCustomPresets(db)]
}

export function createPreset(db: Database, name: string, data: SchedulePresetData): SchedulePreset {
  const id = crypto.randomUUID()
  const createdAt = nowIso()
  const preset: SchedulePreset = {
    id,
    name,
    data,
    builtin: false,
    createdAt,
    updatedAt: createdAt
  }
  repo.insertCustomPreset(db, preset)
  return preset
}

export function updatePreset(
  db: Database,
  id: string,
  patch: { name?: string; data?: SchedulePresetData }
): SchedulePreset | null {
  const existing = repo.getCustomPreset(db, id)
  if (!existing) return null
  const preset: SchedulePreset = {
    ...existing,
    name: patch.name ?? existing.name,
    data: patch.data ?? existing.data,
    updatedAt: nowIso()
  }
  return repo.updateCustomPreset(db, id, preset)
}

export function deletePreset(db: Database, id: string): boolean {
  return repo.deleteCustomPreset(db, id)
}

function resolvePresetData(db: Database, source: PresetSource): SchedulePresetData {
  if (source.type === 'builtin') {
    const preset = getBuiltinPreset(source.key)
    if (!preset) {
      throw new ScheduleValidationError(`Unknown built-in preset: ${source.key}`)
    }
    return preset.data
  }
  const preset = repo.getCustomPreset(db, source.id)
  if (!preset) {
    throw new ScheduleValidationError(`Preset not found: ${source.id}`)
  }
  return preset.data
}

function templateToEntry(
  template: SchedulePresetData['periods'][number],
  createdAt: string
): ScheduleEntry {
  const notifications: PeriodNotificationPrefs =
    template.notifications ?? DEFAULT_PERIOD_NOTIFICATIONS
  return {
    id: crypto.randomUUID(),
    recurrenceKind: template.recurrenceKind,
    title: template.title,
    weekdays: template.weekdays ?? null,
    date: template.date ?? null,
    startTime: template.startTime,
    endTime: template.endTime,
    linkedPageId: template.linkedPageId ?? null,
    category: template.category ?? null,
    color: template.color ?? null,
    notes: template.notes ?? null,
    notifications,
    enabled: true,
    createdAt,
    updatedAt: createdAt
  }
}

function templateToReminder(template: ReminderTemplate, createdAt: string): Reminder {
  const notifications: ReminderNotificationPrefs =
    template.notifications ?? DEFAULT_REMINDER_NOTIFICATIONS
  return {
    id: crypto.randomUUID(),
    title: template.title,
    dueDatetime: template.dueDatetime,
    linkedPageId: template.linkedPageId ?? null,
    message: template.message ?? null,
    notifications,
    enabled: true,
    createdAt,
    updatedAt: createdAt
  }
}

/**
 * Applies a preset to the current timetable. `replace` clears existing
 * entries/reminders first; `add` inserts the preset alongside them. Runs inside
 * a single transaction so a failure leaves the timetable untouched.
 */
export function applyPreset(db: Database, source: PresetSource, mode: PresetApplyMode): void {
  const data = resolvePresetData(db, source)
  const createdAt = nowIso()
  const entries = data.periods.map((p) => templateToEntry(p, createdAt))
  const reminders = data.reminders.map((r) => templateToReminder(r, createdAt))

  db.run('BEGIN IMMEDIATE')
  try {
    if (mode === 'replace') {
      repo.deleteAllScheduleEntries(db)
      repo.deleteAllReminders(db)
    }
    repo.bulkInsertScheduleEntries(db, entries)
    repo.bulkInsertReminders(db, reminders)
    db.run('COMMIT')
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}
