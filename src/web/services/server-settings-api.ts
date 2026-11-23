/**
 * Client for the server-managed settings API (/api/settings) plus the
 * desktop restart flow (ADR-011).
 *
 * The listening port and the shell close behavior live in the SQLite settings
 * table so the workspace stays portable. Changing the port takes effect on
 * restart: in the desktop app the shell restarts the server it owns directly
 * through the `restart_server` Tauri command; in a browser there is no shell,
 * so the user is told to close and reopen RTWiki.
 */

import type { CloseBehavior } from '@rtwiki/shared/constants'
import { invoke } from '@tauri-apps/api/core'
import { isNativeMode } from './native-bridge.js'

const SETTINGS_BASE = '/api/settings'

export interface ServerPortSettings {
  port: number
  configuredPort: number
  defaultPort: number
  restartRequired: boolean
}

export interface DesktopSettings {
  closeBehavior: CloseBehavior
  rememberCloseChoice: boolean
}

export interface AppearanceSettings {
  themeId: string
  colorScheme: 'auto' | 'light' | 'dark'
  themes: Array<{ id: string; name: string }>
}

export async function getAppearanceSettings(signal?: AbortSignal): Promise<AppearanceSettings> {
  const res = await fetch(`${SETTINGS_BASE}/appearance`, { signal })
  if (!res.ok) throw new Error(await readError(res, 'Could not load appearance settings'))
  return (await res.json()) as AppearanceSettings
}

export async function updateAppearance(input: {
  themeId?: string
  colorScheme?: 'auto' | 'light' | 'dark'
}): Promise<AppearanceSettings> {
  const res = await fetch(`${SETTINGS_BASE}/appearance`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw new Error(await readError(res, 'Could not save appearance settings'))
  return (await res.json()) as AppearanceSettings
}

export async function updateColorScheme(
  colorScheme: 'auto' | 'light' | 'dark'
): Promise<AppearanceSettings> {
  return updateAppearance({ colorScheme })
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error || `${fallback} (${res.status})`
  } catch {
    return `${fallback} (${res.status})`
  }
}

export async function getServerSettings(signal?: AbortSignal): Promise<ServerPortSettings> {
  const res = await fetch(`${SETTINGS_BASE}/server`, { signal })
  if (!res.ok) throw new Error(await readError(res, 'Could not load server settings'))
  return (await res.json()) as ServerPortSettings
}

export async function updateServerPort(port: number): Promise<ServerPortSettings> {
  const res = await fetch(`${SETTINGS_BASE}/server`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port })
  })
  if (!res.ok) throw new Error(await readError(res, 'Could not save port'))
  return (await res.json()) as ServerPortSettings
}

export async function getDesktopSettings(signal?: AbortSignal): Promise<DesktopSettings> {
  const res = await fetch(`${SETTINGS_BASE}/desktop`, { signal })
  if (!res.ok) throw new Error(await readError(res, 'Could not load desktop settings'))
  return (await res.json()) as DesktopSettings
}

export async function updateCloseBehavior(closeBehavior: CloseBehavior): Promise<DesktopSettings> {
  const res = await fetch(`${SETTINGS_BASE}/desktop`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closeBehavior })
  })
  if (!res.ok) throw new Error(await readError(res, 'Could not save close behavior'))
  return (await res.json()) as DesktopSettings
}

export async function updateRememberCloseChoice(
  rememberCloseChoice: boolean
): Promise<DesktopSettings> {
  const res = await fetch(`${SETTINGS_BASE}/desktop`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rememberCloseChoice })
  })
  if (!res.ok) throw new Error(await readError(res, 'Could not save the close-dialog preference'))
  return (await res.json()) as DesktopSettings
}

function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/health`
}

async function healthOk(port: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(healthUrl(port), { signal: controller.signal })
      return res.ok
    } finally {
      clearTimeout(timeoutId)
    }
  } catch {
    return false
  }
}

/**
 * Restarts the server onto a new port (desktop app only).
 *
 * The shell owns the server through a Job Object and restarts it directly via
 * the `restart_server` command. The command validates the port, rejects calls
 * from outside the app window, and refuses to restart a borrowed server.
 * Returns true when the new server is healthy. Throws a human-readable message
 * on failure (including the borrowed-server case).
 */
export async function restartServerOnPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  if (!isNativeMode()) {
    // Browser mode has no shell to restart the server. The UI shows the
    // relaunch message instead; this is a defensive no-op.
    return false
  }
  await invoke('restart_server', { port })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await healthOk(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

export function serverBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/`
}
