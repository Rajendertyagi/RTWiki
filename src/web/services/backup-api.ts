import {
  BACKUP_SLOTS,
  type BackupSlot,
  type BackupValidationReason,
  SHUTDOWN_TOKEN_HEADER
} from '@rtwiki/shared/constants'

/** Why a backup could not be written. Mirrors `BackupFailure` on the server. */
export type BackupFailure =
  | 'unavailable'
  | 'mid-migration-attachments'
  | 'insufficient-disk-space'
  | 'write-failed'

export interface BackupSlotFile {
  slot: BackupSlot
  filename: string
  path: string
  byteSize: number | null
  modifiedAt: string | null
}

export interface BackupSlotSettings {
  enabled: boolean
  intervalHours: number
  lastRunAt: string | null
}

export interface BackupSettings {
  slots: Record<BackupSlot, BackupSlotSettings>
}

export interface BackupOverview {
  backups: BackupSlotFile[]
  settings: BackupSettings
  due: BackupSlot[]
  filenames: Record<BackupSlot, string>
}

/** The verdict for one candidate, or why it cannot be used. */
export type BackupInspection =
  | { ok: true; candidate: { path: string; byteSize: number; modifiedAt: string } }
  | { ok: false; reason: BackupValidationReason }
  | { kind: 'unavailable' }
  | { kind: 'path-outside-backups'; filename: string }

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T
  } catch {
    return null
  }
}

export async function fetchBackups(): Promise<BackupOverview | null> {
  try {
    const res = await fetch('/api/backup')
    if (!res.ok) return null
    return await readJson<BackupOverview>(res)
  } catch {
    return null
  }
}

export async function saveBackupSettings(
  slots: Record<BackupSlot, { enabled: boolean; intervalHours: number }>
): Promise<BackupSettings | null> {
  try {
    const res = await fetch('/api/backup/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // Only the fields the user can change; `lastRunAt` is the server's to own.
      body: JSON.stringify({
        slots: Object.fromEntries(
          BACKUP_SLOTS.map((slot) => [
            slot,
            { enabled: slots[slot].enabled, intervalHours: slots[slot].intervalHours }
          ])
        )
      })
    })
    if (!res.ok) return null
    return await readJson<BackupSettings>(res)
  } catch {
    return null
  }
}

export async function runBackup(slot: BackupSlot): Promise<BackupFailure | null> {
  try {
    const res = await fetch('/api/backup/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot })
    })
    if (res.ok) return null
    const body = await readJson<{ reason?: BackupFailure }>(res)
    return body?.reason ?? 'write-failed'
  } catch {
    return 'write-failed'
  }
}

export async function inspectBackup(filename: string): Promise<BackupInspection | null> {
  try {
    const res = await fetch(`/api/backup/inspect?file=${encodeURIComponent(filename)}`)
    if (!res.ok) return null
    return await readJson<BackupInspection>(res)
  } catch {
    return null
  }
}

/**
 * Replaces the database, then the server stops.
 *
 * Carries the same per-process token the shutdown endpoint uses: the server is
 * about to stop and the live wiki is about to be replaced, so this is the most
 * consequential request the app makes. RTWiki does not restart itself, so the
 * caller shows the "close and reopen" message rather than waiting for a server
 * that is never coming back on its own.
 */
export async function restoreBackup(
  filename: string,
  token: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SHUTDOWN_TOKEN_HEADER]: token },
      body: JSON.stringify({ file: filename })
    })
    if (res.ok) return { ok: true }
    return { ok: false, message: `restore-failed-${res.status}` }
  } catch {
    return { ok: false, message: 'restore-failed-network' }
  }
}
