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
 * Cross-origin request rejection, at the level a user is actually attacked at.
 *
 * ## The bug this covers
 *
 * A web page the user happens to visit could reach RTWiki's own loopback server.
 * The pages, schedule and schedule-presets routes carried no origin check, the
 * JSON body readers never inspect `Content-Type`, and there is no CORS
 * middleware -- so a CORS-**simple** `POST` with `Content-Type: text/plain` and a
 * JSON body was dispatched with no preflight at all.
 *
 * The worst case is `POST /api/schedule/presets/apply` with `mode: "replace"`,
 * which runs unqualified `DELETE FROM schedule_entries` and
 * `DELETE FROM reminders` (`schedule-repository.ts:150,241`). One request from
 * any page permanently erases the whole timetable.
 *
 * ## The two checks, and why both are tested
 *
 * - `Host` allowlist, on every request. This is the only thing that stops DNS
 *   rebinding, where the browser believes the request is same-origin and so sends
 *   **no** `Origin` and **no** `Sec-Fetch-Site` -- which lands `isSameOrigin` on
 *   its CLI branch, returning `true`.
 * - `isSameOrigin`, on state-changing methods. This stops the ordinary
 *   cross-origin `POST`.
 *
 * A `Host` allowlist alone would still leave the plain cross-origin POST
 * reachable, so the second test below deliberately uses a **valid** Host with a
 * cross-origin `Origin` -- the case the allowlist does not cover.
 */

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-crossorigin-${Date.now()}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
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
    debugEventSink: { append: () => {} },
    host: '127.0.0.1'
  }
}

const ORIGIN = 'http://127.0.0.1:8080'

/** The state-changing routes that were reachable before this guard existed. */
const REACHABLE_ROUTES = [
  {
    method: 'POST',
    path: '/api/pages',
    body: { title: 'Injected', pageType: 'rich', content: '[]' }
  },
  { method: 'POST', path: '/api/schedule/entries', body: { title: 'Injected' } },
  { method: 'POST', path: '/api/schedule/reminders', body: { title: 'Injected' } },
  { method: 'POST', path: '/api/schedule/presets', body: { name: 'Injected' } },
  {
    method: 'POST',
    path: '/api/schedule/presets/apply',
    body: { source: 'any', mode: 'replace' }
  }
]

