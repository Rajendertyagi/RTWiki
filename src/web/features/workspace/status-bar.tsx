import { ActionIcon, Button, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core'
import type { Page } from '@rtwiki/shared/contracts/pages'
import { IconArrowBackUp, IconArrowUpRight, IconHome, IconInfoCircle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Fragment, useEffect, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { getBacklinks, getOutgoingLinks } from '../../services/pages-api.js'
import { formatDate, formatRelativeTime } from '../../util/format-date.js'
import { pagePlainText } from '../../util/page-preview-text.js'
import classes from './status-bar.module.css'

export type StatusSaveState = 'clean' | 'pending' | 'saving' | 'saved' | 'error'

interface StatusBarProps {
  /** Compact page-type label shown on the left (e.g. "Rich Note"). */
  pageTypeLabel: string
  /** Ancestor chain (excluding the open page) for the clickable breadcrumb.
   *  Mirrors Trilium's status-bar breadcrumb of links to parent notes. */
  breadcrumb?: Array<{ id: string; title: string }>
  /** Navigates to the dashboard / home (Trilium's root breadcrumb icon). */
  onHome?: () => void
  /** True when the dashboard is the active view; colours the home icon like
   *  the utility rail / sidebar (blue when active, gray otherwise). */
  activeHome?: boolean
  saveState: StatusSaveState
  /** Underlying error detail shown only on failure (avoids duplicate text). */
  saveError?: string | null
  onRetry?: () => void
  /** The open page; drives the Trilium-style metadata (words, modified,
   *  backlinks, note-info). Omitted on the dashboard / ready state. */
  page?: Page | null
  /** Navigates to a page (used by the backlinks dropdown). */
  onOpenPage?: (pageId: string) => void
  /** Type-specific fields rendered between the type label and the actions. */
  children?: ReactNode
}

interface InfoRowProps {
  label: string
  value: ReactNode
}

function InfoRow({ label, value }: InfoRowProps): JSX.Element {
  return (
    <Group justify="space-between" gap="md" wrap="nowrap" className={classes.infoRow}>
      <Text size="xs" c="dimmed" className={classes.infoLabel}>
        {label}
      </Text>
      <Text size="xs" className={classes.infoValue}>
        {value}
      </Text>
    </Group>
  )
}

/**
 * Compact, single-line workspace status bar. Pinned at the bottom of every
 * page workspace; it stays visible while content scrolls. At narrow widths it
 * scrolls horizontally rather than wrapping taller. Save-state changes are
 * announced politely. Sits below all portal/menu overlays (no z-index set, so
 * floating layers at LAYOUT.overlayZIndex paint above it).
 *
 * Mirrors Trilium's bottom bar: a breadcrumb-style path on the left and a row
 * of metadata actions on the right — word/character count, last-modified time,
 * a backlinks dropdown listing the pages that link here, a note-info popover,
 * and the save state.
 */
export function StatusBar({
  pageTypeLabel,
  breadcrumb,
  onHome,
  activeHome,
  saveState,
  saveError,
  onRetry,
  page,
  onOpenPage,
  children
}: StatusBarProps): JSX.Element {
  // 'pending' is deliberately distinct from 'clean'. Autosave is debounced, so
  // there is a window in which an edit exists but no save has run yet. Folding
  // that window into 'clean' made the bar announce "Saved" for work that was
  // still only in memory, which is the one thing a save indicator must never do.
  const saveLabel =
    saveState === 'saving'
      ? UI_TEXT.saveStatusSaving
      : saveState === 'error'
        ? UI_TEXT.saveStatusError
        : saveState === 'pending'
          ? UI_TEXT.saveStatusPending
          : UI_TEXT.saveStatusSaved

  const text = page ? pagePlainText(page) : ''
  const showWordCount =
    page != null &&
    (page.pageType === 'rich' || page.pageType === 'markdown' || page.pageType === 'html') &&
    text.length > 0
  const wordCount = showWordCount ? text.trim().split(/\s+/).filter(Boolean).length : 0
  const charCount = text.length

  // Backlinks: fetched per open page, surfaced as a clickable dropdown that
  // lists the pages linking here (Trilium's BacklinksBadge pattern).
  const [backlinks, setBacklinks] = useState<Array<{ id: string; title: string }> | null>(null)
  useEffect(() => {
    if (!page) {
      setBacklinks(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setBacklinks(null)
    getBacklinks(page.id, controller.signal)
      .then((entries) => {
        if (!cancelled) {
          setBacklinks(entries.map((e) => ({ id: e.id, title: e.title })))
        }
      })
      .catch(() => {
        if (!cancelled) setBacklinks([])
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [page])

  const backlinkCount = backlinks?.length ?? 0

  // Outgoing links: pages this page points to (Trilium's link relationships),
  // surfaced as a clickable dropdown like the backlinks one.
  const [outgoing, setOutgoing] = useState<Array<{ id: string; title: string }> | null>(null)
  useEffect(() => {
    if (!page) {
      setOutgoing(null)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setOutgoing(null)
    getOutgoingLinks(page.id, controller.signal)
      .then((entries) => {
        if (!cancelled) {
          setOutgoing(entries.map((e) => ({ id: e.id, title: e.title })))
        }
      })
      .catch(() => {
        if (!cancelled) setOutgoing([])
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [page])

  const outgoingCount = outgoing?.length ?? 0
  const modifiedRelative = page ? formatRelativeTime(page.updatedAt) : ''
  const modifiedAbsolute = page ? formatDate(page.updatedAt) : ''
  const pathString = page
    ? [...(breadcrumb ?? []).map((b) => b.title), page.title || UI_TEXT.untitledPage].join(' / ')
    : undefined

  return (
    <div
      className={classes.bar}
      role="status"
      aria-live="polite"
      data-testid="workspace-status-bar"
    >
      <div className={classes.left}>
        <Text size="xs" c="dimmed" className={classes.typeLabel}>
          {pageTypeLabel}
        </Text>
        {page ? (
          <nav className={classes.breadcrumb} aria-label={UI_TEXT.pageLocationLabel}>
            <ActionIcon
              variant={activeHome ? 'filled' : 'subtle'}
              color={activeHome ? 'blue' : 'gray'}
              size="sm"
              onClick={() => onHome?.()}
              aria-label={UI_TEXT.utilityRailHome}
              aria-current={activeHome ? 'page' : undefined}
              className={classes.homeButton}
              data-testid="status-home"
            >
              <IconHome size={16} />
            </ActionIcon>
            {breadcrumb?.map((crumb) => (
              <Fragment key={crumb.id}>
                <UnstyledButton
                  className={classes.crumb}
                  onClick={() => onOpenPage?.(crumb.id)}
                  data-testid="status-crumb"
                >
                  {crumb.title}
                </UnstyledButton>
                <span className={classes.crumbSep} aria-hidden>
                  ›
                </span>
              </Fragment>
            ))}
            <span className={classes.crumbCurrent}>{page.title || UI_TEXT.untitledPage}</span>
          </nav>
        ) : null}
        {children}
      </div>

      <Group gap={2} wrap="nowrap" className={classes.actions}>
        {showWordCount ? (
          <Text
            size="xs"
            c="dimmed"
            className={classes.field}
            title={`${UI_TEXT.statusWordsLabel}: ${wordCount} · ${UI_TEXT.statusCharsLabel}: ${charCount}`}
            data-testid="status-word-count"
          >
            {UI_TEXT.statusWordChars
              .replace('{words}', String(wordCount))
              .replace('{chars}', String(charCount))}
          </Text>
        ) : null}

        {page ? (
          <Text
            size="xs"
            c="dimmed"
            className={classes.field}
            title={`${UI_TEXT.statusModifiedLabel}: ${modifiedAbsolute}`}
            data-testid="status-modified"
          >
            {modifiedRelative}
          </Text>
        ) : null}

        {backlinkCount > 0 ? (
          <Popover position="top-end" withArrow shadow="md" withinPortal>
            <Popover.Target>
              <UnstyledButton
                className={classes.actionButton}
                data-testid="status-backlinks"
                aria-label={`${UI_TEXT.statusBacklinksLabel}: ${backlinkCount}`}
                title={`${UI_TEXT.statusBacklinksLabel}: ${backlinkCount}`}
              >
                <IconArrowBackUp size={14} stroke={1.75} />
                <span className={classes.actionText}>
                  {backlinkCount} {UI_TEXT.statusBacklinksLabel}
                </span>
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown className={classes.backlinksDropdown}>
              <Text size="xs" fw={600} c="dimmed" className={classes.dropdownHeader}>
                {UI_TEXT.backlinksHeading}
              </Text>
              <Stack gap={2} className={classes.backlinksList}>
                {backlinks?.map((entry) => (
                  <UnstyledButton
                    key={entry.id}
                    className={classes.backlinkItem}
                    data-testid="status-backlink-entry"
                    onClick={() => onOpenPage?.(entry.id)}
                  >
                    {entry.title || UI_TEXT.untitledPage}
                  </UnstyledButton>
                ))}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        ) : null}

        {outgoingCount > 0 ? (
          <Popover position="top-end" withArrow shadow="md" withinPortal>
            <Popover.Target>
              <UnstyledButton
                className={classes.actionButton}
                data-testid="status-links"
                aria-label={`${UI_TEXT.statusLinksLabel}: ${outgoingCount}`}
                title={`${UI_TEXT.statusLinksLabel}: ${outgoingCount}`}
              >
                <IconArrowUpRight size={14} stroke={1.75} />
                <span className={classes.actionText}>
                  {outgoingCount} {UI_TEXT.statusLinksLabel}
                </span>
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown className={classes.backlinksDropdown}>
              <Text size="xs" fw={600} c="dimmed" className={classes.dropdownHeader}>
                {UI_TEXT.statusLinksLabel}
              </Text>
              <Stack gap={2} className={classes.backlinksList}>
                {outgoing?.map((entry) => (
                  <UnstyledButton
                    key={entry.id}
                    className={classes.backlinkItem}
                    data-testid="status-link-entry"
                    onClick={() => onOpenPage?.(entry.id)}
                  >
                    {entry.title || UI_TEXT.untitledPage}
                  </UnstyledButton>
                ))}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        ) : null}

        {page ? (
          <Popover position="top-end" withArrow shadow="md" withinPortal>
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label={UI_TEXT.statusNoteInfoLabel}
                className={classes.actionButton}
                data-testid="status-note-info"
              >
                <IconInfoCircle size={15} stroke={1.75} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown className={classes.infoDropdown}>
              <Stack gap={4}>
                <InfoRow label={UI_TEXT.pageInfoType} value={pageTypeLabel} />
                <InfoRow label={UI_TEXT.pageInfoCreated} value={formatDate(page.createdAt)} />
                <InfoRow label={UI_TEXT.pageInfoUpdated} value={formatDate(page.updatedAt)} />
                {showWordCount ? (
                  <>
                    <InfoRow label={UI_TEXT.statusWordsLabel} value={wordCount} />
                    <InfoRow label={UI_TEXT.statusCharsLabel} value={charCount} />
                  </>
                ) : null}
                {backlinkCount > 0 ? (
                  <InfoRow label={UI_TEXT.statusBacklinksLabel} value={backlinkCount} />
                ) : null}
                {pathString ? <InfoRow label={UI_TEXT.statusPathLabel} value={pathString} /> : null}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        ) : null}

        {saveState === 'error' ? (
          <>
            <Text size="xs" c="red">
              {saveError ? `${saveLabel}: ${saveError}` : saveLabel}
            </Text>
            {onRetry ? (
              <Button
                size="compact-xs"
                variant="light"
                onClick={onRetry}
                data-testid="status-retry"
              >
                {UI_TEXT.saveStatusRetry}
              </Button>
            ) : null}
          </>
        ) : (
          <Text size="xs" c="dimmed" className={classes.saveState}>
            {saveLabel}
          </Text>
        )}
      </Group>
    </div>
  )
}
