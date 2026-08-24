import type { Page } from '@rtwiki/shared/contracts/pages'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildTree,
  type FlatRow,
  flattenVisible,
  type HtmlSubfileField,
  isSelfOrDescendant,
  nextTypeAheadMatch,
  parentMap
} from '../features/sidebar/tree-model.js'

const TYPE_AHEAD_RESET_MS = 500
const INDENT_CLAMP_LEVELS = 8

export interface UsePageTreeOptions {
  /** Living pages from the controller (read-only input). */
  pages: Page[]
  /** The currently open page id, owned by the page controller. Read-only. */
  activePageId: string | null
  /** Opens a page through the controller's existing selection flow. */
  onOpen: (id: string) => void
  /** Opens an HTML page's virtual source subfile in the central workspace. */
  onOpenHtmlSource: (pageId: string, field: HtmlSubfileField) => void
}

export interface UsePageTreeResult {
  rows: FlatRow[]
  focusedId: string | null
  expandedIds: ReadonlySet<string>
  // Mutable shape so composition sites can merge additional refs onto the
  // same element (drag-and-drop registration shares this container node).
  containerRef: { current: HTMLDivElement | null }
  handleTreeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  toggleExpand: (id: string) => void
  /** Force-expands a page's row without toggling. */
  expandPage: (id: string) => void
  focusRow: (id: string) => void
  /** Restores tree focus after structural changes; never opens a page. */
  restoreFocusAfterChange: (preferredId: string | null) => void
  /** True when candidateId is ancestorId itself or lives inside its subtree. */
  isSelfOrDescendantChecker: (ancestorId: string, candidateId: string) => boolean
}

/**
 * Owns the tree's keyboard-exploration state: focusedId, expansion and the
 * visible-row flattening. Deliberately does NOT own or mutate the active
 * page — arrow keys, Home/End and type-ahead move DOM focus only; Enter is
 * the sole keyboard path into the controller's selection flow.
 */
