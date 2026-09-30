import { MAX_SCHEDULE_JSON_BODY_BYTES } from '@rtwiki/shared/constants'
import type { Context } from 'hono'

const requestTextEncoder = new TextEncoder()

/** A JSON body that was read and parsed, or a response the caller must return. */
export type JsonBodyResult = { ok: true; body: unknown } | { ok: false; response: Response }

/**
 * True when the request declares a JSON media type.
 *
 * Parameters are not part of the type, so `application/json;charset=utf-8` is
 * accepted — a browser adds that itself, and treating it as a mismatch would be
 * the kind of strictness that breaks working clients. The `+json` structured
 * suffix is accepted because that is what the convention means.
 */
function declaresJson(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const essence = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return essence === 'application/json' || essence.endsWith('+json')
}

/**
 * Reads a JSON request body under an enforced byte ceiling.
 *
 * One definition, shared by the page, schedule, schedule-preset and backup routes
 * so neither the ceiling nor the media-type rule can drift between them.
 * Content-Length is checked first (a cheap refusal that never reads the body),
 * then the byte length of the text actually read (authoritative, and the only
 * check that applies to a chunked request with no declared length).
 *
 * ## Why the media type is required
 *
 * A `POST` whose `Content-Type` is CORS-safelisted — `text/plain` is enough — is
 * a *simple request*: no preflight is sent and the browser dispatches it
 * unconditionally, from any page the user happens to be visiting. CORS governs
 * whether that page may **read the reply**, never whether the request is sent. A
 * reader that ignores the declared type will happily `JSON.parse` such a body, so
 * the label the attacker chooses and the type the server enforces are the same
 * thing. Requiring `application/json` removes the free pass: a cross-origin
 * `fetch` carrying that header is not a simple request, so it preflights, and
 * RTWiki answers a preflight with no CORS headers and the browser never dispatches
 * the real call.
 *
 * This is defence in depth, not the primary control. The `Host` allowlist and the
 * origin check in `createApp()` are what actually stop the attack; see
 * `utils/request-host.ts` for why the two are not substitutes for each other. What
 * this rule adds is that the API says what it accepts, and a body labelled as
 * something else is refused rather than reinterpreted.
 *
 * Malformed and empty bodies stay 400s — a client that sent bad JSON must not be
 * told it sent the wrong media type and go looking in the wrong place. The media
 * type is checked first, though, because a body that is not JSON at all is a
 * different mistake from one that is JSON and broken.
 *
 * @param maxBytes Ceiling for this route family. Named for the schedule by
 *   default because that is where it was defined; it is a generic limit.
 */
export async function readJson(
  c: Context,
  maxBytes: number = MAX_SCHEDULE_JSON_BODY_BYTES
): Promise<JsonBodyResult> {
  if (!declaresJson(c.req.header('content-type'))) {
    return {
      ok: false,
      response: c.json({ error: 'Content-Type must be application/json' }, 415)
    }
  }

  const contentLength = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { ok: false, response: c.json({ error: 'Request body too large' }, 413) }
  }

  const text = await c.req.text()
  if (requestTextEncoder.encode(text).byteLength > maxBytes) {
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
