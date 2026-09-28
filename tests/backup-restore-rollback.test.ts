import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slotFilename, slotPath } from '../src/server/backup/backup-service.js'
import { performRestore } from '../src/server/backup/restore-service.js'
import { closeDatabase, initDatabase, type Database as Db } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import { DATABASE_FILENAME } from '../src/shared/constants/index.js'

/**
 * A restore that fails partway must leave the wiki exactly as it was.
 *
 * Both defects this file guards had no test, which is how they shipped:
 *
 *  1. The rollback condition tested `!existsSync(live)`, and a failed copy
 *     normally *leaves* a truncated `live` behind. So the rollback was skipped
 *     for the common case and RTWiki was left pointed at a file that cannot be
 *     opened, with the only intact copy under the pre-restore name.
 *  2. The rollback deleted the backup it was restoring from, so a failed restore
 *     destroyed the only intact copy of the user's data.
 *
 * The failure is forced in a CHILD PROCESS rather than with `mock.module`.
 * `mock.module` cannot be undone and leaks into every later test file in the
 * same `bun test` process -- not theoretical: with the mock installed in-process,
 * ten unrelated backup tests failed. A child gets a clean module registry, so the
 * parent can then assert on the real filesystem and perform a real retry, and the
 * production code needs no test-only seam.
 */

let tempDir: string
let db: Db

