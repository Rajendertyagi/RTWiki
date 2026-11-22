import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, type getDb, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { ingestFile } from '../src/server/ingest/ingest-file.js'
import type { IngestDependencies, IngestFileInput } from '../src/server/ingest/ingest-types.js'
import type { Logger } from '../src/server/logging/index.js'

const enc = (s: string) => new TextEncoder().encode(s)

const silent: Logger = {
  info() {},
  warn() {},
  error() {},
  async flush() {},
  async close() {}
}

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `rtwiki-ingest-tx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

function input(overrides: Partial<IngestFileInput> = {}): IngestFileInput {
  return {
    sourceKind: 'file',
    bytes: enc('transaction body'),
    reportedType: 'text/plain',
    originalName: 'tx.txt',
    createPage: true,
    ...overrides
  }
}

describe('ingestFile transaction', () => {
  let tempDir: string
  let db: ReturnType<typeof getDb>
  let deps: IngestDependencies

  beforeAll(async () => {
    tempDir = makeTempDir()
    db = initDatabase(tempDir)
    await runMigrations(db)
    deps = { logger: silent }
  })

  afterAll(async () => {
    await closeDatabase()
    cleanup(tempDir)
  })

  it('rolls back the page and attachment when provenance insertion fails', async () => {
    // A trigger that aborts every provenance write is a deterministic way to
    // force the last step of the transaction to fail without touching the
    // production code or relying on a timing-dependent fault.
    db.run(`
      CREATE TRIGGER fail_provenance
      BEFORE INSERT ON import_sources
      BEGIN
        SELECT RAISE(ABORT, 'forced provenance failure');
      END
    `)

    const before = {
      pages: (db.query('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n,
      attachments: (db.query('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n,
      provenance: (db.query('SELECT COUNT(*) AS n FROM import_sources').get() as { n: number }).n
    }

    let threw = false
    try {
      await ingestFile(db, input(), deps)
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    const after = {
      pages: (db.query('SELECT COUNT(*) AS n FROM pages').get() as { n: number }).n,
      attachments: (db.query('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n,
      provenance: (db.query('SELECT COUNT(*) AS n FROM import_sources').get() as { n: number }).n
    }
    expect(after).toEqual(before)

    // No orphan rows: nothing from the failed import is observable.
    expect(db.query('SELECT id FROM import_sources').all()).toEqual([])
    expect(db.query("SELECT id FROM pages WHERE title = 'tx'").all()).toEqual([])

    db.run('DROP TRIGGER fail_provenance')
  })

  it('leaves no open transaction after a rollback', async () => {
    // A subsequent successful import must be able to open BEGIN IMMEDIATE; if
    // the failed one left the connection in a transaction this would throw.
    const result = await ingestFile(db, input({ originalName: 'after.txt' }), deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pageId).not.toBeNull()
      const provenance = db
        .query('SELECT id FROM import_sources WHERE page_id = ?')
        .get(result.pageId)
      expect(provenance).not.toBeNull()
    }
  })
})
