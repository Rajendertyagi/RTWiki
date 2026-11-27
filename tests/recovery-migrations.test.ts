import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup } from '../src/server/backup/backup-service.js'
import { validateBackupFile } from '../src/server/backup/validation.js'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { requiredMigrationNames, runMigrations } from '../src/server/database/migrations.js'
import {
  OperationKind,
  OperationKindSchema,
  OperationStatus,
  OperationStatusSchema,
  RecoveryActor,
  RecoveryActorSchema,
  RevisionCaptureKind,
  RevisionCaptureKindSchema
} from '../src/shared/schemas/recovery.js'

const MIGRATION_014 = '014_soft_delete_attachments'
const MIGRATION_015 = '015_recovery_data'

let tempDir: string
let db: ReturnType<typeof getDb>

function migrationNames(): string[] {
  return (db.query('SELECT name FROM _migrations').all() as Array<{ name: string }>).map(
    (row) => row.name
  )
}

function columnTypes(table: string): Record<string, string> {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
    type: string
  }>
  return Object.fromEntries(rows.map((row) => [row.name, row.type]))
}

function indexNames(): string[] {
  return (
    db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
      name: string
    }>
  ).map((row) => row.name)
}

function insertLegacyPage(id: string): void {
  db.run(
    `INSERT INTO pages (id, title, content, created_at, updated_at, page_type, parent_id, position)
     VALUES (?, ?, ?, ?, ?, 'rich', NULL, 0)`,
    [id, `Page ${id}`, '', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z']
  )
}

function insertLegacyAttachment(id: string): void {
  db.run(
    `INSERT INTO attachments
       (id, mime_type, byte_size, original_name, kind, data, bytes_stored, created_at)
     VALUES (?, 'image/png', 4, 'x.png', 'image', ?, 1, '2020-01-01T00:00:00.000Z')`,
    [id, Buffer.from([1, 2, 3, 4])]
  )
}

/**
 * Rolls the two recovery migrations back to their 013-era shape so the next
 * `runMigrations` exercises the real upgrade path with data already present.
 * Indexes go before the columns they cover: SQLite refuses to drop an indexed
 * column.
 */
function rollBackRecoveryMigrations(): void {
  db.run('DROP INDEX IF EXISTS idx_attachments_deleted_at')
  db.run('ALTER TABLE attachments DROP COLUMN deleted_at')
  db.run('DROP INDEX IF EXISTS idx_page_revisions_page_version')
  db.run('DROP INDEX IF EXISTS idx_page_revisions_captured_at')
  db.run('DROP TABLE IF EXISTS page_revisions')
  db.run('DROP INDEX IF EXISTS idx_operation_log_created_at')
  db.run('DROP TABLE IF EXISTS operation_log')
  db.run('ALTER TABLE pages DROP COLUMN structure_version')
  db.run('DELETE FROM _migrations WHERE name IN (?, ?)', [MIGRATION_014, MIGRATION_015])
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `rtwiki-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db)
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('migrations 014 and 015: recovery foundation', () => {
  it('apply on a fresh database and record both names', () => {
    const names = migrationNames()
    expect(names).toContain(MIGRATION_014)
    expect(names).toContain(MIGRATION_015)
    expect(requiredMigrationNames()).toContain(MIGRATION_014)
    expect(requiredMigrationNames()).toContain(MIGRATION_015)
  })

  it('derive the required set from the migration calls, not a second list', () => {
    // Backup validation compares these two sets in both directions. If a
    // hand-maintained list existed, this equality would be the first thing to
    // drift when a migration is added.
    expect([...requiredMigrationNames()].sort()).toEqual([...migrationNames()].sort())
  })

  it('create the expected columns, tables and indexes with the expected types', () => {
    expect(columnTypes('attachments').deleted_at).toBe('TEXT')
    expect(columnTypes('pages').structure_version).toBe('INTEGER')

    expect(columnTypes('page_revisions')).toEqual({
      id: 'TEXT',
      page_id: 'TEXT',
      version: 'INTEGER',
      title: 'TEXT',
      content: 'TEXT',
      page_type: 'TEXT',
      parent_id: 'TEXT',
      position: 'INTEGER',
      search_content: 'TEXT',
      children_snapshot: 'TEXT',
      links_snapshot: 'TEXT',
      capture_kind: 'TEXT',
      actor: 'TEXT',
      captured_at: 'TEXT',
      created_at: 'TEXT'
    })
    expect(columnTypes('operation_log')).toEqual({
      id: 'TEXT',
      operation_kind: 'TEXT',
      target_page_id: 'TEXT',
      target_attachment_id: 'TEXT',
      before_revision_id: 'TEXT',
      after_revision_id: 'TEXT',
      actor: 'TEXT',
      status: 'TEXT',
      created_at: 'TEXT'
    })

    const indexes = indexNames()
    expect(indexes).toContain('idx_attachments_deleted_at')
    expect(indexes).toContain('idx_page_revisions_page_version')
    expect(indexes).toContain('idx_page_revisions_captured_at')
    expect(indexes).toContain('idx_operation_log_created_at')

    // Recovery data must survive permanent deletion of its target.
    expect(db.query('PRAGMA foreign_key_list(page_revisions)').all()).toEqual([])
    expect(db.query('PRAGMA foreign_key_list(operation_log)').all()).toEqual([])

    const structureVersion = (
      db.query('PRAGMA table_info(pages)').all() as Array<{
        name: string
        type: string
        notnull: number
        dflt_value: string | null
      }>
    ).find((column) => column.name === 'structure_version')
    expect(structureVersion).toMatchObject({ type: 'INTEGER', notnull: 1, dflt_value: '0' })
  })

  it('apply over existing pages and attachments without losing data', async () => {
    insertLegacyPage('p-existing')
    insertLegacyAttachment('a-existing')

    rollBackRecoveryMigrations()
    expect(columnTypes('pages').structure_version).toBeUndefined()
    expect(columnTypes('attachments').deleted_at).toBeUndefined()
    expect(db.query("SELECT id FROM pages WHERE id = 'p-existing'").get()).toBeDefined()

    await runMigrations(db)

    const page = db.query('SELECT structure_version FROM pages WHERE id = ?').get('p-existing') as {
      structure_version: number
    }
    expect(page.structure_version).toBe(0)

    const attachment = db
      .query('SELECT deleted_at, data FROM attachments WHERE id = ?')
      .get('a-existing') as { deleted_at: string | null; data: Uint8Array }
    expect(attachment.deleted_at).toBeNull()
    expect(Buffer.from(attachment.data).toString('hex')).toBe('01020304')

    // A page created after the migration gets the same default.
    db.run("INSERT INTO pages (id, title, content) VALUES ('p-new', 'New', '')")
    const fresh = db.query('SELECT structure_version FROM pages WHERE id = ?').get('p-new') as {
      structure_version: number
    }
    expect(fresh.structure_version).toBe(0)

    expect(migrationNames()).toContain(MIGRATION_014)
    expect(migrationNames()).toContain(MIGRATION_015)
  })

  it('backup validation refuses a backup missing either new migration', async () => {
    const result = await createBackup(tempDir, db, 'daily')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(validateBackupFile(result.path).ok).toBe(true)

    for (const name of [MIGRATION_014, MIGRATION_015]) {
      const path = join(tempDir, `missing-${name}.sqlite`)
      copyFileSync(result.path, path)
      const target = new Database(path)
      try {
        target.run('DELETE FROM _migrations WHERE name = ?', [name])
      } finally {
        target.close()
      }
      expect(validateBackupFile(path)).toEqual({ ok: false, reason: 'schema-missing-migration' })
    }
  })
})

describe('recovery value sets', () => {
  it('define exactly the eight operation kinds', () => {
    expect([...OperationKind]).toEqual([
      'page.update',
      'page.trash',
      'page.restore',
      'page.revision.restore',
      'page.permanent_delete',
      'attachment.trash',
      'attachment.restore',
      'attachment.permanent_delete'
    ])
    expect(OperationKindSchema.safeParse('page.delete').success).toBe(false)
  })

  it('define exactly one status, three actors and three capture kinds', () => {
    expect([...OperationStatus]).toEqual(['committed'])
    expect([...RecoveryActor]).toEqual(['local-client', 'system', 'ai'])
    expect([...RevisionCaptureKind]).toEqual([
      'before_update',
      'before_soft_delete',
      'before_restore'
    ])
    expect(OperationStatusSchema.safeParse('pending').success).toBe(false)
    expect(RecoveryActorSchema.safeParse('anonymous').success).toBe(false)
    expect(RevisionCaptureKindSchema.safeParse('before_import').success).toBe(false)
  })
})
