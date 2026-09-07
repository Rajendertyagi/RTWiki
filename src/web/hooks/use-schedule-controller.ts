import {
  DEFAULT_PERIOD_NOTIFICATIONS,
  DEFAULT_REMINDER_NOTIFICATIONS,
  SCHEDULE_FIRST_DAY_OF_WEEK
} from '@rtwiki/shared/constants'
import type {
  CalendarEvent,
  PresetApplyMode,
  PresetSource,
  Reminder,
  ScheduleEntry,
  SchedulePreset,
  SchedulePresetData
} from '@rtwiki/shared/contracts/schedule'
import { expandForWeek, getWeekStart } from '@rtwiki/shared/schedule/calendar'
import { useCallback, useEffect, useState } from 'react'
import * as api from '../services/schedule-api.js'

export interface ScheduleController {
  entries: ScheduleEntry[]
  reminders: Reminder[]
  presets: SchedulePreset[]
  loading: boolean
  error: string | null
  refresh: () => void
  createEntry: (input: api.ScheduleEntryPayload) => Promise<ScheduleEntry | null>
  updateEntry: (id: string, input: api.ScheduleEntryPayload) => Promise<ScheduleEntry | null>
  deleteEntry: (id: string) => Promise<void>
  createReminder: (input: api.ReminderPayload) => Promise<Reminder | null>
  updateReminder: (id: string, input: api.ReminderPayload) => Promise<Reminder | null>
  deleteReminder: (id: string) => Promise<void>
  createPreset: (name: string, data: SchedulePresetData) => Promise<void>
  updatePreset: (id: string, patch: { name?: string; data?: SchedulePresetData }) => Promise<void>
  deletePreset: (id: string) => Promise<void>
  applyPreset: (source: PresetSource, mode: PresetApplyMode) => Promise<void>
  /** Snapshot of the current timetable as preset data (for "Save as preset"). */
  currentPresetData: () => SchedulePresetData
  weekEvents: (weekStart: string) => CalendarEvent[]
  todayEvents: () => CalendarEvent[]
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useScheduleController(): ScheduleController {
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [presets, setPresets] = useState<SchedulePreset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([api.listEntries(), api.listReminders(), api.listPresets()])
      .then(([e, r, p]) => {
        setEntries(e)
        setReminders(r)
        setPresets(p)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const refresh = useCallback(() => loadAll(), [loadAll])

  const createEntry = useCallback(async (input: api.ScheduleEntryPayload) => {
    try {
      const entry = await api.createEntry(input)
      setEntries((prev) => [...prev, entry])
      return entry
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [])

  const updateEntry = useCallback(async (id: string, input: api.ScheduleEntryPayload) => {
    try {
      const entry = await api.updateEntry(id, input)
      setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)))
      return entry
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [])

  const deleteEntry = useCallback(async (id: string) => {
    try {
      await api.deleteEntry(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const createReminder = useCallback(async (input: api.ReminderPayload) => {
    try {
      const reminder = await api.createReminder(input)
      setReminders((prev) => [...prev, reminder])
      return reminder
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [])

  const updateReminder = useCallback(async (id: string, input: api.ReminderPayload) => {
    try {
      const reminder = await api.updateReminder(id, input)
      setReminders((prev) => prev.map((r) => (r.id === id ? reminder : r)))
      return reminder
    } catch (err) {
      setError((err as Error).message)
      return null
    }
  }, [])

  const deleteReminder = useCallback(async (id: string) => {
    try {
      await api.deleteReminder(id)
      setReminders((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const createPreset = useCallback(async (name: string, data: SchedulePresetData) => {
    try {
      const preset = await api.createPreset(name, data)
      setPresets((prev) => [...prev, preset])
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const updatePreset = useCallback(
    async (id: string, patch: { name?: string; data?: SchedulePresetData }) => {
      try {
        const preset = await api.updatePreset(id, patch)
        setPresets((prev) => prev.map((p) => (p.id === id ? preset : p)))
      } catch (err) {
        setError((err as Error).message)
      }
    },
    []
  )

  const deletePreset = useCallback(async (id: string) => {
    try {
      await api.deletePreset(id)
      setPresets((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const applyPreset = useCallback(
    async (source: PresetSource, mode: PresetApplyMode) => {
      try {
        await api.applyPreset(source, mode)
        await loadAll()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [loadAll]
  )

  const currentPresetData = useCallback((): SchedulePresetData => {
    return {
      periods: entries.map((e) => ({
        title: e.title,
        recurrenceKind: e.recurrenceKind,
        weekdays: e.weekdays,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        category: e.category,
        color: e.color,
        notes: e.notes,
        linkedPageId: e.linkedPageId,
        notifications: e.notifications ?? DEFAULT_PERIOD_NOTIFICATIONS
      })),
      reminders: reminders.map((r) => ({
        title: r.title,
        dueDatetime: r.dueDatetime,
        linkedPageId: r.linkedPageId,
        message: r.message,
        notifications: r.notifications ?? DEFAULT_REMINDER_NOTIFICATIONS
      }))
    }
  }, [entries, reminders])

  const weekEvents = useCallback(
    (weekStart: string): CalendarEvent[] => expandForWeek(entries, reminders, weekStart),
    [entries, reminders]
  )

  const todayEvents = useCallback((): CalendarEvent[] => {
    const weekStart = getWeekStart(todayDateString(), SCHEDULE_FIRST_DAY_OF_WEEK)
    return expandForWeek(entries, reminders, weekStart).filter((e) =>
      e.start.startsWith(todayDateString())
    )
  }, [entries, reminders])

  return {
    entries,
    reminders,
    presets,
    loading,
    error,
    refresh,
    createEntry,
    updateEntry,
    deleteEntry,
    createReminder,
    updateReminder,
    deleteReminder,
    createPreset,
    updatePreset,
    deletePreset,
    applyPreset,
    currentPresetData,
    weekEvents,
    todayEvents
  }
}
