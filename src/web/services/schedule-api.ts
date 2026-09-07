import type {
  PeriodNotificationPrefs,
  PresetApplyMode,
  PresetSource,
  Reminder,
  ReminderNotificationPrefs,
  ScheduleEntry,
  SchedulePreset,
  SchedulePresetData
} from '@rtwiki/shared/contracts/schedule'

const API_BASE = '/api'

interface ApiError {
  error: string
}

async function parseError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as ApiError
    return new Error(body.error || `Request failed (${res.status})`)
  } catch {
    return new Error(`Request failed (${res.status})`)
  }
}

export interface ScheduleEntryPayload {
  recurrenceKind: 'weekly' | 'oneoff'
  title: string
  weekdays: number[] | null
  date: string | null
  startTime: string
  endTime: string
  linkedPageId: string | null
  category: string | null
  color: string | null
  notes: string | null
  notifications: PeriodNotificationPrefs
}

export interface ReminderPayload {
  title: string
  dueDatetime: string
  linkedPageId: string | null
  message: string | null
  notifications: ReminderNotificationPrefs
}

export async function listEntries(signal?: AbortSignal): Promise<ScheduleEntry[]> {
  const res = await fetch(`${API_BASE}/schedule/entries`, { signal })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { entries: ScheduleEntry[] }
  return data.entries
}

export async function createEntry(
  payload: ScheduleEntryPayload,
  signal?: AbortSignal
): Promise<ScheduleEntry> {
  const res = await fetch(`${API_BASE}/schedule/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { entry: ScheduleEntry }
  return data.entry
}

export async function updateEntry(
  id: string,
  payload: ScheduleEntryPayload,
  signal?: AbortSignal
): Promise<ScheduleEntry> {
  const res = await fetch(`${API_BASE}/schedule/entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { entry: ScheduleEntry }
  return data.entry
}

export async function deleteEntry(id: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_BASE}/schedule/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal
  })
  if (!res.ok) throw await parseError(res)
}

export async function listReminders(signal?: AbortSignal): Promise<Reminder[]> {
  const res = await fetch(`${API_BASE}/schedule/reminders`, { signal })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { reminders: Reminder[] }
  return data.reminders
}

export async function createReminder(
  payload: ReminderPayload,
  signal?: AbortSignal
): Promise<Reminder> {
  const res = await fetch(`${API_BASE}/schedule/reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { reminder: Reminder }
  return data.reminder
}

export async function updateReminder(
  id: string,
  payload: ReminderPayload,
  signal?: AbortSignal
): Promise<Reminder> {
  const res = await fetch(`${API_BASE}/schedule/reminders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { reminder: Reminder }
  return data.reminder
}

export async function deleteReminder(id: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_BASE}/schedule/reminders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal
  })
  if (!res.ok) throw await parseError(res)
}

export async function listPresets(signal?: AbortSignal): Promise<SchedulePreset[]> {
  const res = await fetch(`${API_BASE}/schedule/presets`, { signal })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { presets: SchedulePreset[] }
  return data.presets
}

export async function createPreset(
  name: string,
  data: SchedulePresetData,
  signal?: AbortSignal
): Promise<SchedulePreset> {
  const res = await fetch(`${API_BASE}/schedule/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const result = (await res.json()) as { preset: SchedulePreset }
  return result.preset
}

export async function updatePreset(
  id: string,
  patch: { name?: string; data?: SchedulePresetData },
  signal?: AbortSignal
): Promise<SchedulePreset> {
  const res = await fetch(`${API_BASE}/schedule/presets/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
    signal
  })
  if (!res.ok) throw await parseError(res)
  const data = (await res.json()) as { preset: SchedulePreset }
  return data.preset
}

export async function deletePreset(id: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_BASE}/schedule/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal
  })
  if (!res.ok) throw await parseError(res)
}

export async function applyPreset(
  source: PresetSource,
  mode: PresetApplyMode,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/schedule/presets/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, mode }),
    signal
  })
  if (!res.ok) throw await parseError(res)
}
