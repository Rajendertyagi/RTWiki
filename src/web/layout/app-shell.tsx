import { AppShell, Box, Burger } from '@mantine/core'
import { useState } from 'react'
import { LAYOUT, UI_TEXT } from '../config/index.js'
import classes from './app-shell.module.css'

interface AppShellLayoutProps {
  utilityRail: React.ReactNode
  navbar: React.ReactNode
  /** In-session document tabs rendered at the top of the central workspace. */
  tabStrip?: React.ReactNode
  /** Desktop-only page-tree visibility; owned by the composition root. */
  treeOpen: boolean
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
  children
}: AppShellLayoutProps): JSX.Element {
  const [mobileNavOpened, setMobileNavOpened] = useState(false)

  return (
    <AppShell
      navbar={{
        // Mobile drawers keep a usable width even when the desktop tree
        // is collapsed; desktop shrinks to just the rail width.
        width: { base: 280, sm: treeOpen ? LAYOUT.treePaneWidth : LAYOUT.railWidth },
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
