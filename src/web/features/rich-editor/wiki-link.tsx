import { Box, TextInput } from '@mantine/core'
import type { PageType } from '@rtwiki/shared/contracts/pages'
import { buildInternalLinkHref } from '@rtwiki/shared/schemas/page-links'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import type { AnyRichEditor } from './schema.js'

/**
 * Internal page links ("wiki links"): insertion UI.
 *
 * Two entry points share one picker: the always-visible toolbar action and
 * the `[[` caret suggestion menu. The stored target is always the page ID
 * (`rtwiki://page/<id>` href); the displayed text is the page title, or the
 * user's selected text when linking a selection.
 */

export interface LinkablePage {
  id: string
  title: string
  /** Page type for type-aware icons in link/card surfaces. */
  pageType?: PageType
  /** Short safe preview text for card surfaces. */
  preview?: string
}

export function filterLinkablePages(
  pages: LinkablePage[],
  query: string,
  excludeId?: string
): LinkablePage[] {
  const q = query.trim().toLowerCase()
  return pages
    .filter((p) => p.id !== excludeId)
    .filter((p) => (q === '' ? true : p.title.toLowerCase().includes(q)))
    .slice(0, 8)
}

/** Inserts (or applies to the selection) an internal link in the editor. */
export function insertWikiLink(editor: AnyRichEditor, page: LinkablePage): void {
  const href = buildInternalLinkHref(page.id)
  const title = page.title || 'Untitled'
  try {
    // Applies to the current text selection when there is one; otherwise
    // inserts the page title as the link text at the cursor.
    editor.createLink(href, title)
  } catch {
    editor.insertInlineContent([
      { type: 'link', href, content: [{ type: 'text', text: title, styles: {} }] },
      ' '
    ])
  }
  debugLog('ui', 'ui_context_menu_action', {
    targetId: page.id,
    code: 'wiki-link-insert',
    hash: safeHash(href)
  })
}

/**
 * The link picker, as panel contents with no trigger of its own.
 *
 * ## Why the trigger is gone
 *
 * This was `WikiLinkToolbarAction`: a `Popover` with its own target button, its
 * own open state, its own tooltip and its own `wiki-link-button` test id. That is
 * a second toolbar control, which is the thing the unified toolbar exists to
 * remove � and it survived the Rich Note migration only because the shell had not
 * yet claimed the linked-page capability.
 *
 * So the trigger belongs to `DocumentToolbar` and this is only the panel. The
 * list semantics are unchanged: filter by title, keyboard navigable with
 * Arrow/Enter/Escape, an explicit empty state, and pages are never created
 * implicitly.
 *
 * ## What is kept deliberately
 *
 * The `wiki-link-search`, `wiki-link-option-<n>` and `wiki-link-picker` test ids,
 * and the `listbox`/`option` roles. They are part of the project's existing test
 * surface, and they are the right roles for a filterable list � the combobox
 * pattern, not a menu.
 */
export function WikiLinkPanel({
  pages,
  onPick,
  testId,
  pickerClassName,
  emptyClassName,
  itemClassName,
  itemActiveClassName
}: {
  pages: LinkablePage[]
  /** Called with the chosen page. The caller closes the panel and refocuses. */
  onPick: (page: LinkablePage) => void
  /** Test id for the panel itself. */
  testId: string
  /** Presentation classes, passed in so this module owns no styling. */
  pickerClassName: string
  emptyClassName: string
  itemClassName: string
  itemActiveClassName: string
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(() => filterLinkablePages(pages, query), [pages, query])

  const pick = (page: LinkablePage): void => onPick(page)

  return (
    <Box
      className={pickerClassName}
      data-testid={testId}
      role="dialog"
      aria-label={UI_TEXT.wikiLinkLabel}
    >
      <TextInput
        placeholder={UI_TEXT.wikiLinkSearchPlaceholder}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((i) => Math.min(i + 1, results.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((i) => Math.max(i - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const page = results[activeIndex]
            if (page) pick(page)
          }
        }}
        data-testid="wiki-link-search"
        autoFocus
      />
      {results.length === 0 ? (
        <div className={emptyClassName} role="status">
          {UI_TEXT.wikiLinkEmptyLabel}
        </div>
      ) : (
        <div role="listbox" aria-label={UI_TEXT.wikiLinkLabel}>
          {results.map((page, index) => (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex ? `${itemClassName} ${itemActiveClassName}` : itemClassName
              }
              data-testid={`wiki-link-option-${index}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(page)}
            >
              {page.title || UI_TEXT.untitledPage}
            </button>
          ))}
        </div>
      )}
    </Box>
  )
}
