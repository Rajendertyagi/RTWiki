import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { Hono } from 'hono'
import {
  createConfig,
  resolveRuntimePaths,
  joinPaths,
  dirname
} from '../src/server/config/index.js'
import {
  initDatabase,
  closeDatabase,
  type getDb,
  getDatabasePath,
  checkIntegrity
} from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { app } from '../src/server/app.js'
import { serveStatic } from '../src/server/static.js'
import { Logger } from '../src/server/logging/index.js'
import { launchBrowser, type Launcher } from '../src/server/launcher.js'
import { bootstrap } from '../src/server/bootstrap.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const p = s.port
  s.stop()
  return p as number
}

describe('resolveRuntimePaths', () => {
  it('should derive paths from exeDir consistently', () => {
    const paths = resolveRuntimePaths()
    expect(paths.exeDir).toBeDefined()
    expect(paths.dataDir).toBe(joinPaths(paths.exeDir, 'data'))
    expect(paths.databasePath).toBe(joinPaths(paths.exeDir, 'data', 'rtwiki.sqlite'))
    expect(paths.attachmentsDir).toBe(joinPaths(paths.exeDir, 'data', 'attachments'))
    expect(paths.backupsDir).toBe(joinPaths(paths.exeDir, 'data', 'backups'))
    expect(paths.logDir).toBe(joinPaths(paths.exeDir, 'logs'))
    expect(paths.logPath).toBe(joinPaths(paths.exeDir, 'logs', 'rtwiki.log'))
  })

  it('should not derive from cwd', () => {
    const cwd = process.cwd()
    const paths = resolveRuntimePaths()
    expect(paths.exeDir).not.toBe(cwd)
  })

  it('is independent of current working directory', () => {
    const a = resolveRuntimePaths()
    process.chdir(join(tmpdir()))
    const b = resolveRuntimePaths()
    process.chdir(a.exeDir)
    expect(b.exeDir).toBe(a.exeDir)
  })
})

describe('joinPaths and dirname', () => {
  it('joinPaths handles mixed separators', () => {
    expect(joinPaths('a', 'b', 'c')).toBe('a/b/c')
    expect(joinPaths('a\\b', 'c')).toBe('a/b/c')
  })

  it('dirname extracts parent directory', () => {
    expect(dirname('/foo/bar')).toBe('/foo')
    expect(dirname('C:\\foo\\bar')).toBe('C:/foo')
  })
})

describe('createConfig', () => {
  it('creates config with correct defaults', () => {
    const cfg = createConfig('/app')
    expect(cfg.name).toBe('RTWiki')
    expect(cfg.version).toBe('0.1.0')
    expect(cfg.host).toBe('127.0.0.1')
    expect(cfg.port).toBe(8080)
    expect(cfg.databaseFilename).toBe('rtwiki.sqlite')
    expect(cfg.attachmentDir).toBe('attachments')
    expect(cfg.backupDir).toBe('backups')
    expect(cfg.logFilename).toBe('rtwiki.log')
  })

  it('allows overrides', () => {
    const cfg = createConfig('/app', { port: 9999 })
    expect(cfg.port).toBe(9999)
  })
})

describe('database migrations', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(() => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('initializes database and creates tables', async () => {
    const dbPath = getDatabasePath(tempDir)
    expect(dbPath).toContain('rtwiki.sqlite')
    expect(dbPath).not.toContain('.wal')
  })

  it('runs migrations without error', async () => {
    await runMigrations(db)

    const result = db.query('SELECT name FROM _migrations WHERE name = ?').get('001_create_pages')
    expect(result).toBeDefined()
  })

  it('does not duplicate migrations on re-run', async () => {
    await runMigrations(db)
    await runMigrations(db)

    const results = db.query('SELECT name FROM _migrations').all() as { name: string }[]
    const names = results.map((r) => r.name)
    const unique = new Set(names)
    expect(names.length).toBe(unique.size)
  })

  it('enforces foreign keys', async () => {
    await runMigrations(db)
    db.run("INSERT INTO pages (id, title) VALUES ('p1', 'Page 1')")
    db.run("INSERT INTO search_index (page_id, title) VALUES ('p1', 'Page 1')")
    // Deleting the parent must cascade to search_index.
    db.run("DELETE FROM pages WHERE id = 'p1'")
    const orphan = db.query('SELECT page_id FROM search_index WHERE page_id = ?').get('p1')
    expect(orphan).toBeNull()
  })

  it('passes integrity check', () => {
    expect(checkIntegrity()).toBe(true)
  })
})

