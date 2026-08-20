import type { HealthResponse } from '@rtwiki/shared/contracts/health'

const API_BASE = '/api'

export type HealthStatus = 'ok' | 'error' | null

interface HealthResult {
  status: HealthStatus
  data?: HealthResponse
}

export async function checkHealth(signal: AbortSignal): Promise<HealthResult> {
  const response = await fetch(`${API_BASE}/health`, { signal })

  if (!response.ok) {
    return { status: 'error' }
  }

  const data = (await response.json()) as HealthResponse
  return {
    status: data.status === 'ok' ? 'ok' : 'error',
    data
  }
}
