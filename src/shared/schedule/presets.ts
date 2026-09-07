import { DEFAULT_PERIOD_NOTIFICATIONS } from '../constants/index.js'
import type { SchedulePreset } from '../contracts/schedule.js'

/**
 * Read-only built-in presets. These are application constants, never stored in
 * the database, and cannot be edited or deleted by the user. Custom presets
 * (persisted via the API) are merged with these for display.
 */
export const BUILTIN_PRESETS: SchedulePreset[] = [
  {
    id: 'builtin:blank',
    name: 'Blank timetable',
    builtin: true,
    createdAt: null,
    updatedAt: null,
    data: { periods: [], reminders: [] }
  },
  {
    id: 'builtin:school',
    name: 'School study week',
    builtin: true,
    createdAt: null,
    updatedAt: null,
    data: {
      periods: [
        {
          title: 'Mathematics',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5],
          date: null,
          startTime: '09:00',
          endTime: '10:00',
          category: 'Subject',
          color: 'blue',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        },
        {
          title: 'English',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5],
          date: null,
          startTime: '10:00',
          endTime: '11:00',
          category: 'Subject',
          color: 'grape',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        },
        {
          title: 'Science',
          recurrenceKind: 'weekly',
          weekdays: [1, 3, 5],
          date: null,
          startTime: '11:00',
          endTime: '12:00',
          category: 'Subject',
          color: 'teal',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        },
        {
          title: 'Revision',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5],
          date: null,
          startTime: '16:00',
          endTime: '17:30',
          category: 'Revision',
          color: 'orange',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        }
      ],
      reminders: []
    }
  },
  {
    id: 'builtin:exam',
    name: 'Exam revision week',
    builtin: true,
    createdAt: null,
    updatedAt: null,
    data: {
      periods: [
        {
          title: 'Morning revision',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5, 6],
          date: null,
          startTime: '08:00',
          endTime: '10:00',
          category: 'Revision',
          color: 'violet',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        },
        {
          title: 'Practice papers',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5, 6],
          date: null,
          startTime: '10:30',
          endTime: '12:30',
          category: 'Practice',
          color: 'indigo',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        },
        {
          title: 'Evening review',
          recurrenceKind: 'weekly',
          weekdays: [1, 2, 3, 4, 5, 6],
          date: null,
          startTime: '18:00',
          endTime: '19:30',
          category: 'Review',
          color: 'cyan',
          notifications: DEFAULT_PERIOD_NOTIFICATIONS
        }
      ],
      reminders: []
    }
  }
]

export function getBuiltinPreset(key: string): SchedulePreset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === key)
}
