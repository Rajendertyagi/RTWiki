import {
  Box,
  Button,
  Group,
  Radio,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import { TimeInput } from '@mantine/dates'
import { MAX_USER_PORT, MIN_USER_PORT } from '@rtwiki/shared/constants'
import {
  IconAppWindow,
  IconCalendarEvent,
  IconFileAnalytics,
  IconLayoutSidebar,
  IconPalette,
  IconSearch,
  IconTextCaption,
  IconX
} from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '../../diagnostics/debug-log.js'
import {
  type BrowserPermission,
  browserNotificationPermission,
  requestBrowserNotificationPermission
} from '../../services/browser-notify.js'
import {
  type AutostartState,
  getAutostartState,
  isNativeMode,
  setAutostartEnabled
} from '../../services/native-bridge.js'
import { scheduleNotifier } from '../../services/schedule-notifier.js'
import {
  type DesktopSettings,
  getDesktopSettings,
  getServerSettings,
  restartServerOnPort,
  type ServerPortSettings,
  serverBaseUrl,
  updateCloseBehavior,
  updateServerPort
} from '../../services/server-settings-api.js'
import { setWordWrap, useEditorPreferences } from '../workspace/editor-preferences.js'
import type { LayoutPreferences } from '../workspace/layout-preferences.js'
import {
  loadSchedulerPreferences,
  type SchedulerPreferences,
  saveSchedulerPreferences
} from '../workspace/scheduler-preferences.js'
import { DebugLogViewer } from './debug-log-viewer.js'
import classes from './settings.module.css'

type Section = 'appearance' | 'layout' | 'editor' | 'debugLogs' | 'scheduler' | 'desktop'

interface SettingsWorkspaceProps {
  layoutPrefs: LayoutPreferences
  onLayoutReset: () => void
  onClose: () => void
}

/**
 * The section list, each with an icon.
 *
 * Icons because this list is a *list*, and every other list in the app (the
 * page tree, the tab strip, the utility rail) leads with a small type icon.
 * Trilium's settings navigation does the same and, more usefully, styles itself
 * from the left-pane item tokens so it is visually indistinguishable from the
 * note tree. One idiom for "a list you can pick from" is the point; a second
 * look for the same action is what makes an app feel assembled rather than
 * designed.
 */
const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'appearance', label: UI_TEXT.settingsAppearance, icon: IconPalette },
  { id: 'layout', label: UI_TEXT.settingsLayout, icon: IconLayoutSidebar },
  { id: 'editor', label: UI_TEXT.settingsEditor, icon: IconTextCaption },
  { id: 'scheduler', label: UI_TEXT.settingsScheduler, icon: IconCalendarEvent },
  { id: 'desktop', label: UI_TEXT.settingsDesktop, icon: IconAppWindow },
  { id: 'debugLogs', label: UI_TEXT.settingsDebugLogs, icon: IconFileAnalytics }
]

function browserPermissionText(permission: BrowserPermission): string {
  switch (permission) {
    case 'granted':
      return UI_TEXT.schedulerBrowserAllowed
    case 'denied':
      return UI_TEXT.schedulerBrowserBlocked
    case 'unsupported':
      return UI_TEXT.schedulerBrowserUnsupported
    default:
      return UI_TEXT.schedulerBrowserDefault
  }
}