describe('cross-origin requests are rejected', () => {
  let tempDir: string
  let app: ReturnType<typeof createApp>
  let db: ReturnType<typeof initDatabase>

  beforeAll(async () => {
    tempDir = makeTempDir()
    const deps = makeDeps(tempDir)
    db = deps.getDb()
    await runMigrations(db)
    app = createApp(deps)
  })

  afterAll(async () => {
    // `closeDatabase()`, not `db.close()`. The database handle is a process-wide
    // singleton, and closing the raw handle leaves that singleton pointing at a
    // deleted temp directory. Any later test that calls `bootstrap()` -- which
    // resolves the real runtime paths -- then fails with
    // `SQLiteError: unable to open database file`. `tests/app.test.ts` tears down
    // the same way, and that is the reason.
    await closeDatabase()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  describe('a plain cross-origin POST is refused (valid Host, foreign Origin)', () => {
    it.each(REACHABLE_ROUTES)('refuses $method $path', async ({ method, path, body }) => {
      const res = await app.fetch(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { 'Content-Type': 'text/plain', Origin: 'https://attacker.example' },
          body: JSON.stringify(body)
        })
      )
      expect(res.status, `${method} ${path} must be refused cross-origin`).toBe(403)
    })

    it('refused even when Sec-Fetch-Site says cross-site', async () => {
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/schedule/presets/apply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            Origin: 'https://attacker.example',
            'Sec-Fetch-Site': 'cross-site'
          },
          body: JSON.stringify({ source: 'any', mode: 'replace' })
        })
      )
      expect(res.status).toBe(403)
    })

    it('leaves existing timetable data intact after the blocked request', async () => {
      /**
       * The real proof. An earlier version of this assertion counted rows in an
       * empty database, so it passed whether or not the guard existed -- the
       * destructive `DELETE` ran and deleted nothing. Seeding rows first means
       * this now fails if the guard is ever removed.
       */
      db.run(
        `INSERT INTO schedule_entries (id, recurrence_kind, title, date, start_time, end_time, created_at)
         VALUES ('seed-entry', 'oneoff', 'Chemistry lesson', '2026-10-01', '09:00', '10:00', '2026-10-01T08:00:00Z')`
      )
      db.run(
        `INSERT INTO reminders (id, title, due_datetime, created_at)
         VALUES ('seed-reminder', 'Bring lab notes', '2026-10-01T09:00:00Z', '2026-10-01T08:00:00Z')`
      )

      // The exact attack, with a REAL preset key so that -- without the guard --
      // `applyPreset` genuinely reaches the unqualified DELETEs. An invalid key
      // made the transaction roll back and the rows survive for the wrong
      // reason, which would have been a test that passed with or without the fix.
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/schedule/presets/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', Origin: 'https://attacker.example' },
          body: JSON.stringify({
            source: { type: 'builtin', key: 'builtin:school' },
            mode: 'replace'
          })
        })
      )
      // `applyPreset` with mode "replace" runs unqualified
      // `DELETE FROM schedule_entries` and `DELETE FROM reminders`. The row counts
      // are asserted BEFORE the status code, because the damage is the thing that
      // matters: a 403 with the data already gone would be no comfort at all.
      const entries = db.query('SELECT count(*) AS n FROM schedule_entries').get() as { n: number }
      const reminders = db.query('SELECT count(*) AS n FROM reminders').get() as { n: number }
      expect(entries.n, 'the schedule must not have been wiped').toBe(1)
      expect(reminders.n, 'the reminders must not have been wiped').toBe(1)

      expect(res.status, 'the request must have been refused, not served').toBe(403)
    })
  })

  describe('a rebound Host is refused on every method, including GET', () => {
    it.each(REACHABLE_ROUTES)(
      'refuses $method $path with a foreign Host',
      async ({ path, body }) => {
        const res = await app.fetch(
          new Request(`${ORIGIN}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', Host: 'attacker.example' },
            body: JSON.stringify(body)
          })
        )
        expect(res.status, 'a rebound Host must be refused').toBe(403)
      }
    )

    it('refuses a plain GET carrying a foreign Host', async () => {
      // GET is not state-changing, but under rebinding it is how an attacker
      // reads page contents, which is why the Host check runs on every request.
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/pages`, { headers: { Host: 'attacker.example' } })
      )
      expect(res.status).toBe(403)
    })

    it('refuses the health check with a foreign Host', async () => {
      const res = await app.fetch(
        new Request(`${ORIGIN}/health`, { headers: { Host: 'attacker.example' } })
      )
      expect(res.status).toBe(403)
    })
  })

  describe("the owner's own traffic is not broken (relaxed by design)", () => {
    it('allows a same-origin POST with no browser headers at all', async () => {
      // This is the compiled-executable E2E script and any local automation:
      // a `fetch` with no Origin and no Sec-Fetch-Site. `isSameOrigin` accepts
      // it by design, and it must keep working.
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Made by the E2E script', pageType: 'rich', content: '[]' })
        })
      )
      expect(res.status).toBe(201)
      const row = db
        .query('SELECT title FROM pages WHERE title = ?')
        .get('Made by the E2E script') as { title: string } | null
      expect(row, 'the page must actually have been created').not.toBeNull()
    })

    it('allows an explicit same-origin POST with Origin set', async () => {
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/pages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
          body: JSON.stringify({ title: 'Same origin', pageType: 'rich', content: '[]' })
        })
      )
      expect(res.status).toBe(201)
    })

    it('allows GETs with no headers, so the health check and the shell keep working', async () => {
      const res = await app.fetch(new Request(`${ORIGIN}/health`))
      expect(res.status).toBe(200)
    })

    it.each(['127.0.0.1:8080', 'localhost:8080', '127.0.0.1:9999', '[::1]:8080'])(
      'allows a loopback Host spelled %s',
      async (host) => {
        const res = await app.fetch(new Request(`${ORIGIN}/api/pages`, { headers: { Host: host } }))
        expect(res.status).toBe(200)
      }
    )
  })
})
