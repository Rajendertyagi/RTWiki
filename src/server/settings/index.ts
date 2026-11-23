/**
 * Persistent settings stored in the SQLite `settings` table (single source of
 * truth). The server owns the database; callers pass `getDb` explicitly rather
 * than reaching for a hidden global (DEVELOPMENT_STANDARDS.md §1.2, §14).
 *
 * Each key is validated independently on read: an invalid value resets only
 * that key to its default, leaving all others intact.
 */

import {
  BACKUP_DEFAULT_INTERVAL_HOURS,
  BACKUP_SLOTS,
  type BackupSlot,
  CLOSE_BEHAVIORS,
  type CloseBehavior,
  COLOR_SCHEMES,
  type ColorScheme,
  DEFAULT_PORT,
  MAX_BACKUP_INTERVAL_HOURS,
  MAX_USER_PORT,
  MIN_BACKUP_INTERVAL_HOURS,
  MIN_USER_PORT,
  SETTINGS_KEY_BACKUP_SLOTS,
  SETTINGS_KEY_CLOSE_BEHAVIOR,
  SETTINGS_KEY_COLOR_SCHEME,
  SETTINGS_KEY_REMEMBER_CLOSE_CHOICE,
  SETTINGS_KEY_SERVER_PORT,
  SETTINGS_KEY_THEME_ID
} from '@rtwiki/shared/constants'
import type { Database } from '../database/index.js'

type GetDb = () => Database

export interface ServerSettings {
  port: number
}

export interface DesktopSettings {
  closeBehavior: CloseBehavior
  /** Pre-check "Remember my choice" in the in-app close dialog. */
  rememberCloseChoice: boolean
}

/** Appearance preferences. Both values are persisted in the SQLite settings table. */
export interface AppearanceSettings {
  themeId: string
  colorScheme: ColorScheme
}

/** Theme ids are filenames, so restrict them to a safe, portable character set. */
export const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export function isValidThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_ID_PATTERN.test(value)
}