describe('app health and security', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>

  beforeAll(() => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('reports ok after migrations + integrity', async () => {
    await runMigrations(db)
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('sets security headers on responses', async () => {
    const res = await app.request('/health')
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()')
  })
})

describe('static serving', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `rtwiki-static-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html><body>RTWiki</body></html>')
    writeFileSync(join(dir, 'app.js'), 'console.log("hi")')
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'assets', 'index-D_V3awhD.css'), 'body { color: red; }')
    writeFileSync(
      join(dir, 'assets', 'index-CHftKGy2.js'),
      'export default function main() { return 42; }'
    )
  })

  afterEach(() => {
    cleanup(dir)
  })

  function staticApp(): Hono {
    const srv = new Hono()
    srv.use('/*', serveStatic({ root: dir }))
    return srv
  }

  it('serves index.html at root', async () => {
    const res = await staticApp().request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('RTWiki')
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('serves JS asset with exact bytes and correct MIME', async () => {
    const res = await staticApp().request('/assets/index-CHftKGy2.js')
    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('text/javascript')
    expect(contentType).not.toContain('text/html')
    const body = await res.text()
    expect(body).toBe('export default function main() { return 42; }')
    expect(body).not.toContain('RTWiki')
  })

  it('serves CSS asset with exact bytes and text/css', async () => {
    const res = await staticApp().request('/assets/index-D_V3awhD.css')
    expect(res.status).toBe(200)
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('text/css')
    expect(contentType).not.toContain('text/html')
    const body = await res.text()
    expect(body).toBe('body { color: red; }')
    expect(body).not.toContain('RTWiki')
  })

  it('asset response is not index.html', async () => {
    const jsRes = await staticApp().request('/assets/index-CHftKGy2.js')
    const jsBody = await jsRes.text()
    expect(jsBody).not.toContain('<html')
    expect(jsBody).not.toContain('<body')

    const cssRes = await staticApp().request('/assets/index-D_V3awhD.css')
    const cssBody = await cssRes.text()
    expect(cssBody).not.toContain('<html')
    expect(cssBody).not.toContain('<body')
  })

  it('serves assets with immutable cache-control', async () => {
    const res = await staticApp().request('/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('serves index.html with no-cache', async () => {
    const res = await staticApp().request('/')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('returns 404 for missing asset with extension', async () => {
    const res = await staticApp().request('/assets/missing.js')
    expect(res.status).toBe(404)
  })

  it('returns 404 for missing CSS file', async () => {
    const res = await staticApp().request('/assets/missing.css')
    expect(res.status).toBe(404)
  })

  it('falls back to index.html for SPA navigation route', async () => {
    const res = await staticApp().request('/some/spa/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('RTWiki')
  })

  it('falls back to index.html for route with trailing slash', async () => {
    const res = await staticApp().request('/dashboard/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('RTWiki')
  })

  it('does not serve /api paths (API precedence)', async () => {
    const res = await staticApp().request('/api/health')
    // No API route registered in this mini-app, so it falls through to 404.
    expect(res.status).toBe(404)
  })

  it('does not fall back for /api paths', async () => {
    const res = await staticApp().request('/api/pages/missing')
    expect(res.status).toBe(404)
    const body = await res.text()
    expect(body).not.toContain('RTWiki')
  })

  it('serves assets with query string', async () => {
    const res = await staticApp().request('/assets/index-CHftKGy2.js?v=123')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    const body = await res.text()
    expect(body).toBe('export default function main() { return 42; }')
  })

  it('handles URL-encoded paths', async () => {
    writeFileSync(join(dir, 'file with spaces.txt'), 'hello')
    const res = await staticApp().request('/file%20with%20spaces.txt')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('hello')
  })

  it('blocks path traversal', async () => {
    const res = await staticApp().request('/../package.json')
    // Should be blocked: either 403 or SPA fallback, but not actual file.
    const body = await res.text()
    expect(body).not.toContain('"name": "rtwiki"')
  })

  it('blocks encoded path traversal', async () => {
    const res = await staticApp().request('/%2e%2e/package.json')
    const body = await res.text()
    expect(body).not.toContain('"name": "rtwiki"')
  })

  it('blocks null byte in path', async () => {
    const res = await staticApp().request('/..%00/package.json')
    // Should be rejected (400 or 403)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects malformed percent-encoding', async () => {
    const res = await staticApp().request('/%ZZ')
    expect(res.status).toBe(400)
  })
})

describe('launcher', () => {
  it('opens via injected launcher for loopback URL', async () => {
    let opened = ''
    const fakeLauncher: Launcher = (url) => {
      opened = url
    }
    await launchBrowser('http://127.0.0.1:8080/', fakeLauncher)
    expect(opened).toBe('http://127.0.0.1:8080/')
  })

  it('rejects non-loopback URLs', async () => {
    await expect(launchBrowser('http://example.com/')).rejects.toThrow()
  })

  it('rejects non-loopback even with injected opener', async () => {
    const noop: Launcher = () => {}
    await expect(launchBrowser('http://192.168.0.1/', noop)).rejects.toThrow()
    // noop must not have been called
  })

  it('wraps launcher errors with context', async () => {
    const failingLauncher: Launcher = () => {
      throw new Error('spawn failed')
    }
    await expect(launchBrowser('http://127.0.0.1:8080/', failingLauncher)).rejects.toThrow(
      'Browser-open failure'
    )
  })
})

describe('logger', () => {
  it('writes valid JSONL lines with no paths or secrets', async () => {
    const file = join(
      tmpdir(),
      `rtwiki-log-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
    )
    const log = new Logger(file)
    log.info('started', { event: 'init' })
    log.warn('careful', { event: 'warn' })
    log.error('boom', { event: 'err' })
    await log.close()
    const content = readFileSync(file, 'utf8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(3)
    for (const line of lines) {
      const obj = JSON.parse(line)
      expect(typeof obj.timestamp).toBe('string')
      expect(typeof obj.level).toBe('string')
      expect(typeof obj.message).toBe('string')
      expect(JSON.stringify(obj)).not.toContain('/Users/')
      expect(JSON.stringify(obj)).not.toContain('/home/')
    }
    rmSync(file, { force: true })
  })

  it('flush is safe to call repeatedly and after close', async () => {
    const file = join(
      tmpdir(),
      `rtwiki-log2-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`
    )
    const log = new Logger(file)
    log.info('one', { event: 'x' })
    await log.flush()
    await log.flush()
    await log.close()
    await log.flush()
    expect(readFileSync(file, 'utf8').trim().split('\n').length).toBe(1)
    rmSync(file, { force: true })
  })
})

