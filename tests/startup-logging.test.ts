import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/server/bootstrap.js'
import { resolveRuntimePaths } from '../src/server/config/index.js'
import { reportFatalStartupError } from '../src/server/fatal.js'
import type { Launcher } from '../src/server/launcher.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-lc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const port = server.port
  server.stop()
  return port as number
}

function readEvents(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

const noopLauncher: Launcher = () => {}

describe('runtime lifecycle logging', () => {
  it('persists startup, database, migration and listening events with redacted paths', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      launcher: noopLauncher,
      logPath,
      dataDir: join(dir, 'data')
    })
    try {
      const health = await runtime.server.fetch(new Request('http://127.0.0.1/health'))
      expect(health.status).toBe(200)
    } finally {
      await runtime.shutdown()
    }

    expect(existsSync(logPath)).toBe(true)
    const events = readEvents(logPath).map((entry) => entry.event)
    expect(events).toContain('startup')
    expect(events).toContain('db_init')
    expect(events).toContain('migration')

    // The first line is the startup event: version + privacy-redacted dirs.
    // Injected temporary paths must appear redacted (%TEMP%), never raw.
    const firstLine = readFileSync(logPath, 'utf8').split('\n')[0]
    const startup = JSON.parse(firstLine) as Record<string, unknown>
    expect(startup.version).toBe('0.1.0')
    expect(String(startup.dataDir).startsWith('%TEMP%')).toBe(true)
    expect(String(startup.logDir).startsWith('%TEMP%')).toBe(true)
    expect(firstLine).not.toContain(homedir())
    cleanup(dir)
  })

  it('persists the full shutdown stage order and completion', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      launcher: noopLauncher,
      logPath,
      dataDir: join(dir, 'data')
    })
    await runtime.shutdown()

    const events = readEvents(logPath).map((entry) => entry.event)
    for (const stage of [
      'shutdown_requested',
      'shutdown_server_stopped',
      'shutdown_database_closed',
      'shutdown_complete'
    ]) {
      expect(events).toContain(stage)
    }
    const indexOf = (name: string): number => events.indexOf(name)
    expect(indexOf('shutdown_requested')).toBeLessThan(indexOf('shutdown_server_stopped'))
    expect(indexOf('shutdown_server_stopped')).toBeLessThan(indexOf('shutdown_database_closed'))
    expect(indexOf('shutdown_database_closed')).toBeLessThan(indexOf('shutdown_complete'))
    cleanup(dir)
  })

  it('persists existing-instance detection before closing its logger', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const port = freePort()
    const fakeServer = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: (req) => {
        if (new URL(req.url).pathname === '/health') {
          return Response.json({ status: 'ok', app: 'RTWiki', version: '0.1.0' })
        }
        return new Response('Not found', { status: 404 })
      }
    })
    try {
      const runtime = await bootstrap({
        port,
        openBrowser: true,
        launcher: noopLauncher,
        logPath,
        dataDir: join(dir, 'data')
      })
      expect(runtime.server).toBeNull()
      await runtime.shutdown()

      const events = readEvents(logPath).map((entry) => entry.event)
      expect(events).toContain('single_instance')
    } finally {
      fakeServer.stop()
      cleanup(dir)
    }
  })

  it('persists fatal startup failures to an injected path', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    await reportFatalStartupError(new Error('simulated fatal'), logPath)

    const events = readEvents(logPath)
    expect(events.length).toBe(1)
    expect(events[0].event).toBe('startup_fatal')
    expect(events[0].error).toBe('simulated fatal')
    cleanup(dir)
  })

  it('module import does not create development log files', async () => {
    const target = resolveRuntimePaths().logPath
    const existedBefore = existsSync(target)
    await import('../src/server/app.js')
    expect(existsSync(target)).toBe(existedBefore)
  })
})
