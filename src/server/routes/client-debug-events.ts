import { Hono } from 'hono'
import {
  CLIENT_DEBUG_RATE_LIMIT_MAX,
  CLIENT_DEBUG_RATE_LIMIT_WINDOW_MS,
  MAX_CLIENT_DEBUG_BODY_BYTES
} from '../../shared/constants/index.js'
import { DebugEventBatchSchema } from '../../shared/schemas/debug-events.js'
import { isSameOrigin } from '../utils/request-origin.js'

/**
 * Where validated debug events are persisted. Implemented by the rotating
 * JSONL sink in production; tests inject in-memory collectors.
 */
export interface DebugEventSink {
  append(event: Record<string, unknown>): void
}

export interface ClientDebugEventRouteOptions {
  sink: DebugEventSink
  /**
   * Secret values scrubbed from every accepted string field before persisting
   * (currently the per-process shutdown token).
   */
  scrubValues?: string[]
}

/**
 * Bounded rolling-window rate limiter (same shape as the client-error route).
 */
function createRateLimiter(maxBatches: number, windowMs: number): () => boolean {
  let hits: number[] = []
  return (): boolean => {
    const now = Date.now()
    hits = hits.filter((timestamp) => now - timestamp < windowMs)
    if (hits.length >= maxBatches) return false
    hits.push(now)
    return true
  }
}

/** Scrubs known secrets from an optional bounded token field. */
function scrubToken(value: string | undefined, secrets: string[]): string | undefined {
  if (value === undefined) return undefined
  let scrubbed = value
  for (const secret of secrets) {
    if (secret) scrubbed = scrubbed.split(secret).join('[redacted]')
  }
  return scrubbed
}

const SCRUBBED_FIELDS = ['pageId', 'tabId', 'code'] as const

/**
 * Creates the opt-in client debug-event ingestion route.
 *
 * - POST /api/client-debug-events → validate + append each event as one
 *   JSONL line to logs/rtwiki-debug.jsonl.
 * - GET / → 405. There is deliberately no endpoint that can read logs.
 *
 * Protections, in evaluation order:
 *  1. fetch-metadata/same-origin validation (localhost-only ingestion)
 *  2. application/json required
 *  3. payload cap enforced via Content-Length and raw byte length BEFORE any
 *     JSON parsing
 *  4. rolling rate limit on batches (default 120/minute)
 *  5. shared Zod STRICT schema: closed event-name allowlist, category/name
 *     cross-check, bounded fields; unknown fields are REJECTED, not stripped
 *  6. known secrets scrubbed from accepted token fields before persisting
 */
export function createClientDebugEventRoutes(opts: ClientDebugEventRouteOptions): Hono {
  const router = new Hono()
  const allowBatch = createRateLimiter(
    CLIENT_DEBUG_RATE_LIMIT_MAX,
    CLIENT_DEBUG_RATE_LIMIT_WINDOW_MS
  )
  const secrets = opts.scrubValues ?? []

  router.post('/', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const contentType = (c.req.header('content-type') ?? '').toLowerCase()
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Expected application/json' }, 400)
    }

    const contentLength = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_CLIENT_DEBUG_BODY_BYTES) {
      return c.json({ error: 'Payload too large' }, 413)
    }

    const raw = await c.req.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_CLIENT_DEBUG_BODY_BYTES) {
      return c.json({ error: 'Payload too large' }, 413)
    }

    if (!allowBatch()) {
      return c.json({ error: 'Too many batches' }, 429)
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = DebugEventBatchSchema.safeParse(json)
    if (!parsed.success) {
      return c.json({ error: 'Invalid batch' }, 400)
    }

    for (const event of parsed.data.events) {
      const record: Record<string, unknown> = { ...event, session: parsed.data.session }
      for (const field of SCRUBBED_FIELDS) {
        const value = record[field]
        if (typeof value === 'string') {
          record[field] = scrubToken(value, secrets)
        }
      }
      opts.sink.append(record)
    }

    return c.json({ ok: true, accepted: parsed.data.events.length })
  })

  router.get('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  // Reject any other method on the root path.
  router.all('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  return router
}
