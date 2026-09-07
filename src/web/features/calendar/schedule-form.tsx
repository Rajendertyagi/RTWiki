import {
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput
} from '@mantine/core'
import { DateInput, DateTimePicker, TimeInput } from '@mantine/dates'
import { SCHEDULE_COLORS } from '@rtwiki/shared/constants'
import type {
  PeriodNotificationPrefs,
  ReminderNotificationPrefs
} from '@rtwiki/shared/contracts/schedule'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import type { ReminderPayload, ScheduleEntryPayload } from '../../services/schedule-api.js'

export interface FormInitial {
  title?: string
  recurrenceKind?: 'weekly' | 'oneoff'
  weekdays?: number[]
  date?: string | null
  startTime?: string
  endTime?: string
  dueDatetime?: string
  category?: string | null
  color?: string | null
  linkedPageId?: string | null
  notes?: string | null
  message?: string | null
  notifications?: PeriodNotificationPrefs | ReminderNotificationPrefs
}

interface ScheduleFormProps {
  opened: boolean
  kind: 'period' | 'reminder'
  initial?: FormInitial
  pages: Array<{ id: string; title: string }>
  onClose: () => void
  onSubmit: (payload: ScheduleEntryPayload | ReminderPayload) => void
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function timeToDate(value: string): Date | null {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

function dateToTime(value: Date | null): string {
  return value ? dayjs(value).format('HH:mm') : ''
}

function dateToYmd(value: Date | null): string | null {
  return value ? dayjs(value).format('YYYY-MM-DD') : null
}

function parseOffsets(text: string): number[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => !Number.isNaN(n))
}

export function ScheduleForm({
  opened,
  kind,
  initial,
  pages,
  onClose,
  onSubmit
}: ScheduleFormProps): JSX.Element {
  const [title, setTitle] = useState('')
  const [recurrenceKind, setRecurrenceKind] = useState<'weekly' | 'oneoff'>('weekly')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [date, setDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState<Date | null>(timeToDate('09:00'))
  const [endTime, setEndTime] = useState<Date | null>(timeToDate('10:00'))
  const [dueDatetime, setDueDatetime] = useState<Date | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [color, setColor] = useState<string | null>(null)
  const [linkedPageId, setLinkedPageId] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [notifEnabled, setNotifEnabled] = useState(true)
  const [notifStart, setNotifStart] = useState(true)
  const [notifFiveMin, setNotifFiveMin] = useState(true)
  const [notifOffsets, setNotifOffsets] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    setTitle(initial?.title ?? '')
    setRecurrenceKind(initial?.recurrenceKind ?? 'weekly')
    setWeekdays(initial?.weekdays ?? [])
    setDate(initial?.date ? new Date(`${initial.date}T00:00:00`) : null)
    setStartTime(timeToDate(initial?.startTime ?? '09:00'))
    setEndTime(timeToDate(initial?.endTime ?? '10:00'))
    setDueDatetime(initial?.dueDatetime ? new Date(initial.dueDatetime) : null)
    setCategory(initial?.category ?? null)
    setColor(initial?.color ?? null)
    setLinkedPageId(initial?.linkedPageId ?? null)
    setNotes(initial?.notes ?? null)
    setMessage(initial?.message ?? null)
    const prefs = initial?.notifications
    setNotifEnabled(prefs?.enabled ?? true)
    setNotifStart((prefs as PeriodNotificationPrefs | undefined)?.start ?? true)
    setNotifFiveMin((prefs as PeriodNotificationPrefs | undefined)?.fiveMinBefore ?? true)
    setNotifOffsets(((prefs?.customOffsets as number[] | undefined) ?? []).join(', '))
    setError(null)
  }, [opened, initial])

  const pageOptions = pages.map((p) => ({ value: p.id, label: p.title }))
  const colorOptions = SCHEDULE_COLORS.map((c) => ({ value: c, label: c }))

