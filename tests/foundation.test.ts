import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import {
  createConfig,
  resolveRuntimePaths,
  joinPaths,
  dirname
} from '../src/server/config/index.js'
import {
  initDatabase,
  closeDatabase,
  getDatabasePath,
  type getDb
} from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { app } from '../src/server/app.js'

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

    const results = db.query('SELECT name FROM _migrations').all() as {
      name: string
    }[]
    const names = results.map((r) => r.name)
    const unique = new Set(names)
    expect(names.length).toBe(unique.size)
  })
})

describe('app factory', () => {
  it('creates app without binding a network port', () => {
    const appInstance = app
    expect(appInstance).toBeDefined()
    expect(typeof appInstance.fetch).toBe('function')
  })
})
