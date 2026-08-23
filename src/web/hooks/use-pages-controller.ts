import type { Page, PageType } from '@rtwiki/shared/contracts/pages'
import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../config/index.js'
import type { MoveReconciliation } from '../services/pages-api.js'
import * as api from '../services/pages-api.js'

export type MutationStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Pure optimistic arrangement for a positional move: mirrors the server's
 * final-index-after-removal semantics so the UI does not wait for the
 * round trip. The authoritative reconciliation replaces this afterwards.
 */
export function arrangeOptimisticMove(
  pages: Page[],
  id: string,
  newParentId: string | null,
  newPosition: number
): Page[] {
  const moved = pages.find((p) => p.id === id)
  if (!moved) return pages
  const originParentId = moved.parentId ?? null
  const others = pages.filter((p) => p.id !== id)

  // Destination siblings (excluding the moved page), insert at the clamped slot.
  const destination = others
    .filter((p) => (p.parentId ?? null) === newParentId)
    .sort((a, b) => a.position - b.position)
  const clamped = Math.max(0, Math.min(newPosition, destination.length))
  const destinationPositions = new Map<string, number>()
  destination.forEach((page, index) => {
    destinationPositions.set(page.id, index)
  })

  // Remaining origin siblings compact back to contiguous positions.
  const originPositions = new Map<string, number>()
  if (newParentId !== originParentId) {
    const remainingOrigin = others
      .filter((p) => (p.parentId ?? null) === originParentId && !destinationPositions.has(p.id))
      .sort((a, b) => a.position - b.position)
    remainingOrigin.forEach((page, index) => {
      originPositions.set(page.id, index)
    })
  }

  return pages.map((page) => {
    if (page.id === id) {
      return { ...moved, parentId: newParentId, position: clamped }
    }
    const destinationPosition = destinationPositions.get(page.id)
    if (destinationPosition !== undefined) return { ...page, position: destinationPosition }
    const originPosition = originPositions.get(page.id)
    if (originPosition !== undefined) return { ...page, position: originPosition }
    return page
  })
}

export interface PagesController {
  pages: Page[]
  selectedPage: Page | null
  loading: boolean
  error: string | null
  searchQuery: string
  setSearchQuery: (query: string) => void
  selectPage: (id: string | null) => void
  createPage: (title: string, pageType: PageType) => Promise<Page | null>
  moveTo: (id: string, newParentId: string | null) => void
  moveRelative: (id: string, delta: number) => void
  createChild: (parentId: string) => Promise<void>
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

  /**
   * Applies an authoritative move reconciliation to local state: the moved
   * page plus both affected sibling position sets.
   */
  const applyMoveReconciliation = useCallback((result: MoveReconciliation): void => {
    setPages((prev) => {
      const positions = new Map<string, number>()
      for (const s of result.originSiblings) positions.set(s.id, s.position)
      for (const s of result.destinationSiblings) positions.set(s.id, s.position)
      return prev.map((page) => {
        if (page.id === result.movedPage.id) return result.movedPage
        const position = positions.get(page.id)
        return position === undefined ? page : { ...page, position }
      })
    })
    setSelectedPage((prev) => (prev && prev.id === result.movedPage.id ? result.movedPage : prev))
  }, [])

  /** Reparents a page, appending it at the end of the destination children. */
  const moveTo = useCallback(
    (id: string, newParentId: string | null): void => {
      // Oversized positions clamp server-side to the destination end, which
      // is exactly the "append as last child" behaviour the menu promises.
      api
        .movePage(id, { newParentId, newPosition: Number.MAX_SAFE_INTEGER })
        .then(applyMoveReconciliation)
        .catch((err: Error) => {
          setMutationStatus('error')
          setMutationError(err.message)
          scheduleReset()
        })
    },
    [applyMoveReconciliation, scheduleReset]
  )

  /** Reorders a page among its own siblings by a relative step. */
  const moveRelative = useCallback(
    (id: string, delta: number): void => {
      const page = pages.find((p) => p.id === id)
      if (!page) return
      const siblings = pages
        .filter((p) => (p.parentId ?? null) === (page.parentId ?? null))
        .sort((a, b) => a.position - b.position)
      const index = siblings.findIndex((p) => p.id === id)
      const target = Math.min(Math.max(index + delta, 0), siblings.length - 1)
      if (target === index) return
      api
        .movePage(id, { newParentId: page.parentId, newPosition: target })
        .then(applyMoveReconciliation)
        .catch((err: Error) => {
          setMutationStatus('error')
          setMutationError(err.message)
          scheduleReset()
        })
    },
    [pages, applyMoveReconciliation, scheduleReset]
  )

  /**
   * Moves a page to an explicit destination position (drag-and-drop path).
   *
   * Applies the expected arrangement optimistically, then replaces local
   * state with the authoritative server reconciliation payload. On failure
   * the pre-move snapshot is restored (rollback) and the error status is
   * surfaced. The reconciliation maps by id onto the latest state, so a
   * late response can never clobber newer updates.
   */
  const moveToPosition = useCallback(
    (id: string, newParentId: string | null, newPosition: number): void => {
      let rollback: Page[] | null = null
      setPages((prev) => {
        rollback = prev
        return arrangeOptimisticMove(prev, id, newParentId, newPosition)
      })
      api
        .movePage(id, { newParentId, newPosition })
        .then(applyMoveReconciliation)
        .catch((err: Error) => {
          if (rollback) setPages(rollback)
          setMutationStatus('error')
          setMutationError(err.message)
          scheduleReset()
        })
    },
    [applyMoveReconciliation, scheduleReset]
  )

  /** Creates an untitled child under an existing parent and opens it. */
  const createChild = useCallback(async (parentId: string): Promise<void> => {
    try {
      const page = await api.createPage({
        title: UI_TEXT.untitledPage,
        pageType: 'rich',
        content: '',
        parentId
      })
      setPages((prev) => [...prev, page])
      setSelectedPage(page)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create page'
      setMutationStatus('error')
      setMutationError(message)
    }
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

  const savePageContent = useCallback(async (id: string, content: string): Promise<boolean> => {
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
  }, [])

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
    moveTo,
    moveRelative,
    moveToPosition,
    createChild,
    renamePage,
    duplicatePage,
    deletePage,
    mutationStatus,
    mutationError,
    refreshPages
  }
}
