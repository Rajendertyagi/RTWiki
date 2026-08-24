export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface AutosaveState {
  status: AutosaveStatus
  error: string | null
  pendingPageId: string | null
  pendingContent: string | null
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

export interface AutosaveControllerOptions {
  debounceMs?: number
  onSave: (pageId: string, content: string) => Promise<void>
  onStatusChange?: (state: AutosaveState) => void
  /**
   * Optional Debug Mode observer. Receives monotonic revisions only — never
   * content. Callers enrich events with lengths/hashes at their own boundary.
   */
  events?: AutosaveEventSink
  /** @internal Test injection point; defaults to the real timers. */
  scheduler?: Scheduler
}

/**
 * Debug Mode observation points across the autosave lifecycle. Every method
 * is optional and must never throw into the save pipeline.
 */
export interface AutosaveEventSink {
  scheduled?(revision: number): void
  cancelled?(revision: number): void
  flushRequested?(revision: number): void
  requestStarted?(revision: number): void
  success?(revision: number): void
  failure?(revision: number): void
  revisionApplied?(revision: number): void
  staleIgnored?(revision: number): void
}

/**
 * A DocumentRevision holds a snapshot of content at a point in time.
 * Revisions are monotonically increasing and never reused.
 */
interface DocumentRevision {
  revision: number
  content: string
}

export function createAutosaveController(options: AutosaveControllerOptions): {
  getState: () => AutosaveState
  notifyEdit: (pageId: string, content: string) => void
  save: () => Promise<boolean>
  retry: () => Promise<boolean>
  flush: () => Promise<boolean>
  dispose: () => void
} {
  const debounceMs = options.debounceMs ?? 2000
  // Debug events are observed through an indirection so a throwing observer
  // can never break saving.
  const emitEvent = (name: keyof AutosaveEventSink, revision: number): void => {
    try {
      options.events?.[name]?.(revision)
    } catch {
      // Observation must never break editing.
    }
  }
  // Wrapper arrows (not the bare methods): in browsers setTimeout/clearTimeout
  // are Window scope methods and throw "Illegal invocation" when invoked with
  // any other `this` — e.g. as properties of a plain scheduler object.
  const scheduler = options.scheduler ?? {
    setTimeout: (fn: () => void, ms: number): number =>
      globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number): void => {
      globalThis.clearTimeout(id)
    }
  }

  // Monotonic counter — never derived from snapshot state
  let currentRevision = 0
  let status: AutosaveStatus = 'idle'
  let error: string | null = null
  let pendingPageId: string | null = null
  let pendingContent: string | null = null
  let confirmedRevision = 0
  let inFlightSnapshot: DocumentRevision | null = null
  let inFlightPromise: Promise<boolean> | null = null
  let timer: number | null = null
  let disposed = false

  const emit = (): void => {
    if (disposed) return
    options.onStatusChange?.({ status, error, pendingPageId, pendingContent })
  }

  const setState = (nextStatus: AutosaveStatus, nextError: string | null): void => {
    status = nextStatus
    error = nextError
    emit()
  }

  const clearTimer = (): void => {
    if (timer !== null) {
      scheduler.clearTimeout(timer)
      timer = null
    }
  }

  /**
   * Save exactly the supplied immutable snapshot.
   * Clears only its own in-flight state in finally.
   */
  const startSnapshotSave = async (snapshot: DocumentRevision): Promise<boolean> => {
    inFlightSnapshot = snapshot
    inFlightPromise = (async (): Promise<boolean> => {
      emitEvent('requestStarted', snapshot.revision)
      try {
        await options.onSave(pendingPageId ?? '', snapshot.content)
        // Advance confirmedRevision only if this request is still the newest
        if (snapshot.revision >= confirmedRevision) {
          confirmedRevision = snapshot.revision
          emitEvent('revisionApplied', confirmedRevision)
          // Only clear pending if it hasn't been superseded
          if (
            pendingContent !== null &&
            pendingPageId !== null &&
            currentRevision === snapshot.revision
          ) {
            pendingPageId = null
            pendingContent = null
          }
          // Determine state
          if (
            pendingContent !== null &&
            pendingPageId !== null &&
            confirmedRevision < currentRevision
          ) {
            setState('dirty', null)
          } else {
            setState('saved', null)
          }
        } else {
          // Stale completion: a newer revision was already confirmed.
          emitEvent('staleIgnored', snapshot.revision)
        }
        // Stale completion: do nothing — newer revision is already confirmed
        return true
      } catch (err) {
        // Only surface error if this was still the active in-flight request
        if (inFlightSnapshot !== null && inFlightSnapshot.revision === snapshot.revision) {
          setState('error', err instanceof Error ? err.message : 'Save failed')
        }
        emitEvent('failure', snapshot.revision)
        // Do NOT clear pendingContent — preserve for retry
        return false
      } finally {
        inFlightSnapshot = null
        inFlightPromise = null
      }
    })()
    setState('saving', null)
    return inFlightPromise
  }

  /**
   * Single drain operation used by autosave, manual save, retry, and flush.
   * Coalesces in-flight saves and continues until current revision is confirmed.
   */
  const drain = async (): Promise<boolean> => {
    if (timer !== null) {
      emitEvent('flushRequested', currentRevision)
    }
    clearTimer()

    while (
      pendingContent !== null &&
      pendingPageId !== null &&
      confirmedRevision < currentRevision
    ) {
      if (inFlightPromise !== null) {
        const activeResult = await inFlightPromise
        if (!activeResult) return false
        continue
      }

      const snapshot: DocumentRevision = {
        revision: currentRevision,
        content: pendingContent
      }
      const result = await startSnapshotSave(snapshot)
      if (!result) return false
    }

    return true
  }

  const scheduleSave = (): void => {
    if (timer !== null) {
      // Re-arming mid-window supersedes the previous schedule.
      emitEvent('cancelled', currentRevision)
      clearTimer()
    }
    emitEvent('scheduled', currentRevision)
    timer = scheduler.setTimeout(async () => {
      timer = null
      await drain()
    }, debounceMs)
  }

  const notifyEdit = (pageId: string, content: string): void => {
    if (disposed) return

    currentRevision += 1
    pendingPageId = pageId
    pendingContent = content
    setState('dirty', null)
    scheduleSave()
  }

  const save = async (): Promise<boolean> => {
    if (disposed) return false
    return drain()
  }

  const retry = async (): Promise<boolean> => {
    if (disposed) return false
    const saved = await drain()
    return saved
  }

  const flush = async (): Promise<boolean> => {
    if (disposed) return true
    return drain()
  }

  const dispose = (): void => {
    disposed = true
    clearTimer()
  }

  const getState = (): AutosaveState => ({
    status,
    error,
    pendingPageId,
    pendingContent
  })

  return { getState, notifyEdit, save, retry, flush, dispose }
}
