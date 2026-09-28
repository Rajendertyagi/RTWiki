import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, slotFilename } from '../src/server/backup/backup-service.js'
import { performRestore } from '../src/server/backup/restore-service.js'
import { validateBackupFile } from '../src/server/backup/validation.js'
import { closeDatabase, type Database as Db, initDatabase } from '../src/server/database/index.js'
import { requiredMigrationNames, runMigrations } from '../src/server/database/migrations.js'
import { createPage, nextChildPosition } from '../src/server/repositories/page-repository.js'
import { DATABASE_FILENAME } from '../src/shared/constants/index.js'

let tempDir: string
let db: Db

interface PageRow {
  id: string
  title: string
  content: string
  parent_id: string | null
  position: number
}

function addPage(title: string, content: string, parentId: string | null = null): string {
  const id = crypto.randomUUID()
  createPage(db, id, title, 'rich', content, content, {
    parentId,
    position: nextChildPosition(db, parentId)
  })
  return id
}

function liveConnection(): Db {
  return initDatabase(tempDir)
}

function readPages(target: Db): PageRow[] {
  return target
    .query('SELECT id, title, content, parent_id, position FROM pages WHERE deleted_at IS NULL')
    .all() as PageRow[]
}

/**
 * Content equality, compared as a set.
 *
 * Deliberately not positional. `VACUUM INTO` may renumber the `pages` rowids --
 * SQLite documents that a VACUUM "may change the ROWIDs of entries in any tables
 * that do not have an explicit INTEGER PRIMARY KEY", and `pages` is
 * `id TEXT PRIMARY KEY`. Three of the ordering queries tie-break on rowid
 * (`page-repository.ts:365`, `:382`, `:430`, `:435`), so a positional comparison
 * would fail on a perfectly correct backup. An order-blind comparison could mask
 * a real ordering regression, so ordering is asserted separately and only where
 * it does not depend on rowid.
 */
