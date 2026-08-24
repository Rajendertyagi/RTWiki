import { APP_NAME, APP_VERSION, HEALTH_PATH } from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { NONCE, type SecureHeadersVariables, secureHeaders } from 'hono/secure-headers'
import { checkIntegrity, getDb } from './database/index.js'
import { createConsoleLogger, type Logger } from './logging/index.js'
import { createClientDebugEventRoutes, type DebugEventSink } from './routes/client-debug-events.js'
import { createClientErrorRoutes } from './routes/client-errors.js'
import { createPageRoutes } from './routes/pages.js'
import { createShutdownRoutes } from './routes/shutdown.js'
import type { ShutdownCoordinator } from './shutdown-coordinator.js'
import { serveStatic } from './static.js'

export type AppVariables = SecureHeadersVariables & {
  db: ReturnType<typeof getDb>
}

/**
 * Security headers via Hono's official secureHeaders middleware.
 *
 * The per-request CSP nonce (NONCE) is generated with crypto.getRandomValues
 * inside the middleware before handlers run and is exposed to HTML-serving
 * handlers through the context (`secureHeadersNonce`), so the header value
 * and the value injected into served HTML always originate from the same
 * request. Preview bootstrap/user scripts inside sandboxed srcdoc frames
 * inherit this policy and therefore must carry this exact nonce.
 */
const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", NONCE],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    // KaTeX (official math integration) ships its fonts inline as data: URIs;
    // data: fonts are inert content and cannot execute.
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"]
  },
  xFrameOptions: 'DENY',
  referrerPolicy: 'no-referrer',
  permissionsPolicy: {
    geolocation: [],
    microphone: [],
    camera: []
  }
})

export interface AppDependencies {
  coordinator: ShutdownCoordinator
  token: string
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  frontendDistDir: string
  /**
   * Persistence for opt-in client debug events (Debug Mode). Production
   * injects the rotating logs/rtwiki-debug.jsonl sink; tests may collect
   * in memory or drop events entirely.
   */
  debugEventSink: DebugEventSink
}

/**
 * Creates a fresh Hono app with all routes mounted.
 * Each bootstrap() invocation must call this to get an isolated app instance.
 */
export function createApp(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()

  // Registered before all routes so the nonce exists in context by the time
  // HTML-serving handlers execute.
  app.use('*', securityHeaders)

  app.get(HEALTH_PATH, (c) => {
    const timestamp = new Date().toISOString()
    try {
      const db = deps.getDb()
      db.query('SELECT 1').get()
      if (!checkIntegrity()) {
        return c.json(
          {
            status: 'error',
            app: APP_NAME,
            version: APP_VERSION,
            db: { ready: false },
            time: timestamp
          },
          503
        )
      }
      return c.json({
        status: 'ok',
        app: APP_NAME,
        version: APP_VERSION,
        db: { ready: true },
        time: timestamp
      })
    } catch {
      return c.json(
        {
          status: 'error',
          app: APP_NAME,
          version: APP_VERSION,
          db: { ready: false },
          time: timestamp
        },
        503
      )
    }
  })

  app.route('/api/pages', createPageRoutes(deps.getDb))
  app.route(
    '/api/shutdown',
    createShutdownRoutes({ coordinator: deps.coordinator, token: deps.token })
  )
  // Sanitized frontend-error reports. The shutdown token is scrubbed from any
  // accepted field before the report reaches the log file.
  app.route(
    '/api/client-errors',
    createClientErrorRoutes({ logger: deps.logger, scrubValues: [deps.token] })
  )
  // Opt-in structured client debug events (Debug Mode). Same scrubbing rule:
  // the shutdown token never reaches the debug log file.
  app.route(
    '/api/client-debug-events',
    createClientDebugEventRoutes({ sink: deps.debugEventSink, scrubValues: [deps.token] })
  )

  app.use('/*', serveStatic({ root: deps.frontendDistDir, logger: deps.logger }))

  app.onError((err, c) => {
    deps.logger.error('Unhandled error', { event: 'http_error', error: err.message })
    return c.json({ error: 'Internal server error' }, 500)
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))

  return app
}

/**
 * Default app instance for tests and legacy access. Uses an explicitly
 * injected console-only logger and a dropping debug-event sink so importing
 * this module never creates files.
 */
export const app = createApp({
  coordinator: {
    state: 'running' as const,
    completed: Promise.resolve({
      ok: true,
      forced: false
    } as import('./shutdown-coordinator.js').ShutdownResult),
    requestShutdown: () =>
      Promise.resolve({
        ok: true,
        forced: false
      } as import('./shutdown-coordinator.js').ShutdownResult)
  } as unknown as import('./shutdown-coordinator.js').ShutdownCoordinator,
  token: '',
  getDb: getDb,
  logger: createConsoleLogger(),
  frontendDistDir: '',
  debugEventSink: { append: () => {} }
})
