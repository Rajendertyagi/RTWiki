import { AppShell, Burger, Group, Title } from '@mantine/core'
import { useState } from 'react'
import { UI_TEXT } from '../config/index.js'
import classes from './app-shell.module.css'

interface AppShellLayoutProps {
  utilityRail: React.ReactNode
  navbar: React.ReactNode
  children: React.ReactNode
}

export function AppShellLayout({
  utilityRail,
  navbar,
  children
}: AppShellLayoutProps): JSX.Element {
  const [opened, setOpened] = useState(false)

  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{ width: 336, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <div className={classes.headerInner}>
          <Group gap="sm">
            <Burger
              opened={opened}
              onClick={() => setOpened((o) => !o)}
              hiddenFrom="sm"
              size="sm"
            />
            <Title order={4} className={classes.headerTitle}>
              {UI_TEXT.appName}
            </Title>
          </Group>
        </div>
      </AppShell.Header>

      <AppShell.Navbar p={0}>
        <div className={classes.navbarInner}>
          <div className={classes.railColumn}>{utilityRail}</div>
          <div className={classes.sidebarColumn}>{navbar}</div>
        </div>
      </AppShell.Navbar>

      <AppShell.Main className={classes.main}>{children}</AppShell.Main>
    </AppShell>
  )
}