function expectSameContent(actual: PageRow[], expected: PageRow[]): void {
  const key = (p: PageRow) => `${p.id}|${p.title}|${p.content}|${p.parent_id ?? ''}|${p.position}`
  expect(new Set(actual.map(key)).size).toBe(new Set(expected.map(key)).size)
  expect([...actual.map(key)].sort()).toEqual([...expected.map(key)].sort())
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-roundtrip-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('the round trip', () => {
  it('backs up, wipes, restores, and gets the content back', async () => {
    addPage('Alpha', 'the first note')
    const parent = addPage('Parent', 'a page with children')
    addPage('Child one', 'nested content', parent)
    addPage('Child two', 'more nested content', parent)
    const before = readPages(db)
    expect(before).toHaveLength(4)

    const backup = await createBackup(tempDir, db, 'daily')
    expect(backup.ok).toBe(true)
    if (!backup.ok) return

    // Wipe. Deletes the rows and checkpoints, so what is left is a working,
    // empty wiki rather than a broken one.
    db.run('DELETE FROM pages')
    db.run('DELETE FROM search_index')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    expect(readPages(db)).toHaveLength(0)

    const restored = await performRestore(tempDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    const after = readPages(liveConnection())
    expect(after).toHaveLength(4)
    expectSameContent(after, before)
  })

  it('keeps the backup file, so a second restore of the same slot is possible', async () => {
    addPage('Keep me', 'x')
    await createBackup(tempDir, db, 'daily')
    const path = join(tempDir, 'backups', slotFilename('daily'))

    await performRestore(tempDir, slotFilename('daily'))
    // Copied, not consumed. Moving it would leave no daily after a daily
    // restore, and a second attempt would have nothing to restore from.
    expect(existsSync(path)).toBe(true)

    await performRestore(tempDir, slotFilename('daily'))
    expect(readPages(liveConnection())).toHaveLength(1)
  })

  it('moves the previous database aside rather than deleting it', async () => {
    addPage('Before', 'the wiki as it was')
    const beforeId = readPages(db)[0]?.id
    await createBackup(tempDir, db, 'daily')

    // Change the wiki after the backup, so the restore is visibly a rollback.
    addPage('After', 'written after the backup was taken')
    expect(readPages(db)).toHaveLength(2)

    const restored = await performRestore(tempDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    // The live wiki is back to the backup's state.
    expect(readPages(liveConnection())).toHaveLength(1)

    // And the database that was there before is still on disk, holding the page
    // that is no longer live. A bad restore is recoverable by hand.
    expect(existsSync(restored.preRestorePath)).toBe(true)
    const preRestore = new Database(restored.preRestorePath, { readonly: true })
    const rows = preRestore.query('SELECT id, title FROM pages').all()
    preRestore.close()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => (r as { id: string }).id)).toContain(beforeId)
  })

  it('moves the WAL sidecars aside with it, so the old journal cannot be replayed', async () => {
    // The hazard this covers: restoring by replacing only the main file would
    // leave the previous database's `-wal` beside the new one, and SQLite treats
    // a WAL that does not match its database as a hot journal and replays it --
    // writing the old wiki's pages back over the one just restored, silently.
    addPage('Content that lands in the WAL', 'x')
    await createBackup(tempDir, db, 'daily')

    // A write after the backup, left un-checkpointed, guarantees a non-empty
    // `-wal` at the moment of the swap.
    db.run(
      `INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, version)
       VALUES ('wal-only', 'Written after the backup', 'x', 'rich', NULL, 99,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`
    )

    const restored = await performRestore(tempDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    const titles = readPages(liveConnection()).map((p) => p.title)
    // The post-backup page is gone, and did not come back via a replayed WAL.
    expect(titles).toEqual(['Content that lands in the WAL'])
  })

  it('a tied sibling pair survives a restore with its content intact', async () => {
    // The regression guard for the rowid footnote. Two siblings deliberately
    // share a `position`, which is what makes rowid the deciding tie-break.
    // `(parent_id, position)` is not UNIQUE in the schema, so this state is
    // reachable; the point is that neither page is lost or altered, and the
    // round-trip assertion does not depend on which of the two comes first.
    const parent = addPage('Parent', 'p')
    const first = crypto.randomUUID()
    const second = crypto.randomUUID()
    for (const [id, title] of [
      [first, 'Tied A'],
      [second, 'Tied B']
    ] as const) {
      db.run(
        `INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, version)
         VALUES (?, ?, 'tied content', 'rich', ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`,
        [id, title, parent]
      )
    }

    const tied = readPages(db).filter((p) => p.parent_id === parent)
    expect(tied).toHaveLength(2)
    expect(tied[0]?.position).toBe(tied[1]?.position)

    const backup = await createBackup(tempDir, db, 'daily')
    expect(backup.ok).toBe(true)

    db.run('DELETE FROM pages WHERE parent_id = ?', [parent])
    expect(readPages(db).filter((p) => p.parent_id === parent)).toHaveLength(0)

    const restored = await performRestore(tempDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    const after = readPages(liveConnection()).filter((p) => p.parent_id === parent)
    expect(after).toHaveLength(2)
    expectSameContent(after, tied)
    // Both siblings are present with their content, whichever order they come
    // back in -- the assertion is order-insensitive by design.
    expect([...after.map((p) => p.title)].sort()).toEqual(['Tied A', 'Tied B'])
  })

  it('orders siblings by position, which is stable across a restore', async () => {
    const parent = addPage('Parent', 'p')
    for (const title of ['One', 'Two', 'Three']) {
      addPage(title, 'ordered content', parent)
    }
    const before = readPages(db).filter((p) => p.parent_id === parent)

    await createBackup(tempDir, db, 'daily')
    db.run('DELETE FROM pages WHERE parent_id = ?', [parent])
    const restored = await performRestore(tempDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    const after = readPages(liveConnection()).filter((p) => p.parent_id === parent)
    // `position` is unique within a sibling group here, so the ordering is
    // decided by `position` and not by rowid -- which makes this assertion
    // safe, and the tied-pair case above the one that needed loosening.
    const monotonic = after.every(
      (page, index) => index === 0 || (after[index - 1]?.position ?? 0) <= page.position
    )
    expect(monotonic).toBe(true)
    expect([...after.map((p) => p.title)]).toEqual([...before.map((p) => p.title)])
  })
})

describe('an existing installation', () => {
  it('a database that has already run its migrations can back up and restore', async () => {
    // Regression. The schema check compares a backup's `_migrations` against the
    // set of migrations this build *requires*. That set used to be populated
    // only as migrations were applied or found present, and
    // `008_drop_stored_name` is reached solely through the code path that
    // applies `007` for the first time. So on any database where `007` had
    // already run -- which is every database that had been started before this
    // build -- the required set held 8 names while `_migrations` held 9, and
    // every backup the server took was refused as `schema-too-new`.
    //
    // Every other test here builds a fresh temporary database, which is exactly
    // the case that hid it. This one restarts against the same data directory,
    // so `007` is already applied and the already-applied path is the one taken.
    const dataDir = tempDir

    // The page is written on the first boot, through the connection `beforeEach`
    // already opened and migrated.
    db.run(
      `INSERT INTO pages (id, title, content, page_type, parent_id, position, created_at, updated_at, version)
       VALUES ('kept', 'Written before the restart', 'body text', 'rich', NULL, 0,
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 0)`
    )

    // Restart. `initDatabase` here replaces the handle, so the old one must be
    // closed first or its file stays locked and the directory cannot be removed.
    await closeDatabase()
    const restarted = initDatabase(dataDir)
    await runMigrations(restarted, join(dataDir, 'attachments'))

    // The required set and the table must agree, in both directions.
    const required = requiredMigrationNames()
    const reader = new Database(join(dataDir, DATABASE_FILENAME), { readonly: true })
    const present = (
      reader.query('SELECT name FROM _migrations').all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    reader.close()
    expect(present.filter((name) => !required.includes(name))).toEqual([])
    expect(required.filter((name) => !present.includes(name))).toEqual([])

    // And the round trip actually closes, on the restarted database.
    const backup = await createBackup(dataDir, restarted, 'daily')
    expect(backup.ok).toBe(true)
    if (!backup.ok) return
    expect(validateBackupFile(backup.path).ok).toBe(true)

    restarted.run('DELETE FROM pages')
    expect(readPages(restarted)).toHaveLength(0)

    const restored = await performRestore(dataDir, slotFilename('daily'))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return

    // Every handle closed before reading, or Windows refuses to delete the
    // temporary directory afterwards.
    const after = new Database(join(dataDir, DATABASE_FILENAME), { readonly: true })
    const rows = after
      .query('SELECT title, content FROM pages WHERE deleted_at IS NULL')
      .all() as Array<{ title: string; content: string }>
    after.close()
    expect(rows).toEqual([{ title: 'Written before the restart', content: 'body text' }])
  })

  it('a database still mid-migration is refused rather than backed up', async () => {
    // The counterpart, and the reason 008 is recorded as *required* rather than
    // as *applied*. When the attachment backfill cannot finish, 008 stays
    // outstanding and a backup of that database must be refused -- which the
    // schema check now does on its own, in addition to the attachment-byte
    // check in `createBackup`.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(`DELETE FROM _migrations WHERE name = '008_drop_stored_name'`)
    db.exec('ALTER TABLE attachments RENAME TO attachments_settled')
    db.exec(`
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
        original_name TEXT, checksum TEXT, created_at TEXT NOT NULL,
        stored_name TEXT NOT NULL, data BLOB
      )
    `)
    db.exec(`
      INSERT INTO attachments (id, mime_type, byte_size, original_name, checksum, created_at, stored_name, data)
      VALUES ('mid', 'image/png', 4, 'a.png', NULL, '2026-01-01T00:00:00.000Z', 'a.png', NULL)
    `)
    db.exec('DROP TABLE attachments_settled')
    db.exec('PRAGMA foreign_keys = ON')

    // The required set still contains 008 even though the table does not.
    expect(requiredMigrationNames()).toContain('008_drop_stored_name')

    const refused = await createBackup(tempDir, db, 'daily')
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('mid-migration-attachments')
  })

  it('a backup of a mid-migration database is refused by the schema check too', async () => {
    // The schema check refuses independently of the attachment-byte check, so
    // neither is the only thing standing between a half-migrated database and a
    // backup that claims to be complete. The fixture is a healthy backup whose
    // `_migrations` has been rolled back one step.
    const backup = await createBackup(tempDir, db, 'daily')
    expect(backup.ok).toBe(true)
    if (!backup.ok) return

    const doctored = join(tempDir, 'backups', 'rtwiki-backup-behind')
    copyFileSync(backup.path, doctored)
    const handle = new Database(doctored)
    handle.exec(`DELETE FROM _migrations WHERE name = '008_drop_stored_name'`)
    handle.close()

    expect(validateBackupFile(doctored)).toEqual({
      ok: false,
      reason: 'schema-missing-migration'
    })
  })
})

describe('a restore that cannot proceed', () => {
  it('leaves the wiki untouched when the candidate is refused', async () => {
    addPage('Safe', 'must survive')
    const before = readPages(db)
    await createBackup(tempDir, db, 'daily')

    // A file in the backups directory that is not a database.
    const junk = join(tempDir, 'backups', 'not-really.sqlite')
    await Bun.write(junk, 'this is not a database')

    const refused = await performRestore(tempDir, 'not-really.sqlite')
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason.kind).toBe('invalid')

    // The live database was never touched, and is still usable.
    expect(readPages(db)).toHaveLength(before.length)
  })

  it('refuses a filename that tries to escape the backups directory', async () => {
    addPage('Safe', 'must survive')
    const refused = await performRestore(tempDir, `..${DATABASE_FILENAME}`)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason.kind).toBe('path-outside-backups')
    expect(readPages(db)).toHaveLength(1)
  })
})