  const handleSubmit = (): void => {
    if (!title.trim()) {
      setError(UI_TEXT.scheduleTitleRequired)
      return
    }
    const start = dateToTime(startTime)
    const end = dateToTime(endTime)
    const offsets = parseOffsets(notifOffsets)

    if (kind === 'period') {
      if (recurrenceKind === 'weekly' && weekdays.length === 0) {
        setError(UI_TEXT.scheduleWeekdaysRequired)
        return
      }
      if (recurrenceKind === 'oneoff' && !date) {
        setError(UI_TEXT.scheduleDateRequired)
        return
      }
      if (start && end && start >= end) {
        setError(UI_TEXT.scheduleEndAfterStart)
        return
      }
      const payload: ScheduleEntryPayload = {
        recurrenceKind,
        title: title.trim(),
        weekdays: recurrenceKind === 'weekly' ? weekdays : null,
        date: recurrenceKind === 'oneoff' ? dateToYmd(date) : null,
        startTime: start,
        endTime: end,
        linkedPageId,
        category,
        color,
        notes,
        notifications: {
          enabled: notifEnabled,
          start: notifStart,
          fiveMinBefore: notifFiveMin,
          customOffsets: offsets
        }
      }
      onSubmit(payload)
    } else {
      if (!dueDatetime) {
        setError(UI_TEXT.scheduleDueRequired)
        return
      }
      const payload: ReminderPayload = {
        title: title.trim(),
        dueDatetime: dayjs(dueDatetime).format('YYYY-MM-DDTHH:mm'),
        linkedPageId,
        message,
        notifications: { enabled: notifEnabled, customOffsets: offsets }
      }
      onSubmit(payload)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={kind === 'period' ? UI_TEXT.schedulePeriod : UI_TEXT.scheduleReminder}
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          label={UI_TEXT.titleLabel}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          error={error}
          data-testid="schedule-form-title"
        />

        {kind === 'period' ? (
          <>
            <SegmentedControl
              value={recurrenceKind}
              onChange={(v) => setRecurrenceKind(v as 'weekly' | 'oneoff')}
              data={[
                { value: 'weekly', label: UI_TEXT.scheduleWeekly },
                { value: 'oneoff', label: UI_TEXT.scheduleOneOff }
              ]}
              fullWidth
            />
            {recurrenceKind === 'weekly' ? (
              <Group gap="xs">
                {WEEKDAY_ORDER.map((d, i) => (
                  <Checkbox
                    key={d}
                    label={WEEKDAY_LABELS[i]}
                    checked={weekdays.includes(d)}
                    onChange={(e) =>
                      setWeekdays((prev) =>
                        e.currentTarget.checked ? [...prev, d] : prev.filter((x) => x !== d)
                      )
                    }
                  />
                ))}
              </Group>
            ) : (
              <DateInput
                label={UI_TEXT.scheduleDate}
                value={date}
                onChange={(value) => setDate(value ? new Date(`${value}T00:00:00`) : null)}
                valueFormat="YYYY-MM-DD"
              />
            )}
            <Group grow>
              <TimeInput
                label={UI_TEXT.scheduleStartTime}
                value={dateToTime(startTime)}
                onChange={(e) => setStartTime(timeToDate(e.currentTarget.value))}
              />
              <TimeInput
                label={UI_TEXT.scheduleEndTime}
                value={dateToTime(endTime)}
                onChange={(e) => setEndTime(timeToDate(e.currentTarget.value))}
              />
            </Group>
            <Group grow>
              <TextInput
                label={UI_TEXT.scheduleCategory}
                value={category ?? ''}
                onChange={(e) => setCategory(e.currentTarget.value || null)}
              />
              <Select
                label={UI_TEXT.scheduleColor}
                data={colorOptions}
                value={color}
                onChange={setColor}
                clearable
                placeholder={UI_TEXT.scheduleColorAuto}
              />
            </Group>
            <Textarea
              label={UI_TEXT.scheduleNotes}
              value={notes ?? ''}
              onChange={(e) => setNotes(e.currentTarget.value || null)}
              autosize
              minRows={2}
            />
          </>
        ) : (
          <>
            <DateTimePicker
              label={UI_TEXT.scheduleDue}
              value={dueDatetime}
              onChange={(value) => setDueDatetime(value ? new Date(value) : null)}
              valueFormat="YYYY-MM-DD HH:mm"
            />
            <Textarea
              label={UI_TEXT.scheduleMessage}
              value={message ?? ''}
              onChange={(e) => setMessage(e.currentTarget.value || null)}
              autosize
              minRows={2}
            />
          </>
        )}

        <Select
          label={UI_TEXT.linkedPageLabel}
          data={pageOptions}
          value={linkedPageId}
          onChange={setLinkedPageId}
          clearable
          searchable
          placeholder={UI_TEXT.scheduleNoLink}
        />

        <Divider label={UI_TEXT.scheduleNotifications} labelPosition="center" />
        <Switch
          label={UI_TEXT.scheduleNotifyEnabled}
          checked={notifEnabled}
          onChange={(e) => setNotifEnabled(e.currentTarget.checked)}
        />
        {kind === 'period' && notifEnabled ? (
          <Group gap="lg">
            <Switch
              label={UI_TEXT.scheduleNotifyStart}
              checked={notifStart}
              onChange={(e) => setNotifStart(e.currentTarget.checked)}
            />
            <Switch
              label={UI_TEXT.scheduleNotifyFiveMin}
              checked={notifFiveMin}
              onChange={(e) => setNotifFiveMin(e.currentTarget.checked)}
            />
          </Group>
        ) : null}
        <TextInput
          label={UI_TEXT.scheduleNotifyOffsets}
          description={UI_TEXT.scheduleNotifyOffsetsHint}
          value={notifOffsets}
          onChange={(e) => setNotifOffsets(e.currentTarget.value)}
        />

        {error ? (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        ) : null}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            {UI_TEXT.cancelButton}
          </Button>
          <Button onClick={handleSubmit} data-testid="schedule-form-submit">
            {UI_TEXT.saveButton}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