export function isValidColorScheme(value: unknown): value is ColorScheme {
  return typeof value === 'string' && (COLOR_SCHEMES as readonly string[]).includes(value)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Reads one raw value; returns null when the key is absent or unreadable. */
function readRaw(getDb: GetDb, key: string): string | null {
  try {
    const row = getDb().query('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

/** Writes one value (upsert). Parameterized; no user content in SQL text. */
function writeRaw(getDb: GetDb, key: string, value: string): void {
  getDb().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  )
}

/** Parses a JSON value, returning null on malformed input. */
function parseJson(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * Effective listening port: persisted value when valid, otherwise the compiled
 * default. A corrupt or missing row can never block startup.
 */
export function readServerPort(getDb: GetDb): number {
  const value = parseJson(readRaw(getDb, SETTINGS_KEY_SERVER_PORT))
  return isValidUserPort(value) ? value : DEFAULT_PORT
}

/** Persists the listening port. Throws on invalid values. */
export function writeServerPort(getDb: GetDb, port: number): ServerSettings {
  if (!isValidUserPort(port)) {
    throw new Error(`Port must be an integer between ${MIN_USER_PORT} and ${MAX_USER_PORT}`)
  }
  writeRaw(getDb, SETTINGS_KEY_SERVER_PORT, JSON.stringify(port))
  return { port }
}

/**
 * Result of the explicit settings read during bootstrap (startup sequence).
 * `resetKeys` names the keys whose stored value was invalid and was therefore
 * reset in memory only — the stored row is left untouched, and every other key
 * keeps its own value.
 */
export interface SettingsReadResult {
  port: number
  desktop: DesktopSettings
  appearance: AppearanceSettings
  backup: BackupSettings
  resetKeys: string[]
}

/**
 * Reads every setting in one explicit startup step. Each key is validated
 * independently by the existing readers; this function only reports which keys
 * fell back so bootstrap can log them. Invalid values are reset in memory, not
 * persisted back to the table.
 */
export function readAllSettings(getDb: GetDb): SettingsReadResult {
  const resetKeys: string[] = []
  const portRaw = parseJson(readRaw(getDb, SETTINGS_KEY_SERVER_PORT))
  if (!isValidUserPort(portRaw)) resetKeys.push(SETTINGS_KEY_SERVER_PORT)

  const behaviorRaw = parseJson(readRaw(getDb, SETTINGS_KEY_CLOSE_BEHAVIOR))
  if (!isCloseBehavior(behaviorRaw)) resetKeys.push(SETTINGS_KEY_CLOSE_BEHAVIOR)

  const rememberRaw = parseJson(readRaw(getDb, SETTINGS_KEY_REMEMBER_CLOSE_CHOICE))
  if (typeof rememberRaw !== 'boolean') resetKeys.push(SETTINGS_KEY_REMEMBER_CLOSE_CHOICE)

  const themeStored = readRaw(getDb, SETTINGS_KEY_THEME_ID)
  if (themeStored !== null && !isValidThemeId(parseJson(themeStored))) {
    resetKeys.push(SETTINGS_KEY_THEME_ID)
  }
  const schemeStored = readRaw(getDb, SETTINGS_KEY_COLOR_SCHEME)
  if (schemeStored !== null && !isValidColorScheme(parseJson(schemeStored))) {
    resetKeys.push(SETTINGS_KEY_COLOR_SCHEME)
  }

  const backupRaw = parseJson(readRaw(getDb, SETTINGS_KEY_BACKUP_SLOTS))
  if (!isRecord(backupRaw) || !isRecord(backupRaw.slots)) {
    resetKeys.push(SETTINGS_KEY_BACKUP_SLOTS)
  }

  return {
    port: readServerPort(getDb),
    desktop: readDesktopSettings(getDb),
    appearance: readAppearanceSettings(getDb),
    backup: readBackupSettings(getDb),
    resetKeys
  }
}

export function defaultDesktopSettings(): DesktopSettings {
  return { closeBehavior: 'ask', rememberCloseChoice: false }
}

/** Desktop shell preferences; each field falls back independently. */
export function readDesktopSettings(getDb: GetDb): DesktopSettings {
  const fallback = defaultDesktopSettings()
  const parsed = parseJson(readRaw(getDb, SETTINGS_KEY_CLOSE_BEHAVIOR))
  const closeBehavior = isCloseBehavior(parsed) ? parsed : fallback.closeBehavior
  const rememberRaw = parseJson(readRaw(getDb, SETTINGS_KEY_REMEMBER_CLOSE_CHOICE))
  const rememberCloseChoice =
    typeof rememberRaw === 'boolean' ? rememberRaw : fallback.rememberCloseChoice
  return { closeBehavior, rememberCloseChoice }
}

/** Persists the desktop shell preferences. Throws on invalid values. */
export function writeDesktopSettings(getDb: GetDb, settings: DesktopSettings): DesktopSettings {
  if (!isCloseBehavior(settings.closeBehavior)) {
    throw new Error(`closeBehavior must be one of: ${CLOSE_BEHAVIORS.join(', ')}`)
  }
  if (typeof settings.rememberCloseChoice !== 'boolean') {
    throw new Error('rememberCloseChoice must be a boolean')
  }
  writeRaw(getDb, SETTINGS_KEY_CLOSE_BEHAVIOR, JSON.stringify(settings.closeBehavior))
  writeRaw(getDb, SETTINGS_KEY_REMEMBER_CLOSE_CHOICE, JSON.stringify(settings.rememberCloseChoice))
  return { ...settings }
}

// ---------------------------------------------------------------------------
// Appearance (theme + color scheme)
// ---------------------------------------------------------------------------

export const DEFAULT_THEME_ID = 'default'
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'auto'

/** Appearance preferences; each field falls back independently. */
export function readAppearanceSettings(getDb: GetDb): AppearanceSettings {
  const themeRaw = parseJson(readRaw(getDb, SETTINGS_KEY_THEME_ID))
  const schemeRaw = parseJson(readRaw(getDb, SETTINGS_KEY_COLOR_SCHEME))
  return {
    themeId: isValidThemeId(themeRaw) ? themeRaw : DEFAULT_THEME_ID,
    colorScheme: isValidColorScheme(schemeRaw) ? schemeRaw : DEFAULT_COLOR_SCHEME
  }
}

/** Persists appearance preferences. Throws on invalid values. */
export function writeAppearanceSettings(
  getDb: GetDb,
  settings: AppearanceSettings
): AppearanceSettings {
  if (!isValidThemeId(settings.themeId)) {
    throw new Error(`themeId must match ${THEME_ID_PATTERN}`)
  }
  if (!isValidColorScheme(settings.colorScheme)) {
    throw new Error(`colorScheme must be one of: ${COLOR_SCHEMES.join(', ')}`)
  }
  writeRaw(getDb, SETTINGS_KEY_THEME_ID, JSON.stringify(settings.themeId))
  writeRaw(getDb, SETTINGS_KEY_COLOR_SCHEME, JSON.stringify(settings.colorScheme))
  return { ...settings }
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
 * The backup schedule. A missing or corrupt row yields defaults, so a bad
 * setting can never stop backups. A slot absent from the row falls back
 * individually, so adding a slot later needs no migration of stored settings.
 */
export function readBackupSettings(getDb: GetDb): BackupSettings {
  const defaults = defaultBackupSettings()
  const parsed = parseJson(readRaw(getDb, SETTINGS_KEY_BACKUP_SLOTS))
  if (!isRecord(parsed) || !isRecord(parsed.slots)) return defaults
  const slots = {} as Record<BackupSlot, BackupSlotSettings>
  for (const slot of BACKUP_SLOTS) {
    slots[slot] = readSlot(parsed.slots[slot], defaults.slots[slot])
  }
  return { slots }
}

export function writeBackupSettings(getDb: GetDb, settings: BackupSettings): BackupSettings {
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
  writeRaw(getDb, SETTINGS_KEY_BACKUP_SLOTS, JSON.stringify(next))
  return next
}

/**
 * Stamps a slot as taken. Called only after a backup has actually landed, so a
 * failed backup leaves the slot due and is retried on the next check rather
 * than being silently skipped for a whole interval.
 */
export function recordBackupRun(
  getDb: GetDb,
  slot: BackupSlot,
  at: Date = new Date()
): BackupSettings {
  const settings = readBackupSettings(getDb)
  settings.slots[slot].lastRunAt = at.toISOString()
  return writeBackupSettings(getDb, settings)
}
