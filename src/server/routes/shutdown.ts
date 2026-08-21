import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { SHUTDOWN_TOKEN_HEADER } from '../../shared/constants/index.js'
import type { ShutdownCoordinator } from '../shutdown-coordinator.js'

export interface ShutdownRouteOptions {
  coordinator: ShutdownCoordinator
  token: string
}

/**
 * Validates that a request originates from the local machine by checking
 * fetch-metadata headers against the request URL's origin.
 *
 * Security model:
 * - When Sec-Fetch-Site is present, require exactly "same-origin".
 * - When Origin is present: reject "null", reject malformed values,
 *   require exact equality with `new URL(request.url).origin`.
 * - When Referer is present: reject malformed values, require exact origin equality.
 * - When no browser headers are present (CLI/automation path): accept; the
 *   POST token requirement provides CSRF protection.
 */
function isSameOrigin(req: Request): boolean {
  const fetchSite = req.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return false

  const requestOrigin = new URL(req.url).origin

  const origin = req.headers.get('origin')
  if (origin !== null) {
    if (origin === 'null') return false
    try {
      if (new URL(origin).origin !== requestOrigin) return false
    } catch {
      return false // malformed Origin
    }
    return true
  }

  const referer = req.headers.get('referer')
  if (referer !== null) {
    try {
      if (new URL(referer).origin !== requestOrigin) return false
    } catch {
      return false // malformed Referer
    }
    return true
  }

  return true // CLI/automation path — token required on POST for CSRF protection
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, 'utf8')
  const bBytes = Buffer.from(b, 'utf8')
  if (aBytes.byteLength !== bBytes.byteLength) return false
  return timingSafeEqual(aBytes, bBytes)
}

/**
 * Creates the shutdown API routes.
 *
 * - GET  /token  → returns the per-process shutdown token
 * - POST /       → validates token + same-origin, then triggers shutdown (returns 202)
 * - Any other method on / → 405
 *
 * Security model:
 * - POST-only shutdown endpoint
 * - Per-process unpredictable token (crypto.randomUUID)
 * - Custom header required (not query param, not body field)
 * - Fetch-metadata validation via Sec-Fetch-Site / Origin / Referer
 * - Constant-time token comparison
 * - No CORS headers (set globally by app middleware)
 * - Token never logged, never in URL, never in DB
 */
export function createShutdownRoutes(opts: ShutdownRouteOptions): Hono {
  const { coordinator, token } = opts
  const router = new Hono()

  router.get('/token', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ token })
  })

  router.post('/', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const provided = c.req.header(SHUTDOWN_TOKEN_HEADER)
    if (!timingSafeEqualStrings(provided ?? '', token)) {
      return c.json({ error: 'Invalid shutdown token' }, 403)
    }

    // Fire-and-forget: route returns immediately; coordinator handles completion.
    void coordinator.requestShutdown()
    return c.json({ status: 'shutting_down' }, 202)
  })

  // Reject any other method on the root path.
  router.all('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  return router
}
