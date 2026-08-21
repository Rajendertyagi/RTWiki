import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import { SHUTDOWN_TOKEN_HEADER } from '../src/shared/constants/index.js'

// ---------- helpers ----------

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-app-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function makeDeps(tempDir: string, overrides: Partial<AppDependencies> = {}): AppDependencies {
  const db = initDatabase(tempDir)
  return {
    coordinator: new ShutdownCoordinator({
      stopGracefully: async () => {},
      closeDatabase: async () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {}
    }),
    token: randomUUID(),
    getDb: () => db,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      close: async () => {}
    } as unknown as import('../src/server/logging/index.js').Logger,
    frontendDistDir: '',
    ...overrides
  }
}

// ---------- createApp tests ----------

describe('createApp factory', () => {
  let tempDir: string
  let deps: AppDependencies

  beforeAll(async () => {
    tempDir = makeTempDir()
    deps = makeDeps(tempDir)
    await runMigrations(deps.getDb())
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('creates a Hono app with health endpoint returning 200 and RTWiki info', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1:8080/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      app: string
      version: string
      db: { ready: boolean }
    }
    expect(body.status).toBe('ok')
    expect(body.app).toBe('RTWiki')
    expect(body.version).toBe('0.1.0')
    expect(body.db).toEqual({ ready: true })
  })

  it('returns security headers on every response', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1:8080/health'))
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Permissions-Policy')).toBeTruthy()
  })

  it('page routes work through the app', async () => {
    const app = createApp(deps)

    // Create a page.
    const createRes = await app.fetch(
      new Request('http://127.0.0.1:8080/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'App Test Page', pageType: 'rich', content: '{}' })
      })
    )
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { page: { id: string; title: string } }
    expect(created.page.id).toBeDefined()
    expect(created.page.title).toBe('App Test Page')

    // List pages.
    const listRes = await app.fetch(new Request('http://127.0.0.1:8080/api/pages'))
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { pages: Array<{ id: string; title: string }> }
    expect(list.pages.some((p) => p.id === created.page.id)).toBe(true)
  })

  it('shutdown route GET /token with matching Origin returns 200', async () => {
    const app = createApp(deps)
    const res = await app.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown/token', {
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string }
    expect(typeof body.token).toBe('string')
    expect(body.token.length).toBeGreaterThan(0)
  })

  it('shutdown route POST / with correct token returns 202', async () => {
    const coordinator = new ShutdownCoordinator({
      stopGracefully: async () => {},
      closeDatabase: async () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {}
    })
    const token = randomUUID()
    const app = createApp({ ...deps, coordinator, token })

    const res = await app.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
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

  it('shutdown route without token returns 403', async () => {
    const app = createApp(deps)
    const res = await app.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    expect(res.status).toBe(403)
  })

  it('injected coordinator is used — not the default export', async () => {
    let stopCalled = false
    let stopResolve!: () => void
    const stopPromise = new Promise<void>((r) => {
      stopResolve = r
    })

    const customCoordinator = new ShutdownCoordinator({
      stopGracefully: async () => {
        stopCalled = true
        await stopPromise
      },
      closeDatabase: async () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {}
    })

    const app = createApp({ ...deps, coordinator: customCoordinator, token: 'test-token' })

    const res = await app.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: 'test-token'
        }
      })
    )
    // 202 is returned immediately; stopGracefully was invoked but not yet completed.
    expect(res.status).toBe(202)
    expect(stopCalled).toBe(true) // invoked synchronously before the await
    expect(customCoordinator.state).toBe('stopping') // not yet resolved

    // Release the deferred stop.
    stopResolve()
    await customCoordinator.completed
    expect(customCoordinator.state).toBe('stopped')
  })

  it('two app instances are isolated — different tokens, different coordinators', async () => {
    const appA = createApp(makeDeps(tempDir))
    const appB = createApp(makeDeps(tempDir))

    // Each app has its own token.
    const tokenARes = await appA.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown/token', {
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    const tokenBRes = await appB.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown/token', {
        headers: { Origin: 'http://127.0.0.1:8080' }
      })
    )
    const tokenA = (await tokenARes.json()) as { token: string }
    const tokenB = (await tokenBRes.json()) as { token: string }
    expect(tokenA.token).not.toBe(tokenB.token)

    // Each app accepts its own token independently.
    const resA = await appA.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: tokenA.token
        }
      })
    )
    const resB = await appB.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: tokenB.token
        }
      })
    )
    expect(resA.status).toBe(202)
    expect(resB.status).toBe(202)

    // A wrong token for appA is rejected by appA (not confused with appB's token).
    const wrongRes = await appA.fetch(
      new Request('http://127.0.0.1:8080/api/shutdown', {
        method: 'POST',
        headers: {
          Origin: 'http://127.0.0.1:8080',
          [SHUTDOWN_TOKEN_HEADER]: tokenB.token
        }
      })
    )
    expect(wrongRes.status).toBe(403)
  })

  it('404 for unknown routes', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1:8080/nonexistent'))
    expect(res.status).toBe(404)
  })
})
