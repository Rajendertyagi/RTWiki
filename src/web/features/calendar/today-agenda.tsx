import type { MantineColor } from '@mantine/core'
import { Text } from '@mantine/core'
import { AgendaView } from '@mantine/schedule'
import type { CalendarEvent } from '@rtwiki/shared/contracts/schedule'
import dayjs from 'dayjs'
import { UI_TEXT } from '../../config/index.js'

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

/** Vertical list of today's occurrences, rendered with Mantine's AgendaView. */
export function TodayAgenda({ events }: { events: CalendarEvent[] }): JSX.Element {
  const today = dayjs().format('YYYY-MM-DD')
  if (events.length === 0) {
    return (
      <Text size="sm" c="dimmed" p="md">
        {UI_TEXT.scheduleNoItemsToday}
      </Text>
    )
  }
  return <AgendaView rangeStart={today} rangeEnd={today} events={events.map(toScheduleEvent)} />
}
