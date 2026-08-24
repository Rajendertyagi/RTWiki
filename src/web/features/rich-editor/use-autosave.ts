import { useCallback, useEffect, useRef, useState } from 'react'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import { type AutosaveStatus, createAutosaveController } from './autosave-controller.js'

interface UseAutosaveOptions {
  pageId: string
  onSave: (pageId: string, content: string) => Promise<void>
}

export function useAutosave(options: UseAutosaveOptions): {
  status: AutosaveStatus
  error: string | null
  isDirty: boolean
  notifyEdit: (content: string) => void
  save: () => Promise<boolean>
  retry: () => Promise<boolean>
  flush: () => Promise<boolean>
} {
  const { pageId } = options
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // One controller for the component's lifetime. Recreating it whenever the
  // caller's onSave identity changed (an inline arrow does, every render)
  // disposed the pending debounce timer and silently cancelled scheduled
  // saves - the editor showed dirty forever and never persisted.
  // onSave is routed through a ref so callers may pass inline callbacks.
  const onSaveRef = useRef(options.onSave)
  useEffect(() => {
    onSaveRef.current = options.onSave
  })

  // Debug Mode enrichment: the controller reports monotonic revisions; this
  // boundary attaches the latest document length and safe hash. Content
  // itself never reaches the debug log.
  const metaRef = useRef({ rev: 0, len: 0, hash: safeHash('') })
  const emitAutosaveEvent = useCallback(
    (
      name:
        | 'autosave_scheduled'
        | 'autosave_cancelled'
        | 'autosave_flush_requested'
        | 'autosave_request_started'
        | 'autosave_success'
        | 'autosave_failure'
        | 'autosave_revision_applied'
        | 'autosave_stale_ignored',
      revision: number
    ): void => {
      const meta = metaRef.current
      const matchesLatest = meta.rev === revision
      debugLog('autosave', name, {
        pageId,
        rev: revision,
        len: matchesLatest ? meta.len : undefined,
        hash: matchesLatest ? meta.hash : undefined
      })
    },
    [pageId]
  )

  const controllerRef = useRef<ReturnType<typeof createAutosaveController> | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createAutosaveController({
      onSave: (pid: string, content: string) => onSaveRef.current(pid, content),
      onStatusChange: (state) => {
        setStatus(state.status)
        setError(state.error)
      },
      events: {
        scheduled: (rev) => emitAutosaveEvent('autosave_scheduled', rev),
        cancelled: (rev) => emitAutosaveEvent('autosave_cancelled', rev),
        flushRequested: (rev) => emitAutosaveEvent('autosave_flush_requested', rev),
        requestStarted: (rev) => emitAutosaveEvent('autosave_request_started', rev),
        success: (rev) => emitAutosaveEvent('autosave_success', rev),
        failure: (rev) => emitAutosaveEvent('autosave_failure', rev),
        revisionApplied: (rev) => emitAutosaveEvent('autosave_revision_applied', rev),
        staleIgnored: (rev) => emitAutosaveEvent('autosave_stale_ignored', rev)
      }
    })
  }
  const controller = controllerRef.current

  useEffect(() => {
    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [controller])

  // Reset status when page changes
  useEffect(() => {
    void pageId
    setStatus('idle')
    setError(null)
  }, [pageId])

  const isDirty = status === 'dirty' || status === 'error'

  const notifyEdit = useCallback(
    (content: string): void => {
      metaRef.current = {
        rev: metaRef.current.rev + 1,
        len: content.length,
        hash: safeHash(content)
      }
      controller.notifyEdit(pageId, content)
    },
    [controller, pageId]
  )

  const save = useCallback((): Promise<boolean> => controller.save(), [controller])

  const retry = useCallback((): Promise<boolean> => controller.retry(), [controller])

  const flush = useCallback((): Promise<boolean> => controller.flush(), [controller])

  return { status, error, isDirty, notifyEdit, save, retry, flush }
}
