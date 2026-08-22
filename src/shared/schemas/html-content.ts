import { z } from 'zod'

/**
 * Canonical HTML-page content — the single source of truth shared by the
 * frontend and the server. Stored in `pages.content` as the JSON
 * serialization of this schema whenever `page_type` is `html`.
 *
 * Version history:
 * - v1: { version, html, css, javascript } — Phase 4A shape. Still accepted
 *   everywhere; legacy documents normalize to v2 on load.
 * - v2 (Phase 4B): adds `jsEnabled`. New documents are created as v2 with
 *   `jsEnabled: false`; serialization always emits v2.
 *
 * Rich Note pages are unaffected: they continue to store canonical BlockNote
 * JSON (see ADR-004). This schema exists so both sides validate one format
 * definition; there is deliberately no duplicate frontend/server copy.
 */

export const HTML_CONTENT_VERSION_LATEST = 2 as const

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

const contentFields = {
  html: byteBoundedString(MAX_HTML_BYTES, 'html'),
  css: byteBoundedString(MAX_CSS_BYTES, 'css'),
  javascript: byteBoundedString(MAX_JAVASCRIPT_BYTES, 'javascript')
} as const

/** Phase 4A shape — accepted for reads and writes, never emitted by saves. */
export const HtmlContentV1Schema = z.strictObject({
  version: z.literal(1),
  ...contentFields
})

/** Current shape — adds the per-page JavaScript enable flag. */
export const HtmlContentV2Schema = z.strictObject({
  version: z.literal(HTML_CONTENT_VERSION_LATEST),
  ...contentFields,
  jsEnabled: z.boolean()
})

/**
 * `strictObject` rejects unknown keys instead of stripping them: stored page
 * content must be exactly a canonical shape, so silent key loss can never
 * masquerade as a successful save.
 */
export const HtmlContentSchema = z.union([HtmlContentV1Schema, HtmlContentV2Schema])

export type HtmlPageContentV1 = z.infer<typeof HtmlContentV1Schema>
export type HtmlPageContentV2 = z.infer<typeof HtmlContentV2Schema>
export type HtmlPageContent = HtmlPageContentV1 | HtmlPageContentV2

export function isHtmlContentV2(content: HtmlPageContent): content is HtmlPageContentV2 {
  return content.version === HTML_CONTENT_VERSION_LATEST
}

/**
 * Normalizes any stored document to the current shape. Legacy v1 documents
 * gain `jsEnabled: false` in memory only — their stored bytes stay v1 until
 * an actual edit re-serializes them.
 */
export function normalizeHtmlContent(content: HtmlPageContent): HtmlPageContentV2 {
  if (isHtmlContentV2(content)) {
    return content
  }
  return { ...content, version: HTML_CONTENT_VERSION_LATEST, jsEnabled: false }
}

export function createEmptyHtmlContent(): HtmlPageContentV2 {
  return {
    version: HTML_CONTENT_VERSION_LATEST,
    html: '',
    css: '',
    javascript: '',
    jsEnabled: false
  }
}

export function serializeHtmlContent(content: HtmlPageContentV2): string {
  return JSON.stringify(content)
}

export type ParsedHtmlContent =
  | { ok: true; content: HtmlPageContent }
  | { ok: false; error: string }

/**
 * Parses and validates a stored or submitted content string against the
 * canonical schema (either version). Returns the first issue's message so
 * API errors keep the existing `{ error: string }` response shape.
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
