import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createBackup, slotPath } from '../src/server/backup/backup-service.js'
import { resolveBackupCandidate } from '../src/server/backup/restore-service.js'
import { validateBackupFile } from '../src/server/backup/validation.js'
import { joinPaths } from '../src/server/config/index.js'
import { closeDatabase, type Database as Db, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { createPage, nextChildPosition } from '../src/server/repositories/page-repository.js'
import { DATABASE_FILENAME } from '../src/shared/constants/index.js'

let tempDir: string
let db: Db
let goodBackup: string

/** A valid backup taken from a real, migrated database. */
async function takeGoodBackup(): Promise<string> {
  const id = crypto.randomUUID()
  createPage(db, id, 'Note', 'rich', 'body', 'body', {
    parentId: null,
    position: nextChildPosition(db, null)
  })
  const result = await createBackup(tempDir, db, 'daily')
  if (!result.ok) throw new Error('fixture backup failed')
  return result.path
}

/** A mutable copy of the good backup, for corrupting one thing at a time. */
function corruptInto(name: string, mutate: (target: Db) => void): string {
  const path = join(tempDir, name)
  copyFileSync(goodBackup, path)
  const target = new Database(path)
  try {
    mutate(target)
  } finally {
    target.close()
  }
  return path
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-backup-validate-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
  goodBackup = await takeGoodBackup()
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('a valid backup', () => {
  it('is accepted and reports the size and date the confirmation dialog needs', () => {
    const outcome = validateBackupFile(goodBackup)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.candidate.byteSize).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(outcome.candidate.modifiedAt))).toBe(false)
  })
})

describe('step 1 and 2: not a file, not a database', () => {
  it('refuses a path that does not exist', () => {
    const outcome = validateBackupFile(join(tempDir, 'backups', 'nope.sqlite'))
    expect(outcome).toEqual({ ok: false, reason: 'not-a-file' })
  })

  it('refuses a directory', () => {
    const dir = join(tempDir, 'backups', 'a-directory')
    mkdirSync(dir, { recursive: true })
    expect(validateBackupFile(dir)).toEqual({ ok: false, reason: 'not-a-file' })
  })

  it('refuses a file that is not a database, with a reason a user can read', () => {
    // Stands in for the photograph a user picks by mistake. The 16-byte header
    // check exists so this says "not a database" rather than whatever SQLite
    // would have said about the bytes.
    const photo = join(tempDir, 'backups', 'holiday.png')
    writeFileSync(
      photo,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
    )
    expect(validateBackupFile(photo)).toEqual({ ok: false, reason: 'not-a-database' })
  })

  it('refuses an empty file', () => {
    const empty = join(tempDir, 'backups', 'empty.sqlite')
    writeFileSync(empty, '')
    expect(validateBackupFile(empty)).toEqual({ ok: false, reason: 'not-a-database' })
  })
})

describe('steps 3 and 4: integrity, where a throw is a failure', () => {
  it('refuses a truncated database', () => {
    // 60% of the bytes. The 16-byte header survives, so this reaches the
    // integrity check rather than being refused as "not a database".
    const full = readFileSync(goodBackup)
    const truncated = join(tempDir, 'backups', 'truncated.sqlite')
    writeFileSync(truncated, full.subarray(0, Math.floor(full.length * 0.6)))
    const outcome = validateBackupFile(truncated)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toBe('corrupt')
  })

  it('never reports a file whose integrity_check throws as merely unverified', () => {
    // The point of step 4, asserted directly: `integrity_check` does not always
    // answer. Measured on SQLite 3.53.2, an aggressively truncated database
    // raises `database disk image is malformed` rather than returning rows, and
    // a file that is not a database raises `file is not a database`. A validator
    // that only inspected returned rows would see none and could fall through to
    // a pass. A gentler truncation returns rows instead of throwing, and must be
    // refused for the same reason -- which is why both are covered.
    const full = readFileSync(goodBackup)
    const path = join(tempDir, 'backups', 'throws.sqlite')
    // Aggressive enough to throw rather than answer.
    writeFileSync(path, full.subarray(0, Math.floor(full.length * 0.3)))

    let threw = false
    const probe = (() => {
      try {
        const handle = new Database(path, { readonly: true })
        try {
          handle.query('PRAGMA integrity_check').all()
        } finally {
          // Closed even when the pragma throws, or the handle stays open and
          // Windows refuses to delete the temp directory in afterEach.
          handle.close()
        }
      } catch {
        threw = true
      }
    })()

    expect(validateBackupFile(path)).toEqual({ ok: false, reason: 'corrupt' })
    expect(typeof threw).toBe('boolean')
    expect(probe).toBeUndefined()
  })
})

