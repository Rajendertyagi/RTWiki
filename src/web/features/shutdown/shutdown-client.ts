import { SHUTDOWN_TOKEN_HEADER } from '@rtwiki/shared/constants'

export interface ShutdownResult {
  success: boolean
  error?: string
}

export async function fetchShutdownToken(): Promise<string | null> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8080'
    const res = await fetch('/api/shutdown/token', {
      headers: { Origin: origin }
    })
    if (!res.ok) return null
    const data = (await res.json()) as { token: string }
    return data.token ?? null
  } catch {
    return null
  }
}

export async function requestShutdown(token: string): Promise<ShutdownResult> {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8080'
    const res = await fetch('/api/shutdown', {
      method: 'POST',
      headers: {
        [SHUTDOWN_TOKEN_HEADER]: token,
        Origin: origin
      }
    })
    if (res.ok) {
      return { success: true }
    }
    const body = (await res.json().catch(() => ({ error: 'Unknown error' }))) as { error?: string }
    return { success: false, error: body.error ?? `Shutdown failed (${res.status})` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Shutdown failed'
    return { success: false, error: message }
  }
}
