import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

interface Operation {
  tags?: string[]
  operationId?: string
  summary?: string
}
interface Spec {
  paths?: Record<string, Record<string, Operation | undefined>>
}
interface Tool {
  name: string
  description: string
  method: string
  path: string
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-openapi-${Date.now()}-${randomUUID().slice(0, 8)}`)
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

function taggedOperations(spec: Spec): string[] {
  const result: string[] = []
  for (const [path, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations ?? {})) {
      if (operation?.tags?.includes('ai-safe')) result.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return result.sort()
}

describe('OpenAPI document and derived AI tool manifest', () => {
  let tempDir: string
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    tempDir = makeTempDir()
    const db = initDatabase(tempDir)
    await runMigrations(db)
    app = createApp(makeDeps(tempDir, db))
    // An untagged route added after construction must never reach the manifest.
    app.get('/api/untagged-probe', (c) => c.json({ ok: true }))
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('serves a byte-identical cached document on two consecutive reads', async () => {
    const first = await app.request('/openapi.json')
    const second = await app.request('/openapi.json')
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await first.text()).toBe(await second.text())
  })

  it('contains parent routes and app.route()-mounted child routes with tags intact', async () => {
    const spec = (await (await app.request('/openapi.json')).json()) as Spec
    const tagged = taggedOperations(spec)
    // Parent routes declared directly on the root app's children.
    expect(tagged).toContain('GET /api/pages')
    expect(tagged).toContain('POST /api/pages')
    expect(tagged).toContain('POST /api/pages/batch')
    // Routes mounted through app.route() on separate Hono instances.
    expect(tagged).toContain('GET /api/attachments/{id}')
    expect(tagged).toContain('POST /api/import')
    expect(tagged).toContain('GET /api/schedule/entries')
    expect(tagged).toContain('GET /api/settings/server')
    // Every tagged operation really carries the tag in the document.
    expect(tagged.length).toBeGreaterThan(0)
  })

  it('derives the tool manifest from the tagged operations only', async () => {
    const spec = (await (await app.request('/openapi.json')).json()) as Spec
    const tagged = taggedOperations(spec)
    const toolsRes = await app.request('/api/ai/tools')
    expect(toolsRes.status).toBe(200)
    const body = (await toolsRes.json()) as { tools: Tool[] }
    const derived = body.tools.map((tool) => `${tool.method} ${tool.path}`).sort()
    expect(derived).toEqual(tagged)
    // Names and descriptions come from the spec, not a second hand-written list.
    for (const tool of body.tools) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('never exposes an untagged route', async () => {
    const body = (await (await app.request('/api/ai/tools')).json()) as { tools: Tool[] }
    expect(body.tools.some((tool) => tool.path === '/api/untagged-probe')).toBe(false)
    const spec = (await (await app.request('/openapi.json')).json()) as Spec
    expect(Object.keys(spec.paths ?? {}).some((path) => path.includes('untagged-probe'))).toBe(
      false
    )
  })

  it('excludes every destructive or irreversible operation', async () => {
    const body = (await (await app.request('/api/ai/tools')).json()) as { tools: Tool[] }
    const paths = body.tools.map((tool) => tool.path)
    expect(paths.some((path) => path.includes('/permanent'))).toBe(false)
    expect(paths.some((path) => path.includes('/backup'))).toBe(false)
    expect(paths.some((path) => path.includes('/shutdown'))).toBe(false)
    expect(paths.some((path) => path.includes('/presets/apply'))).toBe(false)
    // Settings writes are PUT; only the GET reads are tagged.
    expect(body.tools.some((tool) => tool.method === 'PUT')).toBe(false)

    // Recovery surfaces are deliberately untagged. Trash listing (pages and
    // attachments), revision history and undo, and attachment restore all
    // expose or mutate soft-deleted state and must never reach the manifest.
    // (POST /api/pages/{id}/restore IS intentionally ai-safe, so the restore
    // check is scoped to attachments only.)
    expect(paths.some((path) => path.includes('/trash'))).toBe(false)
    expect(paths.some((path) => path.includes('/revisions'))).toBe(false)
    expect(paths.some((path) => path.includes('/attachments/') && path.includes('/restore'))).toBe(
      false
    )
    // Inline document rendering is a separate, sandboxed path, not an AI tool.
    expect(paths.some((path) => path.includes('/view'))).toBe(false)
    // Only the GET reads on /api/schedule are tagged; every write (POST/PATCH/
    // DELETE on entries, reminders and presets) stays out of the manifest.
    expect(
      body.tools.some((tool) => tool.path.includes('/api/schedule') && tool.method !== 'GET')
    ).toBe(false)
  })
})
