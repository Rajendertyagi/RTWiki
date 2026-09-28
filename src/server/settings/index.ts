/**
 * Portable server-managed settings (data/server.json, data/desktop.json).
 *
 * These files live beside the database so the workspace stays portable
 * (ADR-005). The server owns all reads and writes; the desktop shell reads
 * them at boot (listening port, window close behavior) and the Settings UI
 * edits them through the /api/settings routes. Nothing here is ever logged.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  BACKUP_DEFAULT_INTERVAL_HOURS,
  BACKUP_SETTINGS_FILENAME,
  BACKUP_SLOTS,
  type BackupSlot,
  CLOSE_BEHAVIORS,
  type CloseBehavior,
  DEFAULT_PORT,
  DESKTOP_SETTINGS_FILENAME,
  MAX_BACKUP_INTERVAL_HOURS,
  MAX_USER_PORT,
  MIN_BACKUP_INTERVAL_HOURS,
  MIN_USER_PORT,
  RESTART_REQUEST_FILENAME,
  SERVER_SETTINGS_FILENAME,
  SHUTDOWN_REQUEST_FILENAME
} from '@rtwiki/shared/constants'
import { dirname, joinPaths } from '../config/index.js'

export interface ServerSettings {
  port: number
}

export interface DesktopSettings {
  closeBehavior: CloseBehavior
}

/** True for an integer in the unprivileged TCP range. */
export function isValidUserPort(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_USER_PORT &&
    value <= MAX_USER_PORT
  )
}

export function isCloseBehavior(value: unknown): value is CloseBehavior {
  return typeof value === 'string' && (CLOSE_BEHAVIORS as readonly string[]).includes(value)
}

function settingsPath(dataDir: string, filename: string): string {
  if (!dataDir) throw new Error('Server settings unavailable: data directory is not configured')
  return joinPaths(dataDir, filename)
}

function readJsonFile(path: string): unknown {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Atomic write (tmp + rename) so a crash mid-write never corrupts settings. */
function writeJsonFile(path: string, value: unknown): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * Effective listening port: persisted file value when valid, otherwise the
 * compiled default. A corrupt or missing file can never block startup.
 */
export function readServerPort(dataDir: string): number {
  if (!dataDir) return DEFAULT_PORT
  const parsed = readJsonFile(joinPaths(dataDir, SERVER_SETTINGS_FILENAME))
  if (isRecord(parsed) && isValidUserPort(parsed.port)) return parsed.port
  return DEFAULT_PORT
}

/** Persists the listening port. Throws on invalid values. */
export function writeServerPort(dataDir: string, port: number): ServerSettings {
  if (!isValidUserPort(port)) {
    throw new Error(`Port must be an integer between ${MIN_USER_PORT} and ${MAX_USER_PORT}`)
  }
  const settings: ServerSettings = { port }
  writeJsonFile(settingsPath(dataDir, SERVER_SETTINGS_FILENAME), settings)
  return settings
}

export function defaultDesktopSettings(): DesktopSettings {
  return { closeBehavior: 'ask' }
}

/** Desktop shell preferences; unknown values fall back to defaults. */
export function readDesktopSettings(dataDir: string): DesktopSettings {
  const fallback = defaultDesktopSettings()
  if (!dataDir) return fallback
  const parsed = readJsonFile(joinPaths(dataDir, DESKTOP_SETTINGS_FILENAME))
  if (!isRecord(parsed)) return fallback
  return {
    closeBehavior: isCloseBehavior(parsed.closeBehavior)
      ? parsed.closeBehavior
      : fallback.closeBehavior
  }
}

/** Persists the desktop shell preferences. Throws on invalid values. */
export function writeDesktopSettings(dataDir: string, settings: DesktopSettings): DesktopSettings {
  if (!isCloseBehavior(settings.closeBehavior)) {
    throw new Error(`closeBehavior must be one of: ${CLOSE_BEHAVIORS.join(', ')}`)
  }
  const next: DesktopSettings = { closeBehavior: settings.closeBehavior }
  writeJsonFile(settingsPath(dataDir, DESKTOP_SETTINGS_FILENAME), next)
  return next
}

// ---------------------------------------------------------------------------
// Backup schedule (docs/BACKUP_PLAN.md §6.2)
// ---------------------------------------------------------------------------

/** One slot's schedule state. `lastRunAt` is an ISO timestamp, or null if never. */
export interface BackupSlotSettings {
  enabled: boolean
  intervalHours: number
  lastRunAt: string | null
}

export interface BackupSettings {
  slots: Record<BackupSlot, BackupSlotSettings>
}

export function isValidBackupInterval(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_BACKUP_INTERVAL_HOURS &&
    value <= MAX_BACKUP_INTERVAL_HOURS
  )
}

export function defaultBackupSettings(): BackupSettings {
  const slots = {} as Record<BackupSlot, BackupSlotSettings>
  for (const slot of BACKUP_SLOTS) {
    slots[slot] = {
      enabled: true,
      intervalHours: BACKUP_DEFAULT_INTERVAL_HOURS[slot],
      lastRunAt: null
    }
  }
  return { slots }
}

