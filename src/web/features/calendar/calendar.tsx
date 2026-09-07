import type { MantineColor } from '@mantine/core'
import { ActionIcon, Box, Button, Group, Text, Tooltip } from '@mantine/core'
import { WeekView } from '@mantine/schedule'
import {
  SCHEDULE_DAY_END,
  SCHEDULE_DAY_START,
  SCHEDULE_FIRST_DAY_OF_WEEK
} from '@rtwiki/shared/constants'
import type {
  CalendarEvent,
  PresetApplyMode,
  PresetSource
} from '@rtwiki/shared/contracts/schedule'
import { getWeekEnd, getWeekStart } from '@rtwiki/shared/schedule/calendar'
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPlus,
  IconX
} from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { useScheduleController } from '../../hooks/use-schedule-controller.js'
import type { ReminderPayload, ScheduleEntryPayload } from '../../services/schedule-api.js'
import classes from './calendar.module.css'
import { PresetsPanel } from './presets-panel.js'
import { type FormInitial, ScheduleForm } from './schedule-form.js'
import { TodayAgenda } from './today-agenda.js'

function toScheduleEvent(e: CalendarEvent) {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    color: e.color as MantineColor,
    payload: { kind: e.kind, sourceId: e.sourceId }
  }
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

interface CalendarProps {
  pages: Array<{ id: string; title: string }>
  onClose: () => void
}

