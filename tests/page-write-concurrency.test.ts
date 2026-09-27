import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import * as repo from '../src/server/repositories/page-repository.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

// Namespace imports (never named ones) so a missing export surfaces as a
// failing assertion rather than a module-link error while the fix is pending.

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-concurrency-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

function makeDeps(tempDir: string): AppDependencies {
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
    debugEventSink: { append: () => {} }
  }
}

interface StoredRow {
  title: string
  content: string
  version: number
  updated_at: string
}

describe('page write concurrency control', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
    app = createApp(makeDeps(tempDir))
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  /** The stored row exactly as SQLite holds it, for byte-level comparison. */
  function storedRow(id: string): StoredRow {
    return db
      .query('SELECT title, content, version, updated_at FROM pages WHERE id = ?')
      .get(id) as StoredRow
  }

  function storedIndexContent(id: string): string {
    const row = db.query('SELECT content FROM search_index WHERE page_id = ?').get(id) as {
      content: string
    } | null
    return row?.content ?? ''
  }

  const BASE = 'http://127.0.0.1:8080'

  async function createPage(
    title: string,
    content: string
  ): Promise<{ id: string; version: number }> {
    const res = await app.fetch(
      new Request(`${BASE}/api/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pageType: 'rich', content })
      })
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { page: { id: string; version: number } }
    return body.page
  }

  async function patch(
    id: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; error?: string }> {
    const res = await app.fetch(
      new Request(`${BASE}/api/pages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
    const parsed = (await res.json()) as { error?: string }
    return { status: res.status, error: parsed.error }
  }

  // ---- repository / service level ----------------------------------------

  it('applies an update that carries the current version and increments it', () => {
    const page = repo.createPage(db, crypto.randomUUID(), 'CAS success', 'rich', 'v1', 'v1')
    expect(page.version).toBe(1)

    const updated = repo.updatePage(db, page.id, { content: 'v2', version: page.version })
    expect(updated?.content).toBe('v2')
    expect(updated?.version).toBe(2)
    expect(storedRow(page.id).content).toBe('v2')
  })

  it('rejects a stale version and leaves the stored row byte-for-byte unchanged', () => {
    const page = repo.createPage(
      db,
      crypto.randomUUID(),
      'CAS stale',
      'rich',
      'original content',
      'original content'
    )
    const indexBefore = storedIndexContent(page.id)
    expect(indexBefore).toBe('original content')

    // The other tab already saved, so the stale client's version no longer matches.
    repo.updatePage(db, page.id, { content: 'written by the other tab', version: page.version })
    const afterOtherTab = storedRow(page.id)
    expect(afterOtherTab.version).toBe(2)

    let thrown: unknown
    try {
      repo.updatePage(db, page.id, { content: 'stale overwrite attempt', version: page.version })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(repo.PageVersionConflictError)
    const after = storedRow(page.id)
    expect(after.content).toBe(afterOtherTab.content)
    expect(after.content).not.toBe('stale overwrite attempt')
    expect(after.title).toBe(afterOtherTab.title)
    expect(after.version).toBe(afterOtherTab.version)
    expect(after.updated_at).toBe(afterOtherTab.updated_at)
    // The search index must not be touched by a rejected write either.
    expect(storedIndexContent(page.id)).toBe('written by the other tab')
  })

  it('reports the expected and actual version on the conflict', () => {
    const page = repo.createPage(db, crypto.randomUUID(), 'CAS detail', 'rich', 'x', 'x')
    repo.updatePage(db, page.id, { content: 'y', version: 1 })
    repo.updatePage(db, page.id, { content: 'z', version: 2 })

    let thrown: InstanceType<(typeof repo)['PageVersionConflictError']> | null = null
    try {
      repo.updatePage(db, page.id, { content: 'late', version: 1 })
    } catch (err) {
      thrown = err as InstanceType<(typeof repo)['PageVersionConflictError']>
    }
    expect(thrown).not.toBeNull()
    expect(thrown?.expectedVersion).toBe(1)
    expect(thrown?.actualVersion).toBe(3)
  })

  it('still returns null for a missing page (404 path is unchanged)', () => {
    const result = repo.updatePage(db, '00000000-0000-0000-0000-000000000000', {
      content: 'x',
      version: 1
    })
    expect(result).toBeNull()
  })

  it('a no-field update does not bump the version', () => {
    const page = repo.createPage(db, crypto.randomUUID(), 'CAS noop', 'rich', 'body', 'body')
    const result = repo.updatePage(db, page.id, { version: page.version })
    expect(result?.version).toBe(1)
    expect(storedRow(page.id).version).toBe(1)
  })

  // ---- HTTP level --------------------------------------------------------

  it('serves an update that carries the current version', async () => {
    const page = await createPage('HTTP CAS success', 'before')
    const res = await patch(page.id, { content: 'after', version: page.version })
    expect(res.status).toBe(200)
  })

  it('returns 409 for a stale version and changes nothing', async () => {
    const page = await createPage('HTTP CAS stale', 'stored bytes')
    expect((await patch(page.id, { content: 'tab A', version: page.version })).status).toBe(200)
    const afterTabA = storedRow(page.id)

    const stale = await patch(page.id, { content: 'tab B', version: page.version })
    expect(stale.status).toBe(409)
    expect(typeof stale.error).toBe('string')
    expect(stale.error?.length ?? 0).toBeGreaterThan(0)

    const afterStale = storedRow(page.id)
    expect(afterStale.content).toBe(afterTabA.content)
    expect(afterStale.content).toBe('tab A')
    expect(afterStale.version).toBe(afterTabA.version)
    expect(afterStale.updated_at).toBe(afterTabA.updated_at)
  })

  it('rejects a missing version by validation instead of treating it as a match', async () => {
    const page = await createPage('HTTP CAS missing version', 'untouched')
    const before = storedRow(page.id)

    const res = await patch(page.id, { content: 'no version supplied' })
    expect(res.status).toBe(400)
    expect(typeof res.error).toBe('string')
    expect(res.error?.length ?? 0).toBeGreaterThan(0)

    const after = storedRow(page.id)
    expect(after.content).toBe(before.content)
    expect(after.version).toBe(before.version)
  })

  it('rejects a non-integer or non-positive version', async () => {
    const page = await createPage('HTTP CAS bad version', 'untouched')
    expect((await patch(page.id, { content: 'x', version: 0 })).status).toBe(400)
    expect((await patch(page.id, { content: 'x', version: 1.5 })).status).toBe(400)
    expect((await patch(page.id, { content: 'x', version: String(page.version) })).status).toBe(400)
    expect(storedRow(page.id).content).toBe('untouched')
  })

  it('two sequential clients: the first write succeeds, the second is rejected', async () => {
    const page = await createPage('Two tabs', 'shared start')

    // Both tabs loaded the same version.
    const clientA = page.version
    const clientB = page.version

    const first = await patch(page.id, { content: 'client A text', version: clientA })
    expect(first.status).toBe(200)

    const second = await patch(page.id, { content: 'client B text', version: clientB })
    expect(second.status).toBe(409)

    expect(storedRow(page.id).content).toBe('client A text')
    expect(storedRow(page.id).version).toBe(clientA + 1)
  })

  it('the client can keep writing after re-reading the new version', async () => {
    const page = await createPage('Recovery', 'v1')
    expect((await patch(page.id, { content: 'v2', version: page.version })).status).toBe(200)

    const res = await app.fetch(new Request(`${BASE}/api/pages/${page.id}`))
    const { page: reloaded } = (await res.json()) as { page: { version: number } }

    expect((await patch(page.id, { content: 'v3', version: reloaded.version })).status).toBe(200)
    expect(storedRow(page.id).content).toBe('v3')
    expect(storedRow(page.id).version).toBe(3)
  })

  it('a title rename is version-guarded too', async () => {
    const page = await createPage('Rename guard', 'body')
    expect((await patch(page.id, { title: 'Renamed', version: page.version })).status).toBe(200)
    const stale = await patch(page.id, { title: 'Stale rename', version: page.version })
    expect(stale.status).toBe(409)
    expect(storedRow(page.id).title).toBe('Renamed')
  })
})

describe('search query bound', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
    app = createApp(makeDeps(tempDir))
    repo.createPage(db, crypto.randomUUID(), 'Searchable Bound', 'rich', 'needle', 'needle')
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  const BASE = 'http://127.0.0.1:8080'

  it('accepts a normal-length query and finds the page', async () => {
    const res = await app.fetch(new Request(`${BASE}/api/pages?q=Bound`))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pages: Array<{ title: string }> }
    expect(body.pages.some((p) => p.title === 'Searchable Bound')).toBe(true)
  })

  it('rejects an over-long query with a clear, actionable error', async () => {
    const long = 'a'.repeat(5000)
    const res = await app.fetch(new Request(`${BASE}/api/pages?q=${long}`))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('accepts a query at the ceiling and rejects one character over', async () => {
    const probe = async (length: number): Promise<number> => {
      const res = await app.fetch(new Request(`${BASE}/api/pages?q=${'a'.repeat(length)}`))
      return res.status
    }
    // 200 characters is the documented ceiling: far beyond any real search
    // phrase. One character more is refused, never silently truncated.
    expect(await probe(200)).toBe(200)
    expect(await probe(201)).toBe(400)
  })
})
