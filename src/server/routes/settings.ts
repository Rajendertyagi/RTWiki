import { DEFAULT_PORT } from '@rtwiki/shared/constants'
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
  isCloseBehavior,
  isValidUserPort,
  readDesktopSettings,
  readServerPort,
  requestRestart,
  writeDesktopSettings,
  writeServerPort
} from '../settings/index.js'
import { isSameOrigin } from '../utils/request-origin.js'

// Small bodies only: a port number and a close-behavior string never need
// more than a few bytes; anything larger is rejected before parsing.
const MAX_SETTINGS_BODY_BYTES = 4096

export interface SettingsRouteOptions {
  dataDir: string
  /** Running port; compared against the saved port for restartRequired. */
  getCurrentPort: () => number
}

/**
 * Server and desktop-shell settings (data/server.json, data/desktop.json).
 *
 * - GET  /server          → running port, configured port, default port
 * - PUT  /server          → validates + persists { port }; changing the port
 *                           takes effect on restart (restartRequired: true)
 * - POST /server/restart  → records a restart request for the desktop shell,
 *                           which respawns the sidecar after shutdown
 * - GET  /desktop         → desktop shell preferences { closeBehavior }
 * - PUT  /desktop         → validates + persists { closeBehavior }
 *
 * Mutations require same-origin (fetch-metadata check, mirroring the
 * shutdown routes); reads are harmless on loopback and stay open for the
 * CLI/automation path.
 */
export function createSettingsRoutes(opts: SettingsRouteOptions): Hono {
  const routes = new Hono()

  async function readBody(c: Context): Promise<unknown> {
    const contentLength = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(contentLength) && contentLength > MAX_SETTINGS_BODY_BYTES) {
      return { tooLarge: true }
    }
    try {
      return await c.req.json()
    } catch {
      return { invalid: true }
    }
  }

  routes.get('/server', (c) => {
    try {
      return c.json({
        port: opts.getCurrentPort(),
        configuredPort: readServerPort(opts.dataDir),
        defaultPort: DEFAULT_PORT,
        restartRequired: false
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.put('/server', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    const body = (await readBody(c)) as
      | Record<string, unknown>
      | { tooLarge: boolean }
      | { invalid: boolean }
    if ('tooLarge' in body) return c.json({ error: 'Request body too large' }, 413)
    if ('invalid' in body || typeof body !== 'object' || body === null) {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const port = (body as Record<string, unknown>).port
    if (!isValidUserPort(port)) {
      return c.json({ error: 'Port must be an integer between 1024 and 65535' }, 400)
    }
    try {
      const saved = writeServerPort(opts.dataDir, port)
      return c.json({ port: saved.port, restartRequired: saved.port !== opts.getCurrentPort() })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.post('/server/restart', (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    try {
      requestRestart(opts.dataDir)
      return c.json({ status: 'restart_requested' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.get('/desktop', (c) => {
    try {
      return c.json(readDesktopSettings(opts.dataDir))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  routes.put('/desktop', async (c) => {
    if (!isSameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403)
    const body = (await readBody(c)) as
      | Record<string, unknown>
      | { tooLarge: boolean }
      | { invalid: boolean }
    if ('tooLarge' in body) return c.json({ error: 'Request body too large' }, 413)
    if ('invalid' in body || typeof body !== 'object' || body === null) {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const closeBehavior = (body as Record<string, unknown>).closeBehavior
    if (!isCloseBehavior(closeBehavior)) {
      return c.json({ error: 'closeBehavior must be one of: ask, minimize, quit' }, 400)
    }
    try {
      return c.json(writeDesktopSettings(opts.dataDir, { closeBehavior }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, 500)
    }
  })

  return routes
}
