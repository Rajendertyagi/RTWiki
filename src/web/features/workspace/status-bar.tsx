import { Button, Group, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { UI_TEXT } from '../../config/index.js'
import classes from './status-bar.module.css'

export type StatusSaveState = 'clean' | 'saving' | 'saved' | 'error'

interface StatusBarProps {
  /** Compact page-type label shown on the left (e.g. "Rich Note"). */
  pageTypeLabel: string
  /** Full location path of the open page (e.g. "Ren Parent / Child"), shown
   *  on the left. Replaces the old above-content breadcrumb. */
  pagePath?: string
  saveState: StatusSaveState
  /** Underlying error detail shown only on failure (avoids duplicate text). */
  saveError?: string | null
  onRetry?: () => void
  /** Type-specific fields rendered between the type label and the save state. */
  children?: ReactNode
}

/**
 * Compact, single-line workspace status bar. Pinned at the bottom of every
 * page workspace; it stays visible while content scrolls. At narrow widths it
 * scrolls horizontally rather than wrapping taller. Save-state changes are
 * announced politely. Sits below all portal/menu overlays (no z-index set, so
 * floating layers at LAYOUT.overlayZIndex paint above it).
 */
export function StatusBar({
  pageTypeLabel,
  pagePath,
  saveState,
  saveError,
  onRetry,
  children
}: StatusBarProps): JSX.Element {
  const saveLabel =
    saveState === 'saving'
      ? UI_TEXT.saveStatusSaving
      : saveState === 'error'
        ? UI_TEXT.saveStatusError
        : UI_TEXT.saveStatusSaved
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
        {pagePath ? (
          <Text size="xs" c="dimmed" className={classes.pagePath} aria-label={UI_TEXT.pageLocationLabel}>
            {pagePath}
          </Text>
        ) : null}
        {children}
      </div>
      <Group gap="xs" wrap="nowrap" className={classes.right}>
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
