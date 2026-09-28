import {
  APP_NAME,
  APP_VERSION,
  DEFAULT_HOST,
  DEFAULT_PORT,
  HEALTH_PATH
} from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { NONCE, type SecureHeadersVariables, secureHeaders } from 'hono/secure-headers'
import { createAttachmentRoutes } from './attachments/attachment-routes.js'
import { checkIntegrity, getDb } from './database/index.js'
import { createConsoleLogger, type Logger } from './logging/index.js'
import { createBackupRoutes } from './routes/backup.js'
import { createClientDebugEventRoutes, type DebugEventSink } from './routes/client-debug-events.js'
import { createClientErrorRoutes } from './routes/client-errors.js'
import { createPageRoutes } from './routes/pages.js'
import { createScheduleRoutes } from './routes/schedule.js'
import { createSchedulePresetRoutes } from './routes/schedule-presets.js'
import { createSettingsRoutes } from './routes/settings.js'
import { createShutdownRoutes } from './routes/shutdown.js'
import type { ShutdownCoordinator } from './shutdown-coordinator.js'
import { serveStatic } from './static.js'
import { isAllowedHost, isUnsafeMethod } from './utils/request-host.js'
import { isSameOrigin } from './utils/request-origin.js'

/**
 * Context key a route uses to ask for a stricter Content-Security-Policy than the
 * app-wide one. Declared here, where the middleware that reads it lives, and
 * imported by the attachment routes that need it — so the key has one owner.
 */
export const DOCUMENT_CSP_KEY = 'rtwikiDocumentCsp' as const

export type AppVariables = SecureHeadersVariables & {
  /**
   * A per-response Content-Security-Policy for a route that needs one stricter
   * than the app-wide policy — currently only a document download, which must not
   * be able to run anything even if a browser renders it despite the disposition.
   *
   * Set by the route; applied by a middleware registered *before*
   * `securityHeaders`, so it wins. See the note where that middleware is added.
   */
  [DOCUMENT_CSP_KEY]?: string
  db: ReturnType<typeof getDb>
}

/**
 * The app's Content-Security-Policy, exported so it can be asserted directly.
 *
 * `styleSrc` carries `'unsafe-inline'` because Mermaid injects a `<style>`
 * element into the SVG of every diagram it renders. That is a real dependency,
 * not a leftover: drop `'unsafe-inline'` and every diagram silently loses its
 * styling, with nothing failing and no error on the page. `tests/security-headers.test.ts`
 * pins it so that regression cannot land unnoticed.
 *
 * The per-request CSP nonce (NONCE) is generated with crypto.getRandomValues
 * inside the middleware before handlers run and is exposed to HTML-serving
 * handlers through the context (`secureHeadersNonce`), so the header value
 * and the value injected into served HTML always originate from the same
 * request. Preview bootstrap/user scripts inside sandboxed srcdoc frames
 * inherit this policy and therefore must carry this exact nonce.
 */
export const APP_CONTENT_SECURITY_POLICY = {
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
}