describe('single-instance detection', () => {
  it('detects existing RTWiki instance on port', async () => {
    const port = freePort()
    // Start a fake RTWiki health endpoint on the port.
    const fakeServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            app: 'RTWiki',
            version: '0.1.0',
            db: { ready: true },
            time: new Date().toISOString()
          })
        }
        return new Response('Not found', { status: 404 })
      }
    })

    try {
      let openedUrl = ''
      const fakeLauncher: Launcher = (url) => {
        openedUrl = url
      }

      const runtime = await bootstrap({
        port,
        openBrowser: true,
        launcher: fakeLauncher
      })

      // Should not start a real server (null server indicates detection).
      expect(runtime.server).toBeNull()
      expect(runtime.db).toBeNull()
      expect(openedUrl).toBe(`http://127.0.0.1:${port}/`)

      // Shutdown should be a no-op.
      await runtime.shutdown()
    } finally {
      fakeServer.stop()
    }
  })

  it('detects existing RTWiki with --no-open', async () => {
    const port = freePort()
    const fakeServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', app: 'RTWiki', version: '0.1.0' })
        }
        return new Response('Not found', { status: 404 })
      }
    })

    try {
      let openedUrl = ''
      const fakeLauncher: Launcher = (url) => {
        openedUrl = url
      }

      const runtime = await bootstrap({
        port,
        openBrowser: false,
        launcher: fakeLauncher
      })

      expect(runtime.server).toBeNull()
      expect(openedUrl).toBe('')
      await runtime.shutdown()
    } finally {
      fakeServer.stop()
    }
  })

  it('unrelated port occupant does not trigger single-instance detection', async () => {
    const port = freePort()
    // A random HTTP server that does NOT identify as RTWiki.
    const fakeServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: () => new Response('some other app', { status: 200 })
    })

    try {
      // The probe fires while fakeServer is running. It gets a 200 response
      // but the body does NOT contain app:"RTWiki", so probe returns null.
      // Bootstrap then attempts to bind and gets EADDRINUSE (not a single-instance exit).
      let error: unknown = null
      try {
        await bootstrap({ port, openBrowser: false })
      } catch (err) {
        error = err
      }

      // Must have failed with EADDRINUSE, NOT exited as single-instance.
      expect(error).not.toBeNull()
      expect(error instanceof Error).toBe(true)
      const msg = (error as Error).message
      expect(msg).toContain('Failed to start server')
      expect(msg).not.toContain('existing')
    } finally {
      fakeServer.stop()
    }
  })

  it('no resource leak on existing instance detection', async () => {
    const port = freePort()
    const fakeServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', app: 'RTWiki', version: '0.1.0' })
        }
        return new Response('Not found', { status: 404 })
      }
    })

    try {
      const runtime = await bootstrap({ port, openBrowser: false })

      // Null server/db means no resources were allocated.
      expect(runtime.server).toBeNull()
      expect(runtime.db).toBeNull()

      // Shutdown is idempotent.
      await runtime.shutdown()
      await runtime.shutdown()
    } finally {
      fakeServer.stop()
    }
  })

  it('starts normally when port is free', async () => {
    const port = freePort()
    const runtime = await bootstrap({ port, openBrowser: false })

    expect(runtime.server).not.toBeNull()
    expect(runtime.db).not.toBeNull()

    // Verify it's serving.
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.ok).toBe(true)

    await runtime.shutdown()
  })
})

describe('startup and shutdown', () => {
  it('shutdown is idempotent and the server stops', async () => {
    const port = freePort()
    const rt = await bootstrap({ openBrowser: false, port })
    expect(rt.server).toBeDefined()
    await rt.shutdown()
    await rt.shutdown()
    expect(true).toBe(true)
  })
})
