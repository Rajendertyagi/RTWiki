/**
 * Backup creation (docs/BACKUP_PLAN.md §5, §6).
 *
 * One SQL statement -- `VACUUM INTO` -- against the live database. Chosen over
 * a file copy because a copy of a WAL database passes `integrity_check` while
 * having lost committed data still living in the `-wal` sidecar; over
 * `node:sqlite`'s `backup()` because `bun:sqlite` has no `backup()`; and over a
 * hand-rolled chunked copy because disabling `wal_autocheckpoint` around a copy
 * risks leaving it disabled if the process is killed, after which the WAL grows
 * without bound.
 *
 * Three fixed slots, each owning one file and overwriting only itself. There is
 * deliberately no retention code: storage is bounded at three files with
 * nothing to configure, and each period can never overwrite another. The cost
 * -- a mistake persisting past a backup window overwrites that period's last
 * good copy -- is recorded in the plan rather than argued about here.
 */

import * as nodeFs from 'node:fs'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { promisify } from 'node:util'
import {
  BACKUP_FILENAME_PREFIX,
  BACKUP_PARTIAL_SUFFIX,
  BACKUP_SLOTS,
  BACKUPS_DIR,
  type BackupSlot,
  type BackupValidationReason
} from '@rtwiki/shared/constants'
import { joinPaths } from '../config/index.js'
import type { Database } from '../database/index.js'
import { getDatabaseLogger } from '../database/index.js'
import { countAttachmentsAwaitingBytes } from './validation.js'

/** `fs.statfs` has no synchronous form in this runtime, so it is promisified. */
const statfs = promisify(nodeFs.statfs)

/**
 * How far before a backup starts, the free space is checked.
 *
 * The compacted output is what has to fit -- not twice the database. SQLite
 * documents "as much as twice the size of the original database file" for
 * `VACUUM`, which copies to a temporary file and then over the original;
 * `VACUUM INTO` "omits the step of copying the vacuumed database back over top
 * of the original", so that figure does not apply. A 2x threshold would refuse
 * backups that would in fact fit, which is the failure mode worth avoiding
 * here: a user who is told their disk is full when it is not stops backing up.
 */
const FREE_SPACE_SLACK_BYTES = 16 * 1024 * 1024

export type BackupFailure =
  | 'unavailable'
  | 'mid-migration-attachments'
  | 'insufficient-disk-space'
  | 'write-failed'

export type BackupOutcome =
  | { ok: true; slot: BackupSlot; path: string; byteSize: number }
  | { ok: false; reason: BackupFailure; detail?: string }

export interface BackupSlotFile {
  slot: BackupSlot
  filename: string
  path: string
  byteSize: number | null
  modifiedAt: string | null
}

export function backupsDirFor(dataDir: string): string {
  return joinPaths(dataDir, BACKUPS_DIR)
}

export function slotFilename(slot: BackupSlot): string {
  return `${BACKUP_FILENAME_PREFIX}${slot}`
}

export function slotPath(dataDir: string, slot: BackupSlot): string {
  return joinPaths(backupsDirFor(dataDir), slotFilename(slot))
}

/** The in-progress name. `VACUUM INTO` refuses a target that exists, so the
 *  backup is always written here first and moved onto the slot on success. */
export function partialPathFor(dataDir: string, slot: BackupSlot): string {
  return `${slotPath(dataDir, slot)}${BACKUP_PARTIAL_SUFFIX}`
}

function ensureBackupsDir(dataDir: string): void {
  mkdirSync(backupsDirFor(dataDir), { recursive: true })
}

/**
 * Bytes the compacted output is expected to need, as a necessary condition.
 *
 * `page_count - freelist_count` is the live content in pages, and the compacted
 * output cannot exceed it -- deleted pages are exactly what a vacuum discards.
 * Using the file size instead would be looser (it includes the freelist) and
 * would refuse backups that fit.
 */
function expectedOutputBytes(db: Database): number {
  const read = (pragma: string): number => {
    try {
      const row = db.query(`PRAGMA ${pragma}`).get() as Record<string, unknown> | null
      const value = row ? Object.values(row)[0] : 0
      return typeof value === 'number' ? value : 0
    } catch {
      return 0
    }
  }
  const pageSize = read('page_size') || 4096
  const live = Math.max(0, read('page_count') - read('freelist_count'))
  return live * pageSize + FREE_SPACE_SLACK_BYTES
}

async function hasRoomFor(bytes: number, dir: string): Promise<boolean> {
  try {
    const stats = await statfs(dir)
    return stats.bsize * stats.bavail >= bytes
  } catch {
    // Cannot tell. Not a reason to refuse: the write is attempted anyway and a
    // genuine ENOSPC is reported with its own reason below. Refusing on an
    // unreadable stat would make backups stop for a reason the user cannot act
    // on, which is the opposite of what a safety feature is for.
    return true
  }
}

/**
 * Moves a completed `.partial` onto its slot.
 *
 * Measured on this machine, Windows: `rename` over an existing *file* succeeds
 * (it replaces the target), so no delete-then-rename fallback is needed and
 * none is written. Renaming onto a *directory* fails `EPERM`, which is not a
 * case this can reach -- the slot name is derived from the fixed slot list, so
 * nothing user-supplied becomes a directory there.
 *
 * If the move ever did fail, the failure is the safe one by construction: the
 * slot was never touched, so the previous good backup survives, and the orphaned
 * `.partial` is swept at the next startup.
 */
function moveOntoSlot(partial: string, slotFile: string): void {
  renameSync(partial, slotFile)
}

