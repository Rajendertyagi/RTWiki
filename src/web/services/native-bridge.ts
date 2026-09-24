/**
 * Guarded bridge to the Tauri desktop shell (ADR-011).
 *
 * The shell injects `window.__TAURI_INTERNALS__` into the WebView2 page. When
 * the bridge is absent — browser mode, or a desktop build where the injected
 * IPC script did not initialise (see the CSP risk in ADR-011) — every function
 * here degrades to a safe fallback instead of throwing, so core features never
 * depend on native availability.
 *
 * Tauri plugin modules are loaded with lazy dynamic imports so the browser
 * bundle path never evaluates them; they are only fetched when native mode is
 * detected at runtime.
 */

export interface AutostartState {
  /** False in browser mode or when the IPC bridge is unavailable. */
  available: boolean
  enabled: boolean
}

/** True when the page runs inside the Tauri desktop shell. */
export function isNativeMode(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Reads launch-at-login registration. Never throws. */
export async function getAutostartState(): Promise<AutostartState> {
  if (!isNativeMode()) return { available: false, enabled: false }
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart')
    return { available: true, enabled: await isEnabled() }
  } catch {
    return { available: false, enabled: false }
  }
}

/**
 * Enables or disables launch-at-login. Returns false when unavailable or when
 * the shell rejects the change, so callers can leave the UI untouched.
 */
export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isNativeMode()) return false
  try {
    const autostart = await import('@tauri-apps/plugin-autostart')
    if (enabled) {
      await autostart.enable()
    } else {
      await autostart.disable()
    }
    return true
  } catch {
    return false
  }
}

/**
 * Sends a native OS toast through the shell. Returns false when unavailable,
 * permission is not granted, or the shell rejects the call.
 */
export async function sendNativeNotification(title: string, body?: string): Promise<boolean> {
  if (!isNativeMode()) return false
  try {
    const notify = await import('@tauri-apps/plugin-notification')
    let granted = await notify.isPermissionGranted()
    if (!granted) {
      granted = (await notify.requestPermission()) === 'granted'
    }
    if (!granted) return false
    notify.sendNotification({ title, body })
    return true
  } catch {
    return false
  }
}
