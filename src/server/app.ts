import { HEALTH_PATH } from '@rtwiki/shared/constants'
import { Hono } from 'hono'
import { getDb, checkIntegrity } from './database/index.js'
import { logger } from './logging/index.js'
import { resolveRuntimePaths } from './config/index.js'
import { serveStatic } from './static.js'
import { createPageRoutes } from './routes/pages.js'

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

export const app = new Hono<{ Variables: { db: ReturnType<typeof getDb> } }>()

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
    const db = getDb()
    db.query('SELECT 1').get()
    if (!checkIntegrity()) {
      return c.json(
        { status: 'error', app: 'RTWiki', version: '0.1.0', db: { ready: false }, time: timestamp },
        503
      )
    }
    return c.json({
      status: 'ok',
      app: 'RTWiki',
      version: '0.1.0',
      db: { ready: true },
      time: timestamp
    })
  } catch {
    return c.json(
      { status: 'error', app: 'RTWiki', version: '0.1.0', db: { ready: false }, time: timestamp },
      503
    )
  }
})

app.route('/api/pages', createPageRoutes(getDb))

app.use('/*', serveStatic({ root: resolveRuntimePaths().frontendDistDir }))

app.onError((err, c) => {
  logger.error('Unhandled error', { event: 'http_error', error: err.message })
  return c.json({ error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))