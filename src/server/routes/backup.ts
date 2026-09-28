/**
 * Backup and restore API.
 *
 * Sits behind the app-wide cross-origin guard in `app.ts`, so the Host
 * allowlist and the state-changing-method origin check both already apply.
 * `POST /restore` additionally requires the per-process shutdown token, because
 * it replaces the database and stops the process -- the same token and the same
 * constant-time comparison `routes/shutdown.ts` uses, so a cross-origin page
 * cannot reach it even if the origin check is ever relaxed.
 */

import { BACKUP_SLOTS, type BackupSlot, SHUTDOWN_TOKEN_HEADER } from '@rtwiki/shared/constants'
import { type Context, Hono } from 'hono'
import { createBackup, listBackups, slotFilename } from '../backup/backup-service.js'
import { inspectBackup, performRestore } from '../backup/restore-service.js'
import { dueSlots } from '../backup/schedule.js'
import type { Database } from '../database/index.js'
import type { Logger } from '../logging/index.js'
import {
  type BackupSettings,
  isValidBackupInterval,
  readBackupSettings,
  writeBackupSettings
} from '../settings/index.js'
import type { ShutdownCoordinator } from '../shutdown-coordinator.js'
import { readJson } from '../utils/read-json.js'
import { timingSafeEqualStrings } from './shutdown.js'

export interface BackupRouteOptions {
  getDb: () => Database
  dataDir: string
  token: string
  logger: Logger
  coordinator: ShutdownCoordinator
}

function isBackupSlot(value: unknown): value is BackupSlot {
  return typeof value === 'string' && (BACKUP_SLOTS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createBackupRoutes(opts: BackupRouteOptions): Hono {
  const { getDb, dataDir, token, logger, coordinator } = opts
  const routes = new Hono()

  // Every handler guards on `dataDir` itself rather than a blanket middleware,
  // matching `attachments/attachment-routes.ts`: an empty data directory is the
  // default test instance, which must report unavailability rather than write
  // anywhere.
  const unavailable = (c: Context) => c.json({ error: 'Backup is unavailable' }, 503)

  /** Current slot files plus the schedule, for the settings panel. */
  routes.get('/', (c) => {
    if (!dataDir) return unavailable(c)
    return c.json({
      backups: listBackups(dataDir),
      settings: readBackupSettings(dataDir),
      due: dueSlots(dataDir),
      filenames: Object.fromEntries(BACKUP_SLOTS.map((s) => [s, slotFilename(s)]))
    })
  })

  /** The user's confirmation dialog needs the verdict, date and size up front. */
  routes.get('/inspect', (c) => {
    if (!dataDir) return unavailable(c)
    const filename = c.req.query('file') ?? ''
    if (filename === '') return c.json({ error: 'A backup file is required' }, 400)
    return c.json(inspectBackup(dataDir, filename))
  })

  /** Update which periods run and how often. Intervals are validated here. */
  routes.put('/settings', async (c) => {
    if (!dataDir) return unavailable(c)
    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    if (!isRecord(parsed.body) || !isRecord(parsed.body.slots)) {
      return c.json({ error: 'Invalid settings' }, 400)
    }

    const current = readBackupSettings(dataDir)
    for (const [slot, raw] of Object.entries(parsed.body.slots)) {
      if (!isBackupSlot(slot) || !isRecord(raw)) continue
      const target = current.slots[slot]
      if (typeof raw.enabled === 'boolean') target.enabled = raw.enabled
      if (raw.intervalHours !== undefined) {
        if (!isValidBackupInterval(raw.intervalHours)) {
          return c.json({ error: `Invalid interval for ${slot}` }, 400)
        }
        target.intervalHours = raw.intervalHours
      }
    }

    try {
      return c.json(writeBackupSettings(dataDir, current))
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not save settings' },
        400
      )
    }
  })

  /** "Back up now" for one period. */
  routes.post('/run', async (c) => {
    if (!dataDir) return unavailable(c)
    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    const slot = isRecord(parsed.body) ? parsed.body.slot : undefined
    if (!isBackupSlot(slot)) return c.json({ error: 'Unknown backup period' }, 400)

    const result = await createBackup(dataDir, getDb(), slot)
    if (!result.ok) {
      logger.warn('Manual backup failed', {
        event: 'backup_manual_failed',
        slot,
        reason: result.reason
      })
      return c.json({ ok: false, reason: result.reason }, 409)
    }
    return c.json({ ok: true, slot, byteSize: result.byteSize })
  })

  /**
   * Replace the database from a backup, then stop.
   *
   * Token-gated for the same reason the shutdown route is: after this returns,
   * the wiki the user is looking at is gone. The token is fetched by the client
   * from `/api/shutdown/token`, which the origin check already protects.
   */
  routes.post('/restore', async (c) => {
    if (!dataDir) return unavailable(c)
    const provided = c.req.header(SHUTDOWN_TOKEN_HEADER)
    if (!timingSafeEqualStrings(provided ?? '', token)) {
      return c.json({ error: 'Invalid shutdown token' }, 403)
    }

    const parsed = await readJson(c)
    if (!parsed.ok) return parsed.response
    const filename = isRecord(parsed.body) ? parsed.body.file : undefined
    if (typeof filename !== 'string' || filename === '') {
      return c.json({ error: 'A backup file is required' }, 400)
    }

    const outcome = await performRestore(dataDir, filename)
    if (!outcome.ok) {
      logger.warn('Restore refused', {
        event: 'restore_refused',
        kind: outcome.reason.kind
      })
      return c.json({ ok: false, reason: outcome.reason }, 409)
    }

    logger.info('Restore accepted; shutting down so the user reopens RTWiki', {
      event: 'restore_accepted'
    })
    // The client is told to close and reopen before the process goes away,
    // because nothing in this codebase respawns it. Responded first so the
    // message is not lost to the shutdown that follows.
    void coordinator.requestShutdown()
    return c.json({ ok: true, preRestore: outcome.preRestorePath }, 202)
  })

  return routes
}

/** Exported for the app's dependency bag typing. */
export type { BackupSettings }
