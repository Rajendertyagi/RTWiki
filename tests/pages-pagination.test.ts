import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import type { Page } from '../src/shared/contracts/pages.js'
import { listAllPages, listPages, PAGE_LIST_BATCH_LIMIT } from '../src/web/services/pages-api.js'

// ---------- shared helpers ----------

function makePage(id: string, title: string): Page {
  const now = new Date().toISOString()
  return {
    id,
    title,
    content: '',
    pageType: 'rich',
    parentId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1
  }
}

interface ListCall {
  url: string
  limit: number
  offset: number
}

/** Original fetch captured before any stubbing so foreign calls pass through. */
const realFetch = globalThis.fetch
const pristineFetch = realFetch as (input: unknown, init?: RequestInit) => Promise<Response>

function isPageListGet(input: unknown): boolean {
  const url = new URL(String(input), 'http://localhost')
  return url.pathname === '/api/pages'
}

/**
 * Installs a fetch stub serving windows of `dataset` through the real
 * /api/pages query contract (limit/offset/total). Any other request chains
 * to the pristine fetch, so the stub stays harmless even if another test
 * file executes while it is installed. Returns a restore fn.
 */
function serveWindows(dataset: Page[], onCall?: (call: ListCall) => void): () => void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    // The service uses browser-style relative URLs; give them a base here.
    if (!isPageListGet(input)) return pristineFetch(input, init)
    const url = new URL(String(input), 'http://localhost')
    const limit = Number(url.searchParams.get('limit')) || 50
    const offset = Number(url.searchParams.get('offset')) || 0
    onCall?.({ url: url.search, limit, offset })
    const body = JSON.stringify({
      pages: dataset.slice(offset, offset + limit),
      total: dataset.length
    })
    return new Response(body, { status: 200 })
  }) as unknown as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

// ---------- unit tests: complete pagination over synthetic windows ----------

describe('listAllPages pagination', () => {
  let restore: () => void

  afterAll(() => restore?.())

  it('retrieves more than one full window completely', async () => {
    const dataset = Array.from({ length: 120 }, (_, i) => makePage(`p${i}`, `Page ${i}`))
    const calls: ListCall[] = []
    restore = serveWindows(dataset, (call) => calls.push(call))

    const result = await listAllPages()

    expect(result.pages.length).toBe(120)
    expect(result.total).toBe(120)
    expect(new Set(result.pages.map((p) => p.id)).size).toBe(120)
    // Every batch uses the bounded window size and advances by what it got.
    expect(calls.length).toBe(Math.ceil(120 / PAGE_LIST_BATCH_LIMIT))
    for (const call of calls) expect(call.limit).toBe(PAGE_LIST_BATCH_LIMIT)
    expect(calls[0]?.offset).toBe(0)
    expect(calls[1]?.offset).toBe(PAGE_LIST_BATCH_LIMIT)
  })

  it('stops after a single request when everything fits in one window', async () => {
    const dataset = Array.from({ length: 7 }, (_, i) => makePage(`q${i}`, `Page ${i}`))
    const calls: ListCall[] = []
    restore = serveWindows(dataset, (call) => calls.push(call))

    const result = await listAllPages()

    expect(result.pages.length).toBe(7)
    expect(calls.length).toBe(1)
  })

  it('drops duplicate ids that appear across window boundaries', async () => {
    const dataset = Array.from({ length: 60 }, (_, i) => makePage(`d${i}`, `Page ${i}`))
    // Simulate row drift: the first id reappears in the second window.
    const drifted = [...dataset]
    drifted.splice(PAGE_LIST_BATCH_LIMIT, 0, dataset[0])
    restore = serveWindows(drifted)

    const result = await listAllPages()

    expect(result.pages.filter((p) => p.id === 'd0').length).toBe(1)
    expect(new Set(result.pages.map((p) => p.id)).size).toBe(60)
  })

  it('rejects without publishing partial state when a later batch fails', async () => {
    const dataset = Array.from({ length: 100 }, (_, i) => makePage(`f${i}`, `Page ${i}`))
    let callCount = 0
    globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
      if (!isPageListGet(input)) return pristineFetch(input, init)
      callCount += 1
      if (callCount > 1) return new Response('boom', { status: 500 })
      const body = JSON.stringify({
        pages: dataset.slice(0, PAGE_LIST_BATCH_LIMIT),
        total: dataset.length
      })
      return new Response(body, { status: 200 })
    }) as unknown as typeof fetch
    restore = () => {
      globalThis.fetch = realFetch
    }

    let resolvedPages: Page[] | null = null
    await expect(
      listAllPages().then((result) => {
        resolvedPages = result.pages
        return result
      })
    ).rejects.toThrow()
    // The caller never receives a partial collection.
    expect(resolvedPages).toBeNull()
  })
})

// ---------- integration test: real app, real DB, >50 pages ----------

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-pag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('listAllPages against the running API', () => {
  let tempDir: string
  let deps: AppDependencies
  let app: ReturnType<typeof createApp>
  let restoreFetch: () => void

  beforeAll(async () => {
    tempDir = makeTempDir()
    const db = initDatabase(tempDir)
    deps = {
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
      frontendDistDir: ''
    }
    await runMigrations(deps.getDb())
    app = createApp(deps)

    // Seed beyond the default window synchronously through the repository
    // (setup only): 55 roots plus one parent whose child sorts outside the
    // first window. Wide async setup windows interleave with other test
    // files in this suite, so keep hooks tight.
    const { createPage } = await import('../src/server/repositories/page-repository.js')
    for (let i = 0; i < 55; i++) {
      const parent = createPage(deps.getDb(), randomUUID(), `SeedRoot${i}`, 'rich', '', '', {
        parentId: null,
        position: i
      })
      if (i === 0) {
        createPage(deps.getDb(), randomUUID(), 'BoundaryChild', 'rich', '', '', {
          parentId: parent.id,
          position: 0
        })
      }
    }

    // Route the web service through the in-process app; foreign requests
    // chain to the pristine fetch so interleaved test files are unaffected.
    globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
      if (!isPageListGet(input)) return pristineFetch(input, init)
      return app.fetch(new Request(new URL(String(input), 'http://localhost'), init))
    }) as unknown as typeof fetch
    restoreFetch = () => {
      globalThis.fetch = realFetch
    }
  })

  afterAll(() => {
    restoreFetch?.()
    void closeDatabase()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('returns every page including hierarchy spanning window boundaries', async () => {
    // Sanity: the single-window default really does truncate this dataset.
    const singleWindow = await listPages(undefined)
    expect(singleWindow.total).toBeGreaterThan(PAGE_LIST_BATCH_LIMIT)
    expect(singleWindow.pages.length).toBe(PAGE_LIST_BATCH_LIMIT)

    const result = await listAllPages()
    expect(result.total).toBe(56) // 55 roots + 1 boundary child
    expect(result.pages.length).toBe(56)
    const titles = new Set(result.pages.map((p) => p.title))
    expect(titles.has('SeedRoot0')).toBe(true)
    expect(titles.has('SeedRoot54')).toBe(true)
    // Parent and child both survive complete retrieval.
    const child = result.pages.find((p) => p.title === 'BoundaryChild')
    expect(child).toBeDefined()
    const parent = result.pages.find((p) => p.id === child?.parentId)
    expect(parent?.title).toBe('SeedRoot0')
  })
})