export function usePageTree(options: UsePageTreeOptions): UsePageTreeResult {
  const { pages, activePageId, onOpen, onOpenHtmlSource } = options

  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)
  const typeAheadRef = useRef({ buffer: '', expiresAt: 0 })

  const tree = useMemo(() => buildTree(pages), [pages])
  const parents = useMemo(() => parentMap(pages), [pages])
  const rows = useMemo(
    () => flattenVisible(tree, expandedIds, INDENT_CLAMP_LEVELS),
    [tree, expandedIds]
  )

  // Roving tabindex fallback: before any keyboard exploration, the open page
  // row (or the first row) participates in the tab order.
  const activeVisible = rows.some((r) => r.id === activePageId)
  const effectiveFocusedId =
    focusedId ?? (activeVisible ? activePageId : null) ?? rows[0]?.id ?? null

  const focusDomRow = useCallback((id: string): void => {
    const container = containerRef.current
    const el =
      container?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(id)}"]`) ??
      container?.querySelector<HTMLElement>(`[data-subfile-id="${CSS.escape(id)}"]`)
    el?.focus()
  }, [])

  const setFocusAndDom = useCallback(
    (id: string): void => {
      setFocusedId(id)
      // DOM focus follows immediately; the row carries tabindex=0 via the
      // roving-tabindex calculation.
      queueMicrotask(() => focusDomRow(id))
    },
    [focusDomRow]
  )

  const moveFocus = useCallback(
    (delta: number): void => {
      if (rows.length === 0) return
      const currentIndex = rows.findIndex((r) => r.id === effectiveFocusedId)
      const nextIndex =
        currentIndex < 0 ? 0 : Math.min(Math.max(currentIndex + delta, 0), rows.length - 1)
      setFocusAndDom(rows[nextIndex].id)
    },
    [rows, effectiveFocusedId, setFocusAndDom]
  )

  /** Force-expands a page row (used after creating a child beneath it). */
  const expandPage = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const toggleExpand = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAllSiblings = useCallback(
    (id: string): void => {
      const row = rows.find((r) => r.id === id)
      if (!row || row.subfile || !row.node) return
      const parentId = row.node.page.parentId ?? null
      const siblings = rows.filter(
        (r) => !r.subfile && r.node !== null && (r.node.page.parentId ?? null) === parentId
      )
      setExpandedIds((prev) => {
        const next = new Set(prev)
        for (const sibling of siblings) {
          if (sibling.node && sibling.node.children.length > 0) next.add(sibling.node.page.id)
        }
        return next
      })
    },
    [rows]
  )

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const key = event.key

      if (key === 'ArrowDown') {
        event.preventDefault()
        moveFocus(1)
        return
      }
      if (key === 'ArrowUp') {
        event.preventDefault()
        moveFocus(-1)
        return
      }
      if (key === 'Home') {
        event.preventDefault()
        if (rows.length > 0) setFocusAndDom(rows[0].id)
        return
      }
      if (key === 'End') {
        event.preventDefault()
        if (rows.length > 0) setFocusAndDom(rows[rows.length - 1].id)
        return
      }
      if (key === 'ArrowRight') {
        event.preventDefault()
        const row = rows.find((r) => r.id === effectiveFocusedId)
        if (!row || row.subfile || !row.node) return
        if (row.node.children.length > 0 && !row.expanded) {
          toggleExpand(row.id)
        } else if (row.node.children.length > 0) {
          moveFocus(1)
        }
        return
      }
      if (key === 'ArrowLeft') {
        event.preventDefault()
        const row = rows.find((r) => r.id === effectiveFocusedId)
        if (!row) return
        if (row.subfile) {
          // A subfile's logical parent is its HTML page.
          setFocusAndDom(row.subfile.pageId)
          return
        }
        if (!row.node) return
        if (row.expanded) {
          toggleExpand(row.id)
          return
        }
        const parentId = row.node.page.parentId
        if (parentId !== null && rows.some((r) => r.id === parentId)) {
          setFocusAndDom(parentId)
        }
        return
      }
      if (key === '*') {
        event.preventDefault()
        if (effectiveFocusedId) expandAllSiblings(effectiveFocusedId)
        return
      }
      if (key === 'Enter') {
        event.preventDefault()
        const row = rows.find((r) => r.id === effectiveFocusedId)
        if (!row) return
        if (row.subfile) {
          onOpenHtmlSource(row.subfile.pageId, row.subfile.field)
        } else {
          onOpen(row.id)
        }
        return
      }

      // Type-ahead: printable single characters accumulate into a buffer.
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now()
        const state = typeAheadRef.current
        const buffer = now <= state.expiresAt ? state.buffer + key : key
        typeAheadRef.current = { buffer, expiresAt: now + TYPE_AHEAD_RESET_MS }

        const labels = rows.map((r) => (r.subfile ? r.subfile.label : (r.node?.page.title ?? '')))
        const startIndex = Math.max(
          0,
          rows.findIndex((r) => r.id === effectiveFocusedId)
        )
        const matchIndex = nextTypeAheadMatch(labels, buffer, startIndex)
        if (matchIndex >= 0) setFocusAndDom(rows[matchIndex].id)
        event.preventDefault()
      }
    },
    [
      rows,
      effectiveFocusedId,
      moveFocus,
      setFocusAndDom,
      toggleExpand,
      expandAllSiblings,
      onOpen,
      onOpenHtmlSource
    ]
  )

  /**
   * Focus restoration after structural operations. Falls back to the active
   * page row, then the first visible row. Never opens anything.
   */
  const restoreFocusAfterChange = useCallback(
    (preferredId: string | null): void => {
      const target =
        (preferredId !== null && rows.some((r) => r.id === preferredId) ? preferredId : null) ??
        (activePageId !== null && rows.some((r) => r.id === activePageId) ? activePageId : null) ??
        rows[0]?.id ??
        null
      if (target) setFocusAndDom(target)
    },
    [rows, activePageId, setFocusAndDom]
  )

  // Keep DOM focus attached to the correct row when the visible set changes
  // (expand/collapse, external refetches) without stealing focus from other UI.
  useEffect(() => {
    if (
      focusedId !== null &&
      containerRef.current !== null &&
      document.activeElement !== null &&
      containerRef.current.contains(document.activeElement)
    ) {
      const stillVisible = rows.some((r) => r.id === focusedId)
      if (!stillVisible && rows.length > 0) {
        setFocusedId(rows[0].id)
      }
    }
  }, [rows, focusedId])

  return {
    rows,
    focusedId: effectiveFocusedId,
    expandedIds,
    containerRef,
    handleTreeKeyDown,
    toggleExpand,
    expandPage,
    focusRow: setFocusAndDom,
    restoreFocusAfterChange,
    isSelfOrDescendantChecker: (ancestorId: string, candidateId: string): boolean =>
      isSelfOrDescendant(parents, ancestorId, candidateId)
  }
}
