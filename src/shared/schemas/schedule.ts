import { z } from 'zod'
import {
  DEFAULT_PERIOD_NOTIFICATIONS,
  DEFAULT_REMINDER_NOTIFICATIONS,
  SCHEDULE_COLORS
} from '../constants/index.js'

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time in HH:mm format')

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')

const dateTimeString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/,
    'Expected a date/time in YYYY-MM-DDTHH:mm format'
  )

const colorSchema = z.enum(SCHEDULE_COLORS as unknown as [string, ...string[]])

export const periodNotificationPrefsSchema = z.object({
  enabled: z.boolean(),
  start: z.boolean(),
  fiveMinBefore: z.boolean(),
  customOffsets: z.array(z.number().int())
})

export const reminderNotificationPrefsSchema = z.object({
  enabled: z.boolean(),
  customOffsets: z.array(z.number().int())
})

/**
 * Shared shape for creating or fully replacing a schedule entry. The UI always
 * sends the complete object, so the same schema serves create and update.
 */
export const scheduleEntrySchema = z
  .object({
    recurrenceKind: z.enum(['weekly', 'oneoff']),
    title: z.string().min(1, 'Title is required').max(200),
    weekdays: z.array(z.number().int().min(0).max(6)).nullable().default(null),
    date: dateString.nullable().default(null),
    startTime: timeString,
    endTime: timeString,
    linkedPageId: z.string().uuid().nullable().default(null),
    category: z.string().max(80).nullable().default(null),
    color: colorSchema.nullable().default(null),
    notes: z.string().nullable().default(null),
    notifications: periodNotificationPrefsSchema.default(DEFAULT_PERIOD_NOTIFICATIONS)
  })
  .superRefine((value, ctx) => {
    if (value.recurrenceKind === 'weekly') {
      if (!Array.isArray(value.weekdays) || value.weekdays.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Weekly periods need at least one weekday',
          path: ['weekdays']
        })
      }
      if (value.date !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Weekly periods must not set a date',
          path: ['date']
        })
      }
    } else {
      if (!value.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'One-off periods need a date',
          path: ['date']
        })
      }
      if (value.weekdays !== null && value.weekdays.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'One-off periods must not set weekdays',
          path: ['weekdays']
        })
      }
    }
    if (value.startTime >= value.endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'End time must be after start time',
        path: ['endTime']
      })
    }
  })

export type ScheduleEntryInput = z.infer<typeof scheduleEntrySchema>

export const reminderSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  dueDatetime: dateTimeString,
  linkedPageId: z.string().uuid().nullable().default(null),
  message: z.string().nullable().default(null),
  notifications: reminderNotificationPrefsSchema.default(DEFAULT_REMINDER_NOTIFICATIONS)
})

export type ReminderInput = z.infer<typeof reminderSchema>

export const periodTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  recurrenceKind: z.enum(['weekly', 'oneoff']),
  weekdays: z.array(z.number().int().min(0).max(6)).nullable().default(null),
  date: dateString.nullable().default(null),
  startTime: timeString,
  endTime: timeString,
  category: z.string().max(80).nullable().default(null),
  color: colorSchema.nullable().default(null),
  notes: z.string().nullable().default(null),
  linkedPageId: z.string().uuid().nullable().default(null),
  notifications: periodNotificationPrefsSchema.default(DEFAULT_PERIOD_NOTIFICATIONS)
})

export const reminderTemplateSchema = z.object({
  title: z.string().min(1).max(200),
  dueDatetime: dateTimeString,
  linkedPageId: z.string().uuid().nullable().default(null),
  message: z.string().nullable().default(null),
  notifications: reminderNotificationPrefsSchema.default(DEFAULT_REMINDER_NOTIFICATIONS)
})

export const schedulePresetDataSchema = z.object({
  periods: z.array(periodTemplateSchema),
  reminders: z.array(reminderTemplateSchema)
})

export const createPresetSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  data: schedulePresetDataSchema
})

export type CreatePresetInput = z.infer<typeof createPresetSchema>

export const updatePresetSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  data: schedulePresetDataSchema.optional()
})

export type UpdatePresetInput = z.infer<typeof updatePresetSchema>

export const applyPresetSchema = z.object({
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('builtin'), key: z.string() }),
    z.object({ type: z.literal('custom'), id: z.string().uuid() })
  ]),
  mode: z.enum(['replace', 'add'])
})

export type ApplyPresetInput = z.infer<typeof applyPresetSchema>
