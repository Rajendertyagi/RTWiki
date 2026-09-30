import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'

/**
 * `Cache-Control` on the API.
 *
 * `AGENTS.md` §9 lists `Cache-Control` as a mandatory security header and records
 * that `secureHeaders` does not supply it, leaving four static sites to set it
 * themselves and the entire JSON API uncovered. This closes that half.
 *
 * The interesting part is what the rule must *not* do. A blanket `no-store` on
 * every route would break the two things that were already right — hashed assets
 * are `immutable` and must stay so, and attachment content is addressed by an
 * immutable id where revalidation is meaningful. So the middleware is scoped to
 * `/api/*` and only fills a gap, and both of those are asserted here rather than
 * assumed.
 */
const PORT = 8080

describe('Cache-Control', () => {
  let tempDir: string
  let app: ReturnType<typeof createApp>
  let pageId: string
  let db: ReturnType<typeof initDatabase>

  beforeAll(async () => {
    tempDir = join(tmpdir(), `rtwiki-cachecontrol-${Date.now()}-${randomUUID().slice(0, 8)}`)
    mkdirSync(tempDir, { recursive: true })
    db = initDatabase(tempDir)
    await runMigrations(db)

    const created = (await db
      .query(
        `INSERT INTO pages (id, title, content, page_type, parent_id, position)
         VALUES (?, ?, ?, 'rich', NULL, 0)
         RETURNING id`
      )
      .get(randomUUID(), 'Cache control subject', '[]')) as { id: string }
    pageId = created.id

    const deps: AppDependencies = {
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
      debugEventSink: { append: () => {} },
      host: '127.0.0.1',
      // The attachment routes answer 503 without a data directory
      // (`available: Boolean(deps.dataDir)` in `app.ts`), and the preservation test
      // needs a real attachment served, not a refusal.
      dataDir: tempDir
    }
    app = createApp(deps)
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const HOST_HEADER = { host: `127.0.0.1:${PORT}` }

  it('marks the page list as no-store, which is the leak this closes', async () => {
    // A cached copy of this response could be served after the user deleted the
    // note, and nothing in the app can correct that.
    const res = await app.request('/api/pages', { headers: HOST_HEADER })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks a single page as no-store', async () => {
    const res = await app.request(`/api/pages/${pageId}`, { headers: HOST_HEADER })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks search results as no-store', async () => {
    const res = await app.request('/api/pages?q=Cache', { headers: HOST_HEADER })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks a missing page no-store, so an error cannot outlive the note it names', async () => {
    // Errors derived from page content are page content. An error response that
    // survived in a cache would leak the fact the note once existed.
    const res = await app.request('/api/pages/does-not-exist', { headers: HOST_HEADER })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks a rejected request no-store, including the unrecognised-Host refusal', async () => {
    // The refusal is produced by middleware, before any route, so it needs the
    // header from the same place. A browser that cached it would keep refusing a
    // legitimate request after the user fixed their hosts file.
    const res = await app.request('/api/pages', { headers: { host: 'attacker.example' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('leaves a route with a deliberate policy alone', async () => {
    // Attachment content is addressed by an immutable id, so revalidation is
    // meaningful and the route already says `private, no-cache`. The middleware
    // fills a gap; it must not override a decision a route has made.
    //
    // A **real** attachment, not a missing one: the route's 404 branch sets no
    // header of its own, so asking for a nonexistent id would test the gap-filling
    // rather than the preservation. That distinction is the whole point of the
    // `has()` check, so the test has to reach the path that actually sets a policy.
    const attachmentId = 'cache-control-fixture'
    db.run(
      `INSERT INTO attachments (id, mime_type, byte_size, kind, extracted_text, original_name, checksum, data)
       VALUES (?, 'image/png', 4, 'image', NULL, 'x.png', NULL, X'DEADBEEF')`,
      [attachmentId]
    )

    const res = await app.request(`/api/attachments/${attachmentId}`, { headers: HOST_HEADER })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
  })

  it('marks a missing attachment no-store, because that branch sets no policy', async () => {
    // The counterpart to the test above, and the reason the middleware exists: a
    // route's 404 sets nothing, so the gap-filler is what covers it.
    const res = await app.request('/api/attachments/no-such-attachment', { headers: HOST_HEADER })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does not touch the health check, which is read by a poller', async () => {
    // `/health` is deliberately *not* under `/api`, so the scoping leaves it alone.
    // Stated explicitly because it is the one place the rule's scope is visible
    // from outside: a poller should re-request rather than be served a cached `ok`.
    const res = await app.request('/health', { headers: HOST_HEADER })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).not.toBe('no-store')
  })
})
