import { useCallback, useEffect, useRef, useState } from 'react'
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

  const controllerRef = useRef<ReturnType<typeof createAutosaveController> | null>(null)
  if (!controllerRef.current) {
    controllerRef.current = createAutosaveController({
      onSave: (pid: string, content: string) => onSaveRef.current(pid, content),
      onStatusChange: (state) => {
        setStatus(state.status)
        setError(state.error)
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
      controller.notifyEdit(pageId, content)
    },
    [controller, pageId]
  )

  const save = useCallback((): Promise<boolean> => controller.save(), [controller])

  const retry = useCallback((): Promise<boolean> => controller.retry(), [controller])

  const flush = useCallback((): Promise<boolean> => controller.flush(), [controller])

  return { status, error, isDirty, notifyEdit, save, retry, flush }
}
