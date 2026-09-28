import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type BackupSchedule,
  dueSlots,
  startBackupSchedule
} from '../src/server/backup/schedule.js'
import {
  closeDatabase,
  type Database as Db,
  initDatabase,
  setDatabaseLogger
} from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import type { Logger } from '../src/server/logging/index.js'
import { BACKUP_FILENAME_PREFIX } from '../src/shared/constants/index.js'

/**
 * The scheduler's overlap guard, and the fact that it is always released.
 *
 * The guard is one synchronous flag, `inFlight` (`schedule.ts`). It is set
 * before the run body's first `await` and cleared in a `.finally`, so it cannot
 * be entered twice from the same tick and cannot outlive the run. What is worth
 * proving is the release, because a guard that is never cleared is a schedule
 * that silently stops working -- and it looks exactly like a guard that is doing
 * its job, right up until the day backups quietly stop happening.
 *
 * Overlap is observed through the database module's logger, which is how
 * `createBackup` reports a completed backup ('Backup written'). `mock.module` is
 * deliberately not used: it cannot be undone and leaks into every later test
 * file in the same `bun test` process.
 */

let tempDir: string
let db: Db
let schedule: BackupSchedule | null = null

interface LogLine {
  level: 'info' | 'warn' | 'error'
  event?: string
}

let lines: LogLine[] = []

/** A logger that records what it was told, so assertions can read it. */
function recordingLogger(): Logger {
  // `LogContext` is `Record<string, unknown>`, so `event` arrives untyped.
  const eventOf = (context?: Record<string, unknown>): string | undefined => {
    const value = context?.event
    return typeof value === 'string' ? value : undefined
  }
  return {
    info: (_message, context) => {
      lines.push({ level: 'info', event: eventOf(context) })
    },
    warn: (_message, context) => {
      lines.push({ level: 'warn', event: eventOf(context) })
    },
    error: (_message, context) => {
      lines.push({ level: 'error', event: eventOf(context) })
    },
    flush: async () => {},
    close: async () => {}
  }
}

/** How many backups the service reported writing. */
function backupsWritten(): number {
  return lines.filter((l) => l.level === 'info' && l.event === 'backup_written').length
}

function dailySlotPath(): string {
  return join(tempDir, 'backups', `${BACKUP_FILENAME_PREFIX}daily`)
}

/** Leaves exactly one period enabled and due, so a run does one predictable thing. */
function onlyDailyDue(): void {
  writeFileSync(
    join(tempDir, 'backups.json'),
    JSON.stringify({
      slots: {
        daily: { enabled: true, intervalHours: 24, lastRunAt: null },
        weekly: { enabled: false, intervalHours: 168, lastRunAt: null },
        monthly: { enabled: false, intervalHours: 720, lastRunAt: null }
      }
    })
  )
}

function start(checkIntervalMs = 3_600_000, kickoffMs = 3_600_000): BackupSchedule {
  const created = startBackupSchedule({
    dataDir: tempDir,
    getDb: () => db,
    logger: recordingLogger(),
    // Long enough that the timers never fire during a test: every run here is
    // triggered explicitly, so what is under test is the guard and not a race
    // with the scheduler's own cadence.
    checkIntervalMs,
    kickoffMs
  })
  if (created === null) throw new Error('schedule was not created')
  return created
}

beforeEach(async () => {
  lines = []
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-schedule-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  mkdirSync(join(tempDir, 'attachments'), { recursive: true })
  setDatabaseLogger(recordingLogger())
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
})

