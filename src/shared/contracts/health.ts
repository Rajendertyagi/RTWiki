export type HealthStatus = 'ok' | 'error'

export interface HealthResponse {
  status: HealthStatus
  app: string
  version: string
  db: { ready: boolean }
  time: string
}