function readSlot(raw: unknown, fallback: BackupSlotSettings): BackupSlotSettings {
  if (!isRecord(raw)) return fallback
  const lastRunAt = raw.lastRunAt
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    intervalHours: isValidBackupInterval(raw.intervalHours)
      ? raw.intervalHours
      : fallback.intervalHours,
    lastRunAt:
      typeof lastRunAt === 'string' && !Number.isNaN(Date.parse(lastRunAt)) ? lastRunAt : null
  }
}

/**
 * The backup schedule. A missing or corrupt file yields defaults, so a bad
 * settings file can never stop backups — the same rule the port reader follows.
 * A slot absent from the file falls back individually, so adding a slot later
 * does not require a migration of everyone's settings.
 */
export function readBackupSettings(dataDir: string): BackupSettings {
  const defaults = defaultBackupSettings()
  if (!dataDir) return defaults
  const parsed = readJsonFile(joinPaths(dataDir, BACKUP_SETTINGS_FILENAME))
  if (!isRecord(parsed) || !isRecord(parsed.slots)) return defaults
  const slots = {} as Record<BackupSlot, BackupSlotSettings>
  for (const slot of BACKUP_SLOTS) {
    slots[slot] = readSlot(parsed.slots[slot], defaults.slots[slot])
  }
  return { slots }
}

export function writeBackupSettings(dataDir: string, settings: BackupSettings): BackupSettings {
  const slots = {} as Record<BackupSlot, BackupSlotSettings>
  for (const slot of BACKUP_SLOTS) {
    const next = settings.slots[slot]
    if (!isValidBackupInterval(next.intervalHours)) {
      throw new Error(
        `Backup interval must be a whole number of hours between ${MIN_BACKUP_INTERVAL_HOURS} and ${MAX_BACKUP_INTERVAL_HOURS}`
      )
    }
    slots[slot] = {
      enabled: next.enabled,
      intervalHours: next.intervalHours,
      lastRunAt: next.lastRunAt
    }
  }
  const next: BackupSettings = { slots }
  writeJsonFile(settingsPath(dataDir, BACKUP_SETTINGS_FILENAME), next)
  return next
}

/**
 * Stamps a slot as taken. Called only after a backup has actually landed, so a
 * failed backup leaves the slot due and is retried on the next check rather
 * than being silently skipped for a whole interval.
 */
export function recordBackupRun(
  dataDir: string,
  slot: BackupSlot,
  at: Date = new Date()
): BackupSettings {
  const settings = readBackupSettings(dataDir)
  settings.slots[slot].lastRunAt = at.toISOString()
  return writeBackupSettings(dataDir, settings)
}

/**
 * Restart handshake with the desktop shell (ADR-011): the frontend records
 * the request before shutting the server down; the shell's watch thread
 * consumes the flag and respawns the sidecar with the freshly saved port.
 */
export function requestRestart(dataDir: string): void {
  const path = settingsPath(dataDir, RESTART_REQUEST_FILENAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, String(Date.now()), 'utf8')
}

/** Returns true once per recorded request; deletes the flag. */
export function consumeRestartRequest(dataDir: string): boolean {
  if (!dataDir) return false
  const path = joinPaths(dataDir, RESTART_REQUEST_FILENAME)
  try {
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/** Drops a stale flag (e.g. left by a crash mid-restart) at boot. */
export function clearRestartRequest(dataDir: string): void {
  if (!dataDir) return
  try {
    rmIfExists(joinPaths(dataDir, RESTART_REQUEST_FILENAME))
  } catch {
    // A stale flag is harmless; the shell only acts on fresh requests.
  }
}

/**
 * Shutdown handshake with the desktop shell (ADR-011): the server records an
 * authorized shutdown so the shell's watch thread can tell an intentional exit
 * from a crash. Without this the shell respawns the sidecar, undoing the
 * shutdown, and the sidecar never appears to stop.
 *
 * Written only after the shutdown token check passes, so an unauthorized
 * request can never suppress crash recovery.
 */
export function requestShutdown(dataDir: string): void {
  if (!dataDir) return
  const path = settingsPath(dataDir, SHUTDOWN_REQUEST_FILENAME)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, String(Date.now()), 'utf8')
}

/** Returns true once per recorded shutdown; deletes the flag. */
export function consumeShutdownRequest(dataDir: string): boolean {
  if (!dataDir) return false
  const path = joinPaths(dataDir, SHUTDOWN_REQUEST_FILENAME)
  try {
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/** Drops a stale flag (e.g. left by a crash mid-shutdown) at boot. */
export function clearShutdownRequest(dataDir: string): void {
  if (!dataDir) return
  try {
    rmIfExists(joinPaths(dataDir, SHUTDOWN_REQUEST_FILENAME))
  } catch {
    // A stale flag is harmless; the shell only acts on fresh requests.
  }
}

function rmIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
