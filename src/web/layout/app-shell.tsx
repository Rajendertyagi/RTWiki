import { AppShell, Box, Burger } from '@mantine/core'
import { useState } from 'react'
import { LAYOUT, UI_TEXT } from '../config/index.js'
import classes from './app-shell.module.css'
import { PaneDivider } from './pane-divider.js'

interface AppShellLayoutProps {
  utilityRail: React.ReactNode
  navbar: React.ReactNode
  /** In-session document tabs rendered at the top of the central workspace. */
  tabStrip?: React.ReactNode
  /** Desktop-only page-tree visibility; owned by the composition root. */
  treeOpen: boolean
  /** Current desktop tree-pane width (persisted user preference; Slice 2). */
  treeWidth: number
  /** Live tree-width updates during divider drag (unsaved until commit). */
  onTreeWidthChange: (width: number) => void
  /** Divider pointer-up / keyboard commit (persist the width). */
  onTreeWidthCommit: (width: number) => void
  children: React.ReactNode
}

/**
 * Shell regions, outermost first:
 *   rail (full viewport height) -> page tree pane -> central workspace.
 *
 * There is deliberately no global header row: with no `header` prop the
 * Mantine navbar spans the full viewport height, so the launcher rail
 * starts at the very top of the screen. The tree pane is independently
 * collapsible on desktop; on mobile the drawer always exposes BOTH the
 * rail and the tree regardless of that collapsed state (the pane is only
 * hidden through a >=sm media query, never unmounted).
 */
export function AppShellLayout({
  utilityRail,
  navbar,
  tabStrip,
  treeOpen,
  treeWidth,
  onTreeWidthChange,
  onTreeWidthCommit,
  children
}: AppShellLayoutProps): JSX.Element {
  const [mobileNavOpened, setMobileNavOpened] = useState(false)

  return (
    <AppShell
      navbar={{
        // Mobile drawer keeps its own named width; desktop uses the persisted
        // tree width (or the rail alone when collapsed).
        width: { base: LAYOUT.mobileDrawerWidth, sm: treeOpen ? treeWidth : LAYOUT.railWidth },
        breakpoint: 'sm',
        collapsed: { mobile: !mobileNavOpened }
      }}
      // No shell padding: the tab strip must sit flush at the viewport top;
      // inner regions manage their own spacing.
      padding={0}
    >
      <AppShell.Navbar p={0}>
        <div className={classes.navbarInner}>
          <div className={classes.railColumn}>{utilityRail}</div>
          <div
            className={
              treeOpen
                ? classes.sidebarColumn
                : `${classes.sidebarColumn} ${classes.treeCollapsedDesktop}`
            }
          >
            {navbar}
          </div>
          {/* Tree divider: resizes the actual Mantine desktop navbar width.
              Rendered only while the tree is expanded; inert below sm via
              the shared divider CSS (mobile drawer owns navigation). */}
          {treeOpen ? (
            <PaneDivider
              value={treeWidth}
              min={LAYOUT.treePaneMinWidth}
              max={LAYOUT.treePaneMaxWidth}
              direction={1}
              onChange={onTreeWidthChange}
              onCommit={onTreeWidthCommit}
              ariaLabel={UI_TEXT.resizeTreePaneLabel}
              testId="tree-pane-divider"
            />
          ) : null}
        </div>
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>
        {/* Mobile-only nav affordance; desktop has the in-rail toggle. */}
        <Box className={classes.mobileBar} hiddenFrom="sm">
          <Burger
            opened={mobileNavOpened}
            onClick={() => setMobileNavOpened((o) => !o)}
            size="sm"
            aria-label={UI_TEXT.toggleNavigation}
          />
        </Box>
        {tabStrip}
        <div className={classes.mainContent}>{children}</div>
      </AppShell.Main>
    </AppShell>
  )
}