/**
 * Deletes every leftover `.partial` in the backups directory.
 *
 * "Delete on failure" does not cover a hard kill, and SQLite states that an
 * interrupted `VACUUM INTO` "might be incomplete and corrupt" -- so an orphaned
 * `.partial` is a corrupt file sitting where a backup belongs. Run at startup,
 * where a leftover from a previous crash is the expected case.
 */
export function sweepPartialBackups(dataDir: string): number {
  const dir = backupsDirFor(dataDir)
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(BACKUP_PARTIAL_SUFFIX)) continue
    try {
      rmSync(joinPaths(dir, entry), { force: true })
      removed += 1
    } catch {
      // A `.partial` that cannot be removed is harmless: nothing reads it, and
      // the sweep runs again next startup.
    }
  }
  if (removed > 0) {
    getDatabaseLogger().info('Removed incomplete backups from a previous run', {
      event: 'backup_sweep',
      removed
    })
  }
  return removed
}

/** Every slot, present or not, so the UI can show an empty state per period. */
export function listBackups(dataDir: string): BackupSlotFile[] {
  return BACKUP_SLOTS.map((slot) => {
    const path = slotPath(dataDir, slot)
    const filename = slotFilename(slot)
    try {
      const stat = statSync(path)
      return {
        slot,
        filename,
        path,
        byteSize: stat.size,
        modifiedAt: new Date(stat.mtimeMs).toISOString()
      }
    } catch {
      return { slot, filename, path, byteSize: null, modifiedAt: null }
    }
  })
}

/**
 * Takes one slot's backup.
 *
 * Order matters and is the reason the slot is never written in place: a backup
 * that fails partway through while overwriting `backup-daily` destroys the
 * previous good copy -- the one needed precisely when backups are failing. So
 * the write goes to a `.partial`, and only a complete file is moved onto the
 * slot.
 *
 * Must never be called from inside a write transaction. Every transaction in
 * this codebase is a synchronous `BEGIN IMMEDIATE` .. `COMMIT` with no `await`
 * between, so a timer callback cannot interleave into one; but SQLite documents
 * that a `VACUUM` fails with an open transaction on the same connection, and
 * unfinalized statements can hold a read transaction open. Callers are on the
 * request path, not inside a repository.
 */
export async function createBackup(
  dataDir: string,
  db: Database,
  slot: BackupSlot
): Promise<BackupOutcome> {
  if (!dataDir) return { ok: false, reason: 'unavailable' }

  // A one-file backup cannot include bytes that still live in
  // `data/attachments/`. Refuse rather than produce a backup that looks
  // complete and is not; the migration resolves on the next boot.
  if (countAttachmentsAwaitingBytes(db) > 0) {
    getDatabaseLogger().warn('Backup refused: attachment migration incomplete', {
      event: 'backup_refused',
      slot,
      reason: 'mid-migration-attachments'
    })
    return { ok: false, reason: 'mid-migration-attachments' }
  }

  try {
    ensureBackupsDir(dataDir)
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      detail: error instanceof Error ? error.message : String(error)
    }
  }

  const dir = backupsDirFor(dataDir)
  if (!(await hasRoomFor(expectedOutputBytes(db), dir))) {
    getDatabaseLogger().error('Backup refused: not enough free space', {
      event: 'backup_refused',
      slot,
      reason: 'insufficient-disk-space'
    })
    return { ok: false, reason: 'insufficient-disk-space' }
  }

  const partial = partialPathFor(dataDir, slot)
  const target = slotPath(dataDir, slot)

  // A stale `.partial` for this slot would make `VACUUM INTO` refuse the
  // target, so it is removed first. The startup sweep is the backstop for the
  // crash case; this covers a retry inside one session.
  rmSync(partial, { force: true })

  // `VACUUM INTO` is not a write on the source, so it takes no write lock and
  // leaves concurrent readers and WAL writers alone. It is immune to
  // `incremental_vacuum`, which truncates the main file in this database's
  // `auto_vacuum = INCREMENTAL` mode -- the pragma appears only in a comment at
  // `database/index.ts` and is never called. Do not add a call here: a
  // file-copy backup would be reading a shrinking file, and this one would not.
  try {
    db.run('VACUUM INTO ?', [partial])
  } catch (error) {
    rmSync(partial, { force: true })
    const code = (error as NodeJS.ErrnoException).code
    const detail = error instanceof Error ? error.message : String(error)
    getDatabaseLogger().error('Backup failed', {
      event: 'backup_failed',
      slot,
      // A SQLite message, never a path: the backups directory carries the
      // user's name (SECURITY.md 10).
      detail,
      ...(code ? { code } : {})
    })
    return {
      ok: false,
      reason: code === 'ENOSPC' ? 'insufficient-disk-space' : 'write-failed',
      detail
    }
  }

  try {
    moveOntoSlot(partial, target)
  } catch (error) {
    rmSync(partial, { force: true })
    return {
      ok: false,
      reason: 'write-failed',
      detail: error instanceof Error ? error.message : String(error)
    }
  }

  let byteSize = 0
  try {
    byteSize = statSync(target).size
  } catch {
    // The move reported success; a stat that now fails is not worth failing a
    // completed backup over, and the list view reports null for it.
  }

  getDatabaseLogger().info('Backup written', { event: 'backup_written', slot, byteSize })
  return { ok: true, slot, path: target, byteSize }
}

/** Re-exported so route and UI layers can name a failure without a deep import. */
export type { BackupValidationReason }
