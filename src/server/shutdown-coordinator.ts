import type { FullSaveResult } from './database/index.js'

export type ShutdownState = 'running' | 'stopping' | 'stopped' | 'failed'

export type ShutdownResult =
  | { ok: true; forced: false; fullSaveOk?: boolean }
  | { ok: false; stage: 'server' | 'database' | 'logger'; error: Error; fullSaveOk?: boolean }

export interface ShutdownCapabilities {
  /** Stop accepting new work, then wait a short bounded time for work in progress. */
  stopGracefully: () => Promise<void>
  /** Full save of pending database changes into the main file, with a short limit. */
  fullSave?: () => FullSaveResult
  /** Remove the clean-exit marker once shutdown has reached a terminal state. */
  clearCleanExitMarker?: () => void
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
 *  1. stop accepting work, then wait a short bounded time for work in progress
 *  2. full save of pending changes into the main database file (log on failure)
 *  3. close database
 *  4. remove the clean-exit marker
 *  5. log "Shutdown complete" while logger is still open
 *  6. close logger
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

    // Phase 1: stop accepting new work, then wait a short bounded time for work
    // in progress. The bound lives in the injected capability so this module
    // never owns a timeout value (single source of truth in shared constants).
    try {
      await this.caps.stopGracefully()
    } catch (err) {
      this.currentState = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      return { ok: false, stage: 'server', error }
    }
    this.caps.logInfo('HTTP server stopped', { event: 'shutdown_server_stopped' })

    // Phase 2: full save of pending changes into the main database file. A
    // failure is logged and the shutdown still continues — the guarantee is
    // only that the folder is normally safe to copy after a clean close.
    const fullSave = this.caps.fullSave?.() ?? null
    if (fullSave?.ok) {
      this.caps.logInfo('Pending database changes saved to the main file', {
        event: 'shutdown_full_save_ok'
      })
    } else if (fullSave) {
      this.caps.logWarn('Could not fully save pending database changes', {
        event: 'shutdown_full_save_failed',
        detail: fullSave.detail ?? 'unknown error'
      })
    }
    const fullSaveField = fullSave ? { fullSaveOk: fullSave.ok } : {}

    // Phase 3: close database (only after the full save was attempted).
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
      return { ok: false, stage: 'database', error, ...fullSaveField }
    }
    this.caps.logInfo('Database closed', { event: 'shutdown_database_closed' })

    // Phase 4: the process is exiting normally, so the clean-exit marker can go.
    this.caps.clearCleanExitMarker?.()

    // Phase 5: log completion before closing logger.
    this.caps.logInfo('Shutdown complete', { event: 'shutdown_complete' })

    // Phase 6: close logger.
    try {
      await this.caps.closeLogger()
    } catch (err) {
      this.currentState = 'failed'
      const error = err instanceof Error ? err : new Error(String(err))
      return { ok: false, stage: 'logger', error, ...fullSaveField }
    }

    this.currentState = 'stopped'
    return { ok: true, forced: false, ...fullSaveField }
  }
}
