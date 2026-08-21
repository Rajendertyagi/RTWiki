import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
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

// ---------- B. Coordinator lifecycle tests ----------

describe('shutdown coordinator lifecycle', () => {
  it('returns 202 and coordinator transitions through states', async () => {
    let stopResolver!: (v: void) => void
    const stopPromise = new Promise<void>((r) => {
      stopResolver = r
    })

    const coordinator = new ShutdownCoordinator({
      stopGracefully: () => stopPromise,
      closeDatabase: () => Promise.resolve(),
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: () => Promise.resolve()
    })

    expect(coordinator.state).toBe('running')

    const token = randomUUID()
    const routes = createShutdownRoutes({ coordinator, token })

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

    // State should be 'stopping' immediately after request
    expect(coordinator.state).toBe('stopping')

    // Resolve the stop to complete shutdown
    stopResolver()
    const result = await coordinator.completed
    expect(result.ok).toBe(true)
    expect(coordinator.state).toBe('stopped')
  })

  it('is idempotent — second requestShutdown returns the same resolved result', async () => {
    const coordinator = new ShutdownCoordinator({
      stopGracefully: () => Promise.resolve(),
      closeDatabase: () => Promise.resolve(),
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: () => Promise.resolve()
    })

    const p1 = coordinator.requestShutdown()
    const p2 = coordinator.requestShutdown()
    expect(p1).toBe(p2)

    const r1 = await p1
    const r2 = await p2
    expect(r1).toEqual(r2)
    expect(r1.ok).toBe(true)
  })

  it('DB closes after server stops, logger closes after DB', async () => {
    const phases: string[] = []

    const coordinator = new ShutdownCoordinator({
      stopGracefully: async () => {
        phases.push('server_stop')
      },
      closeDatabase: async () => {
        phases.push('db_close')
      },
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {
        phases.push('logger_close')
      }
    })

    await coordinator.requestShutdown()
    await coordinator.completed

    expect(phases).toEqual(['server_stop', 'db_close', 'logger_close'])
    expect(coordinator.state).toBe('stopped')
  })

  it('route-level idempotency — second POST also returns 202', async () => {
    const coordinator = new ShutdownCoordinator({
      stopGracefully: () => Promise.resolve(),
      closeDatabase: () => Promise.resolve(),
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: () => Promise.resolve()
    })

    const token = randomUUID()
    const routes = createShutdownRoutes({ coordinator, token })

    const res1 = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: token
        }
      })
    )
    expect(res1.status).toBe(202)

    const res2 = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: token
        }
      })
    )
    expect(res2.status).toBe(202)
  })
})

// ---------- C. Real HTTP integration test ----------

describe('shutdown integration (real HTTP, one shot)', () => {
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

  it('real HTTP: valid POST returns 202, coordinator completes, server stops accepting connections', async () => {
    // Obtain token via in-process fetch (avoids network-path Origin quirks).
    const tokenRes = await runtime.server.fetch(
      new Request(`http://127.0.0.1:${port}/api/shutdown/token`)
    )
    expect(tokenRes.status).toBe(200)
    const { token } = (await tokenRes.json()) as { token: string }
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)

    // Send real HTTP POST (not in-process fetch).
    const shutdownRes = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: {
        [SHUTDOWN_TOKEN_HEADER]: token
      }
    })
    expect(shutdownRes.status).toBe(202)
    const body = (await shutdownRes.json()) as { status: string }
    expect(body.status).toBe('shutting_down')

    // Await coordinator completion deterministically.
    const result = await runtime.coordinator.completed
    expect(result.ok).toBe(true)
    expect(runtime.coordinator.state).toBe('stopped')

    // Server must reject new connections after shutdown.
    await expect(
      fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
    ).rejects.toThrow()
  })

  it('real HTTP: wrong token is rejected with 403', async () => {
    // Re-bootstrap a fresh server for this test since the previous one shut down.
    const fresh = await import('../src/server/bootstrap.js').then((m) =>
      m.bootstrap({ port: 0, openBrowser: false })
    )
    const freshPort = fresh.server.port as number

    const wrongRes = await fetch(`http://127.0.0.1:${freshPort}/api/shutdown`, {
      method: 'POST',
      headers: {
        [SHUTDOWN_TOKEN_HEADER]: 'wrong-token'
      }
    })
    expect(wrongRes.status).toBe(403)

    // Clean up fresh server.
    void fresh.coordinator.requestShutdown()
  })
})
