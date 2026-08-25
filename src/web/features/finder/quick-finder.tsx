import { Modal, Text, TextInput } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconSearch } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { listPages } from '../../services/pages-api.js'
import {
  loadRecentPages,
  type RecentPageEntry,
  resolveRecentPages
} from '../../util/recent-pages.js'
import classes from './quick-finder.module.css'

/**
 * Global Ctrl+K page finder.
 *
 * Groups results as Recent / Title matches / Content matches with
 * deduplication across groups. Title matching is immediate over the loaded
 * page collection; content matching reuses the existing search endpoint,
 * debounced so typing never blocks title results. Keyboard-first: Up/Down
 * navigate a flat highlight order, Enter opens through the controller flow,
 * Escape closes and leaves no overlay behind (Mantine unmounts on close).
 *
 * Ctrl+K conflict rule: the installed CodeMirror keymaps (default, history,
 * search, fold, close-brackets) bind no Mod-K combination, so the finder is
 * safe to open globally, including while editing source files.
 */

export interface QuickFinderProps {
  opened: boolean
  onClose: () => void
  pages: Page[]
  /** Opens a page through the controller/tab flow (flushes pending edits). */
  onOpenPage: (pageId: string) => void
}

interface FinderRow {
  page: Page
  group: 'recent' | 'title' | 'content'
}

const MAX_PER_GROUP = 6

export function QuickFinder({ opened, onClose, pages, onOpenPage }: QuickFinderProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [contentMatches, setContentMatches] = useState<Page[]>([])
  const [recents, setRecents] = useState<RecentPageEntry[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Fresh recents + reset state each time the finder opens.
  useEffect(() => {
    if (opened) {
      setRecents(loadRecentPages())
      setQuery('')
      setActiveIndex(0)
      setContentMatches([])
    }
  }, [opened])

  // Debounced content search against the existing endpoint; never blocks
  // title results (those render synchronously from `pages`).
  useEffect(() => {
    if (!opened) return
    const q = query.trim()
    if (q === '') {
      setContentMatches([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      listPages(undefined, { q })
        .then((result) => {
          if (!cancelled) setContentMatches(result.pages.slice(0, MAX_PER_GROUP))
        })
        .catch(() => {
          if (!cancelled) setContentMatches([])
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, opened])

  const rows = useMemo<FinderRow[]>(() => {
    const q = query.trim().toLowerCase()
    const seen = new Set<string>()
    const out: FinderRow[] = []

    const push = (page: Page | undefined, group: FinderRow['group']): void => {
      if (!page || seen.has(page.id)) return
      seen.add(page.id)
      out.push({ page, group })
    }

    // 1) Recent (filtered by query when one is active).
    for (const page of resolveRecentPages(recents, pages)) {
      if (out.length >= MAX_PER_GROUP && q === '') break
      if (q === '' || page.title.toLowerCase().includes(q)) push(page, 'recent')
    }

    // 2) Title matches.
    let titleCount = 0
    for (const page of pages) {
      if (titleCount >= MAX_PER_GROUP) break
      if (q === '' || page.title.toLowerCase().includes(q)) {
        titleCount += 1
        push(page, 'title')
      }
    }

    // 3) Content matches (from the debounced endpoint).
    for (const page of contentMatches) {
      if (out.length >= MAX_PER_GROUP * 3) break
      push(page, 'content')
    }

    return out
  }, [pages, recents, query, contentMatches])

  const openRow = (row: FinderRow | undefined): void => {
    if (!row) return
    onClose()
    onOpenPage(row.page.id)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openRow(rows[activeIndex])
    }
  }

  const groupLabel = (group: FinderRow['group']): string =>
    group === 'recent'
      ? UI_TEXT.quickFinderRecentGroup
      : group === 'title'
        ? UI_TEXT.quickFinderTitleGroup
        : UI_TEXT.quickFinderContentGroup

  let lastGroup: FinderRow['group'] | null = null
  let renderIndex = -1

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={UI_TEXT.quickFinderTitle}
      centered
      withinPortal
      zIndex={LAYOUT.overlayZIndex}
      size="md"
      // Unmount content on close so no overlay or focus trap can linger.
      keepMounted={false}
    >
      <TextInput
        ref={inputRef}
        leftSection={<IconSearch size={14} />}
        placeholder={UI_TEXT.quickFinderSearchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        data-testid="quick-finder-input"
        aria-label={UI_TEXT.quickFinderSearchPlaceholder}
        autoFocus
      />
      <div
        className={classes.results}
        role="listbox"
        aria-label={UI_TEXT.quickFinderTitle}
        data-testid="quick-finder-results"
      >
        {rows.length === 0 ? (
          <Text size="sm" c="dimmed" p="sm" role="status">
            {UI_TEXT.quickFinderEmptyLabel}
          </Text>
        ) : (
          rows.map((row) => {
            renderIndex += 1
            const index = renderIndex
            const showGroup = row.group !== lastGroup
            lastGroup = row.group
            return (
              <div key={row.page.id}>
                {showGroup ? (
                  <Text size="xs" fw={600} c="dimmed" className={classes.groupLabel}>
                    {groupLabel(row.group)}
                  </Text>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? `${classes.resultItem} ${classes.resultItemActive}`
                      : classes.resultItem
                  }
                  data-testid={`quick-finder-option-${row.page.id}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => openRow(row)}
                >
                  {row.page.title || UI_TEXT.untitledPage}
                </button>
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