const modulePath = (relative: string): string =>
  new URL(relative, import.meta.url).pathname.replace(/^\//, '')

const IMPORTS = [
  ['DATABASE', '../src/server/database/index.ts'],
  ['MIGRATIONS', '../src/server/database/migrations.ts'],
  ['BACKUP_SERVICE', '../src/server/backup/backup-service.ts'],
  ['RESTORE', '../src/server/backup/restore-service.ts'],
  ['REPOSITORY', '../src/server/repositories/page-repository.ts']
] as const

interface FailureReport {
  ok: boolean
  reason?: { kind: string; detail?: string }
  slotSizeBefore: number
  slotSizeAfter: number
  slotIdentical: boolean
  slotExists: boolean
}

/**
 * In a child process: migrate, seed, back up, measure the slot, force the
 * replacement to fail, then report what the slot looks like afterwards.
 *
 * `behaviour: 'partial'` is what a full disk does -- the destination is created
 * and partly written before the write errors. `'none'` is a refusal that never
 * creates the destination.
 */
async function childForcesFailure(behaviour: 'partial' | 'none'): Promise<FailureReport> {
  const script = join(tempDir, `fail-${behaviour}.ts`)
  const importLines = IMPORTS.map(
    ([name, rel]) => `import * as ${name} from ${JSON.stringify(modulePath(rel))}`
  ).join('\n')

  writeFileSync(
    script,
    [
      `import { mock } from 'bun:test'`,
      `import { createHash } from 'node:crypto'`,
      importLines,
      `const [dataDir, file, mode] = process.argv.slice(2)`,
      `const realFs = await import('node:fs')`,
      `const db = DATABASE.initDatabase(dataDir)`,
      `await MIGRATIONS.runMigrations(db, dataDir + '/attachments')`,
      // The order matters and mirrors reality: the backup is taken, and only then
      // does the wiki change. So the backup holds 'Before' alone, the live
      // database holds both, and a correct restore visibly undoes 'After'.
      `REPOSITORY.createPage(db, crypto.randomUUID(), 'Before', 'rich', 'before body', 'before body',`,
      `  { parentId: null, position: REPOSITORY.nextChildPosition(db, null) })`,
      `const backup = await BACKUP_SERVICE.createBackup(dataDir, db, 'daily')`,
      `if (!backup.ok) { process.stdout.write(JSON.stringify({ ok: false, reason: { kind: 'setup' } })); process.exit(0) }`,
      `REPOSITORY.createPage(db, crypto.randomUUID(), 'After', 'rich', 'after body', 'after body',`,
      `  { parentId: null, position: REPOSITORY.nextChildPosition(db, null) })`,
      `const slot = dataDir + '/backups/rtwiki-backup-daily'`,
      `const sizeBefore = realFs.statSync(slot).size`,
      `const hashBefore = createHash('sha256').update(realFs.readFileSync(slot)).digest('hex')`,
      `mock.module('node:fs', () => ({ ...realFs, copyFileSync: (src, dest) => {`,
      `  if (mode === 'partial') realFs.writeFileSync(dest, realFs.readFileSync(src).subarray(0, 200))`,
      `  throw new Error('ENOSPC: no space left on device')`,
      `} }))`,
      `const outcome = await RESTORE.performRestore(dataDir, file)`,
      `await DATABASE.closeDatabase()`,
      `const exists = realFs.existsSync(slot)`,
      `const sizeAfter = exists ? realFs.statSync(slot).size : -1`,
      `const hashAfter = exists`,
      `  ? createHash('sha256').update(realFs.readFileSync(slot)).digest('hex') : ''`,
      `process.stdout.write(JSON.stringify({`,
      `  ...outcome, slotSizeBefore: sizeBefore, slotSizeAfter: sizeAfter,`,
      `  slotIdentical: hashBefore === hashAfter, slotExists: exists`,
      `}))`
    ].join('\n')
  )

  const proc = Bun.spawn(['bun', 'run', script, tempDir, slotFilename('daily'), behaviour], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  if (exitCode !== 0) {
    throw new Error(`child failed (${exitCode}): ${stderr}${stdout}`)
  }
  const payload = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}'
  return JSON.parse(payload) as FailureReport
}

function titlesOf(path: string): string[] {
  const handle = new Database(path, { readonly: true })
  try {
    return (
      handle.query('SELECT title FROM pages WHERE deleted_at IS NULL ORDER BY title').all() as Array<{
        title: string
      }>
    ).map((r) => r.title)
  } finally {
    handle.close()
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-rollback-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  mkdirSync(join(tempDir, 'attachments'), { recursive: true })
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('a replacement that fails after the database was moved aside', () => {
  it('leaves a valid live database when the copy leaves a truncated file behind', async () => {
    // The common case, and the one the inverted guard skipped: the half-written
    // file exists, so `!existsSync(live)` was false and nothing was rolled back.
    const report = await childForcesFailure('partial')
    expect(report.ok).toBe(false)
    expect(report.reason?.kind).toBe('swap-failed')

    const live = join(tempDir, DATABASE_FILENAME)
    expect(existsSync(live)).toBe(true)
    // A truncated 200-byte file raises "database disk image is malformed" here,
    // so opening it is itself the assertion that no partial file survived.
    expect(titlesOf(live)).toEqual(['After', 'Before'])
    expect(statSync(live).size).toBeGreaterThan(1000)
  })

  it('rolls back when the copy fails before creating any live file', async () => {
    const report = await childForcesFailure('none')
    expect(report.ok).toBe(false)
    expect(report.reason?.kind).toBe('swap-failed')

    const live = join(tempDir, DATABASE_FILENAME)
    expect(existsSync(live)).toBe(true)
    expect(titlesOf(live)).toEqual(['After', 'Before'])
  })

  it('never deletes the backup it was restoring from', async () => {
    // The regression: the old rollback deleted `source` here, so a failed restore
    // consumed the slot and left nothing to retry from.
    for (const behaviour of ['partial', 'none'] as const) {
      const scratch = mkdtempSync(join(tmpdir(), `rtwiki-slot-${behaviour}-`))
      mkdirSync(join(scratch, 'backups'), { recursive: true })
      mkdirSync(join(scratch, 'attachments'), { recursive: true })
      const outer = tempDir
      tempDir = scratch
      try {
        const report = await childForcesFailure(behaviour)
        expect(report.ok).toBe(false)
        expect(report.slotExists).toBe(true)
        expect(report.slotSizeAfter).toBe(report.slotSizeBefore)
        expect(report.slotIdentical).toBe(true)
        // Still a usable database, not a truncated one, and still holding only
        // what it held when it was taken.
        expect(titlesOf(slotPath(scratch, 'daily'))).toEqual(['Before'])
      } finally {
        tempDir = outer
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  })

  it('leaves a separate attempt able to succeed', async () => {
    const report = await childForcesFailure('partial')
    expect(report.ok).toBe(false)
    expect(report.slotExists).toBe(true)
    expect(report.slotIdentical).toBe(true)

    // The parent's module registry was never mocked, so this is a genuine retry
    // against the genuine filesystem -- what a user does after reopening RTWiki.
    // Migrations first, as bootstrap() does at every start: the schema check has
    // no required set to compare against until they have run.
    db = initDatabase(tempDir)
    await runMigrations(db, join(tempDir, 'attachments'))

    const retried = await performRestore(tempDir, slotFilename('daily'))
    expect(retried.ok).toBe(true)
    if (!retried.ok) return

    // The backup's content ('Before' only), not the pre-restore state.
    expect(titlesOf(join(tempDir, DATABASE_FILENAME))).toEqual(['Before'])
  })
})
