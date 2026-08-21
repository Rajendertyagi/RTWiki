import {
  ActionIcon,
  Stack,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import { IconHome, IconMoon, IconPlus, IconPower, IconSearch, IconSun } from '@tabler/icons-react'
import { UI_TEXT } from '../config/index.js'
import classes from './utility-rail.module.css'

interface UtilityRailProps {
  activeHome: boolean
  onHome: () => void
  onSearchFocus: () => void
  onNewPage: () => void
  onStop: () => void
}

export function UtilityRail({
  activeHome,
  onHome,
  onSearchFocus,
  onNewPage,
  onStop
}: UtilityRailProps): JSX.Element {
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true
  })

  const toggleTheme = (): void => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <nav className={classes.rail} aria-label={UI_TEXT.appName}>
      <Stack gap="xs" align="center" className={classes.topGroup}>
        <Tooltip label={UI_TEXT.utilityRailHome} position="right">
          <ActionIcon
            variant={activeHome ? 'filled' : 'subtle'}
            color={activeHome ? 'blue' : 'gray'}
            size="lg"
            onClick={onHome}
            aria-label={UI_TEXT.utilityRailHome}
            aria-current={activeHome ? 'page' : undefined}
            className={classes.action}
          >
            <IconHome size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={UI_TEXT.utilityRailSearch} position="right">
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={onSearchFocus}
            aria-label={UI_TEXT.utilityRailSearch}
            className={classes.action}
          >
            <IconSearch size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={UI_TEXT.utilityRailNewPage} position="right">
          <ActionIcon
            variant="light"
            color="blue"
            size="lg"
            onClick={onNewPage}
            aria-label={UI_TEXT.utilityRailNewPage}
            className={classes.action}
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={UI_TEXT.utilityRailTheme} position="right">
          <ActionIcon
            variant="subtle"
            size="lg"
            onClick={toggleTheme}
            aria-label={UI_TEXT.utilityRailTheme}
            className={classes.action}
          >
            {computedColorScheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </ActionIcon>
        </Tooltip>
      </Stack>

      <div className={classes.spacer} />

      <Stack gap="xs" align="center" className={classes.bottomGroup}>
        <Tooltip label={UI_TEXT.utilityRailStop} position="right">
          <ActionIcon
            variant="subtle"
            color="red"
            size="lg"
            onClick={onStop}
            aria-label={UI_TEXT.utilityRailStop}
            className={classes.stopAction}
          >
            <IconPower size={18} />
          </ActionIcon>
        </Tooltip>
      </Stack>
    </nav>
  )
}
