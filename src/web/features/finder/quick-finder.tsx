import { Combobox, Modal, ScrollArea, Text, TextInput, useCombobox } from '@mantine/core'
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
 * debounced so typing never blocks title results. Keyboard navigation is
 * Mantine's Combobox store (Up/Down/Enter over the option list); Escape closes
 * the Modal through an explicit handler, because Combobox's own Escape only
 * closes its dropdown and this finder has no dropdown — the list is always
 * visible inside the Modal.
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
  const [contentMatches, setContentMatches] = useState<Page[]>([])
  const [recents, setRecents] = useState<RecentPageEntry[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  // The list is always visible, so the Combobox store treats it as permanently
  // open. That makes its Arrow/Enter navigation active from the first keystroke.
  const combobox = useCombobox({ defaultOpened: true })

  // Fresh recents + reset state each time the finder opens.
  useEffect(() => {
    if (opened) {
      setRecents(loadRecentPages())
      setQuery('')
      setContentMatches([])
      combobox.resetSelectedOption()
    }
    // resetSelectedOption is a stable handler from useCombobox.
  }, [opened, combobox.resetSelectedOption])

  // Debounced content search against the existing endpoint; never blocks
  // title results (those render synchronously from `pages`). The cancelled
  // flag guards against a stale response overwriting a newer query.
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

  // Keep the Combobox selection index valid as the option list changes. When
  // nothing is selected yet, select the first option so Enter opens the first
  // result immediately — the original finder highlighted row 0 on open. The
  // signature is read inside the effect so the dependency is genuine.
  const rowsSignature = rows.map((row) => row.page.id).join('|')
  useEffect(() => {
    void rowsSignature
    if (combobox.getSelectedOptionIndex() === -1 && rows.length > 0) {
      combobox.selectFirstOption()
    } else {
      combobox.updateSelectedOptionIndex()
    }
  }, [
    rowsSignature,
    rows.length,
    combobox.getSelectedOptionIndex,
    combobox.selectFirstOption,
    combobox.updateSelectedOptionIndex
  ])

  const openRow = (row: FinderRow | undefined): void => {
    if (!row) return
    onClose()
    onOpenPage(row.page.id)
  }

  const groupLabel = (group: FinderRow['group']): string =>
    group === 'recent'
      ? UI_TEXT.quickFinderRecentGroup
      : group === 'title'
        ? UI_TEXT.quickFinderTitleGroup
        : UI_TEXT.quickFinderContentGroup

  let lastGroup: FinderRow['group'] | null = null

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
      <Combobox
        store={combobox}
        onOptionSubmit={(value) => {
          openRow(rows.find((row) => row.page.id === value))
        }}
      >
        <Combobox.EventsTarget>
          <TextInput
            ref={inputRef}
            leftSection={<IconSearch size={14} />}
            placeholder={UI_TEXT.quickFinderSearchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Combobox's Escape only closes its (always-open) dropdown; the
              // finder must close the Modal itself.
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            data-testid="quick-finder-input"
            aria-label={UI_TEXT.quickFinderSearchPlaceholder}
            // BOTH are required, and `autoFocus` alone is not sufficient.
            //
            // Mantine's `Modal` wraps its content in a focus trap
            // (`useFocusTrap`, node_modules/@mantine/hooks) that picks an initial
            // target on a `setTimeout(0)`, i.e. one macrotask AFTER React has
            // already applied `autoFocus`. Its selection is: an element carrying
            // `data-autofocus`, else the first tabbable descendant. This Modal
            // renders a title, so `withCloseButton` defaults to true and the close
            // button precedes the body in DOM order - it was therefore first
            // tabbable, and the trap moved focus onto the CLOSE BUTTON.
            //
            // That is not cosmetic. The search box then never received keystrokes,
            // a Space in a search term activated the focused close button (a
            // `<button>` is activated by Space), which called `onClose` and
            // unmounted the finder mid-word; the rest of the word was typed into
            // the document behind it and autosaved. `data-autofocus` is Mantine's
            // documented way to state the intended target, and it makes the trap
            // agree with `autoFocus` instead of overriding it. `autoFocus` stays as
            // the fallback for the (unused) no-trap case.
            data-autofocus
            autoFocus
          />
        </Combobox.EventsTarget>
        <ScrollArea.Autosize mah={LAYOUT.panelMaxHeight} type="always" scrollbars="y">
          <Combobox.Options
            className={classes.results}
            aria-label={UI_TEXT.quickFinderTitle}
            data-testid="quick-finder-results"
          >
            {rows.length === 0 ? (
              <Text size="sm" c="dimmed" p="sm" role="status">
                {UI_TEXT.quickFinderEmptyLabel}
              </Text>
            ) : (
              rows.map((row) => {
                const showGroup = row.group !== lastGroup
                lastGroup = row.group
                return (
                  <div key={row.page.id}>
                    {showGroup ? (
                      <Text size="xs" fw={600} c="dimmed" className={classes.groupLabel}>
                        {groupLabel(row.group)}
                      </Text>
                    ) : null}
                    <Combobox.Option
                      value={row.page.id}
                      className={classes.resultItem}
                      data-testid={`quick-finder-option-${row.page.id}`}
                      onMouseEnter={() => combobox.selectOption(rows.indexOf(row))}
                    >
                      {row.page.title || UI_TEXT.untitledPage}
                    </Combobox.Option>
                  </div>
                )
              })
            )}
          </Combobox.Options>
        </ScrollArea.Autosize>
      </Combobox>
    </Modal>
  )
}
