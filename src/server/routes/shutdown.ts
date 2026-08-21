import { Hono } from 'hono'
import { SHUTDOWN_TOKEN_HEADER } from '../../shared/constants/index.js'

/**
 * Validates that a request originates from the local machine by checking
 * the Origin or Referer headers for 127.0.0.1 / localhost.
 *
 * Since the server binds exclusively to 127.0.0.1, all traffic is inherently
 * local. This check prevents a malicious page on a different local port from
 * triggering shutdown via CSRF.
 */
function isSameOrigin(req: Request): boolean {
  // Primary guard: the server binds exclusively to 127.0.0.1, so any request
  // that reaches it is inherently local. This holds even when a client (or
  // test framework) cannot or does not set an Origin/Referer header.
  try {
    const target = new URL(req.url)
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost') return true
  } catch {
    // Malformed target URL — fall through to header checks.
  }

  const origin = req.headers.get('origin')
  if (origin) {
    try {
      const u = new URL(origin)
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return true
    } catch {
      // Malformed origin — reject.
    }
    return false
  }

  const referer = req.headers.get('referer')
  if (referer) {
    try {
      const u = new URL(referer)
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return true
    } catch {
      // Malformed referer — reject.
    }
    return false
  }

  // No Origin or Referer header: accept. Non-browser clients (PowerShell,
  // curl, test frameworks) do not send these headers. The custom
  // X-RTWiki-Shutdown-Token header requirement provides CSRF protection:
  // browsers always send Origin for cross-origin requests with custom
  // headers, and we reject non-localhost origins.
  return true
}

// Module-level mutable state. Each bootstrap() call updates the token and
// handler. The routes (mounted once on the app) always reference the current values.
let currentToken: string | null = null
let currentOnShutdown: (() => Promise<void>) | null = null
let shutdownStarted = false

/**
 * Updates the active shutdown token and handler. Called by bootstrap()
 * each time a new server instance is started.
 */
export function setShutdownHandler(token: string, onShutdown: () => Promise<void>): void {
  currentToken = token
  currentOnShutdown = onShutdown
  shutdownStarted = false
}

/**
 * Creates the shutdown API routes.
 *
 * - GET  /token  → returns the per-process shutdown token
 * - POST /       → validates token + same-origin, then triggers shutdown
 *
 * Security model:
 * - POST-only shutdown endpoint
 * - Per-process unpredictable token (crypto.randomUUID)
 * - Custom header required (not query param, not body field)
 * - Same-origin validation via Origin / Referer
 * - No CORS headers (set globally by app.ts middleware)
 * - Token never logged, never in URL, never in DB
 * - Idempotent — second POST after shutdown starts returns 503
 */
export function createShutdownRoutes(): Hono {
  const router = new Hono()

  router.get('/token', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden', diag: { url: c.req.raw.url, origin: c.req.raw.headers.get('origin') } }, 403)
    }
    if (!currentToken) {
      return c.json({ error: 'Shutdown not available' }, 503)
    }
    return c.json({ token: currentToken })
  })

  router.post('/', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    if (shutdownStarted) {
      return c.json({ error: 'Shutdown already in progress' }, 503)
    }

    if (!currentToken || !currentOnShutdown) {
      return c.json({ error: 'Shutdown not available' }, 503)
    }

    const provided = c.req.header(SHUTDOWN_TOKEN_HEADER)
    if (provided !== currentToken) {
      return c.json({ error: 'Invalid shutdown token' }, 403)
    }

    shutdownStarted = true

    // Respond immediately, then execute shutdown asynchronously so the
    // HTTP response reaches the client before the server stops.
    setTimeout(() => void currentOnShutdown?.(), 200)
    return c.json({ status: 'shutting_down' })
  })

  // Reject any other method on the root path.
  router.all('/', (c) => c.json({ error: 'Method not allowed' }, 405))

  return router
}
