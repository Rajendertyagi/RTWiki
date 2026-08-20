import { AppShell, Burger, Group, Title } from '@mantine/core'
import { useState } from 'react'
import { ThemeToggle } from '../components/theme-toggle.js'
import { UI_TEXT } from '../config/index.js'
import classes from './app-shell.module.css'

interface AppShellLayoutProps {
  navbar: React.ReactNode
  children: React.ReactNode
}

export function AppShellLayout({ navbar, children }: AppShellLayoutProps): JSX.Element {
  const [opened, setOpened] = useState(false)

  return (
    <AppShell
      header={{ height: 44 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !opened } }}
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
          <ThemeToggle />
        </div>
      </AppShell.Header>

      <AppShell.Navbar p={0}>{navbar}</AppShell.Navbar>

      <AppShell.Main className={classes.main}>{children}</AppShell.Main>
    </AppShell>
  )
}
