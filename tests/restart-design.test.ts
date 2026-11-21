import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { UI_TEXT } from '../src/web/config/index.js'

/**
 * Stage 1 restart design: the shell owns the server through a Job Object and
 * restarts it directly. These tests lock in the user-facing rules that cannot
 * be proven by the Rust unit tests alone:
 *  - browser mode tells the user to close and reopen (no shell to restart)
 *  - a borrowed server is never restarted
 *  - the restart command validates the port
 */

describe('browser-mode restart message', () => {
  it('tells the user to close and reopen RTWiki for the new port', () => {
    expect(UI_TEXT.desktopRestartBrowserHint).toContain('Close and reopen RTWiki')
    expect(UI_TEXT.desktopRestartBrowserHint).toContain('new port')
  })

  it('the settings UI shows the relaunch message when not native', () => {
    const code = readFileSync('src/web/features/settings/settings-workspace.tsx', 'utf8')
    expect(code).toContain('nativeMode ?')
    expect(code).toContain('UI_TEXT.desktopRestartBrowserHint')
  })
})

describe('restart command guards', () => {
  const main = readFileSync('src-tauri/src/main.rs', 'utf8')

  it('validates the port is a user port', () => {
    expect(main).toContain('(1024..=65535).contains(&port)')
  })

  it('refuses to restart a borrowed server', () => {
    expect(main).toContain('This server was started elsewhere and cannot be restarted here')
    expect(main).toContain('if !owns')
  })

  it('is granted only to the app window origin', () => {
    const perms = readFileSync('src-tauri/permissions/close-dialog.toml', 'utf8')
    expect(perms).toContain('restart_server')
  })
})

describe('ownership is a process relationship, not a file', () => {
  const sidecar = readFileSync('src-tauri/src/sidecar.rs', 'utf8')
  const main = readFileSync('src-tauri/src/main.rs', 'utf8')

  it('no owner marker or handshake flags remain', () => {
    expect(sidecar).not.toContain('SIDECAR_OWNER_FILENAME')
    expect(sidecar).not.toContain('restart-requested')
    expect(sidecar).not.toContain('shutdown-requested')
    expect(main).not.toContain('read_sidecar_owner')
  })

  it('the shell assigns its server to a Job Object', () => {
    expect(main).toContain('SidecarJob::create()')
    expect(main).toContain('assign(child.id())')
  })
})
