import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { LogContext, Logger } from '../src/server/logging/index.js'
import { createClientErrorRoutes } from '../src/server/routes/client-errors.js'
import { CLIENT_ERROR_RATE_LIMIT_MAX } from '../src/shared/constants/index.js'

class MemoryLogger implements Logger {
  readonly lines: string[] = []

  info(message: string, context?: LogContext): void {
    this.push('info', message, context)
  }

  warn(message: string, context?: LogContext): void {
    this.push('warn', message, context)
  }

  error(message: string, context?: LogContext): void {
    this.push('error', message, context)
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  private push(level: string, message: string, context?: LogContext): void {
    this.lines.push(JSON.stringify({ timestamp: '', level, message, ...(context ?? {}) }))
  }
}

const TOKEN = 'test-shutdown-token-abc123'

function build(): { app: Hono; logger: MemoryLogger } {
  const logger = new MemoryLogger()
  const router = createClientErrorRoutes({ logger, scrubValues: [TOKEN] })
  const app = new Hono().route('/api/client-errors', router)
  return { app, logger }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

function validReport(): Record<string, unknown> {
  return {
    event: 'window_error',
    pageType: 'rich',
    component: 'TestComponent',
    errorName: 'TypeError',
    errorMessage: 'An unexpected browser error occurred.',
    stackLocation: 'index.js:1:2',
    correlationId: 'abcd1234',
    clientTimestamp: new Date().toISOString()
  }
}

describe('client-error reporting endpoint', () => {
  it('accepts a valid report and logs it as client_error with the correlation id', async () => {
    const { app, logger } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(validReport())
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('abcd1234')

    expect(logger.lines.length).toBe(1)
    const logged = JSON.parse(logger.lines[0]) as Record<string, unknown>
    expect(logged.event).toBe('client_error')
    expect(logged.correlationId).toBe('abcd1234')
    expect(logged.report).toBe('window_error')
  })

  it('rejects non-JSON content types', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(validReport())
    })
    expect(res.status).toBe(400)
  })

  it('rejects malformed JSON bodies', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{ definitely not json'
    })
    expect(res.status).toBe(400)
  })

  it('rejects oversized actual bodies before parsing (invalid schema would be 400)', async () => {
    const { app } = build()
    const oversized = JSON.stringify({ ...validReport(), stackLocation: 'x'.repeat(9000) })
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(8 * 1024)
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: oversized
    })
    // The payload is valid JSON but violates the schema; a 413 proves the
    // size gate ran before parsing/validation.
    expect(res.status).toBe(413)
  })

  it('rejects schema violations (unknown event name)', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...validReport(), event: 'not_a_real_event' })
    })
    expect(res.status).toBe(400)
  })

  it('rejects correlation ids outside the allowed alphabet/length', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...validReport(), correlationId: 'bad id!!' })
    })
    expect(res.status).toBe(400)
  })

  it('strips unknown fields and never logs their values', async () => {
    const { app, logger } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...validReport(),
        evil: 'arbitrary-context',
        pageTitle: 'SECRET PAGE TITLE'
      })
    })
    expect(res.status).toBe(200)
    const logged = logger.lines.join('\n')
    expect(logged).not.toContain('evil')
    expect(logged).not.toContain('arbitrary-context')
    expect(logged).not.toContain('SECRET PAGE TITLE')
  })

  it('scrubs the shutdown token out of accepted fields', async () => {
    const { app, logger } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...validReport(),
        component: `Comp ${TOKEN} tail`
      })
    })
    expect(res.status).toBe(200)
    const logged = logger.lines.join('\n')
    expect(logged).not.toContain(TOKEN)
    expect(logged).toContain('[redacted]')
  })

  it('rejects cross-origin requests via fetch metadata', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify(validReport())
    })
    expect(res.status).toBe(403)
  })

  it('rejects mismatched Origin headers', async () => {
    const { app } = build()
    const res = await app.request('/api/client-errors', {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
      body: JSON.stringify(validReport())
    })
    expect(res.status).toBe(403)
  })

  it('accepts same-origin requests on non-loopback hosts (no hardcoded address)', async () => {
    const { app } = build()
    const request = new Request('http://192.168.0.22:8080/api/client-errors', {
      method: 'POST',
      headers: { ...JSON_HEADERS, origin: 'http://192.168.0.22:8080' },
      body: JSON.stringify(validReport())
    })
    const res = await app.request(request)
    expect(res.status).toBe(200)
  })

  it('rate-limits repeated reports', async () => {
    const { app } = build()
    for (let i = 0; i < CLIENT_ERROR_RATE_LIMIT_MAX; i++) {
      const id = `rate${String(i).padStart(2, '0')}`
      const res = await app.request('/api/client-errors', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...validReport(), correlationId: id })
      })
      expect(res.status).toBe(200)
    }
    const limited = await app.request('/api/client-errors', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(validReport())
    })
    expect(limited.status).toBe(429)
  })

  it('returns 405 for GET and exposes no way to read logs over HTTP', async () => {
    const { app } = build()
    const getRoot = await app.request('/api/client-errors')
    expect(getRoot.status).toBe(405)

    const postWrongPath = await app.request('/api/client-errors/logs')
    expect(postWrongPath.status).toBe(404)

    const getLogAttempt = await app.request('/logs/rtwiki.log')
    expect(getLogAttempt.status).toBe(404)
  })
})
