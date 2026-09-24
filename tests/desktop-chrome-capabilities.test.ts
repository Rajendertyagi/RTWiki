/**
 * Desktop shell capability contract.
 *
 * Tauri 2 blocks every core command unless a capability grants it, and a
 * missing grant fails silently at runtime: the call rejects and nothing
 * happens. That is how `data-tauri-drag-region` shipped non-functional in the
 * custom window chrome — `startDragging` was never granted.
 *
 * This test pins the grants the window chrome depends on so the omission
 * cannot come back silently.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Capability {
  identifier: string
  windows: string[]
  permissions: Array<string | { identifier: string }>
}

const CAPABILITY_PATH = join(import.meta.dir, '..', 'src-tauri', 'capabilities', 'default.json')

/**
 * Core-window commands invoked by `src/web/components/window-chrome.tsx`.
 * Keep this list in step with that component — every entry here is a command
 * whose absence produces a silently dead button or a dead drag region.
 */
const REQUIRED_WINDOW_PERMISSIONS = [
  // mousedown on a data-tauri-drag-region element -> window drag. Without this
  // the title bar and tab strip cannot move the window at all.
  'core:window:allow-start-dragging',
  'core:window:allow-minimize',
  'core:window:allow-toggle-maximize',
  // restore/maximize button glyph depends on this query
  'core:window:allow-is-maximized',
  // close button with the "minimize to tray" close behaviour.
  'core:window:allow-hide',
  // close button with the "quit" / "ask" close behaviours: the request is
  // intercepted by the shell's CloseRequested handler.
  'core:window:allow-close'
] as const

function readCapability(): Capability {
  return JSON.parse(readFileSync(CAPABILITY_PATH, 'utf8')) as Capability
}

describe('desktop shell capabilities', () => {
  test('grants every core-window permission the window chrome invokes', () => {
    const granted = new Set(
      readCapability().permissions.map((permission) =>
        typeof permission === 'string' ? permission : permission.identifier
      )
    )

    const missing = REQUIRED_WINDOW_PERMISSIONS.filter((permission) => !granted.has(permission))
    expect(missing).toEqual([])
  })

  test('targets the main window so the grants apply to the shell', () => {
    expect(readCapability().windows).toContain('main')
  })
})