afterEach(async () => {
  schedule?.stop()
  schedule = null
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('the overlap guard', () => {
  it('two triggers in the same tick produce one backup, not two', async () => {
    onlyDailyDue()
    schedule = start()

    // Both calls happen in one synchronous turn. The first sets `inFlight`
    // before it can suspend, so the second must join it rather than start a
    // second run against the same slot.
    const first = schedule.runDue()
    const second = schedule.runDue()
    await Promise.all([first, second])

    expect(backupsWritten()).toBe(1)
    expect(existsSync(dailySlotPath())).toBe(true)
  })

  it('many triggers in one tick still produce one backup', async () => {
    onlyDailyDue()
    schedule = start()

    await Promise.all(Array.from({ length: 12 }, () => schedule?.runDue()))

    expect(backupsWritten()).toBe(1)
  })

  it('is released after a successful run, so a later due run executes', async () => {
    onlyDailyDue()
    schedule = start()

    await schedule.runDue()
    expect(backupsWritten()).toBe(1)
    expect(dueSlots(tempDir)).toEqual([])

    // A successful run stamps the slot, so nothing is due. Make it due again --
    // this is the next day's check -- and the guard must not still be held.
    onlyDailyDue()
    await schedule.runDue()

    expect(backupsWritten()).toBe(2)
  })

  it('is released after a failed backup, and does not wedge the schedule', async () => {
    onlyDailyDue()
    schedule = start()

    // A failure with no exception: `backups/` replaced by a file, so the service
    // reports `unavailable` and returns rather than throwing.
    rmSync(join(tempDir, 'backups'), { recursive: true, force: true })
    writeFileSync(join(tempDir, 'backups'), 'not a directory')
    await schedule.runDue()
    expect(backupsWritten()).toBe(0)
    expect(lines.some((l) => l.event === 'backup_scheduled_failed')).toBe(true)

    // Put it back. The slot was never stamped, so it is still due, and the guard
    // must not be stuck.
    rmSync(join(tempDir, 'backups'), { force: true })
    mkdirSync(join(tempDir, 'backups'), { recursive: true })
    await schedule.runDue()

    expect(backupsWritten()).toBe(1)
  })

  it('survives a thrown exception without an unhandled rejection, and stays usable', async () => {
    onlyDailyDue()
    schedule = start()

    const unhandled: string[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason instanceof Error ? reason.message : String(reason))
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      // A real throw: `backups.json` as a directory. `readBackupSettings`
      // tolerates that, but `recordBackupRun`'s write-then-rename cannot replace
      // a directory, so the run body throws *after* the backup is written.
      rmSync(join(tempDir, 'backups.json'), { force: true })
      mkdirSync(join(tempDir, 'backups.json'), { recursive: true })

      await schedule.runDue()
      // Give any unhandled rejection a chance to surface before it is asserted.
      await Bun.sleep(50)

      // The point of the fix. Both timers call `void runDue()`, so a rejecting
      // run body is a discarded promise: one unhandled rejection per interval,
      // for as long as the fault lasts. Measured at 22 in 900 ms on a 40 ms
      // interval before the run body was made non-rejecting.
      expect(unhandled).toEqual([])
      expect(lines.some((l) => l.level === 'error' && l.event === 'backup_schedule_error')).toBe(
        true
      )
      // The backup itself still happened; only the bookkeeping failed.
      expect(backupsWritten()).toBe(1)

      // And the guard was released, so the next run works once the fault clears.
      rmSync(join(tempDir, 'backups.json'), { recursive: true, force: true })
      onlyDailyDue()
      await schedule.runDue()
      expect(backupsWritten()).toBe(2)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('cannot reach a permanently stuck state over repeated failing runs', async () => {
    onlyDailyDue()
    schedule = start()

    // Ten consecutive runs against a broken backups directory. If the guard were
    // not released on the failure path, the first would be the last.
    rmSync(join(tempDir, 'backups'), { recursive: true, force: true })
    writeFileSync(join(tempDir, 'backups'), 'not a directory')
    for (let i = 0; i < 10; i += 1) {
      await schedule.runDue()
    }
    expect(backupsWritten()).toBe(0)
    // Ten warnings: every run reached the service, so none was short-circuited.
    expect(lines.filter((l) => l.event === 'backup_scheduled_failed')).toHaveLength(10)

    rmSync(join(tempDir, 'backups'), { force: true })
    mkdirSync(join(tempDir, 'backups'), { recursive: true })
    await schedule.runDue()
    expect(backupsWritten()).toBe(1)
  })

  it('is not created at all without a data directory', () => {
    // The default test instance. Creating a schedule here would give it a
    // directory to write to that it must never write to.
    expect(
      startBackupSchedule({ dataDir: '', getDb: () => db, logger: recordingLogger() })
    ).toBeNull()
  })
})
