import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * Stage 2: a second launch must focus the first window and exit before any
 * startup work. The single-instance plugin guarantees the second process never
 * reaches `tauri::Builder::run`; the callback runs in the FIRST instance.
 * The real-folder proof is in scripts/ci (second shell exits, server PID
 * unchanged, no second "Server assigned" log line).
 */

describe('second launch focuses and exits', () => {
  const main = readFileSync('src-tauri/src/main.rs', 'utf8')

  it('uses the single-instance plugin', () => {
    expect(main).toContain('tauri_plugin_single_instance::init')
  })

  it('the callback only focuses the window (and opens browser for --browser)', () => {
    // The callback body must not spawn a server, create a job, or navigate.
    const cb = main.slice(
      main.indexOf('tauri_plugin_single_instance::init'),
      main.indexOf('.plugin(tauri_plugin_autostart')
    )
    expect(cb).toContain('show_main(app)')
    expect(cb).not.toContain('spawn_owned_server')
    expect(cb).not.toContain('SidecarJob')
    expect(cb).not.toContain('boot_and_show')
  })
})
