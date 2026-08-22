import { z } from 'zod'

/**
 * Canonical HTML-page content — the single source of truth shared by the
 * frontend and the server. Stored in `pages.content` as the JSON
 * serialization of this schema whenever `page_type` is `html`.
 *
 * Rich Note pages are unaffected: they continue to store canonical BlockNote
 * JSON (see ADR-004). This schema exists so both sides validate one format
 * definition; there is deliberately no duplicate frontend/server copy.
 */

export const HTML_CONTENT_VERSION = 1 as const

/**
 * Provisional centralized limits (owner-approved 2026-08-22):
 * - HTML 2 MiB: far beyond any study-note document.
 * - CSS/JS 512 KiB each: orders of magnitude beyond legitimate custom
 *   styling/scripting while keeping SQLite rows healthy.
 * Limits count UTF-8 bytes, not UTF-16 code units, so multi-byte characters
 * cannot smuggle oversized payloads past validation.
 */
export const MAX_HTML_BYTES = 2 * 1024 * 1024
export const MAX_CSS_BYTES = 512 * 1024
export const MAX_JAVASCRIPT_BYTES = 512 * 1024

const textEncoder = new TextEncoder()

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

function byteBoundedString(maxBytes: number, field: string) {
  return z.string().refine((value) => utf8ByteLength(value) <= maxBytes, {
    message: `${field} exceeds the maximum of ${maxBytes} UTF-8 bytes`
  })
}

/**
 * `strictObject` rejects unknown keys instead of stripping them: stored page
 * content must be exactly the canonical shape, so silent key loss can never
 * masquerade as a successful save.
 */
export const HtmlContentSchema = z.strictObject({
  version: z.literal(HTML_CONTENT_VERSION),
  html: byteBoundedString(MAX_HTML_BYTES, 'html'),
  css: byteBoundedString(MAX_CSS_BYTES, 'css'),
  javascript: byteBoundedString(MAX_JAVASCRIPT_BYTES, 'javascript')
})

export type HtmlPageContent = z.infer<typeof HtmlContentSchema>

export function createEmptyHtmlContent(): HtmlPageContent {
  return {
    version: HTML_CONTENT_VERSION,
    html: '',
    css: '',
    javascript: ''
  }
}

export function serializeHtmlContent(content: HtmlPageContent): string {
  return JSON.stringify(content)
}

export type ParsedHtmlContent =
  | { ok: true; content: HtmlPageContent }
  | { ok: false; error: string }

/**
 * Parses and validates a stored or submitted content string against the
 * canonical schema. Returns the first issue's message so API errors keep the
 * existing `{ error: string }` response shape.
 */
export function parseHtmlContent(raw: string): ParsedHtmlContent {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'HTML page content must be canonical JSON.' }
  }

  const parsed = HtmlContentSchema.safeParse(parsedJson)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'HTML page content is invalid.'
    }
  }
  return { ok: true, content: parsed.data }
}
