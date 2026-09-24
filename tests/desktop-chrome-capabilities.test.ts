/**
 * Desktop shell capability contract.
 *
 * Tauri 2 blocks every core command unless a capability grants it, and a
 * missing grant fails silently at runtime: the call rejects and nothing
 * happens. That is how `data-tauri-drag-region` shipped non-functional in the
 * custom window chrome — `startDragging` was never granted.
 *
 * The desktop webview loads the app from the **loopback origin**
 * (`http://127.0.0.1:<port>`), which Tauri classifies as *remote*: "by default
 * the API is only accessible to bundled code shipped with the Tauri App". A
 * capability without a `remote` block therefore grants that origin nothing, so
 * every window command rejects and the whole chrome renders inert. The remote
 * capability is what makes the controls work.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface Capability {
  identifier: string
  windows: string[]
  permissions: Array<string | { identifier: string }>
  remote?: { urls: string[] }
}

const CAPABILITIES_DIR = join(import.meta.dir, '..', 'src-tauri', 'capabilities')
const CAPABILITY_PATH = join(CAPABILITIES_DIR, 'default.json')
const REMOTE_CAPABILITY_PATH = join(CAPABILITIES_DIR, 'remote-loopback.json')

/**
 * Core-window commands invoked by `src/web/components/window-chrome.tsx`.
 * Keep this list in step with that component — every entry here is a command
 * whose absence produces a silently dead button or a dead drag region.
 */
const REQUIRED_WINDOW_PERMISSIONS = [
  // mousedown on a data-tauri-drag-region element -> window drag. Without this
  // the band cannot move the window at all.
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

/** The loopback host the webview is pointed at (see sidecar::base_url). */
const LOOPBACK_HOST = '127.0.0.1'

function readCapability(path = CAPABILITY_PATH): Capability {
  return JSON.parse(readFileSync(path, 'utf8')) as Capability
}

function grantedPermissions(capability: Capability): Set<string> {
  return new Set(
    capability.permissions.map((permission) =>
      typeof permission === 'string' ? permission : permission.identifier
    )
  )
}

describe('desktop shell capabilities', () => {
  test('grants every core-window permission the window chrome invokes', () => {
    const granted = grantedPermissions(readCapability())
    const missing = REQUIRED_WINDOW_PERMISSIONS.filter((permission) => !granted.has(permission))
    expect(missing).toEqual([])
  })

  test('targets the main window so the grants apply to the shell', () => {
    expect(readCapability().windows).toContain('main')
  })
})

describe('loopback remote capability', () => {
  test('exists: the loopback origin is remote to Tauri and needs its own grant', () => {
    expect(existsSync(REMOTE_CAPABILITY_PATH)).toBe(true)
  })

  test('covers the loopback origin on any port (the port is Settings-managed)', () => {
    // remote.urls uses URLPattern, and a bare `http://127.0.0.1` does not match
    // an explicit port in Tauri v2. The port is user-configurable, so it must be
    // a pattern rather than a fixed number.
    const { remote } = readCapability(REMOTE_CAPABILITY_PATH)
    expect(remote?.urls).toContain(`http://${LOOPBACK_HOST}:*`)
  })

  test('grants the window chrome its core-window commands', () => {
    const granted = grantedPermissions(readCapability(REMOTE_CAPABILITY_PATH))
    const missing = REQUIRED_WINDOW_PERMISSIONS.filter((permission) => !granted.has(permission))
    expect(missing).toEqual([])
  })

  test('grants the resize listener the maximized state depends on', () => {
    // win.onResized() needs event:listen; without it the restore glyph goes
    // stale after a manual resize.
    expect(grantedPermissions(readCapability(REMOTE_CAPABILITY_PATH))).toContain(
      'core:event:default'
    )
  })

  test('targets the main window', () => {
    expect(readCapability(REMOTE_CAPABILITY_PATH).windows).toContain('main')
  })

  test('does not widen the origin beyond loopback', () => {
    // Least privilege: this grant must never become a wildcard that any page
    // loaded in the shell could use.
    const { remote } = readCapability(REMOTE_CAPABILITY_PATH)
    const offenders = (remote?.urls ?? []).filter(
      (url) => !url.startsWith(`http://${LOOPBACK_HOST}`)
    )
    expect(offenders).toEqual([])
  })
})
