/**
 * Client for the server-managed settings API (/api/settings) plus the
 * desktop restart flow (ADR-011).
 *
 * The listening port and the shell close behavior live in data/server.json
 * and data/desktop.json so the workspace stays portable. Changing the port
 * takes effect on restart: in the desktop app the shell respawns the sidecar
 * (restart handshake via POST /api/settings/server/restart followed by the
 * token-protected shutdown); in a browser the user relaunches manually.
 */

import type { CloseBehavior } from '@rtwiki/shared/constants'
import { SHUTDOWN_TOKEN_HEADER } from '@rtwiki/shared/constants'

const SETTINGS_BASE = '/api/settings'
const SHUTDOWN_BASE = '/api/shutdown'

export interface ServerPortSettings {
  port: number
  configuredPort: number
  defaultPort: number
  restartRequired: boolean
}

export interface DesktopSettings {
  closeBehavior: CloseBehavior
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
 * Records the restart request for the shell, shuts the server down through
 * the token-protected endpoint, then waits for the respawned sidecar to
 * answer on the new port. Returns true when the new server is healthy.
 * Throws with a human-readable message on failure.
 */
export async function restartServerOnPort(port: number, timeoutMs = 30_000): Promise<boolean> {
  const flag = await fetch(`${SETTINGS_BASE}/server/restart`, { method: 'POST' })
  if (!flag.ok) throw new Error(await readError(flag, 'Could not request restart'))

  const tokenRes = await fetch(`${SHUTDOWN_BASE}/token`)
  if (!tokenRes.ok) throw new Error(await readError(tokenRes, 'Could not start restart'))
  const { token } = (await tokenRes.json()) as { token: string }
  if (!token) throw new Error('Could not start restart (empty token)')

  const shutdown = await fetch(`${SHUTDOWN_BASE}`, {
    method: 'POST',
    headers: { [SHUTDOWN_TOKEN_HEADER]: token }
  })
  if (shutdown.status !== 202) throw new Error(await readError(shutdown, 'Server refused restart'))

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
