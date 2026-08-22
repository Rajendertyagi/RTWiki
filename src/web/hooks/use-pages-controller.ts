import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../services/pages-api.js'

export type MutationStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface PagesController {
  pages: Page[]
  selectedPage: Page | null
  loading: boolean
  error: string | null
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectPage: (id: string | null) => void
  createPage: (title: string, pageType: PageType) => Promise<Page | null>
  /** Persists editor content and merges the server-returned page into local state. */
  savePageContent: (id: string, content: string) => Promise<boolean>
  renamePage: (id: string, title: string) => Promise<boolean>
  duplicatePage: (id: string) => Promise<Page | null>
  deletePage: (id: string) => Promise<boolean>
  mutationStatus: MutationStatus
  mutationError: string | null
  refreshPages: () => void
}

const SEARCH_DEBOUNCE_MS = 300

export function usePagesController(): PagesController {
  const [pages, setPages] = useState<Page[]>([])
  const [selectedPage, setSelectedPage] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [mutationStatus, setMutationStatus] = useState<MutationStatus>('idle')
  const [mutationError, setMutationError] = useState<string | null>(null)

  const searchSeqRef = useRef(0)
  const searchAbortRef = useRef<AbortController | null>(null)
  const mutationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadPages = useCallback((query: string | undefined, signal?: AbortSignal) => {
    // Sequence token: a newer load (e.g. the refresh after createPage) must
    // never be overwritten by an older in-flight response resolving later —
    // that stale snapshot once evicted a just-created page from the list and
    // kicked the user back to the dashboard.
    const seq = ++searchSeqRef.current
    setLoading(true)
    setError(null)
    api
      .listPages(signal, query ? { q: query } : undefined)
      .then((result) => {
        if (seq === searchSeqRef.current && !signal?.aborted) {
          setPages(result.pages)
          setLoading(false)
        }
      })
      .catch((err: Error) => {
        if (!signal?.aborted && err.name !== 'AbortError') {
          setError(err.message)
          setLoading(false)
        }
      })
  }, [])

  useEffect(() => {
    searchAbortRef.current?.abort()

    const seq = ++searchSeqRef.current
    const trimmed = searchQuery.trim()

    if (!trimmed) {
      const controller = new AbortController()
      searchAbortRef.current = controller
      loadPages(undefined, controller.signal)
      return () => {
        controller.abort()
      }
    }

    setLoading(true)
    const timer = setTimeout(() => {
      const controller = new AbortController()
      searchAbortRef.current = controller
      api
        .listPages(controller.signal, { q: trimmed })
        .then((result) => {
          if (seq === searchSeqRef.current && !controller.signal.aborted) {
            setPages(result.pages)
            setLoading(false)
            setError(null)
          }
        })
        .catch((err: Error) => {
          if (
            seq === searchSeqRef.current &&
            !controller.signal.aborted &&
            err.name !== 'AbortError'
          ) {
            setError(err.message)
            setLoading(false)
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [searchQuery, loadPages])

  useEffect(() => {
    if (selectedPage) {
      const updated = pages.find((p) => p.id === selectedPage.id) ?? null
      if (updated && updated.updatedAt !== selectedPage.updatedAt) {
        setSelectedPage(updated)
      }
      if (!updated) {
        setSelectedPage(null)
      }
    }
  }, [pages, selectedPage])

  const selectPage = useCallback(
    (id: string | null) => {
      if (id === null) {
        setSelectedPage(null)
        return
      }
      const page = pages.find((p) => p.id === id) ?? null
      setSelectedPage(page)
    },
    [pages]
  )

  const refreshPages = useCallback(() => {
    const controller = new AbortController()
    loadPages(searchQuery.trim() || undefined, controller.signal)
  }, [loadPages, searchQuery])

  const scheduleReset = useCallback(() => {
    if (mutationTimeoutRef.current) {
      clearTimeout(mutationTimeoutRef.current)
    }
    mutationTimeoutRef.current = setTimeout(() => {
      setMutationStatus('idle')
      setMutationError(null)
    }, 2000)
  }, [])

  const createPage = useCallback(
    async (title: string, pageType: PageType): Promise<Page | null> => {
      setMutationStatus('saving')
      setMutationError(null)
      try {
        const page = await api.createPage({ title, pageType })
        // Insert into the local list BEFORE refreshing: the selection-sync
        // effect clears selectedPage whenever the list lacks its id, so a
        // bare refreshPages() would bounce the user back to the dashboard
        // while the refetch is in flight.
        setPages((prev) => [page, ...prev.filter((p) => p.id !== page.id)])
        setSelectedPage(page)
        setMutationStatus('saved')
        scheduleReset()
        refreshPages()
        return page
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create page'
        setMutationStatus('error')
        setMutationError(message)
        return null
      }
    },
    [refreshPages, scheduleReset]
  )

  const savePageContent = useCallback(
    async (id: string, content: string): Promise<boolean> => {
      try {
        const updated = await api.updatePage(id, { content })
        // Merge the server-returned page so a later reopen (without a full
        // reload) reads the persisted content, not a stale list snapshot.
        setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        setSelectedPage((prev) => (prev && prev.id === updated.id ? updated : prev))
        return true
      } catch {
        return false
      }
    },
    []
  )

  const renamePage = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      setMutationStatus('saving')
      setMutationError(null)
      try {
        await api.updatePage(id, { title })
        setMutationStatus('saved')
        scheduleReset()
        refreshPages()
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to rename page'
        setMutationStatus('error')
        setMutationError(message)
        return false
      }
    },
    [refreshPages, scheduleReset]
  )

  const duplicatePage = useCallback(
    async (id: string): Promise<Page | null> => {
      setMutationStatus('saving')
      setMutationError(null)
      try {
        const page = await api.duplicatePage(id)
        setPages((prev) => [page, ...prev.filter((p) => p.id !== page.id)])
        setSelectedPage(page)
        setMutationStatus('saved')
        scheduleReset()
        refreshPages()
        return page
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to duplicate page'
        setMutationStatus('error')
        setMutationError(message)
        return null
      }
    },
    [refreshPages, scheduleReset]
  )

  const deletePage = useCallback(
    async (id: string): Promise<boolean> => {
      setMutationStatus('saving')
      setMutationError(null)
      try {
        await api.deletePage(id)
        setMutationStatus('saved')
        scheduleReset()
        if (selectedPage?.id === id) {
          setSelectedPage(null)
        }
        refreshPages()
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete page'
        setMutationStatus('error')
        setMutationError(message)
        return false
      }
    },
    [refreshPages, scheduleReset, selectedPage]
  )

  return {
    pages,
    selectedPage,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    selectPage,
    createPage,
    savePageContent,
    renamePage,
    duplicatePage,
    deletePage,
    mutationStatus,
    mutationError,
    refreshPages
  }
}
