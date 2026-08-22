import { z } from 'zod'

/**
 * Closed set of safe frontend event names. Anything outside this enum is
 * rejected — the endpoint never accepts arbitrary event labels or context.
 */
export const CLIENT_ERROR_EVENTS = [
  'react_error_boundary',
  'window_error',
  'unhandled_rejection',
  'rich_note_parse_error',
  'rich_note_save_error',
  'rich_note_init_error'
] as const

export const CLIENT_ERROR_PAGE_TYPES = ['rich', 'html', 'dashboard', 'unknown'] as const

/**
 * Sanitized frontend error report. Every field is bounded and content-free by
 * contract: callers must send canned messages for known failures and a
 * reduced top-frame stack location, never page titles, document JSON, or
 * tokens. Unknown fields are stripped by Zod's default behaviour.
 */
export const ClientErrorSchema = z.object({
  event: z.enum(CLIENT_ERROR_EVENTS),
  pageType: z.enum(CLIENT_ERROR_PAGE_TYPES).default('unknown'),
  component: z.string().max(100).optional(),
  errorName: z.string().max(120).optional(),
  errorMessage: z.string().max(300).optional(),
  stackLocation: z.string().max(200).optional(),
  correlationId: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'correlationId must be alphanumeric or dashes'),
  clientTimestamp: z.string().datetime().optional()
})

export type ClientErrorReport = z.infer<typeof ClientErrorSchema>
