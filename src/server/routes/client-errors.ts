import { Hono } from 'hono'
import {
  CLIENT_ERROR_RATE_LIMIT_MAX,
  CLIENT_ERROR_RATE_LIMIT_WINDOW_MS,
  MAX_CLIENT_ERROR_BODY_BYTES
} from '../../shared/constants/index.js'
import { ClientErrorSchema } from '../../shared/schemas/client-error.js'
import type { Logger } from '../logging/index.js'
import { isSameOrigin } from '../utils/request-origin.js'

export interface ClientErrorRouteOptions {
  logger: Logger
  /**
   * Secret values scrubbed from every accepted string field before logging
   * (currently the per-process shutdown token).
   */
  scrubValues?: string[]
}

/**
 * Bounded rolling-window rate limiter. Retains only timestamps inside the
 * current window, so memory use stays proportional to the configured maximum.
 */
function createRateLimiter(maxReports: number, windowMs: number): () => boolean {
  let hits: number[] = []
  return (): boolean => {
    const now = Date.now()
    hits = hits.filter((timestamp) => now - timestamp < windowMs)
    if (hits.length >= maxReports) return false
    hits.push(now)
    return true
  }
}

/**
 * Removes known secrets, control characters and excess whitespace from an
 * optional string field. Validation already capped lengths; scrubbing guards
 * against sensitive values that happen to arrive inside allowed fields.
 */
function scrubField(value: string | undefined, secrets: string[]): string | undefined {
  if (value === undefined) return undefined
  let scrubbed = value
  for (const secret of secrets) {
    if (secret) scrubbed = scrubbed.split(secret).join('[redacted]')
  }
  return (
    scrubbed
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control characters from client-supplied text
      .replace(/[\x00-\x1F\x7F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Creates the sanitized frontend-error reporting route.
 *
 * - POST /api/client-errors → validate + log a bounded, sanitized report.
 * - GET / → 405. There is deliberately no endpoint that can read logs.
 *
 * Protections, in evaluation order:
 *  1. fetch-metadata/same-origin validation (request-derived, not a fixed host)
 *  2. application/json required
 *  3. 8 KB payload cap enforced via Content-Length and raw byte length
 *     BEFORE any JSON parsing
 *  4. rolling rate limit (default 20 reports/minute)
 *  5. shared Zod schema with a closed event enum and strict field caps;
 *     unknown fields are stripped
 *  6. known secrets scrubbed from accepted fields before logging
 */
export function createClientErrorRoutes(opts: ClientErrorRouteOptions): Hono {
  const router = new Hono()
  const allowReport = createRateLimiter(
    CLIENT_ERROR_RATE_LIMIT_MAX,
    CLIENT_ERROR_RATE_LIMIT_WINDOW_MS
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
    if (Number.isFinite(contentLength) && contentLength > MAX_CLIENT_ERROR_BODY_BYTES) {
      return c.json({ error: 'Payload too large' }, 413)
    }

    const raw = await c.req.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_CLIENT_ERROR_BODY_BYTES) {
      return c.json({ error: 'Payload too large' }, 413)
    }

    if (!allowReport()) {
      return c.json({ error: 'Too many reports' }, 429)
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const parsed = ClientErrorSchema.safeParse(json)
    if (!parsed.success) {
      return c.json({ error: 'Invalid report' }, 400)
    }

    const report = parsed.data
    opts.logger.warn('Client error report', {
      event: 'client_error',
      report: report.event,
      pageType: report.pageType,
      component: scrubField(report.component, secrets),
      errorName: scrubField(report.errorName, secrets),
      errorMessage: scrubField(report.errorMessage, secrets),
      stackLocation: scrubField(report.stackLocation, secrets),
      correlationId: report.correlationId
    })

    return c.json({ ok: true, id: report.correlationId })
  })

  router.get('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  // Reject any other method on the root path.
  router.all('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  return router
}
