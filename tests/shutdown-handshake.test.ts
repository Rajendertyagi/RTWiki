import { describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createShutdownRoutes } from '../src/server/routes/shutdown.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { SHUTDOWN_TOKEN_HEADER } from '../src/shared/constants/index.js'

/**
 * Shutdown route security. Ownership is now a process relationship (the shell's
 * Job Object + child handle), so there is no flag file: the route's only job is
 * to authorize the shutdown and trigger the coordinator. These tests prove the
 * token and same-origin guards still hold.
 */

function makeCoordinator(): ShutdownCoordinator {
  return new ShutdownCoordinator({
    stopGracefully: () => Promise.resolve(),
    closeDatabase: () => Promise.resolve(),
    logInfo: () => {},
    logWarn: () => {},
    logError: () => {},
    closeLogger: () => Promise.resolve()
  })
}

describe('shutdown route authorization', () => {
  const token = randomUUID()
  const routes = createShutdownRoutes({ coordinator: makeCoordinator(), token })

  it('an authorized POST triggers shutdown and returns 202', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080', [SHUTDOWN_TOKEN_HEADER]: token }
      })
    )
    expect(res.status).toBe(202)
  })

  it('a wrong token is rejected with 403', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080', [SHUTDOWN_TOKEN_HEADER]: 'wrong' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('a cross-origin POST is rejected with 403', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://evil.com', [SHUTDOWN_TOKEN_HEADER]: token }
      })
    )
    expect(res.status).toBe(403)
  })

  it('GET /token returns the token to a same-origin caller', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/token', {
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { token: string }).token).toBe(token)
  })
})
