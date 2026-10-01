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
 * The JSON media-type rule, at the level a user is actually attacked at.
 *
 * `tests/json-body-media-type.test.ts` proves the rule inside the shared reader.
 * This proves the *route* uses it, because those are different failure modes: a
 * reader with the rule and a route that bypassed it is exactly the arrangement
 * found in the document half of attachments — a correct helper
 * with nothing calling it, which reads as coverage and is not.
 *
 * The attack form is the one that needs no preflight. A cross-origin `POST` with
 * `Content-Type: text/plain` is CORS-simple, so the browser dispatches it
 * unconditionally and the attacker never reads the reply. Requiring
 * `application/json` removes the free pass, because a cross-origin `fetch` carrying
 * that header preflights, and RTWiki answers a preflight with no CORS headers.
 *
 * This is defence in depth. The `Host` allowlist and the origin check in
 * `createApp()` are the primary controls and are covered by
 * `tests/cross-origin-guard.test.ts`; this test is about the second layer being
 * present rather than merely documented.
 */
const PORT = 8080
const ATTACKER_ORIGIN = 'https://attacker.example'

describe('JSON routes refuse a body that does not declare itself JSON', () => {
  let tempDir: string
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    tempDir = join(tmpdir(), `rtwiki-mediatype-${Date.now()}-${randomUUID().slice(0, 8)}`)
    mkdirSync(tempDir, { recursive: true })
    const db = initDatabase(tempDir)
    // The real app rejects a database that has not been migrated, and the routes
    // read real tables, so this is not optional scaffolding.
    await runMigrations(db)
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
      host: '127.0.0.1'
    }
    app = createApp(deps)
  })

  afterAll(async () => {
    await closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const ROUTES: Array<{ method: string; path: string; body: unknown }> = [
    { method: 'POST', path: '/api/pages', body: { title: 'X', pageType: 'rich', content: '[]' } },
    { method: 'POST', path: '/api/schedule/entries', body: { title: 'X' } },
    { method: 'POST', path: '/api/schedule/reminders', body: { title: 'X' } }
  ]

  for (const route of ROUTES) {
    it(`${route.method} ${route.path} refuses a text/plain body`, async () => {
      const res = await app.request(route.path, {
        method: route.method,
        headers: {
          host: `127.0.0.1:${PORT}`,
          // **No Origin and no Referer at all**, deliberately.
          //
          // `isSameOrigin` reads those first, so any Origin header here would be
          // compared against the request URL and the origin guard would answer
          // 403 before the body reader ever ran — the test would then pass on the
          // wrong control, proving only that the guard that already existed still
          // exists. With neither header the check takes its documented
          // CLI/automation branch and returns true, which isolates the media-type
          // rule.
          //
          // That combination is also the honest shape of the residual risk: DNS
          // rebinding, where the browser considers the request same-origin and
          // sends no Origin at all. It is the case the media-type rule exists to
          // stop, and it cannot be reached by sending a foreign Origin.
          'content-type': 'text/plain'
        },
        body: JSON.stringify(route.body)
      })
      // 415, and specifically not a success. A route that bypassed the shared
      // reader would return 201 here and this test would be the only thing saying so.
      expect(res.status).toBe(415)
    })

    it(`${route.method} ${route.path} refuses a text/plain body from another origin too`, async () => {
      // The same request as the ordinary cross-origin attack. Whichever control
      // refuses it, it must be refused — this asserts the outcome, not the reason,
      // and complements the test above rather than repeating it.
      const res = await app.request(route.path, {
        method: route.method,
        headers: {
          host: `127.0.0.1:${PORT}`,
          origin: ATTACKER_ORIGIN,
          'content-type': 'text/plain'
        },
        body: JSON.stringify(route.body)
      })
      expect([403, 415]).toContain(res.status)
    })

    it(`${route.method} ${route.path} accepts the same body as application/json`, async () => {
      const res = await app.request(route.path, {
        method: route.method,
        headers: {
          host: `127.0.0.1:${PORT}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(route.body)
      })
      expect(res.status, 'the rule must not refuse a legitimate client').not.toBe(415)
    })
  }

  it('refuses a body with no declared content type', async () => {
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: { host: `127.0.0.1:${PORT}` },
      body: JSON.stringify({ title: 'X', pageType: 'rich', content: '[]' })
    })
    expect(res.status).toBe(415)
  })

  it('is not the only thing refusing a cross-origin write', async () => {
    // If the media-type rule were the *sole* control, deleting it would silently
    // reopen the route. This asserts the origin guard independently, so the two are
    // known to be separate defences rather than one defence counted twice.
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${PORT}`,
        origin: ATTACKER_ORIGIN,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ title: 'Injected', pageType: 'rich', content: '[]' })
    })
    expect(res.status, 'a cross-origin write with a correct content type').toBe(403)
  })

  it('refuses a rebound Host even from its own origin', async () => {
    // The DNS-rebinding case: the browser sends same-origin headers, so only the
    // Host allowlist can catch it. The media-type rule does not apply, which is
    // exactly why both controls exist.
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: {
        host: 'attacker.example',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ title: 'Injected', pageType: 'rich', content: '[]' })
    })
    expect(res.status, 'a rebound Host must be refused').not.toBe(201)
  })

  it('accepts the charset a browser adds to a JSON body itself', async () => {
    // A browser sending `text/plain` is the attack; a browser sending
    // `application/json;charset=UTF-8` is ordinary use. Refusing the second would
    // break the app to stop something that no longer works.
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${PORT}`,
        'content-type': 'application/json;charset=UTF-8'
      },
      body: JSON.stringify({ title: 'Charset', pageType: 'rich', content: '[]' })
    })
    expect(res.status).toBe(201)
  })

  it('still rejects malformed JSON with the correct content type', async () => {
    const res = await app.request('/api/pages', {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${PORT}`,
        'content-type': 'application/json'
      },
      body: '{not json'
    })
    expect(res.status).toBe(400)
    const payload = (await res.json()) as { error: string }
    expect(payload.error).toBe('Invalid JSON')
  })

  it('leaves attachment upload alone, which is not a JSON route', async () => {
    // The attachment endpoints take multipart. Applying the rule there would refuse
    // every upload, so this asserts the rule was not spread past the readers.
    const res = await app.request('/api/attachments', {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${PORT}`,
        'content-type': 'multipart/form-data; boundary=x'
      },
      body: 'not really multipart'
    })
    expect(res.status, 'must not answer 415 for a non-JSON route').not.toBe(415)
  })
})
