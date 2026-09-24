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
  CLOSE_BEHAVIORS,
  type CloseBehavior,
  DEFAULT_PORT,
  DESKTOP_SETTINGS_FILENAME,
  MAX_USER_PORT,
  MIN_USER_PORT,
  RESTART_REQUEST_FILENAME,
  SERVER_SETTINGS_FILENAME
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

function rmIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}
