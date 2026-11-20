/**
 * In-app close confirmation dialog (desktop shell only).
 *
 * The Rust shell prevents the native close and emits `rtwiki:close-request`
 * when the saved close behavior is "ask". This component shows a dialog with
 * three explicit actions and a "Remember my choice" checkbox. When checked,
 * the chosen behavior is persisted through the settings API so the shell acts
 * on it directly next time, without asking again.
 */

import { Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core'
import { CLOSE_REQUEST_EVENT } from '@rtwiki/shared/constants'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { UI_TEXT } from '../config/index.js'
import { isNativeMode } from '../services/native-bridge.js'
import { getDesktopSettings, updateCloseBehavior } from '../services/server-settings-api.js'

type CloseChoice = 'minimize' | 'quit'

export function CloseDialog(): React.ReactElement | null {
  const [opened, setOpened] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isNativeMode()) return
    let disposed = false
    let unlisten: (() => void) | null = null

    void listen(CLOSE_REQUEST_EVENT, () => {
      if (disposed) return
      // Read the preference fresh: Settings may have changed it this session.
      void getDesktopSettings()
        .then((settings) => {
          if (!disposed) setRemember(settings.rememberCloseChoice)
        })
        .catch(() => {
          if (!disposed) setRemember(false)
        })
      setError(null)
      setOpened(true)
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  if (!isNativeMode()) return null

  const choose = (behavior: CloseChoice): void => {
    setBusy(true)
    setError(null)
    const apply = async (): Promise<void> => {
      if (remember) await updateCloseBehavior(behavior)
      if (behavior === 'minimize') {
        setOpened(false)
        await getCurrentWindow().hide()
      } else {
        // Quit directly through Rust so the close request is not re-raised.
        await invoke('quit_from_dialog')
      }
    }
    void apply().catch((err: unknown) => {
      console.error('[close-dialog] failed to apply close choice:', err)
      setError(UI_TEXT.closeDialogFailed)
      setBusy(false)
    })
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={UI_TEXT.closeDialogTitle}
      centered
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap="md">
        <Text size="sm">{UI_TEXT.closeDialogMessage}</Text>
        <Checkbox
          checked={remember}
          onChange={(event) => setRemember(event.currentTarget.checked)}
          label={UI_TEXT.closeDialogRemember}
          disabled={busy}
        />
        {error ? (
          <Text size="xs" c="red">
            {error}
          </Text>
        ) : null}
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => setOpened(false)} disabled={busy}>
            {UI_TEXT.closeDialogCancel}
          </Button>
          <Button variant="light" loading={busy} onClick={() => choose('minimize')}>
            {UI_TEXT.closeDialogMinimize}
          </Button>
          <Button color="red" loading={busy} onClick={() => choose('quit')}>
            {UI_TEXT.closeDialogExit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