export function Calendar({ pages, onClose }: CalendarProps): JSX.Element {
  const controller = useScheduleController()
  const [weekStart, setWeekStart] = useState<string>(() =>
    getWeekStart(todayDateString(), SCHEDULE_FIRST_DAY_OF_WEEK)
  )
  const [formOpen, setFormOpen] = useState(false)
  const [formKind, setFormKind] = useState<'period' | 'reminder'>('period')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formInitial, setFormInitial] = useState<FormInitial | undefined>(undefined)
  const [presetsOpen, setPresetsOpen] = useState(false)

  const weekEnd = getWeekEnd(weekStart)
  const weekLabel = `${dayjs(weekStart).format('MMM D')} – ${dayjs(weekEnd).format('MMM D, YYYY')}`

  const weekEvents = useMemo(
    () => controller.weekEvents(weekStart).map(toScheduleEvent),
    [controller, weekStart]
  )
  const todayEvents = useMemo(() => controller.todayEvents(), [controller])

  const openNew = (kind: 'period' | 'reminder', initial?: FormInitial): void => {
    setFormKind(kind)
    setEditingId(null)
    setFormInitial(initial)
    setFormOpen(true)
  }

  const openEdit = (event: CalendarEvent): void => {
    if (event.kind === 'period') {
      const entry = controller.entries.find((e) => e.id === event.sourceId)
      if (!entry) return
      setFormKind('period')
      setEditingId(entry.id)
      setFormInitial({
        title: entry.title,
        recurrenceKind: entry.recurrenceKind,
        weekdays: entry.weekdays ?? [],
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        category: entry.category,
        color: entry.color,
        linkedPageId: entry.linkedPageId,
        notes: entry.notes,
        notifications: entry.notifications
      })
      setFormOpen(true)
    } else {
      const reminder = controller.reminders.find((r) => r.id === event.sourceId)
      if (!reminder) return
      setFormKind('reminder')
      setEditingId(reminder.id)
      setFormInitial({
        title: reminder.title,
        dueDatetime: reminder.dueDatetime,
        linkedPageId: reminder.linkedPageId,
        message: reminder.message,
        notifications: reminder.notifications
      })
      setFormOpen(true)
    }
  }

  const handleSubmit = (payload: ScheduleEntryPayload | ReminderPayload): void => {
    if (formKind === 'period') {
      if (editingId) {
        void controller.updateEntry(editingId, payload as ScheduleEntryPayload)
      } else {
        void controller.createEntry(payload as ScheduleEntryPayload)
      }
    } else {
      if (editingId) {
        void controller.updateReminder(editingId, payload as ReminderPayload)
      } else {
        void controller.createReminder(payload as ReminderPayload)
      }
    }
    setFormOpen(false)
    setEditingId(null)
  }

  const handleApply = (source: PresetSource, mode: PresetApplyMode): void => {
    void controller.applyPreset(source, mode)
    setPresetsOpen(false)
  }

  const handleSaveAs = (name: string): void => {
    void controller.createPreset(name, controller.currentPresetData())
  }

  return (
    <Box className={classes.root} data-testid="calendar-view">
      <Group justify="space-between" wrap="nowrap" className={classes.header}>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label={UI_TEXT.scheduleToday}>
            <ActionIcon
              variant="subtle"
              onClick={() =>
                setWeekStart(getWeekStart(todayDateString(), SCHEDULE_FIRST_DAY_OF_WEEK))
              }
            >
              <IconCalendarEvent size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={UI_TEXT.schedulePrevWeek}>
            <ActionIcon
              variant="subtle"
              onClick={() => setWeekStart(dayjs(weekStart).subtract(7, 'day').format('YYYY-MM-DD'))}
            >
              <IconChevronLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={UI_TEXT.scheduleNextWeek}>
            <ActionIcon
              variant="subtle"
              onClick={() => setWeekStart(dayjs(weekStart).add(7, 'day').format('YYYY-MM-DD'))}
            >
              <IconChevronRight size={18} />
            </ActionIcon>
          </Tooltip>
          <Text fw={600} visibleFrom="sm">
            {weekLabel}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-sm"
            leftSection={<IconPlus size={14} />}
            onClick={() => openNew('period')}
          >
            {UI_TEXT.scheduleNewPeriod}
          </Button>
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconClock size={14} />}
            onClick={() => openNew('reminder')}
          >
            {UI_TEXT.scheduleNewReminder}
          </Button>
          <Button size="compact-sm" variant="outline" onClick={() => setPresetsOpen(true)}>
            {UI_TEXT.schedulePresets}
          </Button>
          <Tooltip label={UI_TEXT.scheduleClose}>
            <ActionIcon variant="subtle" onClick={onClose} aria-label={UI_TEXT.scheduleClose}>
              <IconX size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {controller.error ? (
        <Text c="red" p="md">
          {controller.error}
        </Text>
      ) : null}

      <Box className={classes.body}>
        <Box className={classes.week}>
          <WeekView
            date={weekStart}
            events={weekEvents}
            startTime={SCHEDULE_DAY_START}
            endTime={SCHEDULE_DAY_END}
            firstDayOfWeek={SCHEDULE_FIRST_DAY_OF_WEEK as 0 | 1 | 2 | 3 | 4 | 5 | 6}
            withCurrentTimeIndicator
            highlightToday
            withDragSlotSelect
            onEventClick={(event) => openEdit(event.payload as CalendarEvent)}
            onTimeSlotClick={({ slotStart, slotEnd }) =>
              openNew('period', {
                date: slotStart.slice(0, 10),
                startTime: slotStart.slice(11, 16),
                endTime: slotEnd.slice(11, 16)
              })
            }
            onSlotDragEnd={(rangeStart, rangeEnd) =>
              openNew('period', {
                date: rangeStart.slice(0, 10),
                startTime: rangeStart.slice(11, 16),
                endTime: rangeEnd.slice(11, 16)
              })
            }
          />
        </Box>
        <Box className={classes.side}>
          <Text size="sm" fw={600} p="xs">
            {UI_TEXT.scheduleAgenda}
          </Text>
          <Box className={classes.agenda}>
            <TodayAgenda events={todayEvents} />
          </Box>
        </Box>
      </Box>

      <ScheduleForm
        opened={formOpen}
        kind={formKind}
        initial={formInitial}
        pages={pages}
        onClose={() => {
          setFormOpen(false)
          setEditingId(null)
        }}
        onSubmit={handleSubmit}
      />

      <PresetsPanel
        opened={presetsOpen}
        presets={controller.presets}
        onClose={() => setPresetsOpen(false)}
        onApply={handleApply}
        onSaveAs={handleSaveAs}
        onDelete={(id) => void controller.deletePreset(id)}
      />
    </Box>
  )
}
