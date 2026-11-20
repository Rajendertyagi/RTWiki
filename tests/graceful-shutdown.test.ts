import { describe, expect, it, mock } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/server/bootstrap.js'
import { ShutdownCoordinator } from '../src/server/shutdown-coordinator.js'
import {
  SHUTDOWN_DRAIN_TIMEOUT_MS,
  SHUTDOWN_FULL_SAVE_TIMEOUT_MS
} from '../src/shared/constants/index.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('graceful shutdown', () => {
  it('completes within a bounded time and records the full-save stage', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      logPath,
      dataDir: join(dir, 'data')
    })
    const started = Date.now()
    const result = await runtime.coordinator.requestShutdown()
    const elapsed = Date.now() - started
    expect(result.ok).toBe(true)
    // Bounded: the drain + full-save limits plus generous test overhead.
    expect(elapsed).toBeLessThan(SHUTDOWN_DRAIN_TIMEOUT_MS + SHUTDOWN_FULL_SAVE_TIMEOUT_MS + 5_000)
    const events = readEvents(logPath).map((e) => e.event)
    expect(events).toContain('shutdown_full_save_ok')
    expect(events.indexOf('shutdown_full_save_ok')).toBeLessThan(
      events.indexOf('shutdown_database_closed')
    )
    cleanup(dir)
  })

  it('logs a full-save failure but still closes cleanly', async () => {
    const warn = mock(() => {})
    const info = mock(() => {})
    const closeDatabase = mock(async () => {})
    const closeLogger = mock(async () => {})
    const coordinator = new ShutdownCoordinator({
      stopGracefully: async () => {},
      fullSave: () => ({ ok: false, detail: 'simulated checkpoint failure' }),
      clearCleanExitMarker: () => {},
      closeDatabase,
      logInfo: info,
      logWarn: warn,
      logError: () => {},
      closeLogger
    })
    const result = await coordinator.requestShutdown()
    expect(result.ok).toBe(true)
    expect(result.fullSaveOk).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(closeDatabase).toHaveBeenCalled()
    expect(closeLogger).toHaveBeenCalled()
  })

  it('never hangs when stopping work fails', async () => {
    const coordinator = new ShutdownCoordinator({
      stopGracefully: async () => {
        throw new Error('simulated stuck stop')
      },
      closeDatabase: async () => {},
      logInfo: () => {},
      logWarn: () => {},
      logError: () => {},
      closeLogger: async () => {}
    })
    const started = Date.now()
    const result = await Promise.race([
      coordinator.requestShutdown(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('shutdown hung')), 3_000))
    ])
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(result.ok).toBe(false)
  })

  it('the folder is normally safe to copy after a clean close', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      logPath,
      dataDir
    })
    // Commit a real page so the copied file must contain it.
    runtime.db.run(
      'INSERT INTO pages (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['safe-copy-1', 'Safe copy', '{}', '2026-01-01', '2026-01-01']
    )
    await runtime.shutdown()

    // Copy ONLY the main database file into a fresh folder. With the WAL fully
    // checkpointed at shutdown, the copy is a complete, valid database.
    const fresh = join(dir, 'fresh')
    mkdirSync(fresh, { recursive: true })
    copyFileSync(join(dataDir, 'rtwiki.sqlite'), join(fresh, 'rtwiki.sqlite'))
    const { Database } = await import('bun:sqlite')
    const copied = new Database(join(fresh, 'rtwiki.sqlite'), { readonly: true })
    try {
      const row = copied.query('SELECT title FROM pages WHERE id = ?').get('safe-copy-1') as
        | { title: string }
        | undefined
      expect(row?.title).toBe('Safe copy')
    } finally {
      copied.close()
    }
    cleanup(dir)
  })

  it('removes the clean-exit marker on a clean close', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    const runtime = await bootstrap({
      port: freePort(),
      openBrowser: false,
      logPath: join(dir, 'logs', 'rtwiki.log'),
      dataDir
    })
    expect(existsSync(join(dataDir, 'clean-exit'))).toBe(true)
    await runtime.shutdown()
    expect(existsSync(join(dataDir, 'clean-exit'))).toBe(false)
    cleanup(dir)
  })
})
