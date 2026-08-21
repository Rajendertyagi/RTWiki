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

  // Reset status when page changes
  useEffect(() => {
    void pageId
    setStatus('idle')
    setError(null)
  }, [pageId])

  const isDirty = status === 'dirty' || status === 'error'

  const notifyEdit = useCallback(
    (content: string): void => {
      controllerRef.current?.notifyEdit(pageId, content)
    },
    [pageId]
  )

  const save = useCallback(async (): Promise<boolean> => {
    const result = await controllerRef.current?.save()
    return result ?? true
  }, [])

  const retry = useCallback(async (): Promise<boolean> => {
    return (await controllerRef.current?.retry()) ?? false
  }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    const result = await controllerRef.current?.flush()
    return result ?? true
  }, [])

  return { status, error, isDirty, notifyEdit, save, retry, flush }
}
