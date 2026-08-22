import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileLogger } from '../src/server/logging/index.js'
import { sanitizePathForLog } from '../src/server/logging/sanitize-path.js'

function makeTempDir(): string {
  const dir = join(tmpdir(), `rtwiki-logtest-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('FileLogger', () => {
  it('creates the log file eagerly at initialization', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'logs', 'rtwiki.log')
    expect(existsSync(logPath)).toBe(false)
    const log = new FileLogger(logPath)
    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(join(dir, 'logs'))).toBe(true)
    void log.close()
    cleanup(dir)
  })

  it('appends immediately and preserves earlier records across sessions', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    const first = new FileLogger(logPath)
    first.info('first session', { event: 'one' })
    void first.close()

    // A brand-new logger on the same path must append, never truncate.
    const second = new FileLogger(logPath)
    second.info('second session', { event: 'two' })
    void second.close()

    const text = readFileSync(logPath, 'utf8')
    expect(text).toContain('first session')
    expect(text).toContain('second session')
    expect(text.indexOf('first session')).toBeLessThan(text.indexOf('second session'))
    cleanup(dir)
  })

  it('writes valid JSONL with timestamp, level and message', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    const log = new FileLogger(logPath)
    log.info('hello', { event: 'init' })
    log.warn('careful', { event: 'warn' })
    log.error('boom', { event: 'err' })
    void log.close()

    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
    expect(lines.length).toBe(3)
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>
      expect(typeof parsed.timestamp).toBe('string')
      expect(typeof parsed.level).toBe('string')
      expect(typeof parsed.message).toBe('string')
    }
    cleanup(dir)
  })

  it('flush and close are safe and idempotent; closed logger drops events', async () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    const log = new FileLogger(logPath)
    log.info('kept', { event: 'x' })
    await log.flush()
    await log.flush()
    await log.close()
    await log.close()
    await log.flush()
    log.info('dropped after close', { event: 'y' })

    const text = readFileSync(logPath, 'utf8')
    expect(text).toContain('kept')
    expect(text).not.toContain('dropped after close')
    cleanup(dir)
  })

  it('rotation is bounded to current plus maxRotatedFiles', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    const log = new FileLogger(logPath, { maxBytes: 200, maxRotatedFiles: 2 })
    for (let i = 0; i < 30; i++) {
      log.info(`rotation probe ${i} ${'p'.repeat(40)}`, { event: 'rot' })
    }
    void log.close()

    expect(existsSync(logPath)).toBe(true)
    expect(existsSync(join(dir, 'rtwiki.1.log'))).toBe(true)
    expect(existsSync(join(dir, 'rtwiki.2.log'))).toBe(true)
    expect(existsSync(join(dir, 'rtwiki.3.log'))).toBe(false)

    // Every rotated file stays bounded (one incoming line over the threshold).
    for (const name of ['rtwiki.1.log', 'rtwiki.2.log']) {
      const size = Number(readFileSync(join(dir, name), 'utf8').length)
      expect(size).toBeLessThanOrEqual(200 + 120)
    }
    cleanup(dir)
  })

  it('a rotation failure warns once and never crashes or stops appending', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    // Occupy the single rotation slot with a NON-EMPTY directory. Renaming a
    // file onto a non-empty directory fails on every platform, so rotation
    // deterministically fails on Windows and Linux alike.
    mkdirSync(join(dir, 'rtwiki.1.log'), { recursive: true })
    writeFileSync(join(dir, 'rtwiki.1.log', 'occupied.txt'), 'blocker')
    writeFileSync(logPath, 'x'.repeat(500))

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown): void => {
      warnings.push(String(message))
    }

    let threw = false
    try {
      const log = new FileLogger(logPath, { maxBytes: 100, maxRotatedFiles: 1 })
      for (let i = 0; i < 5; i++) {
        log.info(`probe ${i} ${'q'.repeat(40)}`, { event: 'rotfail' })
      }
      void log.close()
    } finally {
      console.warn = originalWarn
    }

    expect(threw).toBe(false)
    expect(warnings.some((w) => w.includes('rotate log file'))).toBe(true)
    expect(warnings.filter((w) => w.includes('rotate log file')).length).toBe(1)
    // Appending continued despite failed rotation.
    expect(readFileSync(logPath, 'utf8').length).toBeGreaterThan(500)
    cleanup(dir)
  })

  it('an unwritable location warns exactly once and keeps terminal logging', () => {
    const dir = makeTempDir()
    // A file used as a parent directory makes every open fail.
    writeFileSync(join(dir, 'blocker'), 'not a directory')
    const logPath = join(dir, 'blocker', 'rtwiki.log')

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown): void => {
      warnings.push(String(message))
    }

    let threw = false
    try {
      const log = new FileLogger(logPath)
      log.info('terminal only', { event: 'nosink' })
      log.warn('still terminal', { event: 'nosink' })
      void log.close()
    } finally {
      console.warn = originalWarn
    }

    expect(threw).toBe(false)
    expect(existsSync(logPath)).toBe(false)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('open log file')
    cleanup(dir)
  })

  it('a mid-life append failure disables the sink without crashing', () => {
    const dir = makeTempDir()
    const logPath = join(dir, 'rtwiki.log')
    const log = new FileLogger(logPath)
    log.info('before failure', { event: 'ok' })

    // Replace the log file with a directory so appends fail with EISDIR.
    rmSync(logPath, { force: true })
    mkdirSync(logPath, { recursive: true })

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown): void => {
      warnings.push(String(message))
    }
    try {
      log.info('after failure', { event: 'broken' })
      log.info('and again', { event: 'broken' })
    } finally {
      console.warn = originalWarn
    }

    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('append to log file')
    cleanup(dir)
  })
})

describe('sanitizePathForLog', () => {
  it('replaces the temp prefix for temporary directories', () => {
    const sanitized = sanitizePathForLog(join(tmpdir(), 'rtwiki', 'data'))
    expect(sanitized.startsWith('%TEMP%')).toBe(true)
    expect(sanitized).not.toContain(tmpdir())
  })

  it('replaces repo root and exe dir with labels', () => {
    const sanitized = sanitizePathForLog('/repo/RTWiki/data/rtwiki.sqlite', {
      repoRoot: '/repo/RTWiki',
      exeDir: '/repo/RTWiki/build/server'
    })
    expect(sanitized).toBe('<repo>/data/rtwiki.sqlite')

    const exeRelative = sanitizePathForLog('/repo/RTWiki/build/server/logs/rtwiki.log', {
      exeDir: '/repo/RTWiki/build/server'
    })
    expect(exeRelative).toBe('<exe-dir>/logs/rtwiki.log')
  })

  it('uses longest match first so nested contexts win', () => {
    // Repo living inside the user profile must be labelled <repo>, not %USERPROFILE%.
    const sanitized = sanitizePathForLog('/home/dev/rtwiki/data', {
      repoRoot: '/home/dev/rtwiki'
    })
    expect(sanitized).toBe('<repo>/data')
  })

  it('never emits the raw Windows username for profile paths', () => {
    const input = join(homedir(), 'some-app', 'data', 'rtwiki.sqlite')
    const sanitized = sanitizePathForLog(input)
    expect(sanitized.startsWith('%USERPROFILE%')).toBe(true)
    expect(sanitized).not.toContain(homedir())
    expect(sanitized).toBe('%USERPROFILE%/some-app/data/rtwiki.sqlite')
  })

  it('leaves unrelated paths untouched but normalized', () => {
    expect(sanitizePathForLog('C:\\other\\place.txt')).toBe('C:/other/place.txt')
  })
})
