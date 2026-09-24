import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShutdownRoutes } from '../src/server/routes/shutdown.js'
import {
  clearShutdownRequest,
  consumeShutdownRequest,
  requestShutdown
} from '../src/server/settings/index.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { SHUTDOWN_REQUEST_FILENAME, SHUTDOWN_TOKEN_HEADER } from '../src/shared/constants/index.js'

/**
 * Shutdown handshake with the desktop shell (ADR-011 pattern, mirroring the
 * restart handshake).
 *
 * Without it the shell cannot tell an authorized shutdown from a crash: it
 * watches the sidecar, sees the process exit, and respawns it — undoing the
 * shutdown. The server therefore records the intent next to the restart flag,
 * and only for requests that passed the token check.
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

describe('shutdown handshake', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtwiki-shutdown-handshake-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('requestShutdown is consumed exactly once', () => {
    expect(consumeShutdownRequest(dir)).toBe(false)
    requestShutdown(dir)
    expect(consumeShutdownRequest(dir)).toBe(true)
    expect(consumeShutdownRequest(dir)).toBe(false)
  })

  it('clearShutdownRequest drops a stale flag', () => {
    requestShutdown(dir)
    clearShutdownRequest(dir)
    expect(consumeShutdownRequest(dir)).toBe(false)
  })

  it('writes the flag into the data dir under the shared filename', () => {
    requestShutdown(dir)
    expect(existsSync(join(dir, SHUTDOWN_REQUEST_FILENAME))).toBe(true)
  })

  it('is a no-op when no data dir is known (browser-only runs)', () => {
    expect(() => requestShutdown('')).not.toThrow()
    expect(consumeShutdownRequest('')).toBe(false)
    expect(() => clearShutdownRequest('')).not.toThrow()
  })
})

describe('shutdown route records the handshake', () => {
  let dir: string
  let token: string
  let routes: ReturnType<typeof createShutdownRoutes>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rtwiki-shutdown-route-'))
    token = randomUUID()
    routes = createShutdownRoutes({ coordinator: makeCoordinator(), token, dataDir: dir })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('an authorized POST records the shutdown handshake', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080', [SHUTDOWN_TOKEN_HEADER]: token }
      })
    )
    expect(res.status).toBe(202)
    expect(consumeShutdownRequest(dir)).toBe(true)
  })

  it('a rejected POST records nothing, so the shell still respawns a crashed sidecar', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080', [SHUTDOWN_TOKEN_HEADER]: 'wrong' }
      })
    )
    expect(res.status).toBe(403)
    expect(existsSync(join(dir, SHUTDOWN_REQUEST_FILENAME))).toBe(false)
  })
})
