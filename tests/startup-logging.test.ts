import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap, unusableDirectoryMessage } from '../src/server/bootstrap.js'
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

  it('does not wait for a keypress when there is no console to wait on', async () => {
    // The fix for "a double-clicked RTWiki.exe closes the window its own error
    // message is printed in" holds the process open — guarded on stdin being a TTY.
    //
    // This test IS the non-TTY case, because a test runner has no console. So it
    // asserts the guard from the side that matters for CI: the call returns. If
    // the direction of the guard were ever reversed, this suite would hang
    // instead of failing, which is why the assertion is written as a race rather
    // than a plain `await` — a hang inside a test is a timeout with no message
    // about which expectation was being set up.
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const started = Date.now()
    await Promise.race([
      reportFatalStartupError(new Error('no console'), logPath),
      // A guard that failed to return would leave the promise pending forever, so
      // the race is what turns "hung" into "failed".
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('fatal report blocked on a non-TTY stdin')), 5_000)
      )
    ])
    expect(Date.now() - started).toBeLessThan(5_000)
    // And it still reported, which is the part that must not be traded away for
    // the wait: the log write happens before the wait is even considered.
    expect(readEvents(logPath)[0]?.event).toBe('startup_fatal')
    cleanup(dir)
  })

  it('module import does not create development log files', async () => {
    const target = resolveRuntimePaths().logPath
    const existedBefore = existsSync(target)
    await import('../src/server/app.js')
    expect(existsSync(target)).toBe(existedBefore)
  })
})

describe('unusable runtime directory', () => {
  // A real EACCES cannot be produced here: a directory ACL cannot be changed
  // without elevation this suite must not ask for. The two behaviours that
  // matter are therefore asserted separately:
  //
  //   1. the message a user is shown — tested directly against the pure builder;
  //   2. that bootstrap turns a directory it cannot use into that message and
  //      stops, rather than a raw Node errno — tested against a real failure,
  //      produced with ENOTDIR instead of EACCES because it needs no privileges.
  //
  // Both go through the same `ensureRuntimeDirectory` catch, so the ENOTDIR run
  // exercises the exact branch an EACCES takes.

  it('names the directory and states the remedy', () => {
    const message = unusableDirectoryMessage('/app/data', 'EACCES')

    // The three things a user needs: which folder, what went wrong, what to do.
    expect(message).toContain('/app/data')
    expect(message).toContain('data')
    expect(message).toMatch(/could not|unable|cannot/i)
    // A remedy, not just a diagnosis.
    expect(message).toMatch(/move|permission|write access|properties/i)
    // And the honest part: RTWiki stops rather than quietly writing elsewhere.
    expect(message).toMatch(/stop|quit|exit|not be stored|will not/i)
    // The underlying cause is carried, not swallowed.
    expect(message).toContain('EACCES')
  })

  it('stops startup and reports the directory instead of a raw errno', async () => {
    const dir = makeTempDir()
    // A regular file where the data directory should be: `data/` cannot be
    // created, so the very first ensure step fails.
    const blocked = join(dir, 'data')
    writeFileSync(blocked, 'not a directory')

    let thrown: unknown
    try {
      await bootstrap({
        port: 0,
        openBrowser: false,
        launcher: noopLauncher,
        logPath: join(dir, 'logs', 'rtwiki.log'),
        dataDir: blocked
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    // The directory reported is the first one that could not be used. Here
    // `data` itself already exists (as a file, so mkdir is skipped) and
    // `data/attachments` is the first child that cannot be created - which is
    // the directory the user actually has to fix.
    const blockedNormalised = blocked.replace(/\\/g, '/')
    expect(message).toContain(blockedNormalised)
    // The OS error is carried rather than swallowed.
    expect(message).toMatch(/Windows reported: ENOTDIR|EACCES|EPERM/)
    // The old failure said only "EACCES: permission denied, mkdir '...'"; the
    // actionable part is what must be present now.
    expect(message).toMatch(/move|permission|write access|properties/i)
    // Still no fallback: nothing was created beside the blocked path.
    expect(existsSync(join(dir, 'data', 'rtwiki.sqlite'))).toBe(false)
    cleanup(dir)
  })

  it('reports a fatal startup failure on the terminal, not only in the log file', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    const lines: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    try {
      await reportFatalStartupError(new Error('RTWiki could not use this folder'), logPath)
    } finally {
      console.error = original
    }

    // The window a user sees is the only channel that survives a log directory
    // that cannot be opened, so the human sentence must not depend on the file.
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).toContain('RTWiki could not use this folder')
    // The log file keeps exactly one machine-readable line, as before.
    const events = readEvents(logPath)
    expect(events.length).toBe(1)
    expect(events[0].event).toBe('startup_fatal')
    cleanup(dir)
  })
})
