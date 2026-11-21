import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * Stage 4: the window is revealed only when the app is actually ready. The old
 * unconditional 5s safety timer could reveal a connection-refused error page;
 * the fallback now waits for a confirmed-healthy server.
 */

describe('window reveal is health-gated', () => {
  const main = readFileSync('src-tauri/src/main.rs', 'utf8')

  it('reveals on the frontend app_ready signal', () => {
    expect(main).toContain('fn app_ready')
    expect(main).toContain('reveal_main_window(&app)')
  })

  it('the fallback checks health before revealing', () => {
    const fallback = main.slice(
      main.indexOf('let fallback_app'),
      main.indexOf('/// Tauri invoke command')
    )
    expect(fallback).toContain('health_ok(fallback_port)')
    expect(fallback).toContain('reveal_main_window(&fallback_app)')
  })

  it('no unconditional 5-second reveal remains', () => {
    expect(main).not.toContain('std::thread::sleep(Duration::from_secs(5))')
  })

  it('logs clearly if the server never becomes healthy', () => {
    expect(main).toContain('Server never became healthy')
  })
})
