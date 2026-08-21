import { useEffect, useRef, useState } from 'react'
import { type AutosaveStatus, createAutosaveController } from './autosave-controller.js'

interface UseAutosaveOptions {
  pageId: string
  onSave: (pageId: string, content: string) => Promise<void>
}

export function useAutosave(options: UseAutosaveOptions): {
  status: AutosaveStatus
  error: string | null
  notifyEdit: (content: string) => void
  flush: () => Promise<boolean>
  retry: () => void
} {
  const { pageId, onSave } = options
  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const controllerRef = useRef<ReturnType<typeof createAutosaveController> | null>(null)

  useEffect(() => {
    const controller = createAutosaveController({
      onSave,
      onStatusChange: (state) => {
        setStatus(state.status)
        setError(state.error)
      }
    })
    controllerRef.current = controller
    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [onSave])

  // Reset status and notify controller of page change
  useEffect(() => {
    void pageId
    setStatus('idle')
    setError(null)
  }, [pageId])

  const notifyEdit = useCallback(
    (content: string): void => {
      controllerRef.current?.notifyEdit(pageId, content)
    },
    [pageId]
  )

  const flush = useCallback(async (): Promise<boolean> => {
    const result = await controllerRef.current?.flush()
    return result ?? true
  }, [])

  const retry = useCallback((): void => {
    controllerRef.current?.retry()
  }, [])

  return { status, error, notifyEdit, flush, retry }
}
