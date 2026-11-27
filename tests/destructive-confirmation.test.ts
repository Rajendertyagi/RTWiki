import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

const ORIGIN = 'http://localhost'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-confirm-${Date.now()}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeDeps(tempDir: string, db: ReturnType<typeof initDatabase>): AppDependencies {
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
    dataDir: tempDir,
    debugEventSink: { append: () => {} },
    host: '127.0.0.1'
  }
}

let tempDir: string
let app: ReturnType<typeof createApp>

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: { origin: ORIGIN, ...(init.headers ?? {}) }
  })
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('irreversible operations require ?confirm=permanent', () => {
  beforeAll(async () => {
    tempDir = makeTempDir()
    const db = initDatabase(tempDir)
    await runMigrations(db)
    app = createApp(makeDeps(tempDir, db))
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('refuses permanent page deletion without confirmation', async () => {
    const res = await request(`/api/pages/${randomUUID()}/permanent`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Permanent deletion requires confirmation',
      code: 'confirmation_required'
    })
  })

  it('refuses permanent attachment deletion without confirmation', async () => {
    const res = await request(`/api/attachments/${randomUUID()}/permanent`, { method: 'DELETE' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Confirmation required',
      code: 'confirmation_required'
    })
  })

  it('refuses preset replace without confirmation', async () => {
    const res = await postJson('/api/schedule/presets/apply', {
      source: { type: 'builtin', key: 'builtin:blank' },
      mode: 'replace'
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Replacing the timetable requires confirmation',
      code: 'confirmation_required'
    })
  })

  it('does not require confirmation for the non-destructive add mode', async () => {
    const res = await postJson('/api/schedule/presets/apply', {
      source: { type: 'builtin', key: 'builtin:blank' },
      mode: 'add'
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('accepts preset replace when the query parameter is present', async () => {
    const res = await postJson('/api/schedule/presets/apply?confirm=permanent', {
      source: { type: 'builtin', key: 'builtin:blank' },
      mode: 'replace'
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true)
  })
})
