import { ActionIcon, Box, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { Schedule, type ScheduleEventData, type ScheduleViewLevel } from '@mantine/schedule'
import {
  DEFAULT_PERIOD_NOTIFICATIONS,
  SCHEDULE_DAY_END,
  SCHEDULE_DAY_START,
  SCHEDULE_FIRST_DAY_OF_WEEK
} from '@rtwiki/shared/constants'
import type { PresetApplyMode, PresetSource } from '@rtwiki/shared/contracts/schedule'
import { IconClock, IconPlus, IconX } from '@tabler/icons-react'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { useScheduleController } from '../../hooks/use-schedule-controller.js'
import type { ReminderPayload, ScheduleEntryPayload } from '../../services/schedule-api.js'
import classes from './calendar.module.css'
import { PresetsPanel } from './presets-panel.js'
import {
  buildScheduleEvents,
  entryToPayload,
  PALETTE_BLOCKS,
  type PaletteBlock,
  readPaletteDragData,
  reminderToPayload,
  setPaletteDragData
} from './schedule-events.js'
import { type FormInitial, ScheduleForm } from './schedule-form.js'
import { TodayAgenda } from './today-agenda.js'

function PaletteBox({ block }: { block: PaletteBlock }): JSX.Element {
  return (
    <Box
      draggable
      onDragStart={(e) => setPaletteDragData(e, block)}
      className={classes.paletteBox}
      style={{
        backgroundColor: `var(--mantine-color-${block.color}-light)`,
        color: `var(--mantine-color-${block.color}-light-color)`
      }}
      data-testid="palette-block"
    >
      <Group justify="space-between" wrap="nowrap" gap={4}>
        <Text size="sm" fw={500}>
          {block.title}
        </Text>
        <Text size="xs">{block.durationMin}m</Text>
      </Group>
    </Box>
  )
}

interface CalendarProps {
  pages: Array<{ id: string; title: string }>
  onClose: () => void
}

export function Calendar({ pages, onClose }: CalendarProps): JSX.Element {
  const controller = useScheduleController()
  const [date, setDate] = useState<string>(() => dayjs().format('YYYY-MM-DD'))
  const [view, setView] = useState<ScheduleViewLevel>('week')
  const [formOpen, setFormOpen] = useState(false)
  const [formKind, setFormKind] = useState<'period' | 'reminder'>('period')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formInitial, setFormInitial] = useState<FormInitial | undefined>(undefined)
  const [presetsOpen, setPresetsOpen] = useState(false)

  // Expand across the current and next calendar year so Day/Week/Month/Year
  // views all have data without per-view re-expansion.
  const rangeStart = `${dayjs().year()}-01-01`
  const rangeEnd = `${dayjs().year() + 1}-12-31`
  const events = useMemo(
    () => buildScheduleEvents(controller.entries, controller.reminders, rangeStart, rangeEnd),
    [controller.entries, controller.reminders, rangeStart, rangeEnd]
  )
  const todayEvents = useMemo(() => controller.todayEvents(), [controller])

  const openNew = (kind: 'period' | 'reminder', initial?: FormInitial): void => {
    setFormKind(kind)
    setEditingId(null)
    setFormInitial(initial)
    setFormOpen(true)
  }

  const openEdit = (event: ScheduleEventData): void => {
    const payload = event.payload as { kind?: 'period' | 'reminder'; sourceId?: string } | undefined
    const raw = event.recurringInstance?.recurringEventId ?? payload?.sourceId
    if (raw == null) return
    const sourceId = String(raw)
    const kind = event.recurringInstance ? 'period' : payload?.kind
    if (!kind) return

    if (kind === 'period') {
      const entry = controller.entries.find((e) => e.id === sourceId)
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
      const reminder = controller.reminders.find((r) => r.id === sourceId)
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

  const handleEventMove = (newStart: string, newEnd: string, event: ScheduleEventData): void => {
    const payload = event.payload as { kind?: 'period' | 'reminder'; sourceId?: string } | undefined
    const raw = event.recurringInstance?.recurringEventId ?? payload?.sourceId
    if (raw == null) return
    const sourceId = String(raw)
    const kind = event.recurringInstance ? 'period' : payload?.kind
    if (!kind) return

    const start = dayjs(newStart)
    const end = dayjs(newEnd)

    if (kind === 'reminder') {
      const reminder = controller.reminders.find((r) => r.id === sourceId)
      if (!reminder) return
      void controller.updateReminder(sourceId, {
        ...reminderToPayload(reminder),
        dueDatetime: start.format('YYYY-MM-DDTHH:mm')
      })
    } else {
      const entry = controller.entries.find((e) => e.id === sourceId)
      if (!entry) return
      const patch =
        entry.recurrenceKind === 'weekly'
          ? {
              weekdays: [start.day()],
              startTime: start.format('HH:mm'),
              endTime: end.format('HH:mm')
            }
          : {
              date: start.format('YYYY-MM-DD'),
              startTime: start.format('HH:mm'),
              endTime: end.format('HH:mm')
            }
      void controller.updateEntry(sourceId, { ...entryToPayload(entry), ...patch })
    }
  }

  const handleExternalDrop = (dataTransfer: DataTransfer, dropDateTime: string): void => {
    const block = readPaletteDragData(dataTransfer)
    if (!block) return
    const start = dayjs(dropDateTime)
    const end = start.add(block.durationMin, 'minute')
    void controller.createEntry({
      recurrenceKind: 'weekly',
      title: block.title,
      weekdays: [start.day()],
      date: null,
      startTime: start.format('HH:mm'),
      endTime: end.format('HH:mm'),
      linkedPageId: null,
      category: null,
      color: block.color,
      notes: null,
      notifications: DEFAULT_PERIOD_NOTIFICATIONS
    })
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

  const viewProps = {
    startTime: SCHEDULE_DAY_START,
    endTime: SCHEDULE_DAY_END,
    firstDayOfWeek: SCHEDULE_FIRST_DAY_OF_WEEK as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    withCurrentTimeIndicator: true,
    highlightToday: true
  }

  return (
    <Box className={classes.root} data-testid="calendar-view">
      <Group className={classes.toolbar} justify="space-between" wrap="nowrap">
        <Text fw={700}>{UI_TEXT.scheduleTitle}</Text>
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

      <Box className={classes.content}>
        <Box className={classes.mainRow}>
          <Paper className={classes.palette} withBorder>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed">
              {UI_TEXT.scheduleDragHint}
            </Text>
            <Stack gap="xs" mt="xs">
              {PALETTE_BLOCKS.map((block) => (
                <PaletteBox key={block.title} block={block} />
              ))}
            </Stack>
          </Paper>

          <Box className={classes.schedule}>
            <Schedule
              date={date}
              onDateChange={setDate}
              view={view}
              onViewChange={setView}
              defaultView="week"
              events={events}
              withEventsDragAndDrop
              withEventResize
              withDragSlotSelect
              onEventClick={(event) => openEdit(event)}
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
              onDayClick={(clickedDate) =>
                openNew('period', { date: clickedDate, startTime: '09:00', endTime: '10:00' })
              }
              onEventDrop={({ newStart, newEnd, event }) =>
                handleEventMove(newStart, newEnd, event)
              }
              onEventResize={({ newStart, newEnd, event }) =>
                handleEventMove(newStart, newEnd, event)
              }
              onExternalEventDrop={(dataTransfer, dropDateTime) =>
                handleExternalDrop(dataTransfer, dropDateTime)
              }
              dayViewProps={{ ...viewProps, intervalMinutes: 30 }}
              weekViewProps={{ ...viewProps, intervalMinutes: 60 }}
              monthViewProps={{
                firstDayOfWeek: SCHEDULE_FIRST_DAY_OF_WEEK as 0 | 1 | 2 | 3 | 4 | 5 | 6
              }}
              yearViewProps={{
                firstDayOfWeek: SCHEDULE_FIRST_DAY_OF_WEEK as 0 | 1 | 2 | 3 | 4 | 5 | 6
              }}
            />
          </Box>
        </Box>

        <Paper className={classes.todayBar} withBorder>
          <Group justify="space-between" wrap="nowrap" px="xs" py={4}>
            <Text size="sm" fw={600}>
              {UI_TEXT.scheduleAgenda}
            </Text>
          </Group>
          <Box className={classes.todayScroll}>
            <TodayAgenda events={todayEvents} />
          </Box>
        </Paper>
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
