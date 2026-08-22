import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AppDependencies, createApp } from '../src/server/app.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'

/**
 * Per-response CSP nonce pairing (Phase 4A Option A).
 *
 * The srcdoc preview inherits the parent document's CSP, so preview scripts
 * must carry exactly the nonce that appears in the serving response's
 * Content-Security-Policy header. These tests prove:
 * - header and injected HTML meta carry the SAME nonce per request;
 * - separate responses receive DIFFERENT nonces (per-request generation);
 * - SPA fallback responses pair identically;
 * - assets are served byte-exact without injection;
 * - the legacy security headers remain in place.
 */

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-nonce-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

const INDEX_HTML =
  '<!DOCTYPE html><html><head><title>RTWiki</title></head><body><div id="root"></div>' +
  '<script type="module" src="/assets/index-test.js"></script></body></html>'

describe('per-response CSP nonce pairing', () => {
  let tempDir: string
  let distDir: string
  let deps: AppDependencies

  beforeAll(async () => {
    tempDir = makeTempDir()
    distDir = join(tempDir, 'web')
    mkdirSync(join(distDir, 'assets'), { recursive: true })
    writeFileSync(join(distDir, 'index.html'), INDEX_HTML)
    writeFileSync(join(distDir, 'assets', 'index-test.js'), 'console.log("app")')

    deps = {
      coordinator: {
        state: 'running' as const,
        completed: Promise.resolve({ ok: true, forced: false }),
        requestShutdown: () => Promise.resolve({ ok: true, forced: false })
      } as unknown as AppDependencies['coordinator'],
      token: 'test-token',
      getDb: initDatabase(tempDir),
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        close: async () => {}
      },
      frontendDistDir: distDir
    }
    await runMigrations(deps.getDb())
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  function extractHeaderNonce(csp: string | null): string | null {
    if (!csp) return null
    const match = /script-src[^;]*'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)
    return match?.[1] ?? null
  }

  function extractMetaNonce(html: string): string | null {
    const match =
      /<meta name="rtwiki-preview-nonce" content="([A-Za-z0-9+/=]+)">/.exec(html)
    return match?.[1] ?? null
  }

  it('serves the SPA with a CSP nonce and an identical meta-tag nonce', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1/'))
    expect(res.status).toBe(200)

    const csp = res.headers.get('content-security-policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'nonce-")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("img-src 'self' data:")
    expect(csp).toContain("frame-ancestors 'none'")

    const html = await res.text()
    const headerNonce = extractHeaderNonce(csp)
    const metaNonce = extractMetaNonce(html)
    expect(headerNonce).not.toBeNull()
    // Same request → same nonce in header and body.
    expect(metaNonce).toBe(headerNonce)
    // Injection must not corrupt the document.
    expect(html).toContain('<title>RTWiki</title>')
    expect(html).toContain('</head>')
  })

  it('issues different nonces for separate HTML responses', async () => {
    const app = createApp(deps)
    const first = await app.fetch(new Request('http://127.0.0.1/'))
    const second = await app.fetch(new Request('http://127.0.0.1/'))

    const firstNonce = extractHeaderNonce(first.headers.get('content-security-policy'))
    const secondNonce = extractHeaderNonce(second.headers.get('content-security-policy'))
    expect(firstNonce).not.toBeNull()
    expect(secondNonce).not.toBeNull()
    expect(firstNonce).not.toBe(secondNonce)

    const secondHtml = await second.text()
    expect(extractMetaNonce(secondHtml)).toBe(secondNonce)
  })

  it('pairs header and meta nonce on SPA fallback routes', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1/pages/deep/route'))
    expect(res.status).toBe(200)

    const csp = res.headers.get('content-security-policy')
    const html = await res.text()
    expect(extractMetaNonce(html)).toBe(extractHeaderNonce(csp))
  })

  it('serves HTML with no-store to prevent stale-body/header pairing', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1/'))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('leaves asset responses byte-exact and immutable without meta injection', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1/assets/index-test.js'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('console.log("app")')
    expect(body).not.toContain('rtwiki-preview-nonce')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('keeps the legacy security headers alongside the nonce policy', async () => {
    const app = createApp(deps)
    const res = await app.fetch(new Request('http://127.0.0.1/health'))
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('permissions-policy')).toBe('geolocation=(), microphone=(), camera=()')
    // API responses carry the CSP too; harmless there, consistent everywhere.
    expect(res.headers.get('content-security-policy')).toContain("'nonce-")
  })
})
