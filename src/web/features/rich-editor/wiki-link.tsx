import { ActionIcon, Box, Popover, TextInput, Tooltip } from '@mantine/core'
import { buildInternalLinkHref } from '@rtwiki/shared/schemas/page-links'
import { IconLink } from '@tabler/icons-react'
import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { debugLog, safeHash } from '../../diagnostics/debug-log.js'
import classes from './rich-editor.module.css'
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
 * Caret-attached picker used by the toolbar action. Same list semantics as
 * the `[[` suggestion menu: filter by title, keyboard navigable, explicit
 * empty state, never creates pages implicitly.
 */
export function WikiLinkToolbarAction({
  editor,
  pages
}: {
  editor: AnyRichEditor
  pages: LinkablePage[]
}): JSX.Element {
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(() => filterLinkablePages(pages, query), [pages, query])

  const pick = (page: LinkablePage): void => {
    insertWikiLink(editor, page)
    setOpened(false)
    setQuery('')
    setActiveIndex(0)
    editor.focus()
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withinPortal
      zIndex={LAYOUT.overlayZIndex}
      closeOnClickOutside
      trapFocus
    >
      <Popover.Target>
        <Tooltip label={UI_TEXT.wikiLinkLabel} position="bottom">
          <ActionIcon
            variant="subtle"
            aria-label={UI_TEXT.wikiLinkLabel}
            aria-haspopup="dialog"
            aria-expanded={opened}
            data-testid="wiki-link-button"
            onClick={() => setOpened((o) => !o)}
          >
            <IconLink size={16} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Box
          className={classes.wikiLinkPicker}
          data-testid="wiki-link-picker"
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
              } else if (event.key === 'Escape') {
                setOpened(false)
              }
            }}
            data-testid="wiki-link-search"
            autoFocus
          />
          {results.length === 0 ? (
            <div className={classes.wikiLinkEmpty} role="status">
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
                    index === activeIndex
                      ? `${classes.wikiLinkItem} ${classes.wikiLinkItemActive}`
                      : classes.wikiLinkItem
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
      </Popover.Dropdown>
    </Popover>
  )
}