/** Security headers via Hono's official secureHeaders middleware. */
const securityHeaders = secureHeaders({
  contentSecurityPolicy: APP_CONTENT_SECURITY_POLICY,
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
   * Runtime data directory backing /api/settings (data/server.json,
   * data/desktop.json). Empty in the default test instance, where mutations
   * report unavailability instead of writing.
   */
  dataDir?: string
  /** Currently bound listening port (for settings restart detection). */
  getCurrentPort?: () => number
  /**
   * Persistence for opt-in client debug events (Debug Mode). Production
   * injects the rotating logs/rtwiki-debug.jsonl sink; tests may collect
   * in memory or drop events entirely.
   */
  debugEventSink: DebugEventSink
  /**
   * Host the server is bound to, added to the Host allowlist so an authorised LAN
   * phase keeps working without revisiting the check. Optional so existing tests
   * that build a dependency bag need no change; it defaults to loopback, which is
   * the only value a default installation can produce.
   */
  host?: string
}

/**
 * Creates a fresh Hono app with all routes mounted.
 * Each bootstrap() invocation must call this to get an isolated app instance.
 */
export function createApp(deps: AppDependencies): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()

  // A route that must serve a *stricter* policy than the app-wide one cannot set
  // the header itself: `secureHeaders` calls `setHeaders` after `await next()`, so
  // it overwrites whatever a handler wrote. That is not theoretical — a document
  // response asking for `default-src 'none'` was silently replaced by the
  // app-wide policy, leaving `script-src 'self'` in force while serving a PDF.
  //
  // The ordering below is therefore load-bearing, and was established by
  // measurement rather than by reading Hono's source: of the four arrangements
  // tried, only *this* one lets the stricter policy reach the client. Hono unwinds
  // middleware in reverse registration order, so registering this first makes its
  // post-handler code run after `secureHeaders` has set the app-wide policy, and
  // the document's policy overwrites it. The route records what it needs in the
  // context; nothing outside this module knows the key.
  app.use('*', async (c, next) => {
    await next()
    const override = c.get(DOCUMENT_CSP_KEY)
    if (typeof override === 'string') c.header('Content-Security-Policy', override)
  })

  // Registered before all routes so the nonce exists in context by the time
  // HTML-serving handlers execute.
  app.use('*', securityHeaders)

  // Cross-origin request rejection, for every request. Two independent checks,
  // because they stop two different attacks and neither substitutes for the other:
  //
  //  1. Host allowlist, on EVERY request. This is the only check that stops DNS
  //     rebinding, where the browser considers the request same-origin and so
  //     sends no Origin and no Sec-Fetch-Site -- which is exactly the case
  //     `isSameOrigin` accepts for the benefit of command-line clients.
  //  2. `isSameOrigin`, on state-changing methods only. This stops the ordinary
  //     case: a form or `fetch` POST from a page on another site. GET is left
  //     alone so the health check and the desktop shell keep working.
  //
  // `isSameOrigin` already returns true when no browser headers are present, so
  // the compiled-executable E2E script and any local automation keep working
  // unchanged. That is deliberate, and it is also why check 1 cannot be skipped.
  //
  // Registered after `secureHeaders` so a rejection still carries the full set of
  // security headers. See `src/server/utils/request-host.ts` for why each part is
  // as permissive as it is, and `request-origin.ts` for the origin half.
  app.use('*', async (c, next) => {
    const allowedHost = deps.host ?? DEFAULT_HOST
    if (!isAllowedHost(c.req.header('host') ?? null, allowedHost)) {
      deps.logger.warn('Rejected request with an unrecognised Host header', {
        event: 'request_host_rejected',
        method: c.req.method,
        host: c.req.header('host') ?? null
      })
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (isUnsafeMethod(c.req.method) && !isSameOrigin(c.req.raw)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    await next()
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
  app.route('/api/schedule', createScheduleRoutes(deps.getDb))
  app.route('/api/schedule/presets', createSchedulePresetRoutes(deps.getDb))
  // Uploaded images. The bytes live in the `attachments` table (ADR-014), so the
  // routes need no directory. With no data directory (the default test instance)
  // they report unavailability rather than writing anywhere.
  app.route(
    '/api/attachments',
    createAttachmentRoutes({
      getDb: deps.getDb,
      logger: deps.logger,
      available: Boolean(deps.dataDir)
    })
  )
  // Backup and restore. Behind the same cross-origin guard as everything else;
  // `POST /restore` additionally requires the shutdown token, because it
  // replaces the database and stops the process. Reports unavailability rather
  // than writing anywhere when there is no data directory, as with attachments.
  app.route(
    '/api/backup',
    createBackupRoutes({
      getDb: deps.getDb,
      dataDir: deps.dataDir ?? '',
      token: deps.token,
      logger: deps.logger,
      coordinator: deps.coordinator
    })
  )
  app.route(
    '/api/shutdown',
    createShutdownRoutes({
      coordinator: deps.coordinator,
      token: deps.token,
      // Lets the shell distinguish an authorized shutdown from a crash.
      dataDir: deps.dataDir ?? ''
    })
  )
  app.route(
    '/api/settings',
    createSettingsRoutes({
      dataDir: deps.dataDir ?? '',
      getCurrentPort: deps.getCurrentPort ?? (() => DEFAULT_PORT)
    })
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
  dataDir: '',
  getCurrentPort: () => DEFAULT_PORT,
  debugEventSink: { append: () => {} }
})
