export type ShutdownState = 'running' | 'stopping' | 'stopped' | 'failed'

export type ShutdownResult =
  | { ok: true; forced: false }
  | { ok: false; stage: 'server' | 'database' | 'logger'; error: Error }

export interface ShutdownCapabilities {
  stopGracefully: () => Promise<void>
  closeDatabase: () => Promise<void>
  logInfo: (message: string, context?: Record<string, unknown>) => void
  logWarn: (message: string, context?: Record<string, unknown>) => void
  logError: (message: string, context?: Record<string, unknown>) => void
  closeLogger: () => Promise<void>
}

/**
 * Process-level shutdown coordinator.
 *
 * One idempotent shutdown operation per instance. Repeated calls return the same
 * settled Promise. The `completed` Promise resolves with the final
 * ShutdownResult — it does not resolve before shutdown is requested.
 *
 * Cleanup order (strict):
 *  1. await server.stop()  (graceful only — no deadline, no forced stop)
 *  2. close database
 *  3. log "Shutdown complete" while logger is still open
 *  4. close logger
 */
export class ShutdownCoordinator {
  private currentState: ShutdownState = 'running'
  private pendingResult: Promise<ShutdownResult> | null = null
  private completedPromise: Promise<ShutdownResult>
  private completedResolve!: (result: ShutdownResult) => void

  constructor(private readonly caps: ShutdownCapabilities) {
    this.completedPromise = new Promise<ShutdownResult>((resolve) => {
      this.completedResolve = resolve
    })
  }

  get state(): ShutdownState {
    return this.currentState
  }

  /**
   * Resolves with the final ShutdownResult once shutdown reaches a terminal state.
   * Does NOT resolve before requestShutdown() is called.
   */
  get completed(): Promise<ShutdownResult> {
    return this.completedPromise
  }

  /**
   * Request graceful shutdown. Idempotent — repeated calls return the same Promise.
   * The returned Promise always settles to a ShutdownResult (never rejects).
   */
  requestShutdown(): Promise<ShutdownResult> {
    if (this.currentState !== 'running') {
      return this.pendingResult as Promise<ShutdownResult>
    }
    this.caps.logInfo('Shutdown requested', { event: 'shutdown_requested' })
    this.pendingResult = this.runSafely()
    this.pendingResult.then((result) => {
      this.completedResolve(result)
    })
    return this.pendingResult
  }

  private async runSafely(): Promise<ShutdownResult> {
    try {
      return await this.run()
    } catch (err) {
      // Unexpected error — surface as server-stage failure.
      const error = err instanceof Error ? err : new Error(String(err))
      this.currentState = 'failed'
      return { ok: false, stage: 'server', error }
    }
  }

  private async run(): Promise<ShutdownResult> {
    this.currentState = 'stopping'
    this.caps.logInfo('Shutting down', { event: 'shutdown' })

    // Phase 1: await graceful server termination.
    try {
      await this.caps.stopGracefully()
    } catch (err) {
      this.currentState = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      return { ok: false, stage: 'server', error }
    }
    this.caps.logInfo('HTTP server stopped', { event: 'shutdown_server_stopped' })

    // Phase 2: close database (only after server is confirmed stopped).
    try {
      await this.caps.closeDatabase()
    } catch (err) {
      this.currentState = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      // Log while logger is still open.
      this.caps.logError('Database close failed', {
        event: 'db_close',
        error: error.message
      })
      try {
        await this.caps.closeLogger()
      } catch {
        // non-fatal
      }
      return { ok: false, stage: 'database', error }
    }
    this.caps.logInfo('Database closed', { event: 'shutdown_database_closed' })

    // Phase 3: log completion before closing logger.
    this.caps.logInfo('Shutdown complete', { event: 'shutdown_complete' })

    // Phase 4: close logger.
    try {
      await this.caps.closeLogger()
    } catch (err) {
      this.currentState = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      return { ok: false, stage: 'logger', error }
    }

    this.currentState = 'stopped'
    return { ok: true, forced: false }
  }
}
