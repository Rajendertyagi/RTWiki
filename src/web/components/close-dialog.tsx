/**
 * In-app close confirmation dialog (desktop shell only).
 *
 * The Rust shell prevents the native close and emits `rtwiki:close-request`
 * when the saved close behavior is "ask". This component shows a dialog with
 * three explicit actions and a "Remember my choice" checkbox. On mount it calls
 * `close_dialog_ready` so the shell knows a listener exists before it emits;
 * without that handshake a press during boot would be lost. Every answer goes
 * through `resolve_close_request` so the shell releases its prompt flag first.
 */

import { Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core'
import { CLOSE_REQUEST_EVENT } from '@rtwiki/shared/constants'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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

    // Handshake FIRST, independent of the listen() promise. The Rust shell only
    // emits rtwiki:close-request when close_prompt_ready is true; nesting this
    // invoke inside listen().then() made a click during boot fall through to
    // hide-to-tray with no dialog. Arming readiness immediately closes that gap.
    void invoke('close_dialog_ready').catch((err: unknown) => {
      console.error('[close-dialog] readiness handshake failed:', err)
    })

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
      if (disposed) {
        fn()
        return
      }
      unlisten = fn
      // Re-arm after the listener is actually registered: a webview reload can
      // clear the shell's flag, and this guarantees readiness tracks the real
      // listener state rather than just "the component mounted".
      void invoke('close_dialog_ready').catch((err: unknown) => {
        console.error('[close-dialog] readiness handshake failed:', err)
      })
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  if (!isNativeMode()) return null

  const resolve = (action: 'minimize' | 'quit' | 'cancel'): void => {
    void invoke('resolve_close_request', { action }).catch((err: unknown) => {
      console.error('[close-dialog] failed to resolve close request:', err)
    })
  }

  const cancel = (): void => {
    setOpened(false)
    resolve('cancel')
  }

  const choose = (behavior: CloseChoice): void => {
    setBusy(true)
    setError(null)
    const apply = async (): Promise<void> => {
      if (remember) await updateCloseBehavior(behavior)
      // Rust releases the prompt flag and performs hide/quit in one command.
      await invoke('resolve_close_request', { action: behavior })
      setOpened(false)
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
      onClose={cancel}
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
          <Button variant="default" onClick={cancel} disabled={busy}>
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
