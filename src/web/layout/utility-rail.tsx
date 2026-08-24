import {
  ActionIcon,
  Box,
  Group,
  Popover,
  Stack,
  Switch,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import {
  IconHome,
  IconLayoutSidebar,
  IconMoon,
  IconPlus,
  IconPower,
  IconSearch,
  IconSettings,
  IconSun
} from '@tabler/icons-react'
import { useState } from 'react'
import { UI_TEXT } from '../config/index.js'
import {
  isDebugLoggingEnabled,
  readStoredDebugLoggingPreference,
  setDebugLoggingEnabled
} from '../diagnostics/debug-log.js'
import classes from './utility-rail.module.css'

interface UtilityRailProps {
  activeHome: boolean
  onHome: () => void
  onSearchFocus: () => void
  onNewPage: () => void
  onStop: () => void
  /** Desktop-only tree-pane visibility, mirrored into the toggle state. */
  treeOpen?: boolean
  /** Desktop-only collapse/expand control for the page-tree pane. */
  onToggleTree?: () => void
}

export function UtilityRail({
  activeHome,
  onHome,
  onSearchFocus,
  onNewPage,
  onStop,
  treeOpen,
  onToggleTree
}: UtilityRailProps): JSX.Element {
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', {
    getInitialValueInEffect: true
  })

  // Debug Mode toggle state. The diagnostics module is the single source of
  // truth; this mirror only drives the popover UI.
  const [debugEnabled, setDebugEnabled] = useState<boolean>(() => {
    // Prefer the live session state when present (e.g. restored at startup),
    // otherwise the persisted preference.
    return isDebugLoggingEnabled() || readStoredDebugLoggingPreference()
  })
  const handleDebugToggle = (checked: boolean): void => {
    setDebugLoggingEnabled(checked)
    setDebugEnabled(checked)
  }

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

        {onToggleTree ? (
          <Tooltip
            label={treeOpen ? UI_TEXT.collapseTreeLabel : UI_TEXT.expandTreeLabel}
            position="right"
          >
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={onToggleTree}
              aria-label={treeOpen ? UI_TEXT.collapseTreeLabel : UI_TEXT.expandTreeLabel}
              aria-expanded={treeOpen}
              className={classes.action}
              visibleFrom="sm"
              data-testid="tree-toggle"
            >
              <IconLayoutSidebar size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}

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
        <Popover withinPortal position="right" withArrow shadow="md">
          <Popover.Target>
            <Tooltip
              label={debugEnabled ? UI_TEXT.debugActiveLabel : UI_TEXT.settingsLabel}
              position="right"
            >
              <ActionIcon
                variant={debugEnabled ? 'light' : 'subtle'}
                color={debugEnabled ? 'teal' : 'gray'}
                size="lg"
                aria-label={UI_TEXT.settingsLabel}
                aria-pressed={debugEnabled}
                className={classes.action}
                data-testid="settings-toggle"
              >
                <IconSettings size={18} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown w={280} p="sm">
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600}>
                  {UI_TEXT.debugToggleLabel}
                </Text>
                <Switch
                  checked={debugEnabled}
                  onChange={(event) => handleDebugToggle(event.currentTarget.checked)}
                  aria-label={UI_TEXT.debugToggleLabel}
                  data-testid="debug-logging-switch"
                />
              </Group>
              <Text size="xs" c="dimmed">
                {UI_TEXT.debugToggleDescription}
              </Text>
              {debugEnabled ? (
                <Group gap="xs">
                  <Box
                    aria-hidden="true"
                    w={8}
                    h={8}
                    style={{
                      borderRadius: '50%',
                      background: 'var(--mantine-color-teal-filled)'
                    }}
                  />
                  <Text size="xs" c="teal">
                    {UI_TEXT.debugActiveLabel}
                  </Text>
                </Group>
              ) : null}
            </Stack>
          </Popover.Dropdown>
        </Popover>

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
