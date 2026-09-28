import { MAX_SCHEDULE_JSON_BODY_BYTES } from '@rtwiki/shared/constants'
import type { Context } from 'hono'

const requestTextEncoder = new TextEncoder()

/** A JSON body that was read and parsed, or a response the caller must return. */
export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; response: Response }

/**
 * Reads a JSON request body under an enforced byte ceiling.
 *
 * One definition, shared by the schedule, schedule-preset and backup routes so
 * the ceiling cannot drift between them. Content-Length is checked first (a
 * cheap refusal that never reads the body), then the byte length of the text
 * actually read (authoritative, and the only check that applies to a chunked
 * request with no declared length).
 *
 * Malformed and empty bodies stay 400s -- a client that sent bad JSON must not
 * be told it sent too much and go looking in the wrong place.
 *
 * This is the same contract as `readJsonBody` in `routes/pages.ts`, which
 * currently carries its own private copy. When that file is next editable both
 * should read this one; the seam is here rather than in a second copy of the
 * same check.
 *
 * The ceiling is named for the schedule because that is where it was defined
 * and what it was sized for. It is a generic JSON ceiling, not a schedule rule.
 */
export async function readJson(c: Context): Promise<JsonBodyResult> {
  const contentLength = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > MAX_SCHEDULE_JSON_BODY_BYTES) {
    return { ok: false, response: c.json({ error: 'Request body too large' }, 413) }
  }

  const text = await c.req.text()
  if (requestTextEncoder.encode(text).byteLength > MAX_SCHEDULE_JSON_BODY_BYTES) {
    return { ok: false, response: c.json({ error: 'Request body too large' }, 413) }
  }
  if (text.length === 0) {
    return { ok: false, response: c.json({ error: 'Empty request body' }, 400) }
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, response: c.json({ error: 'Invalid JSON' }, 400) }
  }
}
