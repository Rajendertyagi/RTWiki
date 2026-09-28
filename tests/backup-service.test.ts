import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBackup,
  listBackups,
  partialPathFor,
  slotFilename,
  slotPath,
  sweepPartialBackups
} from '../src/server/backup/backup-service.js'
import { dueSlots } from '../src/server/backup/schedule.js'
import { closeDatabase, type Database as Db, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { createPage, nextChildPosition } from '../src/server/repositories/page-repository.js'
import { BACKUP_PARTIAL_SUFFIX } from '../src/shared/constants/index.js'

let tempDir: string
let db: Db

/** Creates a page through the repository, the way the service layer does. */
function addPage(title: string, content: string, parentId: string | null = null): string {
  const id = crypto.randomUUID()
  createPage(
    db,
    id,
    title,
    'rich',
    content,
    content,
    parentId === null ? { parentId: null, position: nextChildPosition(db, null) } : undefined
  )
  return id
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-backup-service-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('backup creation', () => {
  it('writes a slot that opens as a database and holds the committed rows', async () => {
    addPage('First', 'alpha')
    addPage('Second', 'beta')

    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(existsSync(result.path)).toBe(true)
    const backup = new Database(result.path, { readonly: true })
    const rows = backup.query('SELECT title FROM pages ORDER BY title').all()
    expect(rows).toEqual([{ title: 'First' }, { title: 'Second' }])
    expect(backup.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    backup.close()
  })

  it('captures rows still living in the -wal sidecar, which a file copy would miss', async () => {
    // The whole reason a copy is not the mechanism: committed transactions sit
    // in the -wal until a checkpoint. These inserts are deliberately small
    // enough to stay there.
    addPage('Only in WAL', 'committed but not yet checkpointed')

    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const backup = new Database(result.path, { readonly: true })
    const titles = backup.query('SELECT title FROM pages').all()
    backup.close()
    expect(titles).toEqual([{ title: 'Only in WAL' }])
  })

  it('leaves no .partial behind on success', async () => {
    addPage('x', 'x')
    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
    expect(existsSync(partialPathFor(tempDir, 'daily'))).toBe(false)
  })

  it('overwrites its own slot and leaves the other two untouched', async () => {
    addPage('x', 'x')
    await createBackup(tempDir, db, 'weekly')
    await createBackup(tempDir, db, 'monthly')

    const weeklyBefore = readFileSync(slotPath(tempDir, 'weekly'))
    const monthlyBefore = readFileSync(slotPath(tempDir, 'monthly'))

    addPage('y', 'y')
    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)

    // Taking the daily must not disturb the weekly or the monthly.
    expect(readFileSync(slotPath(tempDir, 'weekly')).equals(weeklyBefore)).toBe(true)
    expect(readFileSync(slotPath(tempDir, 'monthly')).equals(monthlyBefore)).toBe(true)

    // And taking it again replaces only the daily.
    const firstDaily = readFileSync(slotPath(tempDir, 'daily'))
    await createBackup(tempDir, db, 'daily')
    expect(readFileSync(slotPath(tempDir, 'daily')).equals(firstDaily)).toBe(true)
  })

  it('preserves the previous good backup when the write fails mid-way', async () => {
    addPage('good', 'content worth keeping')
    const first = await createBackup(tempDir, db, 'daily')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const goodBytes = readFileSync(first.path)

    addPage('newer', 'this one will not be captured')

    // Fails the VACUUM itself, after the previous backup is already in place --
    // the situation a slot written in place would destroy.
    const failing = {
      run: (sql: string) => {
        if (sql.startsWith('VACUUM INTO')) throw new Error('disk went away')
        return db.run(sql)
      },
      query: (sql: string) => db.query(sql)
    } as unknown as Db

    const failed = await createBackup(tempDir, failing, 'daily')
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.reason).toBe('write-failed')

    // The previous good backup is byte-for-byte intact and still opens.
    expect(readFileSync(slotPath(tempDir, 'daily')).equals(goodBytes)).toBe(true)
    const survivor = new Database(slotPath(tempDir, 'daily'), { readonly: true })
    expect(survivor.query('SELECT title FROM pages').all()).toEqual([{ title: 'good' }])
    survivor.close()
  })

  it('refuses rather than silently omitting attachment bytes still on disk', async () => {
    // Reproduces the mid-migration state the plan's refusal exists for.
    //
    // Worth being precise about when that state is even reachable: migration 008
    // rebuilds `attachments` with `data BLOB NOT NULL`, so on a fully-migrated
    // database the `data IS NULL` check can never match. The window is between
    // 007 (which adds a *nullable* `data` column) and 008 (which is deliberately
    // skipped while any row still has its bytes on disk). So the table is rebuilt
    // here with the nullable shape 007 leaves behind and one row still holding
    // only a filename -- which is exactly the database where a one-file backup
    // would silently lose the bytes.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('ALTER TABLE attachments RENAME TO attachments_settled')
    db.exec(`
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        original_name TEXT,
        checksum TEXT,
        created_at TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        data BLOB
      )
    `)
    db.exec(`
      INSERT INTO attachments (id, mime_type, byte_size, original_name, checksum, created_at, stored_name, data)
      VALUES ('a1', 'image/png', 10, 'a.png', NULL, '2026-01-01T00:00:00.000Z', 'a1.png', NULL)
    `)
    db.exec('DROP TABLE attachments_settled')
    db.exec('PRAGMA foreign_keys = ON')

    // Sanity: the fixture really is the state the guard is for.
    expect(db.query('SELECT count(*) AS n FROM attachments WHERE data IS NULL').get()).toEqual({
      n: 1
    })

    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('mid-migration-attachments')
    expect(existsSync(slotPath(tempDir, 'daily'))).toBe(false)
  })

  it('does not mistake a fully-migrated database for a mid-migration one', async () => {
    // The counterpart: after 008, `data` is NOT NULL, so the check matches
    // nothing and a normal backup proceeds. Without this the guard could be
    // refusing every backup forever.
    addPage('x', 'x')
    db.run(
      `INSERT INTO attachments (id, mime_type, byte_size, original_name, checksum, created_at, data)
       VALUES ('a2', 'image/png', 4, 'a.png', NULL, '2026-01-01T00:00:00.000Z', x'01020304')`
    )
    expect(db.query('SELECT count(*) AS n FROM attachments WHERE data IS NULL').get()).toEqual({
      n: 0
    })

    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
  })

  it('replaces a stale .partial for the same slot, which VACUUM INTO would refuse', async () => {
    addPage('x', 'x')
    const partial = partialPathFor(tempDir, 'daily')
    writeFileSync(partial, 'left over from a crash')
    expect(existsSync(partial)).toBe(true)

    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
  })
})

describe('.partial sweep', () => {
  it('removes every leftover .partial and leaves real backups alone', () => {
    addPage('x', 'x')
    expect(existsSync(slotPath(tempDir, 'daily'))).toBe(false)

    writeFileSync(partialPathFor(tempDir, 'daily'), 'incomplete')
    writeFileSync(partialPathFor(tempDir, 'weekly'), 'incomplete')
    const keep = slotPath(tempDir, 'monthly')
    writeFileSync(keep, 'a real backup')

    expect(sweepPartialBackups(tempDir)).toBe(2)
    expect(existsSync(partialPathFor(tempDir, 'daily'))).toBe(false)
    expect(existsSync(partialPathFor(tempDir, 'weekly'))).toBe(false)
    expect(readFileSync(keep, 'utf8')).toBe('a real backup')
  })

  it('names the in-progress file with the shared partial suffix', () => {
    expect(partialPathFor(tempDir, 'daily').endsWith(BACKUP_PARTIAL_SUFFIX)).toBe(true)
  })
})

describe('listing', () => {
  it('reports every slot, absent ones included, so the UI can show an empty state', async () => {
    addPage('x', 'x')
    await createBackup(tempDir, db, 'weekly')

    const listed = listBackups(tempDir)
    expect(listed.map((b) => b.slot)).toEqual(['daily', 'weekly', 'monthly'])
    expect(listed.find((b) => b.slot === 'daily')?.byteSize).toBeNull()
    expect(listed.find((b) => b.slot === 'weekly')?.byteSize).toBeGreaterThan(0)
    expect(listed.find((b) => b.slot === 'weekly')?.filename).toBe(slotFilename('weekly'))
  })
})

describe('due slots', () => {
  it('treats every never-taken slot as due', () => {
    expect(dueSlots(tempDir)).toEqual(['daily', 'weekly', 'monthly'])
  })

  it('catches a missed run up exactly once rather than once per missed period', () => {
    // Three days closed. The daily is overdue by three days, but there is one
    // daily slot, so one backup -- not three identical files.
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString()
    writeFileSync(
      join(tempDir, 'backups.json'),
      JSON.stringify({
        slots: {
          daily: { enabled: true, intervalHours: 24, lastRunAt: threeDaysAgo },
          weekly: { enabled: true, intervalHours: 168, lastRunAt: threeDaysAgo },
          monthly: { enabled: true, intervalHours: 720, lastRunAt: threeDaysAgo }
        }
      })
    )

    // Only the daily has elapsed its 24h interval. One due slot, so one backup.
    expect(dueSlots(tempDir)).toEqual(['daily'])
  })

  it('ignores a disabled slot', () => {
    writeFileSync(
      join(tempDir, 'backups.json'),
      JSON.stringify({
        slots: {
          daily: { enabled: false, intervalHours: 24, lastRunAt: null },
          weekly: { enabled: true, intervalHours: 168, lastRunAt: null },
          monthly: { enabled: true, intervalHours: 720, lastRunAt: null }
        }
      })
    )
    expect(dueSlots(tempDir)).toEqual(['weekly', 'monthly'])
  })
})

describe('latent hazard guarded by the plan', () => {
  it('never invokes incremental_vacuum, which truncates the main file in INCREMENTAL mode', async () => {
    addPage('x', 'x')
    const statements: string[] = []
    const watched = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'run') {
          return (sql: string, ...rest: unknown[]) => {
            statements.push(sql)
            return Reflect.apply(target.run as (...a: unknown[]) => unknown, target, [sql, ...rest])
          }
        }
        return Reflect.get(target, prop, receiver)
      }
    }) as Db

    const result = await createBackup(tempDir, watched, 'daily')
    expect(result.ok).toBe(true)
    const invoked = statements.filter((s) => s.toLowerCase().includes('incremental_vacuum'))
    expect(invoked).toEqual([])
  })
})

describe('Windows rename over an existing file', () => {
  it('replaces the slot, which is what makes the fixed-slot model work', async () => {
    addPage('one', 'x')
    await createBackup(tempDir, db, 'daily')
    const first = readFileSync(slotPath(tempDir, 'daily'))

    addPage('two', 'y')
    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The slot now exists, so this second write is the rename-over-existing
    // case: measured on Windows as succeeding, and asserted here so a platform
    // that behaves differently fails the suite rather than a user's backup.
    expect(existsSync(slotPath(tempDir, 'daily'))).toBe(true)
    expect(readFileSync(slotPath(tempDir, 'daily')).equals(first)).toBe(false)

    const backup = new Database(slotPath(tempDir, 'daily'), { readonly: true })
    expect(backup.query('SELECT count(*) AS n FROM pages').get()).toEqual({ n: 2 })
    backup.close()
  })
})
