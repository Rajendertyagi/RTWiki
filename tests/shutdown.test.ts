import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createShutdownRoutes } from '../src/server/routes/shutdown.js'
import type { ShutdownResult as CoordinatorResult } from '../src/server/shutdown-coordinator.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { SHUTDOWN_TOKEN_HEADER } from '../src/shared/constants/index.js'

// ---------- helpers ----------

function makeFakeCoordinator(): {
  coordinator: ShutdownCoordinator
  requestShutdownSpy: ReturnType<typeof mock>
} {
  const requestShutdownSpy = mock(() =>
    Promise.resolve({ ok: true, forced: false } as CoordinatorResult)
  )
  const coordinator = new ShutdownCoordinator({
    stopGracefully: requestShutdownSpy as unknown as () => Promise<void>,
    closeDatabase: mock(() => Promise.resolve()),
    logInfo: mock(),
    logWarn: mock(),
    logError: mock(),
    closeLogger: mock(() => Promise.resolve())
  })
  return { coordinator, requestShutdownSpy }
}

function makeToken(): string {
  return randomUUID()
}

// ---------- A. Pure route tests ----------

describe('shutdown routes (pure)', () => {
  let coordinator: ShutdownCoordinator
  let token: string
  let routes: ReturnType<typeof createShutdownRoutes>

  beforeEach(() => {
    const fake = makeFakeCoordinator()
    coordinator = fake.coordinator
    token = makeToken()
    routes = createShutdownRoutes({ coordinator, token })
  })

  // --- GET /token ---

  it('GET /token with matching Origin returns 200 and a token', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
  })

  it('GET /token without browser headers returns 200 (CLI path)', async () => {
    const res = await routes.fetch(new Request('http://127.0.0.1:8080/token'))
    expect(res.status).toBe(200)
  })

  it('GET /token with external Origin is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'http://evil.com' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with Origin:null is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'null' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with malformed Origin is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'not-a-url' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with Sec-Fetch-Site: cross-site is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { 'Sec-Fetch-Site': 'cross-site' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with Sec-Fetch-Site: same-site is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { 'Sec-Fetch-Site': 'same-site' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with Sec-Fetch-Site: none is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { 'Sec-Fetch-Site': 'none' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token with localhost origin against 127.0.0.1 URL is rejected', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'http://localhost' }
      })
    )
    expect(res.status).toBe(403)
  })

  // --- POST / (shutdown) ---

  it('POST / without token is rejected (403)', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid shutdown token')
  })

  it('POST / with wrong token is rejected (403)', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: 'wrong-token'
        }
      })
    )
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Invalid shutdown token')
  })

  it('POST / with correct token returns 202 immediately', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: token
        }
      })
    )
    expect(res.status).toBe(202)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('shutting_down')
  })

  it('POST / response body is exactly {"status":"shutting_down"}', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: token
        }
      })
    )
    const body = await res.text()
    expect(body).toBe('{"status":"shutting_down"}')
  })

  it('GET / (non-token path) returns 405', async () => {
    const res = await routes.fetch(new Request('http://127.0.0.1:8080/', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('PUT / returns 405', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'PUT',
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(405)
  })

  it('token never appears in 403 response bodies', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: 'wrong'
        }
      })
    )
    const body = await res.text()
    expect(body).not.toContain(token)
  })

  // --- timingSafeEqual ---

  it('timingSafeEqual: equal ASCII strings return true', () => {
    const { timingSafeEqualStrings } = require('../src/server/routes/shutdown.js') as {
      timingSafeEqualStrings: (a: string, b: string) => boolean
    }
    expect(timingSafeEqualStrings('abc', 'abc')).toBe(true)
  })

  it('timingSafeEqual: different strings return false', () => {
    const { timingSafeEqualStrings } = require('../src/server/routes/shutdown.js') as {
      timingSafeEqualStrings: (a: string, b: string) => boolean
    }
    expect(timingSafeEqualStrings('abc', 'abd')).toBe(false)
  })

  it('timingSafeEqual: different byte lengths return false', () => {
    const { timingSafeEqualStrings } = require('../src/server/routes/shutdown.js') as {
      timingSafeEqualStrings: (a: string, b: string) => boolean
    }
    // '€' is 3 bytes in UTF-8; 'a' is 1 byte.
    expect(timingSafeEqualStrings('a', '€')).toBe(false)
  })

  it('timingSafeEqual: non-ASCII equal strings return true', () => {
    const { timingSafeEqualStrings } = require('../src/server/routes/shutdown.js') as {
      timingSafeEqualStrings: (a: string, b: string) => boolean
    }
    expect(timingSafeEqualStrings('café', 'café')).toBe(true)
  })
})

// ---------- C. Real network lifecycle integration test ----------

describe('shutdown integration (real server, one shot)', () => {
  let runtime: Awaited<ReturnType<typeof import('../src/server/bootstrap.js').bootstrap>>
  let port: number

  beforeAll(async () => {
    runtime = await import('../src/server/bootstrap.js').then((m) =>
      m.bootstrap({ port: 0, openBrowser: false })
    )
    port = runtime.server.port as number
  })

  afterAll(async () => {
    // The coordinator owns the only shutdown path; do not call runtime.shutdown()
    // again — the integration test below triggers the real one.
  })

  it('single valid shutdown: 202 then coordinator completes', async () => {
    // Obtain token via in-process fetch (avoids network-path Origin quirks).
    const tokenRes = await runtime.server.fetch(
      new Request(`http://127.0.0.1:${port}/api/shutdown/token`)
    )
    expect(tokenRes.status).toBe(200)
    const { token } = (await tokenRes.json()) as { token: string }
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)

    // Send one valid POST.
    const shutdownRes = await runtime.server.fetch(
      new Request(`http://127.0.0.1:${port}/api/shutdown`, {
        method: 'POST',
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          [SHUTDOWN_TOKEN_HEADER]: token
        }
      })
    )
    expect(shutdownRes.status).toBe(202)
    const body = (await shutdownRes.json()) as { status: string }
    expect(body.status).toBe('shutting_down')

    // Verify coordinator completes.
    const result = await runtime.coordinator.completed
    expect(result.ok).toBe(true)
    expect(runtime.coordinator.state).toBe('stopped')

    // Do NOT send further requests — the server is gone.
  })
})
