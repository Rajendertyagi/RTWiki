/**
 * Server half of the SQLite interop test. Creates the DB with the server's
 * initDatabase + runMigrations, writes settings from the server, and verifies
 * the settings table is readable/writable by a second connection (the shell's
 * read-only path is covered by the Rust test in src-tauri/src/sidecar.rs).
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../src/server/database/index.js'
import { runMigrations } from '../src/server/database/migrations.js'
import {
  readServerPort,
  writeDesktopSettings,
  writeServerPort
} from '../src/server/settings/index.js'
import { DATABASE_FILENAME } from '../src/shared/constants/index.js'

let tempDir: string
let db: ReturnType<typeof initDatabase>

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-sqlite-interop-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  db = initDatabase(tempDir)
  await runMigrations(db, join(tempDir, 'attachments'))
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('SQLite settings interop (server half)', () => {
  it('migration 012 seeds the settings table with defaults', () => {
    const row = db.query("SELECT value FROM settings WHERE key = 'server.port'").get() as {
      value: string
    }
    expect(JSON.parse(row.value)).toBe(8080)
    expect(readServerPort(() => db)).toBe(8080)
  })

  it('a second read-only connection sees committed settings', () => {
    writeServerPort(() => db, 8090)
    writeDesktopSettings(() => db, { closeBehavior: 'quit', rememberCloseChoice: true })

    // Open a separate read-only connection, as the shell does.
    const shell = new Database(join(tempDir, DATABASE_FILENAME), { readonly: true })
    try {
      const port = shell.query("SELECT value FROM settings WHERE key = 'server.port'").get() as {
        value: string
      }
      const behavior = shell
        .query("SELECT value FROM settings WHERE key = 'desktop.closeBehavior'")
        .get() as { value: string }
      expect(JSON.parse(port.value)).toBe(8090)
      expect(JSON.parse(behavior.value)).toBe('quit')
    } finally {
      shell.close()
    }
  })

  it('concurrent writes from the server and reads from a second connection stay consistent', () => {
    // Server writes in a loop while a second connection reads; no torn values.
    const shell = new Database(join(tempDir, DATABASE_FILENAME), { readonly: true })
    try {
      for (let i = 0; i < 20; i += 1) {
        writeServerPort(() => db, 8100 + i)
        const row = shell.query("SELECT value FROM settings WHERE key = 'server.port'").get() as {
          value: string
        }
        const value = JSON.parse(row.value) as number
        expect(value).toBeGreaterThanOrEqual(8100)
        expect(value).toBeLessThanOrEqual(8119)
      }
      expect(readServerPort(() => db)).toBe(8119)
    } finally {
      shell.close()
    }
  })
})
