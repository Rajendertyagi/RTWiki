/**
 * Backup scheduling (docs/BACKUP_PLAN.md §8).
 *
 * There was no scheduler in this codebase before this -- no `setInterval`
 * anywhere in `src/server/`, only a 2 s `AbortController` timeout in
 * `bootstrap()`. So the shape below is new infrastructure rather than a
 * convention being followed.
 *
 * It is the smallest shape that is honest about the fixed-slot model:
 *
 *  - A periodic check plus a kickoff shortly after startup. Because each slot is
 *    one file that overwrites itself, catching up overwrites rather than
 *    accumulates, so a long startup delay costs nothing and a short interval
 *    buys no accuracy.
 *  - A missed run is caught up exactly once. Three days closed produces one
 *    daily backup, not three: the other two would be byte-identical copies of
 *    the same database taken seconds apart, and there is nowhere to put them.
 *  - Each slot keeps its own last-run timestamp, so enabling the monthly does
 *    not disturb the daily.
 *  - An in-flight backup is never overlapped by the next check.
 */

import {
  BACKUP_CHECK_INTERVAL_MS,
  BACKUP_STARTUP_KICKOFF_MS,
  type BackupSlot
} from '@rtwiki/shared/constants'
import type { Database } from '../database/index.js'
import type { Logger } from '../logging/index.js'
import { readBackupSettings, recordBackupRun } from '../settings/index.js'
import { createBackup } from './backup-service.js'

export interface BackupScheduleOptions {
  dataDir: string
  getDb: () => Database
  logger: Logger
  /** Overridable so a test can drive the schedule without waiting hours. */
  checkIntervalMs?: number
  kickoffMs?: number
}

export interface BackupSchedule {
  /** Runs any due slots now. Never overlaps itself. */
  runDue: () => Promise<void>
  stop: () => void
}

/** Which slots are due at `now`, ignoring whether one is already running. */
export function dueSlots(dataDir: string, now: Date = new Date()): BackupSlot[] {
  const settings = readBackupSettings(dataDir)
  const due: BackupSlot[] = []
  for (const [slot, config] of Object.entries(settings.slots) as [
    BackupSlot,
    (typeof settings.slots)[BackupSlot]
  ][]) {
    if (!config.enabled) continue
    // Never taken: due immediately. On a fresh install this fires all three
    // slots once, which establishes them. That is the same behaviour as a
    // period whose stored date is older than its interval.
    if (config.lastRunAt === null) {
      due.push(slot)
      continue
    }
    const elapsedHours = (now.getTime() - Date.parse(config.lastRunAt)) / 3_600_000
    if (elapsedHours >= config.intervalHours) due.push(slot)
  }
  return due
}

/**
 * Starts the schedule.
 *
 * A no-op when there is no data directory -- the case in the default test
 * instance, which must never write to a real location. RTWiki itself is
 * desktop-only with a filesystem beside the executable, so it always schedules.
 */
export function startBackupSchedule(opts: BackupScheduleOptions): BackupSchedule | null {
  const { dataDir, getDb, logger } = opts
  if (!dataDir) return null

  const checkIntervalMs = opts.checkIntervalMs ?? BACKUP_CHECK_INTERVAL_MS
  const kickoffMs = opts.kickoffMs ?? BACKUP_STARTUP_KICKOFF_MS

  // The overlap guard. A backup of a large database runs for seconds, and a
  // check landing inside one would start a second write to the same slot. One
  // flag, checked and set synchronously, is enough: JavaScript cannot suspend
  // between the test and the assignment.
  let inFlight: Promise<void> | null = null

  const runDue = async (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const due = dueSlots(dataDir)
      if (due.length === 0) return
      for (const slot of due) {
        const result = await createBackup(dataDir, getDb(), slot)
        if (result.ok) {
          // Stamped only on success. A failed backup leaves the slot due, so it
          // is retried on the next check instead of being silently skipped for
          // a whole interval -- a schedule that quietly stops is the failure
          // this feature exists to prevent.
          recordBackupRun(dataDir, slot)
        } else {
          logger.warn('Scheduled backup did not complete', {
            event: 'backup_scheduled_failed',
            slot,
            reason: result.reason
          })
        }
      }
    })()
      .catch((error: unknown) => {
        // The run body must not reject. Both timers call `void runDue()`, and a
        // discarded rejected promise is an unhandled rejection -- one per
        // interval, forever, for as long as the fault lasts.
        //
        // Measured with the settings file made unwritable (a directory in its
        // place, so `recordBackupRun`'s write-then-rename fails): 22 unhandled
        // rejections in 900 ms on a 40 ms interval. Under a stricter rejection
        // policy that is a process that dies on a timer.
        //
        // Recorded rather than rethrown, and the remaining slots are still
        // skipped -- which is what a throw did before, so the control flow is
        // unchanged. Only the reporting is fixed.
        logger.error('Scheduled backup run failed', {
          event: 'backup_schedule_error',
          detail: error instanceof Error ? error.message : String(error)
        })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  const kickoff = setTimeout(() => {
    void runDue()
  }, kickoffMs)
  const interval = setInterval(() => {
    void runDue()
  }, checkIntervalMs)

  // A background schedule must never be the reason a process stays alive. Both
  // timers are unref'd so an RTWiki that is shutting down -- or a test process
  // that has finished -- exits on its own rather than waiting out a four-hour
  // interval. `stop()` is still the correct way to end a schedule deliberately;
  // this only removes the reason a forgotten one could wedge an exit.
  kickoff.unref?.()
  interval.unref?.()

  logger.info('Backup schedule started', {
    event: 'backup_schedule',
    checkIntervalMs,
    kickoffMs
  })

  return {
    runDue,
    stop: () => {
      clearTimeout(kickoff)
      clearInterval(interval)
    }
  }
}
