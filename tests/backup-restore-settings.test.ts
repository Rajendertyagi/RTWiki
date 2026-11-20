/**
 * Backup restore brings back settings (deliberate choice, plan §3.9).
 * A backup is a full workspace snapshot (VACUUM INTO of the whole DB), so the
 * settings table — including port and window geometry — is restored with it.
 * This test documents and asserts that behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, slotFilename } from '../src/server/backup/backup-service.js'
import { performRestore } from '../src/server/backup/restore-service.js'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import {
  readDesktopSettings,
  readServerPort,
  writeDesktopSettings,
  writeServerPort
} from '../src/server/settings/index.js'
import { SETTINGS_KEY_WINDOW_GEOMETRY } from '../src/shared/constants/index.js'

let tempDir: string
let db: ReturnType<typeof initDatabase>

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-restore-settings-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('backup restore brings back settings', () => {
  it('restores port, close behavior and window geometry from the backup', async () => {
    // Set distinctive values, then back up.
    writeServerPort(() => db, 8123)
    writeDesktopSettings(() => db, { closeBehavior: 'quit', rememberCloseChoice: true })
    db.run(
      'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [
        SETTINGS_KEY_WINDOW_GEOMETRY,
        JSON.stringify({ x: 111, y: 222, width: 800, height: 600, maximized: false })
      ]
    )
    const backup = await createBackup(tempDir, db, 'daily')
    expect(backup.ok).toBe(true)

    // Change the live settings to something else.
    writeServerPort(() => db, 9000)
    writeDesktopSettings(() => db, { closeBehavior: 'ask', rememberCloseChoice: false })

    // Restore the backup.
    const result = await performRestore(tempDir, slotFilename('daily'))
    expect(result.ok).toBe(true)

    // Reopen the restored DB and confirm the backed-up settings are back.
    await closeDatabase()
    db = initDatabase(tempDir)
    await runMigrations(db, join(tempDir, 'attachments'))
    expect(readServerPort(() => db)).toBe(8123)
    expect(readDesktopSettings(() => db)).toEqual({
      closeBehavior: 'quit',
      rememberCloseChoice: true
    })
    const geometry = db
      .query('SELECT value FROM settings WHERE key = ?1')
      .get(SETTINGS_KEY_WINDOW_GEOMETRY) as { value: string }
    expect(JSON.parse(geometry.value)).toEqual({
      x: 111,
      y: 222,
      width: 800,
      height: 600,
      maximized: false
    })
  })
})
