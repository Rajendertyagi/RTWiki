import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsRoutes } from '../src/server/routes/settings.js'
import {
  clearRestartRequest,
  consumeRestartRequest,
  isCloseBehavior,
  isValidUserPort,
  readDesktopSettings,
  readServerPort,
  requestRestart,
  writeDesktopSettings,
  writeServerPort
} from '../src/server/settings/index.js'
import { DEFAULT_PORT } from '../src/shared/constants/index.js'

// ---------- helpers ----------

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function putJson(path: string, body: unknown, origin?: string): Request {
  return new Request(`http://127.0.0.1:8080${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {})
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

// ---------- validation ----------

describe('settings validation', () => {
  it('accepts unprivileged integer ports only', () => {
    expect(isValidUserPort(1024)).toBe(true)
    expect(isValidUserPort(8080)).toBe(true)
    expect(isValidUserPort(65535)).toBe(true)
    expect(isValidUserPort(0)).toBe(false)
    expect(isValidUserPort(80)).toBe(false)
    expect(isValidUserPort(1023)).toBe(false)
    expect(isValidUserPort(65536)).toBe(false)
    expect(isValidUserPort(8080.5)).toBe(false)
    expect(isValidUserPort('8080')).toBe(false)
    expect(isValidUserPort(null)).toBe(false)
    expect(isValidUserPort(undefined)).toBe(false)
  })

  it('accepts only known close behaviors', () => {
    expect(isCloseBehavior('ask')).toBe(true)
    expect(isCloseBehavior('minimize')).toBe(true)
    expect(isCloseBehavior('quit')).toBe(true)
    expect(isCloseBehavior('tray')).toBe(false)
    expect(isCloseBehavior('')).toBe(false)
    expect(isCloseBehavior(null)).toBe(false)
  })
})

// ---------- file store ----------

describe('settings file store', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('readServerPort falls back to the default when no file exists', () => {
    expect(readServerPort(dir)).toBe(DEFAULT_PORT)
  })

  it('writeServerPort round-trips through readServerPort', () => {
    writeServerPort(dir, 8090)
    expect(readServerPort(dir)).toBe(8090)
  })

  it('writeServerPort rejects invalid ports without writing', () => {
    expect(() => writeServerPort(dir, 80)).toThrow()
    expect(() => writeServerPort(dir, 0)).toThrow()
    expect(readServerPort(dir)).toBe(DEFAULT_PORT)
  })

  it('readDesktopSettings falls back to ask', () => {
    expect(readDesktopSettings(dir)).toEqual({ closeBehavior: 'ask' })
  })

  it('writeDesktopSettings round-trips through readDesktopSettings', () => {
    writeDesktopSettings(dir, { closeBehavior: 'minimize' })
    expect(readDesktopSettings(dir)).toEqual({ closeBehavior: 'minimize' })
  })

  it('requestRestart is consumed exactly once', () => {
    expect(consumeRestartRequest(dir)).toBe(false)
    requestRestart(dir)
    expect(consumeRestartRequest(dir)).toBe(true)
    expect(consumeRestartRequest(dir)).toBe(false)
  })

  it('clearRestartRequest drops a stale flag', () => {
    requestRestart(dir)
    clearRestartRequest(dir)
    expect(consumeRestartRequest(dir)).toBe(false)
  })
})

// ---------- routes ----------

describe('settings routes', () => {
  let dir: string
  let routes: ReturnType<typeof createSettingsRoutes>

  beforeEach(() => {
    dir = makeTempDir()
    routes = createSettingsRoutes({ dataDir: dir, getCurrentPort: () => 8080 })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('GET /server reports running, configured, and default ports', async () => {
    const res = await routes.fetch(new Request('http://127.0.0.1:8080/server'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.port).toBe(8080)
    expect(body.configuredPort).toBe(DEFAULT_PORT)
    expect(body.defaultPort).toBe(DEFAULT_PORT)
    expect(body.restartRequired).toBe(false)
  })

  it('PUT /server persists a new port and flags restartRequired', async () => {
    const res = await routes.fetch(putJson('/server', { port: 8090 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.port).toBe(8090)
    expect(body.restartRequired).toBe(true)
    expect(readServerPort(dir)).toBe(8090)
  })

  it('PUT /server with the running port reports no restart needed', async () => {
    const res = await routes.fetch(putJson('/server', { port: 8080 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.restartRequired).toBe(false)
  })

  it('PUT /server rejects invalid ports with 400', async () => {
    for (const port of [80, 0, 65536, 8080.5, '8090', null]) {
      const res = await routes.fetch(putJson('/server', { port }))
      expect(res.status).toBe(400)
    }
    expect(readServerPort(dir)).toBe(DEFAULT_PORT)
  })

  it('PUT /server rejects malformed JSON with 400', async () => {
    const res = await routes.fetch(putJson('/server', '{not-json'))
    expect(res.status).toBe(400)
  })

  it('PUT /server with an external Origin is rejected', async () => {
    const res = await routes.fetch(putJson('/server', { port: 8090 }, 'http://evil.com'))
    expect(res.status).toBe(403)
    expect(readServerPort(dir)).toBe(DEFAULT_PORT)
  })

  it('POST /server/restart records a restart request', async () => {
    const res = await routes.fetch(
      new Request('http://127.0.0.1:8080/server/restart', { method: 'POST' })
    )
    expect(res.status).toBe(200)
    expect(consumeRestartRequest(dir)).toBe(true)
  })

  it('GET /desktop reports the default close behavior', async () => {
    const res = await routes.fetch(new Request('http://127.0.0.1:8080/desktop'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ closeBehavior: 'ask' })
  })

  it('PUT /desktop persists a valid close behavior', async () => {
    const res = await routes.fetch(putJson('/desktop', { closeBehavior: 'quit' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ closeBehavior: 'quit' })
    expect(readDesktopSettings(dir)).toEqual({ closeBehavior: 'quit' })
  })

  it('PUT /desktop rejects unknown behaviors with 400', async () => {
    const res = await routes.fetch(putJson('/desktop', { closeBehavior: 'tray' }))
    expect(res.status).toBe(400)
    expect(readDesktopSettings(dir)).toEqual({ closeBehavior: 'ask' })
  })
})
