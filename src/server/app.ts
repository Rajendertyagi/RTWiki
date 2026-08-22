import { APP_NAME, APP_VERSION, HEALTH_PATH } from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { checkIntegrity, getDb } from './database/index.js'
import { createConsoleLogger, type Logger } from './logging/index.js'
import { createClientErrorRoutes } from './routes/client-errors.js'
import { createPageRoutes } from './routes/pages.js'
import { createShutdownRoutes } from './routes/shutdown.js'
import type { ShutdownCoordinator } from './shutdown-coordinator.js'
import { serveStatic } from './static.js'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ')

export interface AppDependencies {
  coordinator: ShutdownCoordinator
  token: string
  getDb: () => ReturnType<typeof getDb>
  logger: Logger
  frontendDistDir: string
}

/**
 * Creates a fresh Hono app with all routes mounted.
 * Each bootstrap() invocation must call this to get an isolated app instance.
 */
export function createApp(
  deps: AppDependencies
): Hono<{ Variables: { db: ReturnType<typeof getDb> } }> {
  const app = new Hono<{ Variables: { db: ReturnType<typeof getDb> } }>()

  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('Referrer-Policy', 'no-referrer')
    c.res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  })

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
 * injected console-only logger so importing this module never creates files.
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
  frontendDistDir: ''
})
