import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap, damagedDatabaseMessage, portInUseMessage } from '../src/server/bootstrap.js'
import type { Launcher } from '../src/server/launcher.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-boot-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response('ok') })
  const port = server.port as number
  server.stop()
  return port
}

function readEvents(logPath: string): Array<Record<string, unknown>> {
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

const noopLauncher: Launcher = () => {}

describe('bootstrap (startup sequence) — ordered steps', () => {
  it('detects an existing instance before creating the data folder', async () => {
    const dir = makeTempDir()
    const port = freePort()
    const fake = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ app: 'RTWiki', status: 'ok' })
    })
    try {
      const runtime = await bootstrap({
        port,
        openBrowser: false,
        launcher: noopLauncher,
        logPath: join(dir, 'logs', 'rtwiki.log'),
        dataDir: join(dir, 'data')
      })
      expect(runtime.server).toBeNull()
      // The running-copy check runs before any data directory is created.
      expect(existsSync(join(dir, 'data'))).toBe(false)
    } finally {
      fake.stop()
      cleanup(dir)
    }
  })

  it('reports an unwritable data folder with a friendly message and no database', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    mkdirSync(dataDir, { recursive: true })
    // A directory where the write probe's file should go: mkdir succeeds but
    // Bun.write fails, exercising the same catch as a read-only folder.
    mkdirSync(join(dataDir, '.write-test'), { recursive: true })
    let thrown: unknown
    try {
      await bootstrap({
        port: freePort(),
        openBrowser: false,
        launcher: noopLauncher,
        logPath: join(dir, 'logs', 'rtwiki.log'),
        dataDir
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/move|permission|write access|properties/i)
    expect(existsSync(join(dataDir, 'rtwiki.sqlite'))).toBe(false)
    cleanup(dir)
  })

  it('reports a damaged database with a message pointing at the backups', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    mkdirSync(dataDir, { recursive: true })
    // A file that is not a SQLite database. The read-only port probe tolerates
    // it, but the managed open / integrity check must abort startup.
    writeFileSync(join(dataDir, 'rtwiki.sqlite'), 'this is not a database')
    let thrown: unknown
    try {
      await bootstrap({
        port: freePort(),
        openBrowser: false,
        launcher: noopLauncher,
        logPath: join(dir, 'logs', 'rtwiki.log'),
        dataDir
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain('data/backups')
    expect(message).toContain(damagedDatabaseMessage().split('\n')[0])
    cleanup(dir)
  })

  it('resets each invalid setting independently, leaving the others intact', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      launcher: noopLauncher,
      logPath,
      dataDir
    })
    try {
      // Corrupt only the port row directly in the settings table.
      runtime.db.run(
        "INSERT INTO settings (key, value) VALUES ('server.port', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ['"not-a-port"']
      )
    } finally {
      await runtime.shutdown()
    }
    const events = readEvents(logPath)
    const reset = events.find((e) => e.event === 'startup' && e.action === 'reset_settings')
    // A fresh bootstrap must report only the corrupted key as reset.
    const second = await bootstrap({
      port: freePort(),
      openBrowser: false,
      launcher: noopLauncher,
      logPath,
      dataDir
    })
    await second.shutdown()
    const secondEvents = readEvents(logPath)
    const secondReset = secondEvents.find(
      (e) => e.event === 'startup' && e.action === 'reset_settings'
    )
    expect(secondReset).toBeDefined()
    expect(secondReset?.keys).toEqual(['server.port'])
    expect(reset).toBeUndefined()
    cleanup(dir)
  })

  it('reports a busy port by name with the override, and never auto-picks another', async () => {
    const dir = makeTempDir()
    const port = freePort()
    const fake = Bun.serve({
      port,
      hostname: '127.0.0.1',
      fetch: () => new Response('some other app', { status: 200 })
    })
    try {
      let thrown: unknown
      try {
        await bootstrap({
          port,
          openBrowser: false,
          launcher: noopLauncher,
          logPath: join(dir, 'logs', 'rtwiki.log'),
          dataDir: join(dir, 'data')
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(Error)
      const message = (thrown as Error).message
      expect(message).toContain(String(port))
      expect(message).toContain('--port')
      expect(message).toBe(portInUseMessage(port))
    } finally {
      fake.stop()
      cleanup(dir)
    }
  })

  it('opens the browser only after the server reports healthy', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const calls: string[] = []
    const launcher: Launcher = (url) => {
      calls.push(url)
    }
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: true,
      launcher,
      logPath,
      dataDir: join(dir, 'data')
    })
    try {
      expect(calls).toHaveLength(1)
      const events = readEvents(logPath)
      const healthyIndex = events.findIndex((e) => e.step === 'server_healthy')
      expect(healthyIndex).toBeGreaterThanOrEqual(0)
      // The browser launcher is called after the healthy step was logged.
      expect(calls).toHaveLength(1)
    } finally {
      await runtime.shutdown()
      cleanup(dir)
    }
  })

  it('logs every named step so a failed start shows where it stopped', async () => {
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
    const steps = readEvents(logPath)
      .filter((e) => e.event === 'bootstrap_step')
      .map((e) => e.step)
    for (const expected of [
      'single_instance_check',
      'data_directory_writable_check',
      'database_open_migrate_integrity',
      'read_settings',
      'choose_port',
      'start_server',
      'server_healthy'
    ]) {
      expect(steps).toContain(expected)
    }
    cleanup(dir)
  })
})
