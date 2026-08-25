import { ActionIcon, Divider, Stack, Text, Tooltip } from '@mantine/core'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { getBacklinks } from '../../services/pages-api.js'
import type { DocumentOutlineEntry } from '../rich-editor/document.js'
import classes from './right-sidebar.module.css'

export interface BacklinkEntryView {
  id: string
  title: string
  snippet: string | null
}

interface RightSidebarProps {
  outline: DocumentOutlineEntry[]
  pageTypeLabel: string
  createdDate: string
  updatedDate: string
  /** Page whose backlinks are listed; omitted on legacy callers. */
  pageId?: string
  onNavigateToHeading: (blockId: string) => void
  /** Opens a backlink source through the controller/tab flow. */
  onOpenPage?: (pageId: string) => void
  onCollapse: () => void
}

/**
 * Contextual right sidebar for an open Rich Note: heading outline,
 * ID-exact backlinks, and basic page information. Collapsible; the
 * document expands when hidden.
 */
export function RightSidebar({
  outline,
  pageTypeLabel,
  createdDate,
  updatedDate,
  pageId,
  onNavigateToHeading,
  onOpenPage,
  onCollapse
}: RightSidebarProps): JSX.Element {
  const [backlinks, setBacklinks] = useState<BacklinkEntryView[] | null>(null)
  const backlinksKeyRef = useRef<string | null>(null)

  // Backlinks are fetched per open page and refetched when the page changes.
  // A null list means "not loaded / not applicable"; errors degrade to the
  // empty state rather than blocking the sidebar.
  useEffect(() => {
    if (!pageId) {
      setBacklinks(null)
      return
    }
    // The cache key includes updatedDate so a save while the page is open
    // (link added/removed) refreshes the list without remounting.
    const cacheKey = `${pageId}:${updatedDate}`
    if (backlinksKeyRef.current === cacheKey) return
    backlinksKeyRef.current = cacheKey
    let cancelled = false
    setBacklinks(null)
    getBacklinks(pageId)
      .then((entries) => {
        if (!cancelled) setBacklinks(entries)
      })
      .catch(() => {
        if (!cancelled) setBacklinks([])
      })
    return () => {
      cancelled = true
    }
  }, [pageId, updatedDate])
  return (
    <aside className={classes.panel} aria-label={UI_TEXT.rightSidebarLabel}>
      <div className={classes.header}>
        <Text size="xs" fw={600} c="dimmed">
          {UI_TEXT.rightSidebarLabel}
        </Text>
        <Tooltip label={UI_TEXT.collapseSidebarLabel} position="left">
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={UI_TEXT.collapseSidebarLabel}
            onClick={onCollapse}
          >
            <IconLayoutSidebar size={16} />
          </ActionIcon>
        </Tooltip>
      </div>

      <div className={classes.scrollArea}>
        <Text size="xs" fw={600} c="dimmed" className={classes.sectionTitle}>
          {UI_TEXT.outlineTitle}
        </Text>
        {outline.length === 0 ? (
          <Text size="xs" c="dimmed" className={classes.emptyOutline}>
            {UI_TEXT.outlineEmpty}
          </Text>
        ) : (
          <Stack gap={2}>
            {outline.map((entry) => (
              <button
                key={entry.blockId}
                type="button"
                className={classes.outlineEntry}
                style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }}
                onClick={() => onNavigateToHeading(entry.blockId)}
              >
                {entry.text || UI_TEXT.untitledPage}
              </button>
            ))}
          </Stack>
        )}

        <Divider my="sm" />

        <Text size="xs" fw={600} c="dimmed" className={classes.sectionTitle}>
          {UI_TEXT.backlinksHeading}
        </Text>
        <div data-testid="backlinks-section">
          {backlinks !== null && backlinks.length > 0 ? (
            <Stack gap={2} data-testid="backlinks-list">
              {backlinks.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={classes.outlineEntry}
                  data-testid="backlink-entry"
                  onClick={() => onOpenPage?.(entry.id)}
                  title={entry.snippet ?? undefined}
                >
                  {entry.title || UI_TEXT.untitledPage}
                </button>
              ))}
            </Stack>
          ) : (
            <Text
              size="xs"
              c="dimmed"
              className={classes.emptyOutline}
              data-testid="backlinks-empty"
            >
              {UI_TEXT.backlinksEmptyLabel}
            </Text>
          )}
        </div>

        <Divider my="sm" />

        <Text size="xs" fw={600} c="dimmed" className={classes.sectionTitle}>
          {UI_TEXT.pageInfoTitle}
        </Text>
        <Stack gap={4} className={classes.infoBlock}>
          <Text size="xs">
            {UI_TEXT.pageInfoType}: {pageTypeLabel}
          </Text>
          <Text size="xs">
            {UI_TEXT.pageInfoCreated}: {createdDate}
          </Text>
          <Text size="xs">
            {UI_TEXT.pageInfoUpdated}: {updatedDate}
          </Text>
        </Stack>
      </div>
    </aside>
  )
}
