import { AUTOSAVE_DEBOUNCE_MS } from './document.js'

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
  /** @internal Test injection point; defaults to the real timers. */
  scheduler?: Scheduler
}

export function createAutosaveController(options: AutosaveControllerOptions): {
  getState: () => AutosaveState
  notifyEdit: (pageId: string, content: string) => void
  flush: () => Promise<boolean>
  retry: () => void
  dispose: () => void
} {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS
  const scheduler = options.scheduler ?? { setTimeout, clearTimeout }
  let status: AutosaveStatus = 'idle'
  let error: string | null = null
  let pendingPageId: string | null = null
  let pendingContent: string | null = null
  let savingPageId: string | null = null
  let savingContent: string | null = null
  let savingPromise: Promise<void> | null = null
  let timer: number | null = null
  let nextPending: { pageId: string; content: string } | null = null
  let disposed = false
  let seq = 0

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

  const startSave = async (pageId: string, content: string): Promise<void> => {
    const currentSeq = ++seq
    savingPageId = pageId
    savingContent = content
    pendingPageId = null
    pendingContent = null
    setState('saving', null)

    const promise = options.onSave(pageId, content)
    savingPromise = promise

    try {
      await promise
      if (disposed || currentSeq !== seq) return
      savingPageId = null
      savingContent = null
      savingPromise = null

      if (nextPending) {
        const next = nextPending
        nextPending = null
        pendingPageId = next.pageId
        pendingContent = next.content
        // Immediately start next save without debounce
        void startSave(next.pageId, next.content)
        return
      }

      setState('saved', null)
      // After saved, return to idle after a short delay (handled by caller if needed)
      // Keep saved state until next edit
    } catch (err) {
      if (disposed || currentSeq !== seq) return
      const failedPageId = savingPageId
      const failedContent = savingContent
      savingPageId = null
      savingContent = null
      savingPromise = null
      const message = err instanceof Error ? err.message : 'Save failed'
      if (nextPending) {
        pendingPageId = nextPending.pageId
        pendingContent = nextPending.content
        nextPending = null
      } else if (failedPageId && failedContent !== null) {
        pendingPageId = failedPageId
        pendingContent = failedContent
      }
      setState('error', message)
    }
  }

  const scheduleSave = (): void => {
    clearTimer()
    timer = scheduler.setTimeout(() => {
      timer = null
      if (pendingPageId && pendingContent !== null) {
        const pid = pendingPageId
        const content = pendingContent
        void startSave(pid, content)
      }
    }, debounceMs)
  }

  const notifyEdit = (pageId: string, content: string): void => {
    if (disposed) return

    // If currently saving, queue as nextPending (always keep latest)
    if (status === 'saving') {
      nextPending = { pageId, content }
      pendingPageId = pageId
      pendingContent = content
      setState('dirty', null)
      // Don't schedule timer now; will start immediately after current save finishes
      return
    }

    // If saved/error/idle/dirty, set pending and schedule
    pendingPageId = pageId
    pendingContent = content
    nextPending = null

    if (status === 'error') {
      setState('dirty', null)
    } else if (status !== 'dirty') {
      setState('dirty', null)
    } else {
      // already dirty, just update content
      emit()
    }

    scheduleSave()
  }

  const flush = async (): Promise<boolean> => {
    if (disposed) return false

    if (!pendingPageId && !savingPageId && !nextPending) {
      return true
    }

    clearTimer()

    // If currently saving, wait for it
    if (savingPromise) {
      try {
        await savingPromise
      } catch {
        return false
      }
      // After saving, check if there is pending dirty for same page
      if (pendingPageId && pendingContent !== null) {
        const pid = pendingPageId
        const content = pendingContent
        await startSave(pid, content)
        return status !== 'error'
      }
      if (nextPending) {
        const pid = nextPending.pageId
        const content = nextPending.content
        nextPending = null
        pendingPageId = pid
        pendingContent = content
        await startSave(pid, content)
        return status !== 'error'
      }
      return status !== 'error'
    }

    // If dirty pending, save immediately
    if (pendingPageId && pendingContent !== null) {
      const pid = pendingPageId
      const content = pendingContent
      await startSave(pid, content)
      return status !== 'error'
    }

    if (nextPending) {
      const pid = nextPending.pageId
      const content = nextPending.content
      nextPending = null
      pendingPageId = pid
      pendingContent = content
      await startSave(pid, content)
      return status !== 'error'
    }

    return true
  }

  const retry = (): void => {
    if (disposed) return
    if (status !== 'error' || !pendingPageId || pendingContent === null) return
    // Retry immediately without debounce
    const pid = pendingPageId
    const content = pendingContent
    clearTimer()
    void startSave(pid, content)
  }

  const dispose = (): void => {
    disposed = true
    clearTimer()
    seq++
  }

  const getState = (): AutosaveState => ({
    status,
    error,
    pendingPageId,
    pendingContent
  })

  return { getState, notifyEdit, flush, retry, dispose }
}
