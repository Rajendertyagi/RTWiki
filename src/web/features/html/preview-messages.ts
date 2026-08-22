import { z } from 'zod'

/**
 * Contract for messages posted from the sandboxed preview iframe to the
 * parent application.
 *
 * The iframe runs on an opaque origin, so `targetOrigin="*"` is unavoidable;
 * safety therefore rests on three independent checks performed by the parent
 * before any message is acted upon:
 * 1. `event.source === iframe.contentWindow`
 * 2. this strict schema (unknown fields rejected)
 * 3. exact per-preview channel ID equality
 *
 * Messages failing any check are silently ignored — attacker-controlled
 * content is never logged or surfaced.
 */

export const PREVIEW_MESSAGE_TYPES = ['rtwiki-preview-ready', 'rtwiki-preview-error'] as const

/** Channel IDs are 16 random bytes, hex-encoded (32 chars). */
export const CHANNEL_ID_PATTERN = /^[0-9a-f]{32}$/

export const PreviewMessageSchema = z.strictObject({
  type: z.enum(PREVIEW_MESSAGE_TYPES),
  channel: z.string().regex(CHANNEL_ID_PATTERN),
  operation: z.string().max(100).optional(),
  errorName: z.string().max(120).optional()
})

export type PreviewMessage = z.infer<typeof PreviewMessageSchema>

export function isValidPreviewMessage(data: unknown): data is PreviewMessage {
  return PreviewMessageSchema.safeParse(data).success
}
