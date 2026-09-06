import {
  Box,
  Button,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { UI_TEXT } from '../../config/index.js'
import { isDebugLoggingEnabled, setDebugLoggingEnabled } from '../../diagnostics/debug-log.js'
import { setWordWrap, useEditorPreferences } from '../workspace/editor-preferences.js'
import type { LayoutPreferences } from '../workspace/layout-preferences.js'
import { DebugLogViewer } from './debug-log-viewer.js'
import classes from './settings.module.css'

type Section = 'appearance' | 'layout' | 'editor' | 'debugLogs'

interface SettingsWorkspaceProps {
  layoutPrefs: LayoutPreferences
  onLayoutReset: () => void
  onClose: () => void
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: UI_TEXT.settingsAppearance },
  { id: 'layout', label: UI_TEXT.settingsLayout },
  { id: 'editor', label: UI_TEXT.settingsEditor },
  { id: 'debugLogs', label: UI_TEXT.settingsDebugLogs }
]

export function SettingsWorkspace({
  layoutPrefs,
  onLayoutReset,
  onClose
}: SettingsWorkspaceProps): JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true })
  const editorPrefs = useEditorPreferences()
  const [debugEnabled, setDebugEnabled] = useState<boolean>(() => isDebugLoggingEnabled())

  const handleDebugToggle = (checked: boolean): void => {
    setDebugLoggingEnabled(checked)
    setDebugEnabled(checked)
  }

  return (
    <div className={classes.workspace} data-testid="settings-workspace">
      <div className={classes.nav}>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${classes.navItem} ${section === item.id ? classes.navItemActive : ''}`}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={classes.content}>
        <Group justify="space-between" className={classes.header}>
          <Title order={3}>{UI_TEXT.settingsLabel}</Title>
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
                  value={computedColorScheme}
                  onChange={(value) => setColorScheme(value as 'light' | 'dark')}
                  data={[
                    { value: 'light', label: UI_TEXT.appearanceThemeLight },
                    { value: 'dark', label: UI_TEXT.appearanceThemeDark }
                  ]}
                  data-testid="settings-theme-control"
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
