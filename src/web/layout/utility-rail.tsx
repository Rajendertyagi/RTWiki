import {
  ActionIcon,
  Stack,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import {
  IconCalendar,
  IconHelp,
  IconHome,
  IconLayoutSidebar,
  IconMoon,
  IconPlus,
  IconPower,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconTrash
} from '@tabler/icons-react'
import { UI_TEXT } from '../config/index.js'
import classes from './utility-rail.module.css'

interface UtilityRailProps {
  activeHome: boolean
  onHome: () => void
  onSearchFocus: () => void
  onNewPage: () => void
  onStop: () => void
  /** Opens the Settings workspace (Appearance, Layout, Editor, Debug Logs). */
  onOpenSettings: () => void
  /** Reflects whether the Settings workspace is currently open. */
  settingsOpen?: boolean
  /** Opens the Calendar / study timetable view. */
  onOpenCalendar?: () => void
  /** Reflects whether the Calendar view is currently open. */
  calendarOpen?: boolean
  /** Opens the Favorites view. */
  onOpenFavorites?: () => void
  /** Reflects whether the Favorites view is currently open. */
  favoritesOpen?: boolean
  /** Opens the Trash workspace view. */
  onOpenTrash?: () => void
  /** Reflects whether the Trash view is currently open. */
  trashOpen?: boolean
  /** Opens the Keyboard Shortcuts help modal. */
  onOpenShortcuts?: () => void
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
  onOpenSettings,
  settingsOpen,
  onOpenCalendar,
  calendarOpen,
  onOpenFavorites,
  favoritesOpen,
  onOpenTrash,
  trashOpen,
  onOpenShortcuts,
  treeOpen,
  onToggleTree
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
        <Stack gap={2} align="center">
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
          <Text
            size="10px"
            fw={700}
            c="dimmed"
            style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}
          >
            RTWiki
          </Text>
        </Stack>

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

        {onOpenFavorites ? (
          <Tooltip label={UI_TEXT.utilityRailFavorites} position="right">
            <ActionIcon
              variant={favoritesOpen ? 'filled' : 'subtle'}
              color={favoritesOpen ? 'blue' : 'gray'}
              size="lg"
              onClick={onOpenFavorites}
              aria-label={UI_TEXT.utilityRailFavorites}
              aria-pressed={favoritesOpen}
              className={classes.action}
              data-testid="favorites-toggle"
            >
              <IconStar size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}

        {onOpenCalendar ? (
          <Tooltip label={UI_TEXT.scheduleOpen} position="right">
            <ActionIcon
              variant={calendarOpen ? 'filled' : 'subtle'}
              color={calendarOpen ? 'blue' : 'gray'}
              size="lg"
              onClick={onOpenCalendar}
              aria-label={UI_TEXT.scheduleOpen}
              aria-pressed={calendarOpen}
              className={classes.action}
              data-testid="calendar-toggle"
            >
              <IconCalendar size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}

        {onOpenTrash ? (
          <Tooltip label={UI_TEXT.utilityRailTrash} position="right">
            <ActionIcon
              variant={trashOpen ? 'filled' : 'subtle'}
              color={trashOpen ? 'blue' : 'gray'}
              size="lg"
              onClick={onOpenTrash}
              aria-label={UI_TEXT.utilityRailTrash}
              aria-pressed={trashOpen}
              className={classes.action}
              data-testid="trash-toggle"
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}

        {onOpenShortcuts ? (
          <Tooltip label={UI_TEXT.utilityRailShortcuts} position="right">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={onOpenShortcuts}
              aria-label={UI_TEXT.utilityRailShortcuts}
              className={classes.action}
              data-testid="shortcuts-toggle"
            >
              <IconHelp size={18} />
            </ActionIcon>
          </Tooltip>
        ) : null}

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
        <Tooltip label={UI_TEXT.settingsLabel} position="right">
          <ActionIcon
            variant={settingsOpen ? 'filled' : 'subtle'}
            color={settingsOpen ? 'blue' : 'gray'}
            size="lg"
            onClick={onOpenSettings}
            aria-label={UI_TEXT.settingsLabel}
            aria-pressed={settingsOpen}
            className={classes.action}
            data-testid="settings-toggle"
          >
            <IconSettings size={18} />
          </ActionIcon>
        </Tooltip>

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
