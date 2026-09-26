import { Tooltip } from '@mantine/core'
import { IconLayoutSidebar } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { LAYOUT, UI_TEXT } from '../../config/index.js'
import { useMediaQueryBelow } from '../../hooks/use-media-query.js'
import { PaneDivider } from '../../layout/pane-divider.js'
import type { DocumentOutlineEntry } from '../rich-editor/document.js'
import { loadLayoutPreferences, saveLayoutPreferences } from './layout-preferences.js'
import { RightSidebar } from './right-sidebar.js'
import classes from './right-sidebar.module.css'

/**
 * The document's right-hand region: a resizable sidebar, or the button that
 * brings it back.
 *
 * Extracted so every page type gets the same pane with the same behaviour. This
 * code previously lived inline in the Rich editor, which is precisely why the
 * Markdown and diagram pages had no sidebar: it existed, was correct, and was
 * unreachable from anywhere else. Duplicating it per page type would have
 * preserved that trap, so there is one owner instead.
 *
 * Geometry is the reader's, stored in `layout-preferences` and therefore shared
 * across page types: someone who sized the pane on a Rich Note gets the same
 * size on a diagram.
 */
export interface RightSidebarRegionProps {
  pageId: string
  /** Heading outline, or omitted for a page type that has no headings. */
  outline?: DocumentOutlineEntry[]
  pageTypeLabel: string
  createdDate: string
  updatedDate: string
  onNavigateToHeading?: (blockId: string) => void
  onOpenPage?: (pageId: string) => void
}

/**
 * Below this width the three panes cannot all fit, so the sidebar collapses for
 * the session only. Derived from the pane minimums rather than a fixed
 * breakpoint, so it cannot drift from the layout it is protecting.
 */
const TEMP_COLLAPSE_MAX_WIDTH_PX =
  LAYOUT.treePaneMinWidth + LAYOUT.workspaceMinWidth + LAYOUT.rightSidebarMinWidth - 1

export function RightSidebarRegion(props: RightSidebarRegionProps): JSX.Element {
  const { pageId, outline, pageTypeLabel, createdDate, updatedDate } = props

  const [width, setWidth] = useState(() => loadLayoutPreferences().rightSidebarWidth)
  const [explicitCollapsed, setExplicitCollapsed] = useState(
    () => loadLayoutPreferences().rightSidebarCollapsed
  )
  // Session-only override so a narrow window can be widened without disturbing
  // the reader's saved choice. Dropped as soon as the viewport leaves the narrow
  // state, so the derived rule governs fresh afterwards.
  const [narrowOverride, setNarrowOverride] = useState(false)
  const narrowCollapse = useMediaQueryBelow(TEMP_COLLAPSE_MAX_WIDTH_PX)

  useEffect(() => {
    if (!narrowCollapse) setNarrowOverride(false)
  }, [narrowCollapse])

  const collapsed = explicitCollapsed || (narrowCollapse && !narrowOverride)

  const persist = useCallback(
    (patch: { rightSidebarWidth?: number; rightSidebarCollapsed?: boolean }): void => {
      saveLayoutPreferences({ ...loadLayoutPreferences(), ...patch })
    },
    []
  )

  const collapse = useCallback((): void => {
    setExplicitCollapsed(true)
    persist({ rightSidebarCollapsed: true })
  }, [persist])

  const expand = useCallback((): void => {
    // Two different causes need two different responses. An explicit collapse is
    // cleared outright. A temporary narrow-window collapse is overridden for this
    // session only and must not rewrite the saved preference, or merely resizing
    // the window would silently discard the reader's choice.
    if (explicitCollapsed) {
      setExplicitCollapsed(false)
      persist({ rightSidebarCollapsed: false })
    } else {
      setNarrowOverride(true)
    }
  }, [explicitCollapsed, persist])

  // Persisted on commit, not on every drag frame: the divider reports continuous
  // changes, and writing storage on each one is both wasteful and pointless.
  const commitWidth = useCallback(
    (next: number): void => {
      setWidth(next)
      persist({ rightSidebarWidth: next })
    },
    [persist]
  )

  const expandLabel = explicitCollapsed ? UI_TEXT.rightSidebarLabel : UI_TEXT.restoreSidebarLabel

  return (
    <>
      {collapsed ? (
        <Tooltip label={expandLabel} position="left">
          <button
            type="button"
            className={classes.expandButton}
            aria-label={expandLabel}
            onClick={expand}
          >
            <IconLayoutSidebar size={16} />
          </button>
        </Tooltip>
      ) : (
        <>
          <PaneDivider
            value={width}
            min={LAYOUT.rightSidebarMinWidth}
            max={LAYOUT.rightSidebarMaxWidth}
            direction={-1}
            onChange={setWidth}
            onCommit={commitWidth}
            ariaLabel={UI_TEXT.resizeSidebarLabel}
            testId="sidebar-divider"
          />
          <RightSidebar
            // Remounted per page so the backlinks fetch starts from the new page
            // rather than showing the previous one's list while it loads.
            key={pageId}
            width={width}
            outline={outline}
            pageTypeLabel={pageTypeLabel}
            createdDate={createdDate}
            updatedDate={updatedDate}
            pageId={pageId}
            onNavigateToHeading={props.onNavigateToHeading}
            onOpenPage={props.onOpenPage}
            onCollapse={collapse}
          />
        </>
      )}
    </>
  )
}
