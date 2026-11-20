/**
 * End-to-end settings flow: fresh start → change port → restart → new port used.
 *
 * This is the integrated flow the unit tests do not cover: a fresh data dir,
 * a real bootstrap, a port change through the settings API, then a simulated
 * restart that must pick up the new port from the settings table.
 *
 * The shell's actual read is Rust (`sidecar::configured_port`), covered by the
 * Rust tests in src-tauri/src/sidecar.rs. Here we mirror its read-only connection
 * semantics with a short-lived bun:sqlite read-only handle, so the E2E test
 * exercises the same "read the persisted value from disk" path without needing
 * a compiled shell binary. All files (DB + logs) live under a temp folder.
 */

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrap } from '../src/server/bootstrap.js'
import { closeDatabase } from '../src/server/database/index.js'
import {
  DATABASE_FILENAME,
  DEFAULT_PORT,
  SETTINGS_KEY_SERVER_PORT
} from '../src/shared/constants/index.js'

let tempDir: string
let logPath: string

/** Mirrors the shell's read-only settings read: a short-lived RO connection. */
function shellStylePortRead(): number {
  const db = new Database(join(tempDir, DATABASE_FILENAME), { readonly: true })
  try {
    const row = db
      .query('SELECT value FROM settings WHERE key = ?1')
      .get(SETTINGS_KEY_SERVER_PORT) as { value: string } | undefined
    if (row) {
      const parsed = JSON.parse(row.value) as unknown
      if (
        typeof parsed === 'number' &&
        Number.isInteger(parsed) &&
        parsed >= 1024 &&
        parsed <= 65535
      ) {
        return parsed
      }
    }
  } catch {
    // Missing table or corrupt value — same fallback as the shell.
  } finally {
    db.close()
  }
  return DEFAULT_PORT
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'rtwiki-settings-e2e-'))
  mkdirSync(join(tempDir, 'backups'), { recursive: true })
  logPath = join(tempDir, 'logs', 'rtwiki.log')
})

afterEach(async () => {
  await closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('settings end-to-end', () => {
  it('fresh start uses the default port, a changed port survives a restart', async () => {
    // 1. Fresh start: no DB → default port.
    const first = await bootstrap({
      dataDir: tempDir,
      port: 0, // ephemeral bind for the test; the persisted value is independent
      openBrowser: false,
      logPath
    })
    expect(first.server).not.toBeNull()
    expect(shellStylePortRead()).toBe(DEFAULT_PORT)
    await first.shutdown()

    // 2. Change the port through the settings API (same-origin PUT).
    const second = await bootstrap({
      dataDir: tempDir,
      port: 0,
      openBrowser: false,
      logPath
    })
    const res = await second.server!.fetch(
      new Request('http://127.0.0.1/api/settings/server', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
        body: JSON.stringify({ port: 8099 })
      })
    )
    expect(res.status).toBe(200)
    expect(shellStylePortRead()).toBe(8099)
    await second.shutdown()

    // 3. Simulate restart: close DB, re-bootstrap with no explicit port so the
    //    persisted value is read from the settings table, then confirm both the
    //    server bind and the shell-style read see the new port.
    await closeDatabase()
    const third = await bootstrap({ dataDir: tempDir, openBrowser: false, logPath })
    expect(third.server).not.toBeNull()
    expect(third.server!.port).toBe(8099)
    expect(shellStylePortRead()).toBe(8099)
    await third.shutdown()
  })
})