export function SettingsWorkspace({
  layoutPrefs,
  onLayoutReset,
  onClose
}: SettingsWorkspaceProps): JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  // Filters the section list. Trilium ships a settings search for the same
  // reason: a settings pane is a long list of short rows, and finding one by
  // scrolling is worse than typing three letters.
  const [query, setQuery] = useState('')
  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return SECTIONS
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q))
  }, [query])
  // `colorScheme` is the user's *choice* and may be 'auto'; `computedColorScheme`
  // is what is actually rendering. The control edits the choice, so "System"
  // can be selected and shown as chosen rather than being flattened into whichever
  // side of it the OS currently happens to be on.
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const editorPrefs = useEditorPreferences()
  const [debugEnabled, setDebugEnabled] = useState<boolean>(() => isDebugLoggingEnabled())
  const [schedPrefs, setSchedPrefs] = useState<SchedulerPreferences>(() =>
    loadSchedulerPreferences()
  )
  const [browserPerm, setBrowserPerm] = useState<BrowserPermission>(() =>
    browserNotificationPermission()
  )
  const [nativeMode] = useState<boolean>(() => isNativeMode())
  const [autostart, setAutostart] = useState<AutostartState>({ available: false, enabled: false })
  const [serverSettings, setServerSettings] = useState<ServerPortSettings | null>(null)
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings | null>(null)
  const [portField, setPortField] = useState<string>('')
  const [portMessage, setPortMessage] = useState<string | null>(null)
  const [restarting, setRestarting] = useState<boolean>(false)

  useEffect(() => {
    if (!nativeMode) return
    void getAutostartState().then(setAutostart)
  }, [nativeMode])

  useEffect(() => {
    let cancelled = false
    void getServerSettings()
      .then((s) => {
        if (cancelled) return
        setServerSettings(s)
        setPortField(String(s.configuredPort))
      })
      .catch(() => {})
    void getDesktopSettings()
      .then((s) => {
        if (!cancelled) setDesktopSettings(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleDebugToggle = (checked: boolean): void => {
    setDebugLoggingEnabled(checked)
    setDebugEnabled(checked)
  }

  const updateScheduler = (patch: Partial<SchedulerPreferences>): void => {
    const next = { ...schedPrefs, ...patch }
    setSchedPrefs(next)
    saveSchedulerPreferences(next)
    scheduleNotifier.applyPreferences(next)
  }

  const handleBrowserToggle = async (checked: boolean): Promise<void> => {
    if (!checked) {
      updateScheduler({ browserEnabled: false })
      return
    }
    const result = await requestBrowserNotificationPermission()
    setBrowserPerm(result)
    updateScheduler({ browserEnabled: result === 'granted' })
  }

  const handleAutostartToggle = (checked: boolean): void => {
    void setAutostartEnabled(checked).then((ok) => {
      if (!ok) return
      setAutostart((prev) => ({ ...prev, enabled: checked }))
    })
  }

  const handlePortSave = (): void => {
    const parsed = Number(portField.trim())
    if (!Number.isInteger(parsed) || parsed < MIN_USER_PORT || parsed > MAX_USER_PORT) {
      setPortMessage(UI_TEXT.desktopPortInvalid)
      return
    }
    void updateServerPort(parsed)
      .then((s) => {
        setServerSettings(s)
        setPortMessage(
          s.restartRequired ? UI_TEXT.desktopPortRestartNeeded : UI_TEXT.desktopPortSaved
        )
      })
      .catch((err: unknown) => {
        setPortMessage(err instanceof Error ? err.message : UI_TEXT.desktopPortInvalid)
      })
  }

  const handleRestart = (): void => {
    if (!serverSettings || restarting) return
    const targetPort = serverSettings.port
    setRestarting(true)
    setPortMessage(null)
    void restartServerOnPort(targetPort)
      .then((ok) => {
        if (ok) {
          window.location.href = serverBaseUrl(targetPort)
        } else {
          setRestarting(false)
          setPortMessage(UI_TEXT.desktopRestartFailed)
        }
      })
      .catch((err: unknown) => {
        setRestarting(false)
        setPortMessage(err instanceof Error ? err.message : UI_TEXT.desktopRestartFailed)
      })
  }

  const handleCloseBehavior = (value: string): void => {
    if (value !== 'ask' && value !== 'minimize' && value !== 'quit') return
    void updateCloseBehavior(value)
      .then(setDesktopSettings)
      .catch(() => {})
  }

  return (
    <div className={classes.workspace} data-testid="settings-workspace">
      <nav className={classes.nav} aria-label={UI_TEXT.settingsLabel}>
        <TextInput
          size="xs"
          className={classes.navSearch}
          placeholder={UI_TEXT.settingsSearchPlaceholder}
          aria-label={UI_TEXT.settingsSearchPlaceholder}
          leftSection={<IconSearch size={13} />}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className={classes.navList}>
          {visibleSections.map((item) => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={active ? `${classes.navItem} ${classes.navItemActive}` : classes.navItem}
                aria-current={active ? 'page' : undefined}
                onClick={() => setSection(item.id)}
              >
                <item.icon size={15} />
                <span className={classes.navItemLabel}>{item.label}</span>
              </button>
            )
          })}
          {visibleSections.length === 0 && (
            <Text size="xs" c="dimmed" className={classes.navEmpty}>
              {UI_TEXT.settingsNoMatches}
            </Text>
          )}
        </div>
      </nav>

      <div className={classes.content}>
        <Group justify="flex-end" className={classes.header}>
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconX size={14} />}
            onClick={onClose}
            aria-label={UI_TEXT.settingsCloseLabel}
          >
            {UI_TEXT.settingsCloseLabel}
          </Button>
        </Group>

        <ScrollArea className={classes.scroll} type="never">
          {section === 'appearance' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsAppearance}</Title>
              <Text size="sm" c="dimmed">
                {UI_TEXT.appearanceThemeHint}
              </Text>
              <Group gap="xs">
                <Text size="sm" w={500}>
                  {UI_TEXT.appearanceThemeLabel}
                </Text>
                <SegmentedControl
                  value={colorScheme ?? 'auto'}
                  data-testid="appearance-control"
                  onChange={(value) => setColorScheme(value as 'auto' | 'light' | 'dark')}
                  data={[
                    { value: 'auto', label: UI_TEXT.appearanceThemeAuto },
                    { value: 'light', label: UI_TEXT.appearanceThemeLight },
                    { value: 'dark', label: UI_TEXT.appearanceThemeDark }
                  ]}
                />
              </Group>
            </Stack>
          ) : null}

          {section === 'layout' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsLayout}</Title>
              <Box className={classes.kv}>
                <Text size="sm">{UI_TEXT.layoutTreeWidthLabel}</Text>
                <Text size="sm" c="dimmed">
                  {layoutPrefs.treeWidth}px
                </Text>
              </Box>
              <Box className={classes.kv}>
                <Text size="sm">{UI_TEXT.layoutTreeCollapsedLabel}</Text>
                <Text size="sm" c="dimmed">
                  {layoutPrefs.treeCollapsed ? UI_TEXT.yesLabel : UI_TEXT.noLabel}
                </Text>
              </Box>
              <Box className={classes.kv}>
                <Text size="sm">{UI_TEXT.layoutInspectorWidthLabel}</Text>
                <Text size="sm" c="dimmed">
                  {layoutPrefs.rightSidebarWidth}px
                </Text>
              </Box>
              <Button variant="light" onClick={onLayoutReset} data-testid="settings-reset-layout">
                {UI_TEXT.layoutResetLabel}
              </Button>
              <Text size="xs" c="dimmed">
                {UI_TEXT.layoutResetHint}
              </Text>
            </Stack>
          ) : null}

          {section === 'editor' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsEditor}</Title>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" w={500}>
                    {UI_TEXT.ideWordWrapLabel}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {UI_TEXT.editorWordWrapHint}
                  </Text>
                </div>
                <Switch
                  checked={editorPrefs.wordWrap}
                  onChange={(event) => setWordWrap(event.currentTarget.checked)}
                  aria-label={UI_TEXT.ideWordWrapLabel}
                  data-testid="settings-word-wrap"
                />
              </Group>
            </Stack>
          ) : null}

          {section === 'scheduler' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsScheduler}</Title>

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" w={500}>
                    {UI_TEXT.schedulerInApp}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {UI_TEXT.schedulerInAppHint}
                  </Text>
                </div>
                <Switch
                  checked={schedPrefs.inAppEnabled}
                  onChange={(event) =>
                    updateScheduler({ inAppEnabled: event.currentTarget.checked })
                  }
                  aria-label={UI_TEXT.schedulerInApp}
                  data-testid="scheduler-inapp"
                />
              </Group>

              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" w={500}>
                    {UI_TEXT.schedulerBrowser}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {UI_TEXT.schedulerBrowserHint}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {browserPermissionText(browserPerm)}
                  </Text>
                </div>
                <Switch
                  checked={schedPrefs.browserEnabled}
                  onChange={(event) => void handleBrowserToggle(event.currentTarget.checked)}
                  aria-label={UI_TEXT.schedulerBrowser}
                  data-testid="scheduler-browser"
                />
              </Group>

              <Title order={6}>{UI_TEXT.schedulerQuietHours}</Title>
              <Group gap="sm">
                <TimeInput
                  label={UI_TEXT.schedulerQuietStart}
                  value={schedPrefs.quietStart ?? ''}
                  onChange={(event) =>
                    updateScheduler({ quietStart: event.currentTarget.value || null })
                  }
                  data-testid="scheduler-quiet-start"
                />
                <TimeInput
                  label={UI_TEXT.schedulerQuietEnd}
                  value={schedPrefs.quietEnd ?? ''}
                  onChange={(event) =>
                    updateScheduler({ quietEnd: event.currentTarget.value || null })
                  }
                  data-testid="scheduler-quiet-end"
                />
              </Group>

              <Button
                variant="light"
                onClick={() => scheduleNotifier.fireTest()}
                data-testid="scheduler-test"
              >
                {UI_TEXT.schedulerTest}
              </Button>
            </Stack>
          ) : null}

          {section === 'desktop' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsDesktop}</Title>
              <Text size="xs" c="dimmed">
                {nativeMode ? UI_TEXT.desktopModeLabel : UI_TEXT.desktopBrowserModeLabel}
              </Text>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" w={500}>
                    {UI_TEXT.desktopAutostart}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {autostart.available
                      ? UI_TEXT.desktopAutostartHint
                      : UI_TEXT.desktopAutostartUnavailable}
                  </Text>
                </div>
                <Switch
                  checked={autostart.enabled}
                  disabled={!autostart.available}
                  onChange={(event) => handleAutostartToggle(event.currentTarget.checked)}
                  aria-label={UI_TEXT.desktopAutostart}
                  data-testid="desktop-autostart"
                />
              </Group>

              <Title order={6}>{UI_TEXT.desktopPort}</Title>
              <Group gap="xs" align="end">
                <TextInput
                  label={UI_TEXT.desktopPort}
                  value={portField}
                  inputMode="numeric"
                  disabled={restarting}
                  onChange={(event) => setPortField(event.currentTarget.value)}
                  data-testid="desktop-port"
                />
                <Button
                  variant="light"
                  onClick={handlePortSave}
                  disabled={restarting}
                  data-testid="desktop-port-save"
                >
                  {UI_TEXT.desktopPortSave}
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                {UI_TEXT.desktopPortHint}
              </Text>
              {portMessage ? (
                <Text size="xs" data-testid="desktop-port-message">
                  {portMessage}
                </Text>
              ) : null}
              {restarting && serverSettings ? (
                <Text size="xs" data-testid="desktop-restarting">
                  {UI_TEXT.desktopRestarting.replace('{port}', String(serverSettings.port))}
                </Text>
              ) : null}
              {serverSettings?.restartRequired && !restarting ? (
                nativeMode ? (
                  <Button variant="light" onClick={handleRestart} data-testid="desktop-restart">
                    {UI_TEXT.desktopRestartNow}
                  </Button>
                ) : (
                  <Text size="xs" c="dimmed">
                    {UI_TEXT.desktopRestartBrowserHint}
                  </Text>
                )
              ) : null}

              <Title order={6}>{UI_TEXT.desktopCloseBehavior}</Title>
              <Radio.Group
                value={desktopSettings?.closeBehavior ?? 'ask'}
                onChange={handleCloseBehavior}
                aria-label={UI_TEXT.desktopCloseBehavior}
                data-testid="desktop-close-behavior"
              >
                <Stack gap={4}>
                  <Radio value="ask" label={UI_TEXT.desktopCloseAsk} disabled={!nativeMode} />
                  <Radio
                    value="minimize"
                    label={UI_TEXT.desktopCloseMinimize}
                    disabled={!nativeMode}
                  />
                  <Radio value="quit" label={UI_TEXT.desktopCloseQuit} disabled={!nativeMode} />
                </Stack>
              </Radio.Group>
              <Text size="xs" c="dimmed">
                {nativeMode ? UI_TEXT.desktopCloseHint : UI_TEXT.desktopCloseUnavailable}
              </Text>
            </Stack>
          ) : null}

          {section === 'debugLogs' ? (
            <Stack gap="sm" className={classes.section}>
              <Title order={5}>{UI_TEXT.settingsDebugLogs}</Title>
              <Group justify="space-between" wrap="nowrap">
                <div>
                  <Text size="sm" w={500}>
                    {UI_TEXT.debugToggleLabel}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {UI_TEXT.debugToggleDescription}
                  </Text>
                </div>
                <Switch
                  checked={debugEnabled}
                  onChange={(event) => handleDebugToggle(event.currentTarget.checked)}
                  aria-label={UI_TEXT.debugToggleLabel}
                  data-testid="debug-logging-switch"
                />
              </Group>
              <Text size="xs" c="dimmed" fw={600}>
                {UI_TEXT.debugLogsLiveLabel}
              </Text>
              <DebugLogViewer enabled={debugEnabled} />
            </Stack>
          ) : null}
        </ScrollArea>
      </div>
    </div>
  )
}
