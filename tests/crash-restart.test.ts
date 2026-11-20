import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/server/bootstrap.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-crash-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('crash then restart', () => {
  it('reports an unclean previous run as the first log line and clears the marker', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    const logPath = join(dir, 'logs', 'rtwiki.log')

    // First run: startup checks pass, so the marker is created. Simulate a
    // crash by never calling shutdown.
    const first = await bootstrap({
      port: freePort(),
      openBrowser: false,
      logPath,
      dataDir
    })
    expect(existsSync(join(dataDir, 'clean-exit'))).toBe(true)
    // Force-close the DB without the coordinator, as a crash would leave it.
    first.db.close()

    // Second run: the marker must be reported first, then cleared.
    const second = await bootstrap({
      port: freePort(),
      openBrowser: false,
      logPath,
      dataDir
    })
    await second.shutdown()
    const events = readEvents(logPath)
    const uncleanIndex = events.findIndex((e) => e.event === 'startup_unclean_previous_run')
    expect(uncleanIndex).toBeGreaterThanOrEqual(0)
    // It is the first line of the second run's log section (before its startup).
    const secondStartup = events.findIndex((e, i) => i > uncleanIndex && e.event === 'startup')
    expect(secondStartup).toBeGreaterThan(uncleanIndex)
    expect(existsSync(join(dataDir, 'clean-exit'))).toBe(false)
    cleanup(dir)
  })

  it('a second copy does not mistake the first copy marker for a crash', async () => {
    const dir = makeTempDir()
    const dataDir = join(dir, 'data')
    const firstLog = join(dir, 'logs', 'first.log')
    const secondLog = join(dir, 'logs', 'second.log')
    const port = freePort()

    const first = await bootstrap({
      port,
      openBrowser: false,
      logPath: firstLog,
      dataDir
    })
    try {
      // The first copy's marker exists. A second copy on the same port detects
      // the running instance and must NOT log an unclean previous run.
      const second = await bootstrap({
        port,
        openBrowser: false,
        logPath: secondLog,
        dataDir
      })
      expect(second.server).toBeNull()
      const events = readEvents(secondLog).map((e) => e.event)
      expect(events).not.toContain('startup_unclean_previous_run')
      expect(events).toContain('single_instance')
    } finally {
      await first.shutdown()
      cleanup(dir)
    }
  })
})