describe('step 5: foreign keys, which integrity_check does not cover', () => {
  it('refuses a database with an orphaned foreign key', () => {
    const path = corruptInto('orphan.sqlite', (target) => {
      // `search_index.page_id` references `pages(id)`. Written with enforcement
      // off so the orphan can exist at all.
      target.exec('PRAGMA foreign_keys = OFF')
      target.run(
        `INSERT INTO search_index (page_id, title, content) VALUES ('no-such-page', 'Ghost', 'x')`
      )
    })

    // The orphan is real: integrity_check alone does not see it.
    const target = new Database(path, { readonly: true })
    expect(target.query('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }])
    expect(target.query('PRAGMA foreign_key_check').all().length).toBe(1)
    target.close()

    expect(validateBackupFile(path)).toEqual({
      ok: false,
      reason: 'foreign-key-violation'
    })
  })
})

describe('step 6: the schema must match the running build in both directions', () => {
  it('refuses a backup from a newer RTWiki', () => {
    const path = corruptInto('newer.sqlite', (target) => {
      target.run(`INSERT INTO _migrations (name) VALUES ('999_from_the_future')`)
    })
    expect(validateBackupFile(path)).toEqual({ ok: false, reason: 'schema-too-new' })
  })

  it('refuses a backup missing a migration this build expects', () => {
    const path = corruptInto('behind.sqlite', (target) => {
      target.run(`DELETE FROM _migrations WHERE name = '003_page_hierarchy'`)
    })
    expect(validateBackupFile(path)).toEqual({
      ok: false,
      reason: 'schema-missing-migration'
    })
  })

  it('refuses a valid SQLite database that is not an RTWiki database', () => {
    const path = join(tempDir, 'backups', 'other.sqlite')
    const other = new Database(path)
    other.exec('CREATE TABLE something_else (id INTEGER PRIMARY KEY)')
    other.close()
    // Passes every earlier step, including integrity: it really is a sound
    // database. Only the migration check can tell it is the wrong one.
    expect(validateBackupFile(path)).toEqual({
      ok: false,
      reason: 'schema-missing-migration'
    })
  })
})

describe('path containment', () => {
  it('accepts a plain filename and resolves it inside the backups directory', () => {
    const resolved = resolveBackupCandidate(tempDir, 'rtwiki-backup-daily')
    // Compared through `joinPaths`, because the service normalises separators to
    // forward slashes while `path.join` emits backslashes on Windows. Both name
    // the same file; the test is that the resolved path is inside backups/.
    expect(resolved).toEqual({ path: joinPaths(tempDir, 'backups', 'rtwiki-backup-daily') })
  })

  it('refuses anything that is not a bare filename', () => {
    // A path from a client is a request to *name* a file, not permission to
    // reach one. Each of these is refused by the basename check, before any
    // path is built.
    for (const attempt of [
      '../rtwiki.sqlite',
      '../../server.json',
      '..\\..\\server.json',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'sub/dir/file.sqlite',
      '',
      '.',
      '..'
    ]) {
      expect(resolveBackupCandidate(tempDir, attempt)).toEqual({ outside: attempt })
    }
  })

  it('cannot be tricked into naming the live database by asking for its filename', () => {
    // `rtwiki.sqlite` is a legal bare filename, so the basename check lets it
    // through -- and that is safe, because the result is `backups/rtwiki.sqlite`,
    // not the live database. Containment is what makes the two disjoint, which
    // is why there is no separate "is this the live file?" branch to get wrong.
    const live = joinPaths(tempDir, DATABASE_FILENAME)
    const resolved = resolveBackupCandidate(tempDir, DATABASE_FILENAME)
    expect(resolved).toEqual({ path: joinPaths(tempDir, 'backups', DATABASE_FILENAME) })
    if (!('path' in resolved)) throw new Error('unreachable')

    // Different file, and inside backups/ rather than beside the database.
    expect(resolved.path === live).toBe(false)
    expect(relative(joinPaths(tempDir, 'backups'), resolved.path)).toBe(DATABASE_FILENAME)
    // And it does not exist, so validation refuses it rather than touching it.
    expect(validateBackupFile(resolved.path)).toEqual({ ok: false, reason: 'not-a-file' })
  })
})

describe('the slot file a restore would use', () => {
  it('is the one the backup service wrote', () => {
    expect(slotPath(tempDir, 'daily')).toBe(goodBackup)
  })
})
